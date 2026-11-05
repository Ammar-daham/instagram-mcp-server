import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PROJECT_ROOT } from "../paths.js";
import { FFPROBE, probe, VideoError, type ProbeResult } from "./ffmpeg.js";

const AUDIO_EXT = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"]);
const VIDEO_EXT = new Set([".mp4", ".mov"]);
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
/** Instagram's Reels limit for API uploads. */
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

async function allowedFile(file: string, allowedDirs: string[], exts: Set<string>, kind: string) {
  let real: string;
  try {
    real = await realpath(path.resolve(PROJECT_ROOT, file));
  } catch {
    throw new VideoError(`File not found: ${file}`);
  }
  const roots = await Promise.all(allowedDirs.map((d) => realpath(d).catch(() => d)));
  if (!roots.some((r) => real === r || real.startsWith(r + path.sep))) {
    throw new VideoError(
      `Refusing to use ${real}: ${kind} files must be in ${roots.join(", ")} (or UPLOAD_ALLOWED_DIRS).`,
    );
  }
  if (!exts.has(path.extname(real).toLowerCase())) {
    throw new VideoError(
      `${path.basename(real)} isn't a supported ${kind} file (${[...exts].join(", ")}).`,
    );
  }
  const info = await stat(real);
  if (!info.isFile()) throw new VideoError(`Not a file: ${real}`);
  return { real, bytes: info.size };
}

/** A local music/voice file the Reel may use. */
export async function checkAudio(file: string, allowedDirs: string[]): Promise<string> {
  const { real, bytes } = await allowedFile(file, allowedDirs, AUDIO_EXT, "audio");
  if (bytes > MAX_AUDIO_BYTES) throw new VideoError(`${path.basename(real)} is larger than 50 MB.`);
  const { stdout } = await promisify(execFile)(FFPROBE, [
    "-v",
    "error",
    "-select_streams",
    "a",
    "-show_entries",
    "stream=codec_type",
    "-of",
    "csv=p=0",
    real,
  ]).catch(() => ({ stdout: "" }));
  if (!stdout.includes("audio")) throw new VideoError(`${path.basename(real)} has no audio.`);
  return real;
}

/** A local Reel video that Instagram will accept. */
export async function checkReelVideo(
  file: string,
  allowedDirs: string[],
): Promise<{ real: string; info: ProbeResult; warnings: string[] }> {
  const { real, bytes } = await allowedFile(file, allowedDirs, VIDEO_EXT, "video");
  if (bytes > MAX_VIDEO_BYTES) {
    throw new VideoError(
      `${path.basename(real)} is ${(bytes / 1024 / 1024).toFixed(0)} MB; Reels can be up to 300 MB.`,
    );
  }
  const info = await probe(real);
  const problems: string[] = [];
  if (info.duration < 3) problems.push(`it's ${info.duration.toFixed(1)} s (minimum 3 s)`);
  if (info.duration > 900) problems.push(`it's ${Math.round(info.duration)} s (maximum 15 min)`);
  if (info.videoCodec !== "h264" && info.videoCodec !== "hevc") {
    problems.push(`video codec ${info.videoCodec} (use H.264)`);
  }
  if (info.fps < 23 || info.fps > 60) problems.push(`${info.fps} fps (use 23-60)`);
  if (problems.length) {
    throw new VideoError(`${path.basename(real)} can't be a Reel: ${problems.join("; ")}.`);
  }
  const warnings: string[] = [];
  if (Math.abs(info.width / info.height - 9 / 16) > 0.02) {
    warnings.push(`It's ${info.width}×${info.height}, not 9:16; Instagram will crop or pad it.`);
  }
  if (info.duration > 30)
    warnings.push("Longer than 30 s: short Reels tend to be watched to the end.");
  if (!info.audioCodec) warnings.push("No audio track.");
  return { real, info, warnings };
}
