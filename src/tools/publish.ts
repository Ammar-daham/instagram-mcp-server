import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { contactSheet } from "../cards/contact-sheet.js";
import { LANGUAGES } from "../cards/locale.js";
import { renderCard } from "../cards/render.js";
import { TEMPLATE_NAMES } from "../cards/templates/index.js";
import { loadTheme } from "../cards/theme.js";
import type { ContextFactory } from "../context.js";
import { PROJECT_ROOT } from "../paths.js";
import { runPublish, type FlowDeps } from "../publishing/flow.js";
import { progressReporter } from "./progress.js";
import { rawToolResult, toolResult } from "./result.js";

export type PublishToolOptions = Omit<FlowDeps, "getContext" | "env"> & {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
};

const SAFETY =
  "Without confirm: true this is a dry run: nothing is uploaded or posted, and it returns a " +
  "summary to show the user. Only set confirm: true after the user has explicitly approved " +
  "this exact post. Local images are uploaded only at that moment and deleted from Cloudinary " +
  "again once the post is live, so nothing stays public except the Instagram post.";

const caption = z
  .string()
  .min(1)
  .describe("The caption: hook, value, call to action, hashtags (max 2,200 chars, 30 hashtags)");
const confirm = z
  .boolean()
  .default(false)
  .describe("true only after the user approved this exact post; otherwise a dry run");
const keepUploads = z
  .boolean()
  .default(false)
  .describe("Keep the images on Cloudinary after publishing (default: delete them)");
const image = z
  .string()
  .min(1)
  .describe("A rendered card's local path (from render_card, in out/) or a public https URL");

export function registerPublishTools(
  server: McpServer,
  getContext: ContextFactory,
  options: PublishToolOptions = {},
): void {
  const { env = process.env, now = () => new Date(), ...rest } = options;
  const deps: FlowDeps = { ...rest, getContext, env };

  server.registerTool(
    "publish_post",
    {
      title: "Publish a single-image post",
      description: `Publish one image with a caption to the connected Instagram account. ${SAFETY}`,
      inputSchema: { image, caption, confirm, keep_uploads: keepUploads },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (args, extra) =>
      toolResult(() =>
        runPublish(
          {
            images: [args.image],
            caption: args.caption,
            confirm: args.confirm,
            keepUploads: args.keep_uploads,
            signal: extra.signal,
            onProgress: progressReporter(extra),
          },
          deps,
        ),
      ),
  );

  server.registerTool(
    "publish_carousel",
    {
      title: "Publish a carousel",
      description:
        "Publish 2-10 images as one carousel post (in order) with a caption. All slides " +
        `should share the same aspect ratio (cards are 4:5). ${SAFETY}`,
      inputSchema: {
        images: z.array(image).min(2).max(10).describe("2-10 slides, in order"),
        caption,
        confirm,
        keep_uploads: keepUploads,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (args, extra) =>
      toolResult(() =>
        runPublish(
          {
            images: args.images,
            caption: args.caption,
            confirm: args.confirm,
            keepUploads: args.keep_uploads,
            signal: extra.signal,
            onProgress: progressReporter(extra),
          },
          deps,
        ),
      ),
  );

  server.registerTool(
    "create_and_publish_card_post",
    {
      title: "Render cards and publish them",
      description:
        "Render 1-10 nutrition cards (same templates and content fields as render_card) and " +
        "publish them as a post (1 card) or carousel (2-10). The dry run renders every card " +
        "and returns a preview of all slides plus the summary. Ask the user for the language " +
        `first if they haven't said. ${SAFETY}`,
      inputSchema: {
        language: z.enum(LANGUAGES).describe('"ar" (Arabic) or "en" (English)'),
        cards: z
          .array(
            z.object({
              template: z.enum(TEMPLATE_NAMES),
              content: z.record(z.string(), z.unknown()),
            }),
          )
          .min(1)
          .max(10)
          .describe("The slides in order, e.g. cover, tips…, follow"),
        caption,
        name: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "lowercase letters, digits and dashes only")
          .optional()
          .describe("Base file name for the rendered slides, e.g. 'protein-breakfasts'"),
        confirm,
        keep_uploads: keepUploads,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (args, extra) =>
      rawToolResult(async () => {
        const progress = progressReporter(extra);
        const theme = loadTheme(env);
        const outDir = path.resolve(PROJECT_ROOT, env.CARD_OUTPUT_DIR || "out");
        await mkdir(outDir, { recursive: true });
        const stamp = now().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
        const base = args.name ?? `${stamp}-post`;

        const files: string[] = [];
        const jpegs: Buffer[] = [];
        for (const [i, card] of args.cards.entries()) {
          progress(`Rendering slide ${i + 1}/${args.cards.length}`);
          let rendered;
          try {
            rendered = await renderCard(card.template, card.content, theme, args.language);
          } catch (error) {
            throw new Error(`Slide ${i + 1}: ${(error as Error).message}`);
          }
          const file = path.join(
            outDir,
            args.cards.length === 1
              ? `${base}-${args.language}.jpg`
              : `${base}-${args.language}-${i + 1}.jpg`,
          );
          await writeFile(file, rendered.jpeg);
          files.push(file);
          jpegs.push(rendered.jpeg);
        }

        const result = await runPublish(
          {
            images: files,
            caption: args.caption,
            confirm: args.confirm,
            keepUploads: args.keep_uploads,
            signal: extra.signal,
            onProgress: progress,
          },
          deps,
        );
        const text = { type: "text" as const, text: JSON.stringify({ ...result, files }, null, 2) };
        if (result.mode !== "dry_run") return { content: [text] };
        const preview = await contactSheet(jpegs);
        return {
          content: [
            { type: "image" as const, data: preview.toString("base64"), mimeType: "image/jpeg" },
            text,
          ],
        };
      }),
  );
}
