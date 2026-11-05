import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContextFactory } from "../src/context.js";
import { InstagramClient } from "../src/instagram/client.js";
import { getAccountInsights } from "../src/insights/account.js";
import { followerGrowth, recordFollowers } from "../src/insights/followers.js";
import { getPostInsights, getRecentPosts } from "../src/insights/media.js";
import { createServer } from "../src/server.js";
import { API, BASE, noSleep, useMsw } from "./helpers.js";

const server = useMsw();
const SECRET = "TOKEN_SECRET_123";
const client = () => new InstagramClient({ accessToken: SECRET, baseUrl: BASE, sleep: noSleep });
const NOW = new Date("2026-11-04T12:00:00Z");

const leaky = (extra = {}) => ({
  // Real Graph responses carry paging URLs that include the access token.
  paging: { next: `${API}/42/media?after=X&access_token=${SECRET}`, ...extra },
});

const MEDIA = [
  {
    id: "1",
    media_type: "CAROUSEL_ALBUM",
    media_product_type: "FEED",
    timestamp: "2026-11-03T10:00:00+0000",
    permalink: "https://instagram.com/p/1",
    caption: "x".repeat(300),
    like_count: 9,
    comments_count: 2,
  },
  {
    id: "2",
    media_type: "VIDEO",
    media_product_type: "REELS",
    timestamp: "2026-11-01T10:00:00+0000",
    permalink: "https://instagram.com/reel/2",
    caption: "Reel",
    like_count: 6,
    comments_count: 0,
  },
  {
    id: "3",
    media_type: "IMAGE",
    media_product_type: "FEED",
    timestamp: "2026-10-01T10:00:00+0000",
    permalink: "https://instagram.com/p/3",
    caption: "Old",
    like_count: 1,
    comments_count: 0,
  },
];

function mediaHandlers() {
  return [
    http.get(`${API}/42/media`, ({ request }) => {
      const url = new URL(request.url);
      const after = url.searchParams.get("after");
      const limit = Number(url.searchParams.get("limit"));
      const start = after ? Number(after) : 0;
      const page = MEDIA.slice(start, start + Math.min(limit, 2));
      const next = start + page.length;
      return HttpResponse.json({
        data: page,
        ...leaky({ cursors: next < MEDIA.length ? { after: String(next) } : {} }),
      });
    }),
    http.get(`${API}/:id/insights`, ({ params, request }) => {
      const metric = new URL(request.url).searchParams.get("metric")!;
      const values: Record<string, Record<string, number>> = {
        "1": {
          reach: 200,
          views: 300,
          likes: 9,
          comments: 2,
          saved: 12,
          shares: 6,
          total_interactions: 29,
          profile_visits: 8,
          follows: 5,
        },
        "2": {
          reach: 400,
          views: 600,
          likes: 6,
          comments: 0,
          saved: 2,
          shares: 1,
          total_interactions: 9,
          ig_reels_avg_watch_time: 6861,
          ig_reels_video_view_total_time: 212696,
        },
        "3": {
          reach: 50,
          views: 60,
          likes: 1,
          comments: 0,
          saved: 0,
          shares: 0,
          total_interactions: 1,
          profile_visits: 0,
          follows: 0,
        },
      };
      const v = values[String(params.id)]!;
      const names = metric.split(",");
      const bad = names.find((n) => !(n in v));
      if (bad) {
        return HttpResponse.json(
          { error: { message: `(#100) does not support the ${bad} metric`, code: 100 } },
          { status: 400 },
        );
      }
      return HttpResponse.json({
        data: names.map((name) => ({ name, period: "lifetime", values: [{ value: v[name] }] })),
        ...leaky(),
      });
    }),
  ];
}

describe("getRecentPosts", () => {
  it("pages with cursors, trims captions and drops paging links", async () => {
    server.use(...mediaHandlers());
    const posts = await getRecentPosts(client(), "42", { limit: 3 });
    expect(posts.map((p) => p.id)).toEqual(["1", "2", "3"]);
    expect(posts[0]!.caption).toHaveLength(161);
    expect(posts[1]).toEqual({
      id: "2",
      type: "VIDEO",
      product: "REELS",
      timestamp: "2026-11-01T10:00:00+0000",
      permalink: "https://instagram.com/reel/2",
      caption: "Reel",
      likes: 6,
      comments: 0,
    });
    expect(JSON.stringify(posts)).not.toContain(SECRET);
  });

  it("stops at the since_days cutoff", async () => {
    server.use(...mediaHandlers());
    const posts = await getRecentPosts(client(), "42", { limit: 10, sinceDays: 7, now: NOW });
    expect(posts.map((p) => p.id)).toEqual(["1", "2"]);
  });
});

