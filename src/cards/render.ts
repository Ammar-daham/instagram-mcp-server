import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";
import { CARD_HEIGHT, CARD_WIDTH } from "./layout.js";
import { parseContent, TEMPLATES, type TemplateName } from "./templates/index.js";
import { LOCALES, type Language, type Locale } from "./locale.js";
import type { Theme } from "./theme.js";

type FontWeight = 400 | 600 | 700 | 800;
interface FontSpec {
  name: string;
  file: string;
  weight: FontWeight;
}

// All SIL OFL 1.1, from @fontsource. IBM Plex Sans Arabic tops out at 700, which satori
// uses for the 800 headings. (Noto Sans Arabic was tried: satori drops some of its dots.)
/** Use as fontFamily for the fun style (Arabic glyphs, then its Latin companion). */
export const FUN_FONT = "Baloo Bhaijaan 2";
export const FUN_FONT_FAMILY = `${FUN_FONT}, ${FUN_FONT} Latin`;

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
  // Playful rounded font for the "fun" Reel style. Its Arabic and Latin files need different
  // names: satori only uses the first font registered under a name and weight.
  ...([600, 800] as const).flatMap((weight) =>
    (["arabic", "latin"] as const).map((subset) => ({
      name: subset === "arabic" ? FUN_FONT : `${FUN_FONT} Latin`,
      file: `@fontsource/baloo-bhaijaan-2/files/baloo-bhaijaan-2-${subset}-${weight}-normal.woff`,
      weight,
    })),
  ),
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
  /** Override the language's style (font, labels), e.g. for the fun Reel style. */
  locale?: Locale;
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
  const element = TEMPLATES[template].render(data, theme, options.locale ?? LOCALES[language]);
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
  const png = await renderCardPng(template, content, theme, language);
  const jpeg = await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return { jpeg, width: CARD_WIDTH, height: CARD_HEIGHT };
}

/** Render any satori element tree to a PNG (transparent where nothing is drawn). */
export async function renderNodePng(node: unknown, width: number, height: number): Promise<Buffer> {
  const svg = await satori(node as Parameters<typeof satori>[0], {
    width,
    height,
    fonts: await loadFonts(),
  });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng());
}

/** Lossless 1080×1350 PNG, e.g. as a video frame. */
export async function renderCardPng(
  template: TemplateName,
  content: unknown,
  theme: Theme,
  language: Language = "en",
  locale?: Locale,
): Promise<Buffer> {
  const svg = await renderSvg(template, content, theme, {
    language,
    ...(locale ? { locale } : {}),
  });
  return Buffer.from(
    new Resvg(svg, { fitTo: { mode: "width", value: CARD_WIDTH } }).render().asPng(),
  );
}

/** Half-size preview, to keep the image sent back to Claude small. */
export function previewJpeg(jpeg: Buffer, width = 540): Promise<Buffer> {
  return sharp(jpeg).resize({ width }).jpeg({ quality: 80 }).toBuffer();
}
