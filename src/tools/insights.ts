import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ContextFactory } from "../context.js";
import { getAccountInfo, resolveUserId } from "../instagram/account.js";
import { getAccountInsights } from "../insights/account.js";
import { followerGrowth, readSnapshots, recordFollowers } from "../insights/followers.js";
import {
  getPostInsights,
  getRecentPosts,
  type PostInsights,
  type RecentPost,
} from "../insights/media.js";
import { followersFile } from "../insights/store.js";
import { toolResult } from "./result.js";

export interface InsightsToolOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

const top = (posts: PostInsights[], key: (p: PostInsights) => number | undefined, n = 3) =>
  posts
    .filter((p) => (key(p) ?? 0) > 0)
    .sort((a, b) => (key(b) ?? 0) - (key(a) ?? 0))
    .slice(0, n)
    .map((p) => ({ id: p.id, value: key(p), permalink: p.permalink, caption: p.caption }));

function byFormat(posts: PostInsights[]) {
  const groups: Record<string, PostInsights[]> = {};
  for (const p of posts) {
    if (p.error) continue;
    const format =
      p.product === "REELS" ? "reel" : p.type === "CAROUSEL_ALBUM" ? "carousel" : "single image";
    (groups[format] ??= []).push(p);
  }
  const avg = (list: PostInsights[], f: (p: PostInsights) => number) =>
    Math.round((list.reduce((s, p) => s + f(p), 0) / list.length) * 10) / 10;
  return Object.fromEntries(
    Object.entries(groups).map(([format, list]) => [
      format,
      {
        posts: list.length,
        avgReach: avg(list, (p) => p.metrics.reach ?? 0),
        avgEngagementRate: avg(list, (p) => p.rates?.engagement ?? 0),
        avgSaves: avg(list, (p) => p.metrics.saved ?? 0),
        avgShares: avg(list, (p) => p.metrics.shares ?? 0),
        ...(list.some((p) => p.metrics.follows !== undefined)
          ? { totalFollows: list.reduce((s, p) => s + (p.metrics.follows ?? 0), 0) }
          : {}),
      },
    ]),
  );
}

export function registerInsightsTools(
  server: McpServer,
  getContext: ContextFactory,
  options: InsightsToolOptions = {},
): void {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());

  server.registerTool(
    "get_recent_posts",
    {
      title: "Get recent posts",
      description:
        "List the account's recent posts, newest first: id, type (image, carousel, reel), date, " +
        "link, caption preview, likes and comments. Use the ids with get_post_insights.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(12).describe("How many posts (max 50)"),
        since_days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe("Only posts from the last N days"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ limit, since_days }) =>
      toolResult(async () => {
        const { client, config } = await getContext();
        const userId = await resolveUserId(client, config);
        const posts = await getRecentPosts(client, userId, {
          limit,
          ...(since_days ? { sinceDays: since_days } : {}),
          now: now(),
        });
        return { count: posts.length, posts };
      }),
  );

  server.registerTool(
    "get_post_insights",
    {
      title: "Get post insights",
      description:
        "Lifetime insights per post: reach, views, likes, comments, saves, shares and, for feed " +
        "posts (images and carousels), profile visits and follows (people who followed from the " +
        "post). Reels report average watch time instead; Meta gives no follows for reels. Also " +
        "returns rates (% of reach), the top posts by follows, saves, shares and reach, and " +
        "averages per format. Small numbers on a small account are noisy: look for patterns, " +
        "not single posts.",
      inputSchema: {
        post_ids: z
          .array(z.string().regex(/^\d+$/))
          .min(1)
          .max(25)
          .optional()
          .describe("Specific post ids (from get_recent_posts); default: the most recent posts"),
        recent: z
          .number()
          .int()
          .min(1)
          .max(25)
          .default(10)
          .describe("If no post_ids: how many recent posts to analyse"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ post_ids, recent }) =>
      toolResult(async () => {
        const { client, config } = await getContext();
        let posts: Pick<RecentPost, "id" | "type" | "product">[];
        if (post_ids?.length) {
          posts = [];
          for (const id of post_ids) {
            const m = await client.get<{
              id: string;
              media_type: string;
              media_product_type?: string;
              timestamp: string;
              permalink?: string;
              caption?: string;
            }>(id, { fields: "id,media_type,media_product_type,timestamp,permalink,caption" });
            posts.push({
              id: m.id,
              type: m.media_type,
              product: m.media_product_type ?? "FEED",
              timestamp: m.timestamp,
              ...(m.permalink ? { permalink: m.permalink } : {}),
              ...(m.caption ? { caption: m.caption.slice(0, 160) } : {}),
            } as RecentPost);
          }
        } else {
          posts = await getRecentPosts(client, await resolveUserId(client, config), {
            limit: recent,
          });
        }
        const results: PostInsights[] = [];
        for (const post of posts) results.push(await getPostInsights(client, post));
        const ok = results.filter((r) => !r.error);
        return {
          posts: results,
          top: {
            byFollows: top(ok, (p) => p.metrics.follows),
            bySaves: top(ok, (p) => p.metrics.saved),
            byShares: top(ok, (p) => p.metrics.shares),
            byReach: top(ok, (p) => p.metrics.reach),
          },
          byFormat: byFormat(results),
          notes: [
            "follows/profile_visits exist only for feed posts (images, carousels), not reels.",
            "Insights can lag by up to 48 hours; very new posts may still be low.",
          ],
        };
      }),
  );

  server.registerTool(
    "get_account_insights",
    {
      title: "Get account insights",
      description:
        "Account-level results over the last N days (max 30): reach, views, accounts engaged, " +
        "interactions, likes, comments, saves, shares, link taps, daily reach, current " +
        "followers and follower growth. Follower growth uses Meta's data from 100 followers; " +
        "below that it comes from the server's own daily snapshots.",
      inputSchema: {
        days: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(7)
          .describe("Window in days: 7 or 30 are typical"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ days }) =>
      toolResult(async () => {
        const { client, config } = await getContext();
        const userId = await resolveUserId(client, config);
        const at = now();
        const insights = await getAccountInsights(client, userId, days, at);
        const info = await getAccountInfo(client, config);
        const file = followersFile(env);
        const snapshots =
          info.followers_count !== undefined
            ? await recordFollowers(file, info.followers_count, at)
            : await readSnapshots(file);
        return {
          ...insights,
          account: `@${info.username}`,
          followers: followerGrowth(snapshots, insights.days, at),
        };
      }),
  );
}
