import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

/** Bundled binaries (ffmpeg-static, ffprobe-static): no system install needed. */
export const FFMPEG: string = require("ffmpeg-static") as string;
export const FFPROBE: string = (require("ffprobe-static") as { path: string }).path;

export class VideoError extends Error {
  override name = "VideoError";
}

export async function ffmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  try {
    await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
      maxBuffer: 16 * 1024 * 1024,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    const e = error as { stderr?: string; message: string; name?: string };
    if (e.name === "AbortError") throw new VideoError("Video rendering was cancelled.");
    throw new VideoError(
      `ffmpeg failed: ${(e.stderr || e.message).trim().split("\n").slice(-5).join(" | ")}`,
    );
  }
}

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec?: string;
  audioCodec?: string;
  audioSampleRate?: number;
  pixelFormat?: string;
  bytes: number;
}

interface FfprobeJson {
  format?: { duration?: string; size?: string };
  streams?: {
    codec_type: string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    sample_rate?: string;
    pix_fmt?: string;
  }[];
}

export async function probe(file: string): Promise<ProbeResult> {
  let stdout: string;
  try {
    ({ stdout } = await run(FFPROBE, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      file,
    ]));
  } catch (error) {
    throw new VideoError(
      `Not a readable video: ${file} (${(error as Error).message.split("\n")[0]})`,
    );
  }
  const json = JSON.parse(stdout) as FfprobeJson;
  const video = json.streams?.find((s) => s.codec_type === "video");
  const audio = json.streams?.find((s) => s.codec_type === "audio");
  if (!video) throw new VideoError(`No video stream in ${file}.`);
  const [num, den] = (video.r_frame_rate ?? "0/1").split("/").map(Number);
  return {
    duration: Number(json.format?.duration ?? 0),
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps: den ? Math.round((num! / den) * 100) / 100 : 0,
    ...(video.codec_name ? { videoCodec: video.codec_name } : {}),
    ...(audio?.codec_name ? { audioCodec: audio.codec_name } : {}),
    ...(audio?.sample_rate ? { audioSampleRate: Number(audio.sample_rate) } : {}),
    ...(video.pix_fmt ? { pixelFormat: video.pix_fmt } : {}),
    bytes: Number(json.format?.size ?? 0),
  };
}
