/**
 * Signed uploads to Cloudinary (free tier) to get the public HTTPS URL Instagram requires.
 * Uses the REST upload API directly: https://cloudinary.com/documentation/upload_images
 */
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PROJECT_ROOT } from "../paths.js";

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  folder: string;
  /** Directories uploads may come from (resolved, absolute). */
  allowedDirs: string[];
  apiBaseUrl: string;
}

/** Instagram rejects images above 8 MB. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const SETUP_HINT = "See the Cloudinary section of the README.";

const Env = z.object({
  CLOUDINARY_URL: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/,
      "CLOUDINARY_FOLDER must look like instagram/cards",
    )
    .optional(),
  CARD_OUTPUT_DIR: z.string().optional(),
  UPLOAD_ALLOWED_DIRS: z.string().optional(),
  CLOUDINARY_API_BASE_URL: z.url().optional(),
});

export class HostingError extends Error {
  override name = "HostingError";
}

/** Folders images may be uploaded from: the card output folder plus UPLOAD_ALLOWED_DIRS. */
export function uploadAllowedDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const outDir = path.resolve(PROJECT_ROOT, env.CARD_OUTPUT_DIR?.trim() || "out");
  const extra = (env.UPLOAD_ALLOWED_DIRS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => path.resolve(PROJECT_ROOT, d));
  return [outDir, ...extra];
}

/** Folders local media (videos, music) may be read from: upload folders plus assets/. */
export function mediaInputDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...uploadAllowedDirs(env), path.resolve(PROJECT_ROOT, "assets")];
}

/** Read Cloudinary settings from either CLOUDINARY_URL or the three separate variables. */
export function loadCloudinaryConfig(env: NodeJS.ProcessEnv = process.env): CloudinaryConfig {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
  const parsed = Env.safeParse(cleaned);
  if (!parsed.success) {
    throw new HostingError(parsed.error.issues.map((i) => i.message).join("\n"));
  }
  const e = parsed.data;

  let cloudName = e.CLOUDINARY_CLOUD_NAME?.trim();
  let apiKey = e.CLOUDINARY_API_KEY?.trim();
  let apiSecret = e.CLOUDINARY_API_SECRET?.trim();
  if (e.CLOUDINARY_URL) {
    // cloudinary://<api_key>:<api_secret>@<cloud_name>
    const m = e.CLOUDINARY_URL.trim().match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
    if (!m) {
      throw new HostingError(
        `CLOUDINARY_URL must look like cloudinary://<api_key>:<api_secret>@<cloud_name>. ${SETUP_HINT}`,
      );
    }
    [, apiKey, apiSecret, cloudName] = m;
  }
  const missing = [
    !cloudName && "CLOUDINARY_CLOUD_NAME",
    !apiKey && "CLOUDINARY_API_KEY",
    !apiSecret && "CLOUDINARY_API_SECRET",
  ].filter(Boolean);
  if (missing.length) {
    throw new HostingError(
      `Cloudinary isn't configured: set ${missing.join(", ")} (or CLOUDINARY_URL) in .env. ${SETUP_HINT}`,
    );
  }

  return {
    cloudName: cloudName!,
    apiKey: apiKey!,
    apiSecret: apiSecret!,
    folder: e.CLOUDINARY_FOLDER ?? "instagram",
    allowedDirs: uploadAllowedDirs(env),
    apiBaseUrl: (e.CLOUDINARY_API_BASE_URL ?? "https://api.cloudinary.com").replace(/\/+$/, ""),
  };
}

/**
 * Cloudinary request signature: the params (minus file, api_key, cloud_name, resource_type)
 * sorted by name, joined as k=v with &, followed by the API secret, SHA-1 hashed.
 */
export function signParams(params: Record<string, string>, apiSecret: string): string {
  const payload = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1")
    .update(payload + apiSecret)
    .digest("hex");
}

