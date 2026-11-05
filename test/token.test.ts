import { readFile, stat } from "node:fs/promises";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { InstagramClient } from "../src/instagram/client.js";
import {
  checkToken,
  FACEBOOK_PERMISSIONS,
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
const IG = { loginType: "instagram" as const, userId: undefined };
const FB = { loginType: "facebook" as const, userId: "17841400000000001" };
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
      IG,
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
    await expect(checkToken(client("T"), token(45), IG, NOW)).resolves.toMatchObject({
      daysLeft: 45,
      advice: expect.stringMatching(/expires in 45 days/),
    });
    await expect(checkToken(client("T"), token(3), IG, NOW)).resolves.toMatchObject({
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
      IG,
      NOW,
    );
    expect(status).toMatchObject({ valid: false, source: "env" });
    expect(status.advice).toMatch(/rejected the access token/);
  });
});

describe("Facebook login", () => {
  const envToken = {
    accessToken: "EAAT",
    source: "env" as const,
    expiresAt: undefined,
    refreshedAt: undefined,
  };
  const igUser = () =>
    http.get(`${API}/${FB.userId}`, ({ request }) => {
      expect(new URL(request.url).searchParams.get("fields")).toBe("id,username");
      return HttpResponse.json({ id: FB.userId, username: "bodybloom" });
    });
  const debugToken = (data: object) =>
    http.get(`${API}/debug_token`, ({ request }) => {
      const url = new URL(request.url);
      expect(url.searchParams.get("input_token")).toBe("EAAT");
      expect(url.searchParams.get("access_token")).toBe("EAAT");
      return HttpResponse.json({ data });
    });

  it("checkToken reads expiry and permissions from debug_token", async () => {
    server.use(
      igUser(),
      debugToken({
        is_valid: true,
        expires_at: NOW.getTime() / 1000 + 50 * 86_400,
        scopes: ["instagram_basic", "instagram_content_publish"],
      }),
    );
    const status = await checkToken(client("EAAT"), envToken, FB, NOW);
    expect(status).toMatchObject({
      valid: true,
      loginType: "facebook",
      username: "bodybloom",
      userId: FB.userId,
      daysLeft: 50,
      missingPermissions: ["instagram_manage_insights", "pages_read_engagement"],
    });
    expect(status.advice).toMatch(/Missing permissions needed by later features/);
  });

  it("checkToken reports never-expiring tokens", async () => {
    server.use(
      igUser(),
      debugToken({ is_valid: true, expires_at: 0, scopes: FACEBOOK_PERMISSIONS }),
    );
    const status = await checkToken(client("EAAT"), envToken, FB, NOW);
    expect(status).toMatchObject({ valid: true, expiresAt: "never", missingPermissions: [] });
    expect(status.daysLeft).toBeUndefined();
    expect(status.advice).toBe("Token works and does not expire.");
  });

  it("checkToken reports an invalid token", async () => {
    server.use(debugToken({ is_valid: false, error: { message: "Session expired" } }));
    const status = await checkToken(client("EAAT"), envToken, FB, NOW);
    expect(status).toMatchObject({ valid: false, loginType: "facebook" });
    expect(status.advice).toMatch(/no longer valid: Session expired/);
  });

  it("checkToken uses an app access token when app credentials are set", async () => {
    server.use(
      igUser(),
      http.get(`${API}/debug_token`, ({ request }) => {
        const q = new URL(request.url).searchParams;
        expect(q.get("input_token")).toBe("EAAT");
        expect(q.get("access_token")).toBe("app1|shh");
        return HttpResponse.json({ data: { is_valid: true, expires_at: 0 } });
      }),
    );
    const status = await checkToken(
      client("EAAT"),
      envToken,
      { ...FB, appId: "app1", appSecret: "shh" },
      NOW,
    );
    expect(status).toMatchObject({ valid: true, expiresAt: "never" });
  });

  it("checkToken still verifies the account when debug_token is not allowed", async () => {
    server.use(
      igUser(),
      http.get(`${API}/debug_token`, () =>
        HttpResponse.json(
          { error: { message: "You must provide an app access token", code: 100 } },
          { status: 400 },
        ),
      ),
    );
    const status = await checkToken(client("EAAT"), envToken, FB, NOW);
    expect(status).toMatchObject({ valid: true, username: "bodybloom" });
    expect(status.expiresAt).toBeUndefined();
    expect(status.advice).toMatch(/add META_APP_ID and META_APP_SECRET/);
  });

  it("refresh exchanges the token with the app credentials", async () => {
    const fbConfig = { ...config, ...FB, accessToken: "EAAT", appId: "app1", appSecret: "shh" };
    server.use(
      http.get(`${API}/oauth/access_token`, ({ request }) => {
        const q = new URL(request.url).searchParams;
        expect(Object.fromEntries(q)).toEqual({
          grant_type: "fb_exchange_token",
          client_id: "app1",
          client_secret: "shh",
          fb_exchange_token: "EAAT",
        });
        return HttpResponse.json({ access_token: "EAANEW", token_type: "bearer" });
      }),
    );
    const stored = await refreshAccessToken(fbConfig, {
      now: NOW,
      clientOptions: { sleep: noSleep },
    });
    expect(stored).toMatchObject({ accessToken: "EAANEW", expiresAt: null });
    await expect(resolveAccessToken(fbConfig)).resolves.toMatchObject({
      accessToken: "EAANEW",
      expiresAt: null,
    });
  });

  it("refresh explains missing app credentials", async () => {
    await expect(refreshAccessToken({ ...config, ...FB, accessToken: "EAAT" })).rejects.toThrow(
      /META_APP_ID and META_APP_SECRET/,
    );
  });
});
