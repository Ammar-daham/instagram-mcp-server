import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { InstagramApiError, InstagramClient } from "../src/instagram/client.js";
import { API, BASE, noSleep, useMsw } from "./helpers.js";

const server = useMsw();
const client = (opts = {}) =>
  new InstagramClient({ accessToken: "SECRET", baseUrl: BASE, sleep: noSleep, ...opts });

const graphError = (status: number, code: number, message = "boom") =>
  HttpResponse.json({ error: { message, code, fbtrace_id: "trace1" } }, { status });

describe("InstagramClient", () => {
  it("sends GET params and the token as query parameters", async () => {
    server.use(
      http.get(`${API}/me`, ({ request }) => {
        const url = new URL(request.url);
        return HttpResponse.json({
          token: url.searchParams.get("access_token"),
          fields: url.searchParams.get("fields"),
        });
      }),
    );
    await expect(client().get("me", { fields: "username" })).resolves.toEqual({
      token: "SECRET",
      fields: "username",
    });
  });

  it("sends POST params as a form body", async () => {
    server.use(
      http.post(`${API}/123/media`, async ({ request }) => {
        const form = new URLSearchParams(await request.text());
        return HttpResponse.json({ caption: form.get("caption"), token: form.get("access_token") });
      }),
    );
    await expect(client().post("/123/media", { caption: "hi" })).resolves.toEqual({
      caption: "hi",
      token: "SECRET",
    });
  });

  it("supports unversioned paths", async () => {
    server.use(http.get(`${BASE}/refresh_access_token`, () => HttpResponse.json({ ok: true })));
    await expect(client().get("refresh_access_token", {}, { versioned: false })).resolves.toEqual({
      ok: true,
    });
  });

  it("maps an invalid token to a readable, non-retried error", async () => {
    const handler = vi.fn(() => graphError(400, 190, "Error validating access token"));
    server.use(http.get(`${API}/me`, handler));
    const error = await client()
      .get("me")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InstagramApiError);
    expect((error as InstagramApiError).isAuthError).toBe(true);
    expect((error as Error).message).toMatch(/rejected the access token.*META_SETUP/);
    expect((error as Error).message).toMatch(/Error validating access token \(fbtrace_id trace1\)/);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("maps permission errors", async () => {
    server.use(http.get(`${API}/me`, () => graphError(403, 10)));
    await expect(client().get("me")).rejects.toThrow(/missing a permission/);
  });

  it("retries 5xx responses, then succeeds", async () => {
    const sleep = vi.fn(noSleep);
    let calls = 0;
    server.use(
      http.get(`${API}/me`, () =>
        ++calls < 3 ? new HttpResponse("oops", { status: 502 }) : HttpResponse.json({ ok: 1 }),
      ),
    );
    await expect(client({ sleep, retryDelayMs: 100 }).get("me")).resolves.toEqual({ ok: 1 });
    expect(sleep.mock.calls).toEqual([[100], [200]]);
  });

  it("retries rate limits honouring Retry-After, and gives up after maxRetries", async () => {
    const sleep = vi.fn(noSleep);
    const handler = vi.fn(() =>
      HttpResponse.json(
        { error: { message: "Application request limit reached", code: 4 } },
        { status: 400, headers: { "Retry-After": "2" } },
      ),
    );
    server.use(http.get(`${API}/me`, handler));
    await expect(client({ sleep, maxRetries: 2 }).get("me")).rejects.toThrow(/rate limit/);
    expect(handler).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[2000], [2000]]);
  });

  it("retries network failures without leaking the token", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    const error = (await client({ fetch: fetchImpl, maxRetries: 1 })
      .get("me")
      .catch((e: unknown) => e)) as Error;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(error.message).toMatch(/Could not reach Instagram \(GET \/me\): fetch failed/);
    expect(error.message).not.toContain("SECRET");
  });

  it("treats a 200 with an error body as an error", async () => {
    server.use(http.get(`${API}/me`, () => graphError(200, 100, "bad field")));
    await expect(client().get("me")).rejects.toThrow(
      /Instagram API error 100\. Details: bad field/,
    );
  });
});