describe("getPostInsights", () => {
  it("reads feed metrics, including follows, with rates", async () => {
    server.use(...mediaHandlers());
    const r = await getPostInsights(client(), { id: "1", type: "CAROUSEL_ALBUM", product: "FEED" });
    expect(r.metrics).toMatchObject({ reach: 200, saved: 12, follows: 5, profile_visits: 8 });
    expect(r.rates).toEqual({ engagement: 14.5, saves: 6, shares: 3 });
    expect(r.unavailable).toBeUndefined();
  });

  it("reads reel metrics with average watch time", async () => {
    server.use(...mediaHandlers());
    const r = await getPostInsights(client(), { id: "2", type: "VIDEO", product: "REELS" });
    expect(r.metrics).not.toHaveProperty("follows");
    expect(r.avgWatchSeconds).toBe(6.9);
  });

  it("falls back to one metric at a time when Meta rejects one", async () => {
    server.use(
      http.get(`${API}/9/insights`, ({ request }) => {
        const metric = new URL(request.url).searchParams.get("metric")!;
        if (metric.includes(",") || metric === "follows") {
          return HttpResponse.json(
            { error: { message: "(#100) nope", code: 100 } },
            { status: 400 },
          );
        }
        return HttpResponse.json({ data: [{ name: metric, values: [{ value: 1 }] }] });
      }),
    );
    const r = await getPostInsights(client(), { id: "9", type: "IMAGE", product: "FEED" });
    expect(r.unavailable).toEqual(["follows"]);
    expect(r.metrics.reach).toBe(1);
  });

  it("reports posts without insights instead of failing", async () => {
    server.use(
      http.get(`${API}/9/insights`, () =>
        HttpResponse.json({ error: { message: "(#100) nope", code: 100 } }, { status: 400 }),
      ),
    );
    const r = await getPostInsights(client(), { id: "9", type: "IMAGE", product: "FEED" });
    expect(r.error).toMatch(/No insights for this post/);
  });
});

