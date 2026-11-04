import type { InstagramClient } from "../instagram/client.js";

export const ACCOUNT_METRICS = [
  "reach",
  "views",
  "accounts_engaged",
  "total_interactions",
  "likes",
  "comments",
  "saves",
  "shares",
  "profile_links_taps",
] as const;

interface InsightsResponse {
  data?: {
    name: string;
    total_value?: {
      value?: number;
      breakdowns?: { results?: { dimension_values: string[]; value: number }[] }[];
    };
    values?: { value: number; end_time: string }[];
  }[];
}

export interface AccountInsights {
  days: number;
  since: string;
  until: string;
  totals: Record<string, number>;
  dailyReach: { date: string; reach: number }[];
  follows?: { followed: number; unfollowed: number };
  notes: string[];
}

/** Account totals over the last `days` (1-30, Meta's maximum range per request). */
export async function getAccountInsights(
  client: InstagramClient,
  userId: string,
  days: number,
  now: Date = new Date(),
): Promise<AccountInsights> {
  const d = Math.max(1, Math.min(30, Math.round(days)));
  const until = Math.floor(now.getTime() / 1000);
  const since = until - d * 86_400;
  const notes: string[] = [];

  const totals: Record<string, number> = {};
  let follows: AccountInsights["follows"];
  const res = await client.get<InsightsResponse>(`${userId}/insights`, {
    metric: ACCOUNT_METRICS.join(","),
    period: "day",
    metric_type: "total_value",
    since,
    until,
  });
  for (const m of res.data ?? []) {
    if (typeof m.total_value?.value === "number") totals[m.name] = m.total_value.value;
  }

  // Separate call: it needs the follow_type breakdown, and Meta leaves it empty for accounts
  // under 100 followers. (Unverified live until the account passes 100.)
  try {
    const f = await client.get<InsightsResponse>(`${userId}/insights`, {
      metric: "follows_and_unfollows",
      period: "day",
      metric_type: "total_value",
      breakdown: "follow_type",
      since,
      until,
    });
    const results = f.data?.[0]?.total_value?.breakdowns?.[0]?.results;
    if (results?.length) {
      const get = (k: string) => results.find((r) => r.dimension_values.includes(k))?.value ?? 0;
      follows = { followed: get("FOLLOWER"), unfollowed: get("NON_FOLLOWER") };
    }
  } catch {
    // Not available for this account.
  }
  if (!follows) {
    notes.push(
      "Meta doesn't report follows/unfollows or follower history for accounts under 100 followers; " +
        "follower growth comes from the server's own daily snapshots instead.",
    );
  }

  const series = await client.get<InsightsResponse>(`${userId}/insights`, {
    metric: "reach",
    period: "day",
    since,
    until,
  });
  const dailyReach = (series.data?.[0]?.values ?? []).map((v) => ({
    date: v.end_time.slice(0, 10),
    reach: v.value,
  }));
  notes.push("Insights can lag by up to 48 hours.");

  return {
    days: d,
    since: new Date(since * 1000).toISOString().slice(0, 10),
    until: new Date(until * 1000).toISOString().slice(0, 10),
    totals,
    dailyReach,
    ...(follows ? { follows } : {}),
    notes,
  };
}