/** Only JPEGs from allowed folders: uploading makes a file public, so be strict. */
export async function checkUploadable(
  file: string,
  allowedDirs: string[],
): Promise<{ real: string; data: Buffer }> {
  let real: string;
  try {
    real = await realpath(path.resolve(PROJECT_ROOT, file));
  } catch {
    throw new HostingError(`File not found: ${file}`);
  }
  const roots = await Promise.all(allowedDirs.map((d) => realpath(d).catch(() => d)));
  if (!roots.some((root) => real === root || real.startsWith(root + path.sep))) {
    throw new HostingError(
      `Refusing to upload ${real}: only files in ${roots.join(", ")} can be uploaded ` +
        "(uploads are public). Add the folder to UPLOAD_ALLOWED_DIRS to allow it.",
    );
  }
  const info = await stat(real);
  if (!info.isFile()) throw new HostingError(`Not a file: ${real}`);
  if (info.size > MAX_IMAGE_BYTES) {
    throw new HostingError(
      `${path.basename(real)} is ${(info.size / 1024 / 1024).toFixed(1)} MB; Instagram accepts images up to 8 MB.`,
    );
  }
  const data = await readFile(real);
  if (!(data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)) {
    throw new HostingError(
      `${path.basename(real)} isn't a JPEG. Instagram only publishes JPEG images; render it with render_card.`,
    );
  }
  return { real, data };
}

export interface UploadResult {
  url: string;
  publicId: string;
  bytes: number;
  width: number;
  height: number;
  format: string;
}

interface CloudinaryUploadResponse {
  secure_url: string;
  public_id: string;
  bytes: number;
  width: number;
  height: number;
  format: string;
  error?: { message: string };
}

