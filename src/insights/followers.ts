/**
 * Our own follower history: one snapshot per day, saved whenever the server reads the account.
 * Meta only provides follower history for accounts with 100+ followers.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Snapshot {
  date: string; // YYYY-MM-DD (UTC)
  followers: number;
}

const KEEP_DAYS = 800;

export async function readSnapshots(file: string): Promise<Snapshot[]> {
  try {
    const data = JSON.parse(await readFile(file, "utf8")) as { snapshots?: Snapshot[] };
    return Array.isArray(data.snapshots) ? data.snapshots : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Record today's count (replacing an earlier one from the same day). */
export async function recordFollowers(
  file: string,
  followers: number,
  now: Date = new Date(),
): Promise<Snapshot[]> {
  const date = now.toISOString().slice(0, 10);
  const snapshots = (await readSnapshots(file)).filter((s) => s.date !== date);
  snapshots.push({ date, followers });
  snapshots.sort((a, b) => a.date.localeCompare(b.date));
  const kept = snapshots.slice(-KEEP_DAYS);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ snapshots: kept }, null, 2)}\n`);
  return kept;
}

export interface FollowerGrowth {
  current: number;
  /** The oldest snapshot within the window, if any. */
  from?: Snapshot;
  change?: number;
  history: Snapshot[];
  note?: string;
}

export function followerGrowth(
  snapshots: Snapshot[],
  days: number,
  now: Date = new Date(),
): FollowerGrowth {
  const current = snapshots.at(-1)?.followers ?? 0;
  const start = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const inWindow = snapshots.filter((s) => s.date >= start);
  const from = inWindow[0];
  if (!from || inWindow.length < 2) {
    return {
      current,
      history: inWindow,
      note:
        "Not enough follower history yet: the server saves one snapshot per day when it reads " +
        "the account, so growth appears after a few days of use.",
    };
  }
  return { current, from, change: current - from.followers, history: inWindow };
}
