/**
 * Instagram content publishing: create a container from a public image URL, wait until
 * Instagram has fetched and processed it, then publish it. Same endpoints for Instagram login
 * (graph.instagram.com) and Facebook login (graph.facebook.com).
 */
import { InstagramApiError, type InstagramClient } from "./client.js";

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Stop waiting when the request is cancelled. */
  signal?: AbortSignal;
}

export class PublishError extends Error {
  override name = "PublishError";
}

export interface PublishingLimit {
  used: number;
  total: number;
  remaining: number;
}

/** Instagram allows 100 API-published posts per rolling 24 hours (carousels count as one). */
export async function getPublishingLimit(
  client: InstagramClient,
  userId: string,
): Promise<PublishingLimit> {
  const res = await client.get<{
    data?: { quota_usage?: number; config?: { quota_total?: number } }[];
  }>(`${userId}/content_publishing_limit`, { fields: "quota_usage,config" });
  const used = res.data?.[0]?.quota_usage ?? 0;
  const total = res.data?.[0]?.config?.quota_total ?? 100;
  return { used, total, remaining: Math.max(0, total - used) };
}

export async function createImageContainer(
  client: InstagramClient,
  userId: string,
  options: { imageUrl: string; caption?: string; isCarouselItem?: boolean },
): Promise<string> {
  const res = await client.post<{ id: string }>(`${userId}/media`, {
    image_url: options.imageUrl,
    caption: options.caption,
    is_carousel_item: options.isCarouselItem ? "true" : undefined,
  });
  return res.id;
}

export async function createCarouselContainer(
  client: InstagramClient,
  userId: string,
  children: string[],
  caption: string,
): Promise<string> {
  const res = await client.post<{ id: string }>(`${userId}/media`, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption,
  });
  return res.id;
}

type StatusCode = "FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED" | "PUBLISHED";

export async function getContainerStatus(
  client: InstagramClient,
  containerId: string,
): Promise<{ code: StatusCode; detail?: string }> {
  const res = await client.get<{ status_code: StatusCode; status?: string }>(containerId, {
    fields: "status_code,status",
  });
  return { code: res.status_code, ...(res.status ? { detail: res.status } : {}) };
}

/** Poll until Instagram has processed the container. */
export async function waitForContainer(
  client: InstagramClient,
  containerId: string,
  options: PollOptions = {},
): Promise<void> {
  const interval = options.intervalMs ?? 2000;
  const timeout = options.timeoutMs ?? 90_000;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const start = now();
  for (;;) {
    if (options.signal?.aborted)
      throw new PublishError("Cancelled while Instagram was processing.");
    const status = await getContainerStatus(client, containerId);
    if (status.code === "FINISHED" || status.code === "PUBLISHED") return;
    if (status.code === "ERROR" || status.code === "EXPIRED") {
      throw new PublishError(
        `Instagram couldn't process the media (container ${containerId}: ${status.code}` +
          `${status.detail ? `, ${status.detail}` : ""}). Check the image is a public JPEG ` +
          "between 4:5 and 1.91:1 and at most 8 MB.",
      );
    }
    if (now() - start >= timeout) {
      throw new PublishError(
        `Instagram is still processing the media after ${Math.round(timeout / 1000)} s ` +
          `(container ${containerId}). Nothing was published; try again later.`,
      );
    }
    await sleep(interval);
  }
}

export interface PublishedMedia {
  id: string;
  permalink?: string;
  timestamp?: string;
}

/**
 * Publish a finished container. If the call errors, check whether Instagram published anyway
 * before giving up, so a lost response never leads to a second, duplicate post.
 */
export async function publishContainer(
  client: InstagramClient,
  userId: string,
  containerId: string,
): Promise<PublishedMedia> {
  let mediaId: string;
  try {
    mediaId = (
      await client.post<{ id: string }>(`${userId}/media_publish`, {
        creation_id: containerId,
      })
    ).id;
  } catch (error) {
    const status = await getContainerStatus(client, containerId).catch(() => undefined);
    if (status?.code !== "PUBLISHED") throw error;
    const latest = await client.get<{ data?: { id: string }[] }>(`${userId}/media`, {
      fields: "id",
      limit: 1,
    });
    const id = latest.data?.[0]?.id;
    if (!id) throw error;
    mediaId = id;
  }
  try {
    return await client.get<PublishedMedia>(mediaId, { fields: "id,permalink,timestamp" });
  } catch (error) {
    if (error instanceof InstagramApiError) return { id: mediaId };
    throw error;
  }
}

/** Hosts Meta uses for resumable uploads; the token is only ever sent to these. */
const UPLOAD_HOSTS = new Set(["rupload.facebook.com", "rupload.instagram.com"]);

/** Reel container for a resumable upload: no public video URL needed. */
export async function createReelContainer(
  client: InstagramClient,
  userId: string,
  options: { caption: string; shareToFeed?: boolean; thumbOffsetMs?: number },
): Promise<{ id: string; uri: string }> {
  const res = await client.post<{ id: string; uri?: string }>(`${userId}/media`, {
    media_type: "REELS",
    upload_type: "resumable",
    caption: options.caption,
    share_to_feed: options.shareToFeed === false ? "false" : "true",
    thumb_offset: options.thumbOffsetMs,
  });
  if (!res.uri) throw new PublishError("Instagram didn't return an upload address for the Reel.");
  return { id: res.id, uri: res.uri };
}

/** Send the video bytes straight to Meta (resumable upload, single request). */
export async function uploadReelVideo(
  uri: string,
  accessToken: string,
  video: Buffer,
  options: {
    fetch?: typeof fetch;
    maxRetries?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<void> {
  const host = new URL(uri).host;
  if (new URL(uri).protocol !== "https:" || !UPLOAD_HOSTS.has(host)) {
    throw new PublishError(`Refusing to upload to unexpected host ${host}.`);
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = options.maxRetries ?? 2;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(uri, {
        method: "POST",
        headers: {
          Authorization: `OAuth ${accessToken}`,
          offset: "0",
          file_size: String(video.length),
        },
        body: video,
      });
    } catch (cause) {
      if (attempt < maxRetries) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      throw new PublishError(`Could not reach Meta's upload service: ${(cause as Error).message}`);
    }
    const text = await res.text();
    if (res.ok) return;
    if (res.status >= 500 && attempt < maxRetries) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    // Strip anything token-like before surfacing the message.
    const detail = text.replace(/(EAA|IGAA)[A-Za-z0-9]+/g, "***").slice(0, 300);
    throw new PublishError(`Uploading the video failed (HTTP ${res.status}): ${detail}`);
  }
}
