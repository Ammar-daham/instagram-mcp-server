/**
 * Recent posts and per-post insights. Responses are reduced to the fields we use: Graph paging
 * links embed the access token, so raw responses must never be returned to the client.
 */
import { InstagramApiError, type InstagramClient } from "../instagram/client.js";

export interface RecentPost {
  id: string;
  type: "IMAGE" | "CAROUSEL_ALBUM" | "VIDEO" | string;
  product: "FEED" | "REELS" | "STORY" | string;
  timestamp: string;
  permalink?: string;
  caption?: string;
  likes?: number;
  comments?: number;
}

interface MediaNode {
  id: string;
  media_type: string;
  media_product_type?: string;
  timestamp: string;
  permalink?: string;
  caption?: string;
  like_count?: number;
  comments_count?: number;
}

const CAPTION_PREVIEW = 160;

/** Newest first; follows cursors (not the token-bearing `next` URL) up to `limit` posts. */
export async function getRecentPosts(
  client: InstagramClient,
  userId: string,
  options: { limit?: number; sinceDays?: number; now?: Date } = {},
): Promise<RecentPost[]> {
  const limit = Math.max(1, Math.min(50, options.limit ?? 12));
  const cutoff =
    options.sinceDays !== undefined
      ? (options.now ?? new Date()).getTime() - options.sinceDays * 86_400_000
      : undefined;
  const posts: RecentPost[] = [];
  let after: string | undefined;
  while (posts.length < limit) {
    const page = await client.get<{
      data?: MediaNode[];
      paging?: { cursors?: { after?: string } };
    }>(`${userId}/media`, {
      fields:
        "id,media_type,media_product_type,timestamp,permalink,caption,like_count,comments_count",
      limit: Math.min(50, limit - posts.length),
      after,
    });
    const nodes = page.data ?? [];
    for (const m of nodes) {
      if (cutoff !== undefined && Date.parse(m.timestamp) < cutoff) return posts;
      posts.push({
        id: m.id,
        type: m.media_type,
        product: m.media_product_type ?? "FEED",
        timestamp: m.timestamp,
        ...(m.permalink ? { permalink: m.permalink } : {}),
        ...(m.caption
          ? {
              caption:
                m.caption.length > CAPTION_PREVIEW
                  ? `${m.caption.slice(0, CAPTION_PREVIEW)}…`
                  : m.caption,
            }
          : {}),
        ...(m.like_count !== undefined ? { likes: m.like_count } : {}),
        ...(m.comments_count !== undefined ? { comments: m.comments_count } : {}),
      });
      if (posts.length >= limit) break;
    }
    after = page.paging?.cursors?.after;
    if (!after || nodes.length === 0) break;
  }
  return posts;
}

// What Meta supports per product type (checked against the live API, Graph v24).
const FEED_METRICS = [
  "reach",
  "views",
  "likes",
  "comments",
  "saved",
  "shares",
  "total_interactions",
  "profile_visits",
  "follows",
];
const REELS_METRICS = [
  "reach",
  "views",
  "likes",
  "comments",
  "saved",
  "shares",
  "total_interactions",
  "ig_reels_avg_watch_time",
];

export interface PostInsights {
  id: string;
  type: string;
  product: string;
  timestamp?: string;
  permalink?: string;
  caption?: string;
  metrics: Record<string, number>;
  /** Derived rates, as percentages of reach. */
  rates?: { engagement: number; saves: number; shares: number };
  avgWatchSeconds?: number;
  unavailable?: string[];
  error?: string;
}

interface InsightsResponse {
  data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[];
}

function readValues(res: InsightsResponse): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of res.data ?? []) {
    const v = d.total_value?.value ?? d.values?.[0]?.value;
    if (typeof v === "number") out[d.name] = v;
  }
  return out;
}

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 1000) / 10 : 0);

/** Lifetime insights for one post; unsupported metrics are skipped, not fatal. */
export async function getPostInsights(
  client: InstagramClient,
  post: Pick<RecentPost, "id" | "type" | "product"> & Partial<RecentPost>,
): Promise<PostInsights> {
  const wanted = post.product === "REELS" ? REELS_METRICS : FEED_METRICS;
  const base = {
    id: post.id,
    type: post.type,
    product: post.product,
    ...(post.timestamp ? { timestamp: post.timestamp } : {}),
    ...(post.permalink ? { permalink: post.permalink } : {}),
    ...(post.caption ? { caption: post.caption } : {}),
  };
  if (post.product === "STORY") {
    return { ...base, metrics: {}, error: "Story insights are only available for 24 hours." };
  }

  let metrics: Record<string, number> = {};
  const unavailable: string[] = [];
  try {
    metrics = readValues(
      await client.get<InsightsResponse>(`${post.id}/insights`, { metric: wanted.join(",") }),
    );
  } catch (error) {
    if (!(error instanceof InstagramApiError) || error.code !== 100) {
      return { ...base, metrics: {}, error: (error as Error).message };
    }
    // One unsupported metric fails the whole call: fetch them one by one instead.
    for (const metric of wanted) {
      try {
        Object.assign(
          metrics,
          readValues(await client.get<InsightsResponse>(`${post.id}/insights`, { metric })),
        );
      } catch {
        unavailable.push(metric);
      }
    }
    if (!Object.keys(metrics).length) {
      return {
        ...base,
        metrics: {},
        unavailable,
        error:
          "No insights for this post (e.g. published before the account became a professional account).",
      };
    }
  }

  const reach = metrics.reach ?? 0;
  const result: PostInsights = {
    ...base,
    metrics,
    rates: {
      engagement: pct(metrics.total_interactions ?? 0, reach),
      saves: pct(metrics.saved ?? 0, reach),
      shares: pct(metrics.shares ?? 0, reach),
    },
    ...(unavailable.length ? { unavailable } : {}),
  };
  if (metrics.ig_reels_avg_watch_time !== undefined) {
    result.avgWatchSeconds = Math.round(metrics.ig_reels_avg_watch_time / 100) / 10;
  }
  return result;
}
