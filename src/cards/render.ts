import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";
import { CARD_HEIGHT, CARD_WIDTH } from "./layout.js";
import { parseContent, TEMPLATES, type TemplateName } from "./templates/index.js";
import { LOCALES, type Language } from "./locale.js";
import type { Theme } from "./theme.js";

type FontWeight = 400 | 600 | 700 | 800;
interface FontSpec {
  name: string;
  file: string;
  weight: FontWeight;
}

// All SIL OFL 1.1, from @fontsource. IBM Plex Sans Arabic tops out at 700, which satori
// uses for the 800 headings. (Noto Sans Arabic was tried: satori drops some of its dots.)
const FONT_SPECS: FontSpec[] = [
  ...([400, 600, 800] as const).flatMap((weight) =>
    ["latin", "latin-ext"].map((subset) => ({
      name: "Inter",
      file: `@fontsource/inter/files/inter-${subset}-${weight}-normal.woff`,
      weight,
    })),
  ),
  ...([400, 600, 700] as const).map((weight) => ({
    name: "IBM Plex Sans Arabic",
    file: `@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-${weight}-normal.woff`,
    weight,
  })),
];

let fontsPromise: Promise<{ name: string; data: Buffer; weight: FontWeight; style: "normal" }[]>;

/** Load the bundled fonts once. */
function loadFonts() {
  fontsPromise ??= (async () => {
    const require = createRequire(import.meta.url);
    return Promise.all(
      FONT_SPECS.map(async ({ name, file, weight }) => ({
        name,
        weight,
        style: "normal" as const,
        data: await readFile(require.resolve(file)),
      })),
    );
  })();
  return fontsPromise;
}

export interface RenderOptions {
  language?: Language;
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
  const language = options.language ?? "en";
  const data = parseContent(template, content, language);
  const element = TEMPLATES[template].render(data, theme, LOCALES[language]);
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
  language: Language = "en",
): Promise<RenderedCard> {
  const svg = await renderSvg(template, content, theme, { language });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: CARD_WIDTH } }).render().asPng();
  const jpeg = await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return { jpeg, width: CARD_WIDTH, height: CARD_HEIGHT };
}

/** Half-size preview, to keep the image sent back to Claude small. */
export function previewJpeg(jpeg: Buffer, width = 540): Promise<Buffer> {
  return sharp(jpeg).resize({ width }).jpeg({ quality: 80 }).toBuffer();
}
