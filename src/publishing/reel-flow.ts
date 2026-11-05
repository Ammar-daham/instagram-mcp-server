/**
 * Publish a Reel. Like posts: a dry run unless `confirm`, cancellation honoured until the final
 * publish call, progress updates. The video goes straight to Meta (resumable upload), so it is
 * never hosted anywhere public.
 */
import { readFile } from "node:fs/promises";
import { validateCaption, type CaptionStats } from "../content/caption.js";
import type { ContextFactory } from "../context.js";
import { mediaInputDirs } from "../hosting/cloudinary.js";
import { getAccountInfo, resolveUserId } from "../instagram/account.js";
import {
  createReelContainer,
  getPublishingLimit,
  publishContainer,
  PublishError,
  uploadReelVideo,
  waitForContainer,
  type PollOptions,
  type PublishingLimit,
} from "../instagram/publish.js";
import type { ProbeResult } from "../video/ffmpeg.js";
import { checkReelVideo } from "../video/inputs.js";

export interface ReelRequest {
  video: string;
  caption: string;
  confirm: boolean;
  shareToFeed?: boolean;
  /** Which moment becomes the cover, in ms from the start. */
  thumbOffsetMs?: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface ReelDeps {
  getContext: ContextFactory;
  env: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  /** Videos take longer than images: defaults 5 s interval, 10 min timeout. */
  poll?: PollOptions;
  uploadSleep?: (ms: number) => Promise<void>;
}

export interface ReelDryRun {
  mode: "dry_run";
  type: "reel";
  account: string;
  video: { path: string } & Pick<ProbeResult, "duration" | "width" | "height" | "bytes">;
  caption: CaptionStats & { text: string };
  shareToFeed: boolean;
  publishingLimit: PublishingLimit;
  warnings: string[];
  ready: boolean;
  problems: string[];
  next: string;
}

export interface ReelPublished {
  mode: "published";
  type: "reel";
  mediaId: string;
  permalink?: string;
  timestamp?: string;
}

export async function runReelPublish(
  req: ReelRequest,
  deps: ReelDeps,
): Promise<ReelDryRun | ReelPublished> {
  const stats = validateCaption(req.caption);
  const { real, info, warnings } = await checkReelVideo(req.video, mediaInputDirs(deps.env));
  if (req.thumbOffsetMs !== undefined && req.thumbOffsetMs > info.duration * 1000) {
    throw new PublishError(
      `thumb_offset_ms is past the end of the ${info.duration.toFixed(1)} s video.`,
    );
  }
  const ctx = await deps.getContext();
  const userId = await resolveUserId(ctx.client, ctx.config);
  const limit = await getPublishingLimit(ctx.client, userId);
  const problems =
    limit.remaining < 1
      ? [`Publishing limit reached: ${limit.used}/${limit.total} posts in the last 24 hours.`]
      : [];

  if (!req.confirm) {
    const account = await getAccountInfo(ctx.client, ctx.config)
      .then((a) => `@${a.username}`)
      .catch(() => userId);
    return {
      mode: "dry_run",
      type: "reel",
      account,
      video: {
        path: real,
        duration: info.duration,
        width: info.width,
        height: info.height,
        bytes: info.bytes,
      },
      caption: { text: req.caption, ...stats },
      shareToFeed: req.shareToFeed !== false,
      publishingLimit: limit,
      warnings,
      ready: problems.length === 0,
      problems,
      next:
        problems.length === 0
          ? "Nothing has been uploaded or posted. Show this to the user and, only once they " +
            "approve, call again with confirm: true."
          : "Fix the problems above before publishing.",
    };
  }
  if (problems.length) throw new PublishError(problems.join("\n"));

  const progress = req.onProgress ?? (() => {});
  const cancelled = () => {
    if (req.signal?.aborted) {
      throw new PublishError(
        "The request was cancelled (or timed out) before publishing. Nothing was published.",
      );
    }
  };
  cancelled();
  progress("Creating the Reel");
  const container = await createReelContainer(ctx.client, userId, {
    caption: req.caption,
    shareToFeed: req.shareToFeed !== false,
    ...(req.thumbOffsetMs !== undefined ? { thumbOffsetMs: req.thumbOffsetMs } : {}),
  });
  cancelled();
  progress(`Uploading the video (${(info.bytes / 1024 / 1024).toFixed(1)} MB) to Instagram`);
  await uploadReelVideo(container.uri, ctx.token.accessToken, await readFile(real), {
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.uploadSleep ? { sleep: deps.uploadSleep } : {}),
  });

  // Report every poll so clients that reset their timeout on progress keep waiting.
  const poll: PollOptions = {
    intervalMs: 5000,
    timeoutMs: 10 * 60_000,
    ...deps.poll,
    ...(req.signal ? { signal: req.signal } : {}),
  };
  const started = (poll.now ?? Date.now)();
  const sleep = poll.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  await waitForContainer(ctx.client, container.id, {
    ...poll,
    sleep: async (ms) => {
      progress(
        `Instagram is processing the video (${Math.round(((poll.now ?? Date.now)() - started) / 1000)} s)`,
      );
      await sleep(ms);
    },
  }).catch((error: unknown) => {
    throw new PublishError(`${(error as Error).message}\nNothing was published.`);
  });

  cancelled();
  progress("Publishing");
  const media = await publishContainer(ctx.client, userId, container.id);
  return {
    mode: "published",
    type: "reel",
    mediaId: media.id,
    ...(media.permalink ? { permalink: media.permalink } : {}),
    ...(media.timestamp ? { timestamp: media.timestamp } : {}),
  };
}
