/**
 * The fun "body map" Reel frame (1080×1920): a glowing glass body where the organs that benefit
 * from a nutrient light up with cartoon faces and "talk" in speech bubbles.
 * Layers: background → body → connector lines → text (satori). Kept separate so animations can
 * redraw only what changes.
 */
import sharp from "sharp";
import { z } from "zod";
import { div, type CardNode } from "../../cards/element.js";
import type { Language } from "../../cards/locale.js";
import { FUN_FONT_FAMILY, renderNodePng } from "../../cards/render.js";
import { validateContent } from "../../cards/templates/index.js";
import { cardText, slideField } from "../../cards/text.js";
import type { Theme } from "../../cards/theme.js";
import { FUN_TEXT } from "../fun/text.js";
import { backgroundPng, svgPng } from "../fun/scene.js";
import { anchor, bodySvg, ORGANS, type Organ } from "./anatomy.js";

export const bodyMapSchema = z.strictObject({
  title: cardText(56).describe("Short, punchy title, e.g. 'Vitamin D works here'"),
  badge: cardText(20).optional().describe("Nutrient sticker, e.g. 'Vitamin D3'"),
  organs: z
    .array(
      z.strictObject({
        organ: z.enum(ORGANS),
        says: cardText(48).describe("What the organ says, funny but accurate"),
      }),
    )
    .min(1)
    .max(3)
    .describe("1-3 organs that benefit, each with a short funny line"),
  sources: z.array(cardText(18)).max(4).optional().describe("Foods/sources, e.g. salmon, eggs"),
  slide: slideField,
});
export type BodyMapContent = z.infer<typeof bodyMapSchema>;

const ORGAN_NAMES: Record<Language, Record<Organ, string>> = {
  en: {
    brain: "Brain",
    eyes: "Eyes",
    heart: "Heart",
    lungs: "Lungs",
    liver: "Liver",
    stomach: "Stomach",
    gut: "Gut",
    kidneys: "Kidneys",
    bones: "Bones",
    muscles: "Muscles",
    skin: "Skin",
    immune: "Immune system",
    blood: "Blood",
  },
  ar: {
    brain: "الدماغ",
    eyes: "العيون",
    heart: "القلب",
    lungs: "الرئتان",
    liver: "الكبد",
    stomach: "المعدة",
    gut: "الأمعاء",
    kidneys: "الكليتان",
    bones: "العظام",
    muscles: "العضلات",
    skin: "البشرة",
    immune: "المناعة",
    blood: "الدم",
  },
};

const BUBBLE_W = 330;
const MARGIN = 24;
const TOP_LIMIT = 470;
const BOTTOM_LIMIT = 1395;

interface Bubble {
  organ: Organ;
  text: string;
  side: "left" | "right";
  top: number;
  height: number;
}

/** Estimate a bubble's height from its text (about 16 characters per line at 34 px). */
function bubbleHeight(text: string): number {
  return 48 + 44 + Math.ceil(text.length / 16) * 46;
}

/** Put each bubble beside its organ, on the nearer side, without overlaps. */
export function layoutBubbles(organs: BodyMapContent["organs"]): Bubble[] {
  const sorted = [...organs].sort((a, b) => anchor(a.organ).y - anchor(b.organ).y);
  const sides: Record<"left" | "right", Bubble[]> = { left: [], right: [] };
  for (const { organ, says } of sorted) {
    const a = anchor(organ);
    const height = bubbleHeight(says);
    const preferred: "left" | "right" =
      a.x < 520
        ? "left"
        : a.x > 560
          ? "right"
          : sides.left.length <= sides.right.length
            ? "left"
            : "right";
    const place = (side: "left" | "right") => {
      const prev = sides[side].at(-1);
      const desired = Math.max(TOP_LIMIT, a.y - height / 2);
      const top = prev ? Math.max(desired, prev.top + prev.height + 24) : desired;
      return top + height <= BOTTOM_LIMIT ? top : undefined;
    };
    const other = preferred === "left" ? "right" : "left";
    const side = place(preferred) !== undefined ? preferred : other;
    const top = place(side) ?? Math.max(TOP_LIMIT, BOTTOM_LIMIT - height);
    sides[side].push({ organ, text: says, side, top, height });
  }
  // Top to bottom: the order organs light up in animations.
  return [...sides.left, ...sides.right].sort((a, b) => anchor(a.organ).y - anchor(b.organ).y);
}