export interface UploadOptions {
  publicId?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Extra attempts after network errors and 5xx responses. */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Upload a local JPEG and return its public HTTPS URL. */
export async function uploadImage(
  file: string,
  config: CloudinaryConfig,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const { real, data } = await checkUploadable(file, config.allowedDirs);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = options.maxRetries ?? 2;

  const publicId =
    options.publicId ??
    path
      .basename(real, path.extname(real))
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .slice(0, 100);
  const params: Record<string, string> = {
    folder: config.folder,
    overwrite: "true",
    public_id: publicId,
    timestamp: String(Math.floor((options.now?.() ?? new Date()).getTime() / 1000)),
  };
  const url = `${config.apiBaseUrl}/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`;

  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.set("file", new Blob([data], { type: "image/jpeg" }), path.basename(real));
    for (const [k, v] of Object.entries(params)) form.set(k, v);
    form.set("api_key", config.apiKey);
    form.set("signature", signParams(params, config.apiSecret));

    let response: Response;
    try {
      response = await fetchImpl(url, { method: "POST", body: form });
    } catch (cause) {
      if (attempt < maxRetries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new HostingError(`Could not reach Cloudinary: ${(cause as Error).message}`);
    }
    const body = (await response.json().catch(() => ({}))) as Partial<CloudinaryUploadResponse>;
    if (response.ok && body.secure_url) {
      return {
        url: body.secure_url,
        publicId: body.public_id ?? publicId,
        bytes: body.bytes ?? data.length,
        width: body.width ?? 0,
        height: body.height ?? 0,
        format: body.format ?? "jpg",
      };
    }
    if (response.status >= 500 && attempt < maxRetries) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw new HostingError(describeUploadError(response.status, body.error?.message));
  }
}

function describeUploadError(status: number, message: string | undefined): string {
  const detail = message ? ` Details: ${message}` : "";
  // Cloudinary answers an unknown cloud name with 401 "Invalid cloud_name <name>".
  if (status === 404 || /cloud_name/i.test(message ?? "")) {
    return (
      "Cloudinary doesn't know that cloud name: check CLOUDINARY_CLOUD_NAME. It's the short " +
      'code shown as "Cloud name" in the Cloudinary dashboard (also the part after @ in ' +
      `CLOUDINARY_URL), not the account or environment name.${detail}`
    );
  }
  if (status === 401) {
    return `Cloudinary rejected the credentials: check CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.${detail}`;
  }
  if (status === 420 || status === 429) {
    return `Cloudinary rate or usage limit reached (free tier). Try again later.${detail}`;
  }
  return `Cloudinary upload failed (HTTP ${status}).${detail}`;
}

/** Confirm the uploaded image is publicly reachable as a JPEG, as Instagram will fetch it. */
export async function verifyPublicUrl(
  url: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ ok: boolean; status: number; contentType: string | null }> {
  try {
    const res = await fetchImpl(url, { method: "HEAD" });
    const contentType = res.headers.get("content-type");
    return { ok: res.ok && contentType === "image/jpeg", status: res.status, contentType };
  } catch {
    return { ok: false, status: 0, contentType: null };
  }
}

/**
 * Turn a Cloudinary delivery URL into its public ID, e.g.
 * https://res.cloudinary.com/demo/image/upload/v17/instagram/tip.jpg → "instagram/tip".
 * Returns undefined if the URL isn't an image of this cloud.
 */
export function publicIdFromUrl(url: string, cloudName: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  // /<cloud>/image/upload/[transformations/][v123/]<public_id>.<ext>
  if (parts[0] !== cloudName || parts[1] !== "image" || parts[2] !== "upload") return undefined;
  let rest = parts.slice(3);
  const version = rest.findIndex((p) => /^v\d+$/.test(p));
  if (version >= 0) rest = rest.slice(version + 1);
  if (!rest.length) return undefined;
  return rest.join("/").replace(/\.[A-Za-z0-9]+$/, "");
}

export interface DeleteResult {
  publicId: string;
  /** "deleted", or "not found" if it was already gone. */
  status: "deleted" | "not found";
}

/**
 * Delete an uploaded image and purge it from Cloudinary's CDN cache, so the public URL stops
 * working. Only images inside the configured folder can be deleted, never other media.
 */
export async function deleteImage(
  publicIdOrUrl: string,
  config: CloudinaryConfig,
  options: Omit<UploadOptions, "publicId"> = {},
): Promise<DeleteResult> {
  const publicId = /^https?:\/\//.test(publicIdOrUrl)
    ? publicIdFromUrl(publicIdOrUrl, config.cloudName)
    : publicIdOrUrl.replace(/\.(jpe?g)$/i, "");
  if (!publicId) {
    throw new HostingError(
      `${publicIdOrUrl} isn't an image URL of the Cloudinary cloud "${config.cloudName}".`,
    );
  }
  if (!publicId.startsWith(`${config.folder}/`) || publicId.includes("..")) {
    throw new HostingError(
      `Refusing to delete "${publicId}": only images in the "${config.folder}/" folder ` +
        "(uploaded by this server) can be deleted.",
    );
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = options.maxRetries ?? 2;
  const params: Record<string, string> = {
    invalidate: "true",
    public_id: publicId,
    timestamp: String(Math.floor((options.now?.() ?? new Date()).getTime() / 1000)),
  };
  const url = `${config.apiBaseUrl}/v1_1/${encodeURIComponent(config.cloudName)}/image/destroy`;

  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) form.set(k, v);
    form.set("api_key", config.apiKey);
    form.set("signature", signParams(params, config.apiSecret));

    let response: Response;
    try {
      response = await fetchImpl(url, { method: "POST", body: form });
    } catch (cause) {
      if (attempt < maxRetries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new HostingError(`Could not reach Cloudinary: ${(cause as Error).message}`);
    }
    const body = (await response.json().catch(() => ({}))) as {
      result?: string;
      error?: { message: string };
    };
    if (response.ok && body.result === "ok") return { publicId, status: "deleted" };
    if (response.ok && body.result === "not found") return { publicId, status: "not found" };
    if (response.status >= 500 && attempt < maxRetries) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw new HostingError(
      describeUploadError(response.status, body.error?.message ?? body.result).replace(
        "upload failed",
        "delete failed",
      ),
    );
  }
}
