/** Shared pieces of the fun Reel style: background, header, layering. */
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { div, type Child, type CardNode, type Style } from "../../cards/element.js";
import type { Language } from "../../cards/locale.js";
import { FUN_FONT_FAMILY, renderNodePng } from "../../cards/render.js";
import type { Theme } from "../../cards/theme.js";

export const W = 1080;
export const H = 1920;
export const INK = "#1B1B1B";
export const DEEP = "#0A2A20";
export const YELLOW = "#FFD166";

export function backgroundSvg(theme: Theme): string {
  const dots: [number, number, number, string][] = [
    [90, 380, 10, YELLOW],
    [980, 420, 8, "#FF8FB8"],
    [150, 1180, 7, "#8ED1F0"],
    [940, 1260, 11, "#5CF2B5"],
    [60, 760, 6, "#FF8FB8"],
    [1020, 860, 7, YELLOW],
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><radialGradient id="g" cx="0.5" cy="0.48" r="0.75">
      <stop offset="0" stop-color="${theme.primary}"/><stop offset="1" stop-color="${DEEP}"/>
    </radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    ${dots.map(([x, y, r, c]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="0.8"/>`).join("")}
  </svg>`;
}

export const svgPng = (svg: string): Buffer => Buffer.from(new Resvg(svg).render().asPng());

const bgCache = new Map<string, Buffer>();
export function backgroundPng(theme: Theme): Buffer {
  let png = bgCache.get(theme.primary);
  if (!png) bgCache.set(theme.primary, (png = svgPng(backgroundSvg(theme))));
  return png;
}

export const abs = (style: Style, ...children: Child[]): CardNode =>
  div({ position: "absolute", ...style }, ...children);

/** Handle and slide counter, top right/left inside the safe area. */
export function header(theme: Theme, slide: string | undefined): CardNode {
  return abs(
    { top: 238, left: 60, right: 60, justifyContent: "flex-end" },
    div(
      { fontSize: 28, fontWeight: 600, color: "#FFFFFFCC", direction: "ltr" },
      [theme.handle ?? "", slide ? `  ${slide}` : ""].join(""),
    ),
  );
}

/** A tilted yellow sticker (badge / kicker). */
export function sticker(text: string, language: Language, size = 38, extra: Style = {}): CardNode {
  return div(
    {
      backgroundColor: YELLOW,
      color: INK,
      fontSize: size,
      fontWeight: 800,
      padding: `${Math.round(size * 0.1)}px ${Math.round(size * 0.7)}px ${Math.round(size * 0.26)}px`,
      borderRadius: 22,
      border: `4px solid ${INK}`,
      transform: `rotate(${language === "ar" ? 4 : -4}deg)`,
      ...extra,
    },
    text,
  );
}

/** Full-canvas text layer root. */
export function textRoot(language: Language, ...children: Child[]): CardNode {
  return div(
    {
      width: W,
      height: H,
      position: "relative",
      fontFamily: FUN_FONT_FAMILY,
      direction: language === "ar" ? "rtl" : "ltr",
    },
    ...children,
  );
}

/** Background + optional image layers + text layer → one PNG frame. */
export async function compose(
  theme: Theme,
  layers: (Buffer | { input: Buffer; left: number; top: number })[],
  text: CardNode | undefined,
): Promise<Buffer> {
  const inputs = layers.map((l) => (Buffer.isBuffer(l) ? { input: l } : l));
  if (text) inputs.push({ input: await renderNodePng(text, W, H) });
  return sharp(backgroundPng(theme)).composite(inputs).png().toBuffer();
}
