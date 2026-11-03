import { readFile, stat } from "node:fs/promises";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { InstagramClient } from "../src/instagram/client.js";
import {
  checkToken,
  fingerprint,
  refreshAccessToken,
  resolveAccessToken,
  writeTokenStore,
} from "../src/instagram/token.js";
import { API, BASE, noSleep, tempConfig, useMsw } from "./helpers.js";

const server = useMsw();
let config: Config;
let cleanup: () => Promise<void>;

beforeEach(async () => ({ config, cleanup } = await tempConfig()));
afterEach(() => cleanup());

const NOW = new Date("2026-11-03T00:00:00Z");
const client = (token: string) =>
  new InstagramClient({ accessToken: token, baseUrl: BASE, sleep: noSleep });

describe("resolveAccessToken", () => {
  it("uses the env token when nothing is stored", async () => {
    await expect(resolveAccessToken(config)).resolves.toMatchObject({
      accessToken: "ENV_TOKEN",
      source: "env",
      expiresAt: undefined,
    });
  });

  it("prefers a stored token refreshed from the env token", async () => {
    await writeTokenStore(config.tokenStorePath, {
      accessToken: "REFRESHED",
      expiresAt: "2027-01-01T00:00:00.000Z",
      refreshedAt: NOW.toISOString(),
      envTokenFingerprint: fingerprint("ENV_TOKEN"),
    });
    const token = await resolveAccessToken(config);
    expect(token).toMatchObject({ accessToken: "REFRESHED", source: "store" });
    expect(token.expiresAt?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("ignores a stored token when a different token is put in the env", async () => {
    await writeTokenStore(config.tokenStorePath, {
      accessToken: "OLD_REFRESHED",
      expiresAt: "2027-01-01T00:00:00.000Z",
      refreshedAt: NOW.toISOString(),
      envTokenFingerprint: fingerprint("SOME_OLD_ENV_TOKEN"),
    });
    await expect(resolveAccessToken(config)).resolves.toMatchObject({
      accessToken: "ENV_TOKEN",
      source: "env",
    });
  });
});

describe("refreshAccessToken", () => {
  it("refreshes, stores the new token with its expiry, and chains", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/refresh_access_token`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("grant_type")).toBe("ig_refresh_token");
        seen.push(url.searchParams.get("access_token"));
        return HttpResponse.json({
          access_token: `NEW${seen.length}`,
          token_type: "bearer",
          expires_in: 5184000,
        });
      }),
    );
    const opts = { now: NOW, clientOptions: { sleep: noSleep } };
    const first = await refreshAccessToken(config, opts);
    expect(first).toEqual({
      accessToken: "NEW1",
      expiresAt: "2027-01-02T00:00:00.000Z",
      refreshedAt: NOW.toISOString(),
      envTokenFingerprint: fingerprint("ENV_TOKEN"),
    });
    expect(JSON.parse(await readFile(config.tokenStorePath, "utf8"))).toEqual(first);
    expect((await stat(config.tokenStorePath)).mode & 0o777).toBe(0o600);

    await refreshAccessToken(config, opts);
    expect(seen).toEqual(["ENV_TOKEN", "NEW1"]);
    await expect(resolveAccessToken(config)).resolves.toMatchObject({ accessToken: "NEW2" });
  });

  it("surfaces API errors", async () => {
    server.use(
      http.get(`${BASE}/refresh_access_token`, () =>
        HttpResponse.json(
          { error: { message: "Session has expired", code: 190 } },
          { status: 400 },
        ),
      ),
    );
    await expect(refreshAccessToken(config, { clientOptions: { sleep: noSleep } })).rejects.toThrow(
      /rejected the access token/,
    );
  });
});

describe("checkToken", () => {
  const me = () =>
    http.get(`${API}/me`, () => HttpResponse.json({ user_id: "42", username: "eatwell" }));

  it("reports an untracked expiry for env tokens", async () => {
    server.use(me());
    const status = await checkToken(
      client("T"),
      { accessToken: "T", source: "env", expiresAt: undefined, refreshedAt: undefined },
      NOW,
    );
    expect(status).toMatchObject({ valid: true, username: "eatwell", userId: "42", source: "env" });
    expect(status.daysLeft).toBeUndefined();
    expect(status.advice).toMatch(/isn't tracked yet/);
  });

  it("computes days left and warns near expiry", async () => {
    server.use(me());
    const token = (days: number) => ({
      accessToken: "T",
      source: "store" as const,
      expiresAt: new Date(NOW.getTime() + days * 86_400_000),
      refreshedAt: NOW,
    });
    await expect(checkToken(client("T"), token(45), NOW)).resolves.toMatchObject({
      daysLeft: 45,
      advice: expect.stringMatching(/expires in 45 days/),
    });
    await expect(checkToken(client("T"), token(3), NOW)).resolves.toMatchObject({
      daysLeft: 3,
      advice: expect.stringMatching(/Run `npm run token:refresh` now/),
    });
  });

  it("returns valid: false for a rejected token", async () => {
    server.use(
      http.get(`${API}/me`, () =>
        HttpResponse.json({ error: { message: "expired", code: 190 } }, { status: 400 }),
      ),
    );
    const status = await checkToken(
      client("T"),
      { accessToken: "T", source: "env", expiresAt: undefined, refreshedAt: undefined },
      NOW,
    );
    expect(status).toMatchObject({ valid: false, source: "env" });
    expect(status.advice).toMatch(/rejected the access token/);
  });
});
