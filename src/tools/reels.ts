import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import sharp from "sharp";
import { z } from "zod";
import { contactSheet } from "../cards/contact-sheet.js";
import { LANGUAGES, type Language } from "../cards/locale.js";
import { TEMPLATE_NAMES } from "../cards/templates/index.js";
import { loadTheme } from "../cards/theme.js";
import type { ContextFactory } from "../context.js";
import { mediaInputDirs } from "../hosting/cloudinary.js";
import { PROJECT_ROOT } from "../paths.js";
import { runReelPublish, type ReelDeps } from "../publishing/reel-flow.js";
import { composeReel, type ReelSlide } from "../video/compose.js";
import { probe, VideoError } from "../video/ffmpeg.js";
import { checkAudio } from "../video/inputs.js";
import { buildReel } from "../video/reel.js";
import { progressReporter, type ToolExtra } from "./progress.js";
import { rawToolResult, toolResult } from "./result.js";

export type ReelToolOptions = Omit<ReelDeps, "getContext" | "env"> & {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
};

const SAFETY =
  "Without confirm: true this is a dry run: nothing is uploaded or posted. Only set " +
  "confirm: true after the user has explicitly approved this exact Reel. The video is sent " +
  "straight to Instagram (never hosted publicly).";

const slideSchema = z.object({
  template: z.enum(TEMPLATE_NAMES),
  content: z.record(z.string(), z.unknown()),
  seconds: z.number().min(1).max(10).optional().describe("How long the slide shows"),
  reveal: z
    .boolean()
    .optional()
    .describe("tip cards: show the points one by one (great for retention)"),
});

const renderArgs = {
  language: z.enum(LANGUAGES).describe('"ar" (Arabic) or "en" (English)'),
  slides: z
    .array(slideSchema)
    .min(1)
    .max(10)
    .describe("Slides in order; start with a strong hook (cover), end with follow"),
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "lowercase letters, digits and dashes only")
    .optional()
    .describe("Base file name, e.g. 'vitamin-d3-reel'"),
  audio: z
    .string()
    .optional()
    .describe("Optional music/voice file (mp3, m4a, wav) from out/ or assets/; default silent"),
  progress_bar: z.boolean().default(true).describe("Thin progress bar under the card"),
};

interface RenderedReel {
  file: string;
  duration: number;
  sheet: Buffer;
  info: Awaited<ReturnType<typeof probe>>;
  warnings: string[];
}

async function renderReelFile(
  args: {
    language: Language;
    slides: ReelSlide[];
    name?: string | undefined;
    audio?: string | undefined;
    progress_bar: boolean;
  },
  env: NodeJS.ProcessEnv,
  now: () => Date,
  extra: ToolExtra | undefined,
): Promise<RenderedReel> {
  const progress = progressReporter(extra);
  const theme = loadTheme(env);
  const audio = args.audio ? await checkAudio(args.audio, mediaInputDirs(env)) : undefined;
  progress(`Rendering ${args.slides.length} slide(s)`);
  const { segments, slideFrames } = await composeReel(args.slides, theme, args.language);
  const outDir = path.resolve(PROJECT_ROOT, env.CARD_OUTPUT_DIR || "out");
  await mkdir(outDir, { recursive: true });
  const stamp = now().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const file = path.join(outDir, `${args.name ?? `${stamp}-reel`}-${args.language}.mp4`);
  progress("Encoding the video");
  const duration = await buildReel(segments, file, {
    ...(audio ? { audio } : {}),
    progressBar: args.progress_bar ? { colour: theme.accent, rtl: args.language === "ar" } : false,
    ...(extra?.signal ? { signal: extra.signal } : {}),
  });
  if (duration < 3) {
    throw new VideoError(
      `The Reel is ${duration.toFixed(1)} s; Instagram needs at least 3 s. Add slides or seconds.`,
    );
  }
  const info = await probe(file);
  const thumbs = await Promise.all(
    slideFrames.map((f) => sharp(f).jpeg({ quality: 85 }).toBuffer()),
  );
  const sheet = await contactSheet(thumbs, 180, 1920 / 1080);
  const warnings: string[] = [];
  if (duration > 30)
    warnings.push("Longer than 30 s: short Reels (7-15 s) tend to be watched to the end.");
  if (!audio) warnings.push("Silent Reel: fine with on-screen text; add audio for more reach.");
  return { file, duration, sheet, info, warnings };
}

