import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";
import type { Config } from "../src/config.js";

export const BASE = "https://graph.test";
export const API = `${BASE}/v24.0`;
export const noSleep = () => Promise.resolve();

export function useMsw() {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}

export async function tempConfig(overrides: Partial<Config> = {}): Promise<{
  config: Config;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "ig-mcp-"));
  return {
    config: {
      accessToken: "ENV_TOKEN",
      userId: undefined,
      loginType: "instagram",
      appId: undefined,
      appSecret: undefined,
      apiVersion: "v24.0",
      baseUrl: BASE,
      tokenStorePath: path.join(dir, "token.json"),
      ...overrides,
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
