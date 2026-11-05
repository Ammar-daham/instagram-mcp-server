/** Assemble fun-style shots into an Instagram-ready Reel MP4 with sound. */
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ffmpeg, VideoError } from "../ffmpeg.js";
import { slideShots, type FunContext, type FunSlide, type Shot } from "./slides.js";
import { soundExpression, type TimedCue } from "./sound.js";

export interface FunReel {
  shots: Shot[];
  /** Final frame of each slide, for preview sheets. */
  slideFrames: Buffer[];
}

export async function funShots(
  slides: FunSlide[],
  ctx: FunContext,
  onProgress?: (message: string) => void,
): Promise<FunReel> {
  const shots: Shot[] = [];
  const slideFrames: Buffer[] = [];
  for (const [i, slide] of slides.entries()) {
    onProgress?.(`Animating slide ${i + 1}/${slides.length}`);
    let s: Shot[];
    try {
      s = await slideShots(slide, ctx);
    } catch (error) {
      throw new Error(`Slide ${i + 1}: ${(error as Error).message}`);
    }
    shots.push(...s);
    slideFrames.push(s.at(-1)!.png);
  }
  return { shots, slideFrames };
}

export function shotsDuration(shots: Shot[]): number {
  return shots.reduce((sum, s) => sum + s.seconds, 0);
}

export function cueTimes(shots: Shot[]): TimedCue[] {
  const cues: TimedCue[] = [];
  let t = 0;
  for (const s of shots) {
    if (s.cue) cues.push({ at: t, cue: s.cue });
    t += s.seconds;
  }
  return cues;
}

export interface FunBuildOptions {
  /** "fun": synthesised melody + sound effects; "none": silent; or an audio file path. */
  sound: "fun" | "none" | { file: string };
  signal?: AbortSignal;
}

export async function buildFunReel(
  shots: Shot[],
  outFile: string,
  options: FunBuildOptions,
): Promise<number> {
  if (!shots.length) throw new VideoError("Nothing to render.");
  const total = Math.round(shotsDuration(shots) * 1000) / 1000;
  const dir = await mkdtemp(path.join(tmpdir(), "funreel-"));
  try {
    // Write each distinct frame once (holds reuse the same file).
    const files = new Map<string, string>();
    const lines: string[] = [];
    for (const shot of shots) {
      const key = createHash("sha1").update(shot.png).digest("hex");
      let file = files.get(key);
      if (!file) {
        file = path.join(dir, `f${files.size}.png`);
        await writeFile(file, shot.png);
        files.set(key, file);
      }
      lines.push(`file '${file}'`, `duration ${shot.seconds.toFixed(4)}`);
    }
    lines.push(lines.at(-2)!); // the concat demuxer needs the last file repeated
    const list = path.join(dir, "list.txt");
    await writeFile(list, lines.join("\n"));

    const audioInput =
      options.sound === "none"
        ? ["-f", "lavfi", "-t", String(total), "-i", "anullsrc=r=48000:cl=stereo"]
        : options.sound === "fun"
          ? [
              "-f",
              "lavfi",
              "-i",
              `aevalsrc=exprs='${soundExpression(cueTimes(shots), total)}':s=48000:d=${total}`,
            ]
          : ["-i", options.sound.file];
    const audioFilter =
      options.sound === "none"
        ? "anull"
        : `aresample=48000,apad,atrim=0:${total},loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st=${Math.max(0, total - 0.6)}:d=0.6,aresample=48000`;

    await ffmpeg(
      [
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list,
        ...audioInput,
        "-filter_complex",
        `[0:v]fps=30,format=yuv420p[v];[1:a]${audioFilter},aformat=channel_layouts=stereo[a]`,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-t",
        String(total),
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
        "160k",
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
