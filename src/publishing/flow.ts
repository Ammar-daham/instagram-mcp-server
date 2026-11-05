/**
 * The full publishing flow behind publish_post, publish_carousel and
 * create_and_publish_card_post. Without `confirm` it's a dry run: nothing is uploaded or posted.
 * With `confirm`, local images are uploaded only now, under unguessable names, and every upload
 * is deleted again once Instagram has its own copy (or if publishing fails), so nothing stays
 * public except the Instagram post itself.
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { validateCaption, type CaptionStats } from "../content/caption.js";
import type { ContextFactory } from "../context.js";
import {
  checkUploadable,
  deleteImage,
  HostingError,
  loadCloudinaryConfig,
  publicIdFromUrl,
  uploadAllowedDirs,
  uploadImage,
  type CloudinaryConfig,
  type UploadOptions,
} from "../hosting/cloudinary.js";
import { getAccountInfo, resolveUserId } from "../instagram/account.js";
import {
  createCarouselContainer,
  createImageContainer,
  getPublishingLimit,
  publishContainer,
  PublishError,
  waitForContainer,
  type PollOptions,
  type PublishingLimit,
} from "../instagram/publish.js";

export interface PublishRequest {
  /** Local JPEG paths (uploaded at publish time) or public https URLs. 1 = post, 2-10 = carousel. */
  images: string[];
  caption: string;
  confirm: boolean;
  keepUploads?: boolean;
  /** Cancellation from the client (e.g. a timeout). Honoured until the final publish call. */
  signal?: AbortSignal;
  /** Called at each step, e.g. to send MCP progress notifications. */
  onProgress?: (message: string) => void;
}

export interface FlowDeps {
  getContext: ContextFactory;
  env: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  poll?: PollOptions;
  hosting?: Pick<UploadOptions, "sleep" | "now">;
  /** Random suffix for upload names; injectable for tests. */
  randomSuffix?: () => string;
}

interface ImageSource {
  source: string;
  kind: "local" | "url";
  width?: number;
  height?: number;
}

// Instagram accepts feed images between 4:5 (portrait) and 1.91:1 (landscape).
const MIN_RATIO = 4 / 5;
const MAX_RATIO = 1.91;