describe("getAccountInsights", () => {
  it("returns totals, daily reach and a note when follows aren't available", async () => {
    let follows = false;
    server.use(
      http.get(`${API}/42/insights`, ({ request }) => {
        const q = new URL(request.url).searchParams;
        const days = (Number(q.get("until")) - Number(q.get("since"))) / 86400;
        expect(days).toBe(7);
        if (q.get("metric") === "follows_and_unfollows") {
          follows = true;
          expect(q.get("breakdown")).toBe("follow_type");
          return HttpResponse.json({ data: [] });
        }
        if (q.get("metric_type") === "total_value") {
          return HttpResponse.json({
            data: q
              .get("metric")!
              .split(",")
              .map((name, i) => ({ name, total_value: { value: i + 1 } })),
            ...leaky(),
          });
        }
        return HttpResponse.json({
          data: [
            {
              name: "reach",
              values: [
                { value: 3, end_time: "2026-11-03T07:00:00+0000" },
                { value: 5, end_time: "2026-11-04T07:00:00+0000" },
              ],
            },
          ],
        });
      }),
    );
    const r = await getAccountInsights(client(), "42", 7, NOW);
    expect(r.totals).toMatchObject({
      reach: 1,
      views: 2,
      accounts_engaged: 3,
      profile_links_taps: 9,
    });
    expect(r.dailyReach).toEqual([
      { date: "2026-11-03", reach: 3 },
      { date: "2026-11-04", reach: 5 },
    ]);
    expect(r.follows).toBeUndefined();
    expect(r.notes.join(" ")).toMatch(/under 100 followers/);
    expect(follows).toBe(true);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("reads follows and unfollows when Meta provides them", async () => {
    server.use(
      http.get(`${API}/42/insights`, ({ request }) => {
        const q = new URL(request.url).searchParams;
        if (q.get("metric") === "follows_and_unfollows") {
          return HttpResponse.json({
            data: [
              {
                name: "follows_and_unfollows",
                total_value: {
                  breakdowns: [
                    {
                      results: [
                        { dimension_values: ["FOLLOWER"], value: 12 },
                        { dimension_values: ["NON_FOLLOWER"], value: 3 },
                      ],
                    },
                  ],
                },
              },
            ],
          });
        }
        return HttpResponse.json({ data: [] });
      }),
    );
    const r = await getAccountInsights(client(), "42", 30, NOW);
    expect(r.follows).toEqual({ followed: 12, unfollowed: 3 });
    expect(r.notes.join(" ")).not.toMatch(/under 100/);
  });
});

describe("follower snapshots", () => {
  let dir: string;
  beforeEach(async () => (dir = await mkdtemp(path.join(tmpdir(), "ig-ins-"))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("keeps one snapshot per day and computes growth", async () => {
    const file = path.join(dir, "followers.json");
    await recordFollowers(file, 20, new Date("2026-10-20T09:00:00Z"));
    await recordFollowers(file, 25, new Date("2026-10-30T09:00:00Z"));
    await recordFollowers(file, 27, new Date("2026-11-04T08:00:00Z"));
    const all = await recordFollowers(file, 28, new Date("2026-11-04T20:00:00Z"));
    expect(all).toEqual([
      { date: "2026-10-20", followers: 20 },
      { date: "2026-10-30", followers: 25 },
      { date: "2026-11-04", followers: 28 },
    ]);
    expect(followerGrowth(all, 7, NOW)).toMatchObject({
      current: 28,
      from: { date: "2026-10-30", followers: 25 },
      change: 3,
    });
    expect(followerGrowth(all, 30, NOW).change).toBe(8);
    expect(followerGrowth(all.slice(-1), 7, NOW).note).toMatch(/Not enough follower history/);
  });
});

describe("MCP insights tools", () => {
  let dir: string;
  beforeEach(async () => (dir = await mkdtemp(path.join(tmpdir(), "ig-ins-"))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  async function connect() {
    const env = {
      IG_ACCESS_TOKEN: SECRET,
      IG_USER_ID: "42",
      IG_API_BASE_URL: BASE,
      IG_TOKEN_STORE: "/nonexistent/t.json",
      INSIGHTS_DATA_DIR: dir,
      BRAND_HANDLE: "body.blooms.ai",
    };
    const mcp = createServer(createContextFactory(env, { sleep: noSleep }), {
      env,
      now: () => NOW,
    });
    const c = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(a), c.connect(b)]);
    return c;
  }
  const body = (r: Awaited<ReturnType<Client["callTool"]>>) => {
    const text = (r.content as { text: string }[])[0]!.text;
    expect(text).not.toContain(SECRET);
    return JSON.parse(text);
  };

  it("get_post_insights ranks posts and averages by format", async () => {
    server.use(...mediaHandlers());
    const r = body(
      await (await connect()).callTool({ name: "get_post_insights", arguments: { recent: 3 } }),
    );
    expect(r.posts).toHaveLength(3);
    expect(r.top.byFollows).toEqual([
      { id: "1", value: 5, permalink: "https://instagram.com/p/1", caption: expect.any(String) },
    ]);
    expect(r.top.byReach.map((p: { id: string }) => p.id)).toEqual(["2", "1", "3"]);
    expect(r.byFormat.carousel).toMatchObject({ posts: 1, avgReach: 200, totalFollows: 5 });
    expect(r.byFormat.reel).toMatchObject({ posts: 1, avgReach: 400 });
    expect(r.byFormat.reel).not.toHaveProperty("totalFollows");
  });

  it("get_post_insights accepts specific ids", async () => {
    server.use(
      ...mediaHandlers(),
      http.get(`${API}/2`, () => HttpResponse.json({ ...MEDIA[1], ...leaky() })),
    );
    const r = body(
      await (
        await connect()
      ).callTool({ name: "get_post_insights", arguments: { post_ids: ["2"] } }),
    );
    expect(r.posts[0]).toMatchObject({ id: "2", product: "REELS", avgWatchSeconds: 6.9 });
  });

  it("get_recent_posts lists posts", async () => {
    server.use(...mediaHandlers());
    const r = body(
      await (await connect()).callTool({ name: "get_recent_posts", arguments: { since_days: 7 } }),
    );
    expect(r.count).toBe(2);
  });

  it("get_account_insights records a follower snapshot", async () => {
    server.use(
      http.get(`${API}/42/insights`, () => HttpResponse.json({ data: [], ...leaky() })),
      // Instagram-login token: account info comes from /me.
      http.get(`${API}/me`, () =>
        HttpResponse.json({ user_id: "42", username: "body.blooms.ai", followers_count: 28 }),
      ),
    );
    const c = await connect();
    const r = body(await c.callTool({ name: "get_account_insights", arguments: { days: 7 } }));
    expect(r.account).toBe("@body.blooms.ai");
    expect(r.followers).toMatchObject({ current: 28 });
    expect(r.followers.note).toMatch(/Not enough follower history/);
    expect(JSON.parse(await readFile(path.join(dir, "followers.json"), "utf8"))).toEqual({
      snapshots: [{ date: "2026-11-04", followers: 28 }],
    });
  });

  it("offers the performance_review prompt", async () => {
    const c = await connect();
    const res = await c.getPrompt({
      name: "performance_review",
      arguments: { language: "عربي", days: "7" },
    });
    const text = (res.messages[0]!.content as { text: string }).text;
    expect(text).toMatch(/Review the last 7 days/);
    expect(text).toMatch(/Write the review in Arabic/);
    expect(text).toMatch(/get_account_insights with days: 7/);
    expect(text).toMatch(/never invent or estimate metrics/);
    expect(text).toMatch(/reels have no follows data/);
  });
});