const image = (buf: Buffer) => ({
  type: "image" as const,
  data: buf.toString("base64"),
  mimeType: "image/jpeg",
});
const json = (value: unknown) => ({ type: "text" as const, text: JSON.stringify(value, null, 2) });

export function registerReelTools(
  server: McpServer,
  getContext: ContextFactory,
  options: ReelToolOptions = {},
): void {
  const { env = process.env, now = () => new Date(), ...rest } = options;
  const deps: ReelDeps = { ...rest, getContext, env };

  server.registerTool(
    "render_reel",
    {
      title: "Render a Reel",
      description:
        "Turn 1-10 nutrition cards (same templates and content as render_card) into a 9:16 " +
        "Reel MP4 (1080x1920, H.264, 30 fps) with fades, a slow zoom, optional point-by-point " +
        "reveal on tip cards, a progress bar and optional audio. Saves it in out/ and returns " +
        "a preview sheet of the slides (MCP can't show video). Aim for 7-15 s and a strong " +
        "first slide: viewers decide in 2 seconds. Ask the user for the language first if " +
        "they haven't said.",
      inputSchema: renderArgs,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (args, extra) =>
      rawToolResult(async (): Promise<CallToolResult> => {
        const r = await renderReelFile(args, env, now, extra);
        return {
          content: [
            image(r.sheet),
            json({
              path: r.file,
              duration: Math.round(r.duration * 10) / 10,
              width: r.info.width,
              height: r.info.height,
              bytes: r.info.bytes,
              warnings: r.warnings,
            }),
          ],
        };
      }),
  );

  const publishArgs = {
    caption: z.string().min(1).describe("Reel caption: hook, value, call to action, hashtags"),
    share_to_feed: z
      .boolean()
      .default(true)
      .describe("Also show the Reel in the profile grid/feed"),
    thumb_offset_ms: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Cover frame, in ms from the start (default: 1 s into the first slide)"),
    confirm: z
      .boolean()
      .default(false)
      .describe("true only after the user approved this exact Reel"),
  };

  server.registerTool(
    "publish_reel",
    {
      title: "Publish a Reel",
      description: `Publish an MP4 (from render_reel, in out/) as a Reel. ${SAFETY}`,
      inputSchema: {
        video: z.string().min(1).describe("Path of the MP4 from render_reel"),
        ...publishArgs,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (args, extra) =>
      toolResult(() =>
        runReelPublish(
          {
            video: args.video,
            caption: args.caption,
            confirm: args.confirm,
            shareToFeed: args.share_to_feed,
            thumbOffsetMs: args.thumb_offset_ms ?? 1000,
            signal: extra.signal,
            onProgress: progressReporter(extra),
          },
          deps,
        ),
      ),
  );

  server.registerTool(
    "create_and_publish_reel",
    {
      title: "Render a Reel and publish it",
      description:
        "render_reel + publish_reel in one call. The dry run renders the video and returns the " +
        `preview sheet and checks. ${SAFETY}`,
      inputSchema: { ...renderArgs, ...publishArgs },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (args, extra) =>
      rawToolResult(async (): Promise<CallToolResult> => {
        const r = await renderReelFile(args, env, now, extra);
        const result = await runReelPublish(
          {
            video: r.file,
            caption: args.caption,
            confirm: args.confirm,
            shareToFeed: args.share_to_feed,
            thumbOffsetMs: args.thumb_offset_ms ?? 1000,
            signal: extra.signal,
            onProgress: progressReporter(extra),
          },
          deps,
        );
        if (result.mode === "dry_run") {
          return {
            content: [
              image(r.sheet),
              json({ ...result, warnings: [...r.warnings, ...result.warnings] }),
            ],
          };
        }
        return { content: [json(result)] };
      }),
  );
}
