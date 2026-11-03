import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config.js";
import { InstagramClient, InstagramApiError, type ClientOptions } from "./client.js";

/**
 * What `npm run token:refresh` saves. Instagram's long-lived tokens last 60 days and the API
 * has no endpoint that reports a token's expiry, so we track it ourselves from `expires_in`.
 */
export interface StoredToken {
  accessToken: string;
  expiresAt: string;
  refreshedAt: string;
  /** Fingerprint of the IG_ACCESS_TOKEN this chain of refreshes started from. */
  envTokenFingerprint: string;
}

export interface ResolvedToken {
  accessToken: string;
  source: "env" | "store";
  expiresAt: Date | undefined;
  refreshedAt: Date | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Suggest refreshing once fewer than this many days remain. */
export const REFRESH_WARNING_DAYS = 10;

export function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export async function readTokenStore(file: string): Promise<StoredToken | undefined> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const data = JSON.parse(raw) as Partial<StoredToken>;
  if (!data.accessToken || !data.expiresAt || !data.refreshedAt || !data.envTokenFingerprint) {
    throw new Error(
      `Token store ${file} is malformed. Delete it and run \`npm run token:refresh\`.`,
    );
  }
  return data as StoredToken;
}

export async function writeTokenStore(file: string, data: StoredToken): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Pick the token to use. A refreshed token in the store wins, but only if it descends from the
 * current IG_ACCESS_TOKEN — if you paste a brand-new token into the env, the env wins.
 */
export async function resolveAccessToken(config: Config): Promise<ResolvedToken> {
  const stored = await readTokenStore(config.tokenStorePath);
  const envFp = fingerprint(config.accessToken);
  if (
    stored &&
    (stored.envTokenFingerprint === envFp || fingerprint(stored.accessToken) === envFp)
  ) {
    return {
      accessToken: stored.accessToken,
      source: "store",
      expiresAt: new Date(stored.expiresAt),
      refreshedAt: new Date(stored.refreshedAt),
    };
  }
  return {
    accessToken: config.accessToken,
    source: "env",
    expiresAt: undefined,
    refreshedAt: undefined,
  };
}

interface RefreshResponse {
  access_token: string;
  token_type?: string;
  expires_in: number;
}

/** Exchange the current long-lived token for a fresh 60-day one and save it to the store. */
export async function refreshAccessToken(
  config: Config,
  options: { now?: Date; clientOptions?: Partial<ClientOptions> } = {},
): Promise<StoredToken> {
  const now = options.now ?? new Date();
  const current = await resolveAccessToken(config);
  const client = new InstagramClient({
    baseUrl: config.baseUrl,
    apiVersion: config.apiVersion,
    ...options.clientOptions,
    accessToken: current.accessToken,
  });
  const res = await client.get<RefreshResponse>(
    "refresh_access_token",
    { grant_type: "ig_refresh_token" },
    { versioned: false },
  );
  if (!res.access_token || typeof res.expires_in !== "number") {
    throw new Error(
      "Unexpected response from refresh_access_token (missing access_token/expires_in).",
    );
  }
  const stored: StoredToken = {
    accessToken: res.access_token,
    expiresAt: new Date(now.getTime() + res.expires_in * 1000).toISOString(),
    refreshedAt: now.toISOString(),
    envTokenFingerprint: fingerprint(config.accessToken),
  };
  await writeTokenStore(config.tokenStorePath, stored);
  return stored;
}

export interface TokenStatus {
  valid: boolean;
  username?: string;
  userId?: string;
  source: ResolvedToken["source"];
  expiresAt?: string;
  daysLeft?: number;
  advice: string;
}

/** Verify the token against the API and report what we know about its expiry. */
export async function checkToken(
  client: InstagramClient,
  token: ResolvedToken,
  now: Date = new Date(),
): Promise<TokenStatus> {
  const expiry =
    token.expiresAt === undefined
      ? {}
      : {
          expiresAt: token.expiresAt.toISOString(),
          daysLeft: Math.floor((token.expiresAt.getTime() - now.getTime()) / DAY_MS),
        };

  let me: { user_id?: string; id?: string; username?: string };
  try {
    me = await client.get("me", { fields: "user_id,username" });
  } catch (error) {
    if (error instanceof InstagramApiError && error.isAuthError) {
      return { valid: false, source: token.source, ...expiry, advice: error.message };
    }
    throw error;
  }

  let advice: string;
  if (expiry.daysLeft === undefined) {
    advice =
      "Token works. Its expiry isn't tracked yet: run `npm run token:refresh` (the token must be at " +
      "least 24 hours old) to get a fresh 60-day token and start tracking expiry.";
  } else if (expiry.daysLeft <= REFRESH_WARNING_DAYS) {
    advice = `Token expires in ${expiry.daysLeft} day(s). Run \`npm run token:refresh\` now.`;
  } else {
    advice = `Token works and expires in ${expiry.daysLeft} days. Refresh it with \`npm run token:refresh\` when fewer than ${REFRESH_WARNING_DAYS} days remain.`;
  }
  return {
    valid: true,
    username: me.username,
    userId: me.user_id ?? me.id,
    source: token.source,
    ...expiry,
    advice,
  };
}