async function resolveImages(images: string[], env: NodeJS.ProcessEnv): Promise<ImageSource[]> {
  if (images.length < 1 || images.length > 10) {
    throw new PublishError("A post needs 1 image, a carousel 2-10 images.");
  }
  return Promise.all(
    images.map(async (image): Promise<ImageSource> => {
      if (/^https:\/\//i.test(image)) return { source: image, kind: "url" };
      if (/^[a-z]+:\/\//i.test(image)) {
        throw new PublishError(`Image URLs must use https: ${image}`);
      }
      const { real, data } = await checkUploadable(image, uploadAllowedDirs(env));
      const { width = 0, height = 0 } = await sharp(data).metadata();
      const ratio = width / height;
      if (width < 320 || ratio < MIN_RATIO - 0.01 || ratio > MAX_RATIO + 0.01) {
        throw new PublishError(
          `${path.basename(real)} is ${width}×${height}; Instagram needs at least 320 px wide and ` +
            "an aspect ratio between 4:5 and 1.91:1.",
        );
      }
      return { source: real, kind: "local", width, height };
    }),
  );
}

function tryHosting(env: NodeJS.ProcessEnv): CloudinaryConfig | HostingError {
  try {
    return loadCloudinaryConfig(env);
  } catch (error) {
    if (error instanceof HostingError) return error;
    throw error;
  }
}

export interface DryRunResult {
  mode: "dry_run";
  type: "post" | "carousel";
  account: string;
  caption: CaptionStats & { text: string };
  images: ImageSource[];
  publishingLimit: PublishingLimit;
  ready: boolean;
  problems: string[];
  next: string;
}

export interface PublishedResult {
  mode: "published";
  type: "post" | "carousel";
  mediaId: string;
  permalink?: string;
  timestamp?: string;
  /** Cloudinary images deleted after publishing. */
  deleted: string[];
  /** Uploads that couldn't be deleted (or were kept): remove them with delete_image. */
  leftOnCloudinary: string[];
}

export async function runPublish(
  request: PublishRequest,
  deps: FlowDeps,
): Promise<DryRunResult | PublishedResult> {
  const stats = validateCaption(request.caption);
  const images = await resolveImages(request.images, deps.env);
  const type = images.length === 1 ? "post" : "carousel";
  const ctx = await deps.getContext();
  const userId = await resolveUserId(ctx.client, ctx.config);
  const limit = await getPublishingLimit(ctx.client, userId);
  const hosting = tryHosting(deps.env);
  const hasLocal = images.some((i) => i.kind === "local");

  const problems: string[] = [];
  if (limit.remaining < 1) {
    problems.push(
      `Publishing limit reached: ${limit.used}/${limit.total} posts in the last 24 hours. Try again later.`,
    );
  }
  if (hasLocal && hosting instanceof HostingError) problems.push(hosting.message);

  if (!request.confirm) {
    const account = await getAccountInfo(ctx.client, ctx.config)
      .then((a) => `@${a.username}`)
      .catch(() => userId);
    return {
      mode: "dry_run",
      type,
      account,
      caption: { text: request.caption, ...stats },
      images,
      publishingLimit: limit,
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

  const progress = request.onProgress ?? (() => {});
  const checkCancelled = () => {
    if (request.signal?.aborted) {
      throw new PublishError("The request was cancelled (or timed out) before publishing.");
    }
  };
  const poll = { ...deps.poll, ...(request.signal ? { signal: request.signal } : {}) };

  const uploads: { url: string; publicId: string }[] = [];
  const cloud = hosting instanceof HostingError ? undefined : hosting;
  const hostingOpts = { ...deps.hosting, ...(deps.fetch ? { fetch: deps.fetch } : {}) };
  const suffix = deps.randomSuffix ?? (() => randomBytes(6).toString("hex"));

  let media;
  try {
    const urls: string[] = [];
    for (const [i, image] of images.entries()) {
      checkCancelled();
      if (image.kind === "url") {
        urls.push(image.source);
        continue;
      }
      const base = path
        .basename(image.source, path.extname(image.source))
        .replace(/[^A-Za-z0-9_-]+/g, "-")
        .slice(0, 80);
      progress(`Uploading image ${i + 1}/${images.length}`);
      const up = await uploadImage(image.source, cloud!, {
        ...hostingOpts,
        publicId: `${base}-${suffix()}`,
      });
      uploads.push({ url: up.url, publicId: up.publicId });
      urls.push(up.url);
    }

    let containerId: string;
    checkCancelled();
    if (type === "post") {
      progress("Creating the Instagram post");
      containerId = await createImageContainer(ctx.client, userId, {
        imageUrl: urls[0]!,
        caption: request.caption,
      });
    } else {
      const children: string[] = [];
      for (const [i, url] of urls.entries()) {
        checkCancelled();
        progress(`Instagram is processing slide ${i + 1}/${urls.length}`);
        const child = await createImageContainer(ctx.client, userId, {
          imageUrl: url,
          isCarouselItem: true,
        });
        await waitForContainer(ctx.client, child, poll);
        children.push(child);
      }
      checkCancelled();
      progress("Creating the carousel");
      containerId = await createCarouselContainer(ctx.client, userId, children, request.caption);
    }
    progress("Waiting for Instagram to finish processing");
    await waitForContainer(ctx.client, containerId, poll);
    // Last chance to stop: after this call the post is live.
    checkCancelled();
    progress("Publishing");
    media = await publishContainer(ctx.client, userId, containerId);
  } catch (error) {
    // Not published: take the uploads down again so nothing stays public.
    const left = await deleteAll(
      uploads.map((u) => u.publicId),
      cloud,
      hostingOpts,
    );
    const message = error instanceof Error ? error.message : String(error);
    throw new PublishError(
      `${message}\nNothing was published.` +
        (uploads.length
          ? left.failed.length
            ? ` Couldn't delete these uploads, remove them with delete_image: ${left.failed.join(", ")}`
            : " The uploaded images were deleted again."
          : ""),
    );
  }

  // Published: Instagram has its own copy now, so remove the hosted images.
  const toDelete = [
    ...uploads.map((u) => u.publicId),
    // Also previously uploaded URLs from this server's Cloudinary folder.
    ...(cloud
      ? images
          .filter((i) => i.kind === "url")
          .map((i) => publicIdFromUrl(i.source, cloud.cloudName))
          .filter((id): id is string => Boolean(id?.startsWith(`${cloud.folder}/`)))
      : []),
  ];
  if (!request.keepUploads && toDelete.length) progress("Published. Deleting the uploaded images");
  const result = request.keepUploads
    ? { deleted: [], failed: toDelete }
    : await deleteAll(toDelete, cloud, hostingOpts);

  return {
    mode: "published",
    type,
    mediaId: media.id,
    ...(media.permalink ? { permalink: media.permalink } : {}),
    ...(media.timestamp ? { timestamp: media.timestamp } : {}),
    deleted: result.deleted,
    leftOnCloudinary: result.failed,
  };
}

async function deleteAll(
  publicIds: string[],
  cloud: CloudinaryConfig | undefined,
  options: Omit<UploadOptions, "publicId">,
): Promise<{ deleted: string[]; failed: string[] }> {
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const id of publicIds) {
    try {
      if (!cloud) throw new Error("no hosting config");
      await deleteImage(id, cloud, options);
      deleted.push(id);
    } catch {
      failed.push(id);
    }
  }
  return { deleted, failed };
}
