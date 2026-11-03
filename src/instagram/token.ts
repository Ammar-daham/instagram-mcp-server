import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config.js";
import { InstagramClient, InstagramApiError, type ClientOptions } from "./client.js";

/**
 * What `npm run token:refresh` saves. Instagram-login tokens have no expiry lookup endpoint,
 * so we track their expiry ourselves from `expires_in`.
 */
export interface StoredToken {
  accessToken: string;
  /** ISO date, or null if Meta says the token doesn't expire. */
  expiresAt: string | null;
  refreshedAt: string;
  /** Fingerprint of the IG_ACCESS_TOKEN this chain of refreshes started from. */
  envTokenFingerprint: string;
}

export interface ResolvedToken {
  accessToken: string;
  source: "env" | "store";
  expiresAt: Date | null | undefined;
  refreshedAt: Date | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Suggest refreshing once fewer than this many days remain. */
export const REFRESH_WARNING_DAYS = 10;

/** Facebook-login permissions the finished project relies on (publishing and insights). */
export const FACEBOOK_PERMISSIONS = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "pages_read_engagement",
];

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
  if (
    !data.accessToken ||
    data.expiresAt === undefined ||
    !data.refreshedAt ||
    !data.envTokenFingerprint
  ) {
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
      expiresAt: stored.expiresAt === null ? null : new Date(stored.expiresAt),
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
  expires_in?: number;
}

/**
 * Exchange the current token for a fresh long-lived one and save it to the store.
 * - Instagram login: `GET /refresh_access_token?grant_type=ig_refresh_token` (60 days; the token
 *   must be at least 24h old).
 * - Facebook login: `GET /oauth/access_token?grant_type=fb_exchange_token` (needs the app ID and
 *   secret; ~60 days for user tokens).
 */
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

  let res: RefreshResponse;
  if (config.loginType === "facebook") {
    if (!config.appId || !config.appSecret) {
      throw new Error(
        "Refreshing a Facebook-login token needs META_APP_ID and META_APP_SECRET " +
          "(App settings → Basic in the Meta app dashboard). Add them to .env.",
      );
    }
    res = await client.get<RefreshResponse>(
      "oauth/access_token",
      {
        grant_type: "fb_exchange_token",
        client_id: config.appId,
        client_secret: config.appSecret,
        fb_exchange_token: current.accessToken,
      },
      { auth: false },
    );
  } else {
    res = await client.get<RefreshResponse>(
      "refresh_access_token",
      { grant_type: "ig_refresh_token" },
      { versioned: false },
    );
  }
  if (!res.access_token) {
    throw new Error("Unexpected response from Meta: no access_token in the refresh response.");
  }
  const stored: StoredToken = {
    accessToken: res.access_token,
    expiresAt:
      typeof res.expires_in === "number" && res.expires_in > 0
        ? new Date(now.getTime() + res.expires_in * 1000).toISOString()
        : null,
    refreshedAt: now.toISOString(),
    envTokenFingerprint: fingerprint(config.accessToken),
  };
  await writeTokenStore(config.tokenStorePath, stored);
  return stored;
}

export interface TokenStatus {
  valid: boolean;
  loginType: Config["loginType"];
  username?: string;
  userId?: string;
  source: ResolvedToken["source"];
  /** ISO date, "never", or absent when unknown. */
  expiresAt?: string;
  daysLeft?: number;
  permissions?: string[];
  missingPermissions?: string[];
  advice: string;
}

interface DebugTokenResponse {
  data: {
    is_valid: boolean;
    expires_at?: number;
    scopes?: string[];
    error?: { message?: string };
  };
}

/**
 * Ask Meta about a Facebook-login token. With the app ID/secret we use an app access token,
 * which can inspect any token of the app; otherwise the token inspects itself, which Meta only
 * allows for tokens of apps you own or develop.
 */
