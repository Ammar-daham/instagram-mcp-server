import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";
import { CARD_HEIGHT, CARD_WIDTH } from "./layout.js";
import { parseContent, TEMPLATES, type TemplateName } from "./templates/index.js";
import type { Theme } from "./theme.js";

type FontWeight = 400 | 600 | 800;
const WEIGHTS: FontWeight[] = [400, 600, 800];
const SUBSETS = ["latin", "latin-ext"];

let fontsPromise: Promise<{ name: string; data: Buffer; weight: FontWeight; style: "normal" }[]>;

/** Inter (SIL OFL 1.1) from @fontsource/inter; loaded once. */
function loadFonts() {
  fontsPromise ??= (async () => {
    const require = createRequire(import.meta.url);
    return Promise.all(
      WEIGHTS.flatMap((weight) =>
        SUBSETS.map(async (subset) => ({
          name: "Inter",
          weight,
          style: "normal" as const,
          data: await readFile(
            require.resolve(`@fontsource/inter/files/inter-${subset}-${weight}-normal.woff`),
          ),
        })),
      ),
    );
  })();
  return fontsPromise;
}

export interface RenderOptions {
  /** false keeps text as <text> elements (readable SVG for snapshot tests). */
  embedFont?: boolean;
}

/** Validate content and render the card to SVG. */
export async function renderSvg(
  template: TemplateName,
  content: unknown,
  theme: Theme,
  options: RenderOptions = {},
): Promise<string> {
  const data = parseContent(template, content);
  const element = TEMPLATES[template].render(data, theme);
  return satori(element as Parameters<typeof satori>[0], {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: await loadFonts(),
    embedFont: options.embedFont ?? true,
  });
}

export interface RenderedCard {
  jpeg: Buffer;
  width: number;
  height: number;
}

/** Render a 1080×1350 (4:5) JPEG, Instagram's tallest feed format. */
export async function renderCard(
  template: TemplateName,
  content: unknown,
  theme: Theme,
): Promise<RenderedCard> {
  const svg = await renderSvg(template, content, theme);
  const png = new Resvg(svg, { fitTo: { mode: "width", value: CARD_WIDTH } }).render().asPng();
  const jpeg = await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return { jpeg, width: CARD_WIDTH, height: CARD_HEIGHT };
}

/** Half-size preview, to keep the image sent back to Claude small. */
export function previewJpeg(jpeg: Buffer, width = 540): Promise<Buffer> {
  return sharp(jpeg).resize({ width }).jpeg({ quality: 80 }).toBuffer();
}
