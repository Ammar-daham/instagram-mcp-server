import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PROJECT_ROOT } from "./paths.js";

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
  IG_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, 'IG_API_VERSION must look like "v24.0".')
    .default("v24.0"),
  IG_API_BASE_URL: z.url("IG_API_BASE_URL must be a URL.").default("https://graph.instagram.com"),
  IG_TOKEN_STORE: z.string().optional(),
});

export interface Config {
  accessToken: string;
  userId: string | undefined;
  apiVersion: string;
  baseUrl: string;
  /** Where `npm run token:refresh` keeps the refreshed token and its expiry. */
  tokenStorePath: string;
}

export class ConfigError extends Error {
  override name = "ConfigError";
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
  return {
    accessToken: e.IG_ACCESS_TOKEN,
    userId: e.IG_USER_ID,
    apiVersion: e.IG_API_VERSION,
    baseUrl: e.IG_API_BASE_URL.replace(/\/+$/, ""),
    tokenStorePath: path.resolve(PROJECT_ROOT, e.IG_TOKEN_STORE ?? ".tokens/token.json"),
  };
}
