/**
 * Assemble a Reel MP4 from still 9:16 frames with ffmpeg: optional slow zoom per segment,
 * fades or cuts between segments, a progress bar under the card, and loudness-normalised audio
 * (or a silent track). Output matches Instagram's Reels spec: H.264 High, yuv420p, 30 fps,
 * AAC 48 kHz, faststart.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CARD_BOTTOM, REEL_HEIGHT, REEL_WIDTH } from "./frames.js";
import { ffmpeg, VideoError } from "./ffmpeg.js";

export const FPS = 30;
const FADE = 0.4;
const CUT = 1 / FPS;

export interface Segment {
  /** 1080×1920 PNG. */
  image: Buffer;
  seconds: number;
  /** Transition INTO this segment from the previous one. */
  transition?: "fade" | "cut";
  /** Slow zoom (Ken Burns). Off for reveal steps, so the card doesn't jump between steps. */
  zoom?: boolean;
}

export interface BuildOptions {
  audio?: string;
  /** rtl: the bar fills from the right (Arabic). */
  progressBar?: { colour: string; rtl?: boolean } | false;
  signal?: AbortSignal;
}

const hex = (c: string) => `0x${c.replace(/^#/, "")}`;

/** Total length after transitions overlap. */
export function reelDuration(segments: Pick<Segment, "seconds" | "transition">[]): number {
  return segments.reduce(
    (total, s, i) => total + s.seconds - (i === 0 ? 0 : s.transition === "cut" ? CUT : FADE),
    0,
  );
}

export async function buildReel(
  segments: Segment[],
  outFile: string,
  options: BuildOptions = {},
): Promise<number> {
  if (!segments.length) throw new VideoError("A Reel needs at least one segment.");
  for (const [i, s] of segments.entries()) {
    if (s.seconds < 0.5 || (i > 0 && s.seconds <= FADE)) {
      throw new VideoError(`Segment ${i + 1} is too short (${s.seconds} s).`);
    }
  }
  const total = Math.round(reelDuration(segments) * 1000) / 1000;
  const dir = await mkdtemp(path.join(tmpdir(), "reel-"));
  try {
    const inputs: string[] = [];
    const filters: string[] = [];
    for (const [i, s] of segments.entries()) {
      const file = path.join(dir, `seg${i}.png`);
      await writeFile(file, s.image);
      const frames = Math.round(s.seconds * FPS);
      if (s.zoom === false) {
        inputs.push("-loop", "1", "-framerate", String(FPS), "-t", String(s.seconds), "-i", file);
        filters.push(
          `[${i}:v]scale=${REEL_WIDTH}:${REEL_HEIGHT},setsar=1,format=yuv420p,fps=${FPS}[v${i}]`,
        );
      } else {
        // Upscale before zoompan to avoid the well-known zoompan jitter.
        inputs.push("-i", file);
        filters.push(
          `[${i}:v]scale=${REEL_WIDTH * 2}:${REEL_HEIGHT * 2},` +
            `zoompan=z='1+0.035*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${REEL_WIDTH}x${REEL_HEIGHT}:fps=${FPS},` +
            `setsar=1,format=yuv420p[v${i}]`,
        );
      }
    }

    // Join segments with xfade; offsets follow the growing joined length.
    let last = "v0";
    let length = segments[0]!.seconds;
    for (let i = 1; i < segments.length; i++) {
      const dur = segments[i]!.transition === "cut" ? CUT : FADE;
      const offset = Math.max(0, length - dur);
      filters.push(
        `[${last}][v${i}]xfade=transition=fade:duration=${dur.toFixed(3)}:offset=${offset.toFixed(3)}[x${i}]`,
      );
      last = `x${i}`;
      length = length + segments[i]!.seconds - dur;
    }

    let n = segments.length;
    if (options.progressBar) {
      // A thin bar sliding in under the card (inside the safe area).
      inputs.push(
        "-f",
        "lavfi",
        "-i",
        `color=c=${hex(options.progressBar.colour)}:s=${REEL_WIDTH}x8:r=${FPS}`,
      );
      const x = options.progressBar.rtl ? `W-W*t/${total}` : `-W+W*t/${total}`;
      filters.push(`[${last}][${n}:v]overlay=x='${x}':y=${CARD_BOTTOM + 28}:shortest=1[vbar]`);
      last = "vbar";
      n++;
    }

    if (options.audio) {
      inputs.push("-i", options.audio);
      filters.push(
        `[${n}:a]aresample=48000,apad,atrim=0:${total},` +
          `afade=t=out:st=${Math.max(0, total - 1)}:d=1,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`,
      );
    } else {
      inputs.push("-f", "lavfi", "-t", String(total), "-i", "anullsrc=r=48000:cl=stereo");
      filters.push(`[${n}:a]anull[aout]`);
    }

    await ffmpeg(
      [
        ...inputs,
        "-filter_complex",
        filters.join(";"),
        "-map",
        `[${last}]`,
        "-map",
        "[aout]",
        "-t",
        String(total),
        "-r",
        String(FPS),
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        outFile,
      ],
      options.signal,
    );
    return total;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
