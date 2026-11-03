import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PROJECT_ROOT } from "./paths.js";

/**
 * Meta offers two ways to reach an Instagram professional account:
 * - "instagram": Instagram-login tokens (`IGAA…`) against graph.instagram.com
 * - "facebook":  Facebook-login tokens (`EAA…`) against graph.facebook.com, which address the
 *   account by its Instagram user ID. Needed when the account is tied to a Facebook Page or a
 *   Business Portfolio (e.g. after boosting posts).
 */
export type LoginType = "instagram" | "facebook";

export const DEFAULT_BASE_URLS: Record<LoginType, string> = {
  instagram: "https://graph.instagram.com",
  facebook: "https://graph.facebook.com",
};

const EnvSchema = z.object({
  IG_ACCESS_TOKEN: z
    .string({
      error:
        "IG_ACCESS_TOKEN is missing. Generate a long-lived token as described in docs/META_SETUP.md.",
    })
    .trim()
    .min(1),
  IG_USER_ID: z
    .string()
    .trim()
    .regex(/^\d+$/, "IG_USER_ID must be the numeric Instagram user ID (digits only).")
    .optional(),
  IG_LOGIN_TYPE: z
    .enum(["instagram", "facebook"], 'IG_LOGIN_TYPE must be "instagram" or "facebook".')
    .optional(),
  IG_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, 'IG_API_VERSION must look like "v24.0".')
    .default("v24.0"),
  IG_API_BASE_URL: z.url("IG_API_BASE_URL must be a URL.").optional(),
  IG_TOKEN_STORE: z.string().optional(),
  META_APP_ID: z.string().trim().optional(),
  META_APP_SECRET: z.string().trim().optional(),
});

export interface Config {
  accessToken: string;
  userId: string | undefined;
  loginType: LoginType;
  apiVersion: string;
  baseUrl: string;
  /** Where `npm run token:refresh` keeps the refreshed token and its expiry. */
  tokenStorePath: string;
  /** Needed to refresh Facebook-login tokens. */
  appId: string | undefined;
  appSecret: string | undefined;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Guess the login type from the token: Facebook tokens start with "EAA". */
export function detectLoginType(token: string): LoginType {
  return token.startsWith("EAA") ? "facebook" : "instagram";
}

/** Load `<repo>/.env` if present. Variables already set in the environment win. */
export function loadDotEnv(file = path.join(PROJECT_ROOT, ".env")): void {
  if (existsSync(file)) process.loadEnvFile(file);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat `KEY=` (as copied from .env.example) the same as an unset variable.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `- ${issue.message}`).join("\n");
    throw new ConfigError(`Invalid configuration:\n${problems}`);
  }
  const e = parsed.data;
  const loginType = e.IG_LOGIN_TYPE ?? detectLoginType(e.IG_ACCESS_TOKEN);
  if (loginType === "facebook" && !e.IG_USER_ID) {
    throw new ConfigError(
      "Invalid configuration:\n- IG_USER_ID is required with a Facebook-login token (EAA…). " +
        "Use the Instagram account ID shown next to your account in the Meta app dashboard.",
    );
  }
  return {
    accessToken: e.IG_ACCESS_TOKEN,
    userId: e.IG_USER_ID,
    loginType,
    apiVersion: e.IG_API_VERSION,
    baseUrl: (e.IG_API_BASE_URL ?? DEFAULT_BASE_URLS[loginType]).replace(/\/+$/, ""),
    tokenStorePath: path.resolve(PROJECT_ROOT, e.IG_TOKEN_STORE ?? ".tokens/token.json"),
    appId: e.META_APP_ID,
    appSecret: e.META_APP_SECRET,
  };
}