async function debugFacebookToken(
  client: InstagramClient,
  accessToken: string,
  config: Partial<Pick<Config, "appId" | "appSecret">>,
): Promise<DebugTokenResponse | { note: string }> {
  const appToken =
    config.appId && config.appSecret ? `${config.appId}|${config.appSecret}` : undefined;
  try {
    return await client.get<DebugTokenResponse>(
      "debug_token",
      { input_token: accessToken, ...(appToken ? { access_token: appToken } : {}) },
      { auth: !appToken },
    );
  } catch (error) {
    if (error instanceof InstagramApiError && !error.isAuthError) {
      return {
        note: appToken
          ? `Couldn't read the token's expiry from Meta (${error.graph?.message ?? error.message}).`
          : "Its expiry couldn't be checked: add META_APP_ID and META_APP_SECRET (App settings → Basic) to .env so Meta reports it.",
      };
    }
    throw error;
  }
}

/** Verify the token against the API and report what we know about its expiry. */
export async function checkToken(
  client: InstagramClient,
  token: ResolvedToken,
  config: Pick<Config, "loginType" | "userId"> & Partial<Pick<Config, "appId" | "appSecret">>,
  now: Date = new Date(),
): Promise<TokenStatus> {
  const base = { loginType: config.loginType, source: token.source };
  let expiresAt = token.expiresAt;
  let permissions: string[] | undefined;
  let missingPermissions: string[] | undefined;

  try {
    let expiryNote: string | undefined;
    if (config.loginType === "facebook") {
      const debug = await debugFacebookToken(client, token.accessToken, config);
      if ("note" in debug) {
        expiryNote = debug.note;
      } else {
        const { data } = debug;
        if (!data.is_valid) {
          return {
            ...base,
            valid: false,
            advice: `Meta says the token is no longer valid${data.error?.message ? `: ${data.error.message}` : ""}. Generate a new one (see docs/META_SETUP.md).`,
          };
        }
        if (data.expires_at !== undefined) {
          expiresAt = data.expires_at === 0 ? null : new Date(data.expires_at * 1000);
        }
        permissions = data.scopes;
        missingPermissions = FACEBOOK_PERMISSIONS.filter((p) => !data.scopes?.includes(p));
      }
    }
    const me =
      config.loginType === "facebook"
        ? await client
            .get<{ id: string; username: string }>(config.userId!, { fields: "id,username" })
            .then((r) => ({ user_id: r.id, username: r.username }))
        : await client.get<{ user_id?: string; username?: string }>("me", {
            fields: "user_id,username",
          });

    const daysLeft =
      expiresAt instanceof Date
        ? Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS)
        : undefined;

    let advice: string;
    if (expiresAt === null) {
      advice = "Token works and does not expire.";
    } else if (daysLeft === undefined && expiryNote) {
      advice = `Token works. ${expiryNote}`;
    } else if (daysLeft === undefined) {
      advice =
        "Token works. Its expiry isn't tracked yet: run `npm run token:refresh` (the token must be at " +
        "least 24 hours old) to get a fresh 60-day token and start tracking expiry.";
    } else if (daysLeft <= REFRESH_WARNING_DAYS) {
      advice = `Token expires in ${daysLeft} day(s). Run \`npm run token:refresh\` now.`;
    } else {
      advice = `Token works and expires in ${daysLeft} days. Refresh it with \`npm run token:refresh\` when fewer than ${REFRESH_WARNING_DAYS} days remain.`;
    }
    if (missingPermissions?.length) {
      advice += ` Missing permissions needed by later features: ${missingPermissions.join(", ")}. Regenerate the token with them ticked.`;
    }

    return {
      ...base,
      valid: true,
      username: me.username,
      userId: me.user_id,
      ...(expiresAt === null ? { expiresAt: "never" } : {}),
      ...(expiresAt instanceof Date ? { expiresAt: expiresAt.toISOString(), daysLeft } : {}),
      ...(permissions ? { permissions, missingPermissions } : {}),
      advice,
    };
  } catch (error) {
    if (error instanceof InstagramApiError && error.isAuthError) {
      return { ...base, valid: false, advice: error.message };
    }
    throw error;
  }
}