function connectorsSvg(bubbles: Bubble[], visible: number): string {
  const lines = bubbles.slice(0, visible).map((b) => {
    const a = anchor(b.organ);
    const x0 = b.side === "left" ? MARGIN + BUBBLE_W : 1080 - MARGIN - BUBBLE_W;
    const y0 = b.top + b.height / 2;
    const mx = (x0 + a.x) / 2;
    return (
      `<path d="M${x0} ${y0} C${mx} ${y0} ${mx} ${a.y} ${a.x} ${a.y}" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-dasharray="4 12" stroke-linecap="round" opacity="0.9"/>` +
      `<circle cx="${a.x}" cy="${a.y}" r="12" fill="none" stroke="#FFFFFF" stroke-width="5"/>`
    );
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">${lines.join("")}</svg>`;
}

function textLayer(
  c: BodyMapContent,
  bubbles: Bubble[],
  visible: number,
  theme: Theme,
  language: Language,
  anim: { pop: number; title: number } = { pop: 1, title: 1 },
): CardNode {
  const rtl = language === "ar";
  const names = ORGAN_NAMES[language];
  const abs = (style: Record<string, string | number>, ...children: Parameters<typeof div>[1][]) =>
    div({ position: "absolute", ...style }, ...children);

  const top = abs(
    { top: 225, left: 60, right: 60, justifyContent: "space-between", alignItems: "center" },
    c.badge
      ? div(
          {
            backgroundColor: "#FFD166",
            color: "#1B1B1B",
            fontSize: 38,
            fontWeight: 800,
            padding: "4px 26px 10px",
            borderRadius: 22,
            border: "4px solid #1B1B1B",
            transform: `rotate(${rtl ? 4 : -4}deg)`,
          },
          c.badge,
        )
      : div({}),
    div(
      {
        fontSize: 28,
        fontWeight: 600,
        color: "#FFFFFFCC",
        direction: "ltr",
        fontFamily: FUN_FONT_FAMILY,
      },
      [theme.handle ?? "", c.slide ? `  ${c.slide}` : ""].join(""),
    ),
  );

  const title = abs(
    { top: 305, left: 50, right: 50, justifyContent: "center" },
    div(
      {
        fontSize: c.title.length > 30 ? 58 : 70,
        fontWeight: 800,
        color: "#FFFFFF",
        lineHeight: 1.15,
        textAlign: "center",
        textShadow: "0 4px 0 #0A2A20",
        transform: `scale(${backOut(anim.title).toFixed(3)})`,
        opacity: Math.min(1, anim.title * 2),
      },
      c.title,
    ),
  );

  const bubbleNodes = bubbles.slice(0, visible).map((b, i) =>
    abs(
      {
        top: b.top,
        left: b.side === "left" ? MARGIN : 1080 - MARGIN - BUBBLE_W,
        width: BUBBLE_W,
        boxSizing: "border-box",
        flexDirection: "column",
        backgroundColor: "#FFFFFF",
        borderRadius: 30,
        padding: "18px 24px 22px",
        border: "4px solid #1B1B1B",
        boxShadow: "0 8px 0 #0A2A20",
        // The newest bubble pops in with a little overshoot.
        transform: `rotate(${i % 2 === 0 ? -2 : 2}deg) scale(${(i === visible - 1 ? backOut(anim.pop) : 1).toFixed(3)})`,
      },
      div(
        { fontSize: 27, fontWeight: 800, color: theme.primary, marginBottom: 2 },
        `${names[b.organ]}:`,
      ),
      div(
        { fontSize: 34, fontWeight: 800, color: "#1B1B1B", lineHeight: 1.3 },
        rtl ? b.text : `"${b.text}"`,
      ),
    ),
  );

  const sources = c.sources?.length
    ? abs(
        { top: 1412, left: 60, right: 60, justifyContent: "center" },
        div(
          {
            backgroundColor: "#FFFFFFEE",
            color: "#1B1B1B",
            fontSize: 32,
            fontWeight: 800,
            padding: "8px 28px 14px",
            boxSizing: "border-box",
            borderRadius: 999,
            border: "4px solid #1B1B1B",
          },
          `${FUN_TEXT[language].findIt}: ${c.sources.join(" · ")}`,
        ),
      )
    : null;

  return div(
    {
      width: 1080,
      height: 1920,
      position: "relative",
      fontFamily: FUN_FONT_FAMILY,
      direction: rtl ? "rtl" : "ltr",
    },
    top,
    title,
    ...bubbleNodes,
    sources,
  );
}

export interface BodyMapFrameOptions {
  /** How many organs are lit and talking (top to bottom); default all. */
  bubbles?: number;
  /** 0..1: pop-in progress of the newest bubble. */
  pop?: number;
  /** 0..1: entrance progress of the title. */
  title?: number;
  /** Glow strength 0..1 (for a pulse). */
  glow?: number;
}

/** Ease-out with a small overshoot (0 → 1.1 → 1), for "pop" animations. */
export function backOut(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

/** Validate the content and render one 1080×1920 PNG frame. */
export async function renderBodyMapFrame(
  content: unknown,
  theme: Theme,
  language: Language,
  options: BodyMapFrameOptions = {},
): Promise<Buffer> {
  const c = validateContent("body_map", bodyMapSchema, content, language) as BodyMapContent;
  const bubbles = layoutBubbles(c.organs);
  const visible = Math.min(bubbles.length, options.bubbles ?? bubbles.length);
  const lit = bubbles.slice(0, visible).map((b) => b.organ);
  const layers = [
    { input: svgPng(bodySvg({ highlight: lit, glow: options.glow ?? 1 })) },
    { input: svgPng(connectorsSvg(bubbles, visible)) },
    {
      input: await renderNodePng(
        textLayer(c, bubbles, visible, theme, language, {
          pop: options.pop ?? 1,
          title: options.title ?? 1,
        }),
        1080,
        1920,
      ),
    },
  ];
  return sharp(backgroundPng(theme)).composite(layers).png().toBuffer();
}
