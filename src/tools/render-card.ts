import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { previewJpeg, renderCard } from "../cards/render.js";
import { TEMPLATE_NAMES, TEMPLATES } from "../cards/templates/index.js";
import { loadTheme } from "../cards/theme.js";
import { PROJECT_ROOT } from "../paths.js";
import { rawToolResult } from "./result.js";

const templateList = TEMPLATE_NAMES.map((name) => `- ${name}: ${TEMPLATES[name].summary}`).join(
  "\n",
);

export interface RenderCardOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export function registerRenderCard(server: McpServer, options: RenderCardOptions = {}): void {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());

  server.registerTool(
    "render_card",
    {
      title: "Render a nutrition card",
      description:
        "Render a branded 1080x1350 nutrition graphic (JPEG) and show a preview. Saves the " +
        "full-size file locally and returns its path for uploading/publishing later. " +
        "All cards accept optional `label` (pill text) and `slide` (e.g. '2/7' for carousels).\n" +
        "Keep text short: cards are read in a second. No emoji on cards (put them in the caption).\n" +
        `Templates:\n${templateList}`,
      inputSchema: {
        template: z.enum(TEMPLATE_NAMES).describe("Which card layout to use"),
        content: z
          .record(z.string(), z.unknown())
          .describe("Template fields, as listed in the tool description"),
        file_name: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,60}$/, "lowercase letters, digits and dashes only")
          .optional()
          .describe("Optional file name (without extension), e.g. 'fibre-tips-2'"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ template, content, file_name }) =>
      rawToolResult(async () => {
        const theme = loadTheme(env);
        const card = await renderCard(template, content, theme);
        const outDir = path.resolve(PROJECT_ROOT, env.CARD_OUTPUT_DIR || "out");
        await mkdir(outDir, { recursive: true });
        const stamp = now().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
        const file = path.join(
          outDir,
          `${file_name ?? `${stamp}-${template.replace("_", "-")}`}.jpg`,
        );
        await writeFile(file, card.jpeg);
        const preview = await previewJpeg(card.jpeg);
        return {
          content: [
            { type: "image", data: preview.toString("base64"), mimeType: "image/jpeg" },
            {
              type: "text",
              text: JSON.stringify(
                {
                  path: file,
                  template,
                  width: card.width,
                  height: card.height,
                  bytes: card.jpeg.length,
                },
                null,
                2,
              ),
            },
          ],
        };
      }),
  );
}
