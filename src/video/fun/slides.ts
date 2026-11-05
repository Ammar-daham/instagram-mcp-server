/**
 * The fun Reel style, slide by slide. Each slide becomes a list of "shots" (a frame + how long
 * it shows + an optional sound cue). Only frames where something changes are rendered.
 * Elements that appear later are laid out from the start with opacity 0, so nothing jumps.
 */
import sharp from "sharp";
import { div, type CardNode } from "../../cards/element.js";
import { LOCALES, type Language, type Locale } from "../../cards/locale.js";
import { FUN_FONT_FAMILY, renderCardPng } from "../../cards/render.js";
import { parseContent, type TemplateName } from "../../cards/templates/index.js";
import type { CoverContent } from "../../cards/templates/cover.js";
import type { FollowContent } from "../../cards/templates/follow.js";
import type { MythFactContent } from "../../cards/templates/myth-fact.js";
import type { TipContent } from "../../cards/templates/tip.js";
import type { Theme } from "../../cards/theme.js";
import { bodySvg } from "../body/anatomy.js";
import { backOut, renderBodyMapFrame, bodyMapSchema, type BodyMapContent } from "../body/frame.js";
import { validateContent } from "../../cards/templates/index.js";
import { abs, compose, DEEP, header, INK, sticker, svgPng, textRoot, W, YELLOW } from "./scene.js";
import { FUN_TEXT } from "./text.js";

export type Cue = "pop" | "ding" | "buzz" | "whoosh";
export interface Shot {
  png: Buffer;
  seconds: number;
  cue?: Cue;
}

export type FunTemplate = TemplateName | "body_map";
export interface FunSlide {
  template: FunTemplate;
  content: Record<string, unknown>;
  seconds?: number;
  /** tip: points pop in one by one (default true in the fun style). */
  reveal?: boolean;
}

export interface FunContext {
  theme: Theme;
  language: Language;
  /** Frames per pop animation (default 8 ≈ 0.27 s). */
  popFrames?: number;
}

export const FUN_DEFAULT_SECONDS: Record<FunTemplate, number> = {
  cover: 2.6,
  tip: 5,
  myth_fact: 5,
  body_map: 7,
  macros: 4,
  recipe: 5,
  follow: 3,
};

const DT = 1 / 30;

/** Render a pop animation (progress 0→1) followed by a hold. */
async function pop(
  render: (progress: number) => Promise<Buffer>,
  frames: number,
  cue: Cue | undefined,
  hold: number,
): Promise<Shot[]> {
  const shots: Shot[] = [];
  for (let i = 1; i <= frames; i++) {
    shots.push({ png: await render(i / frames), seconds: DT, ...(i === 1 && cue ? { cue } : {}) });
  }
  if (hold > 0) shots.push({ png: shots.at(-1)!.png, seconds: hold });
  return shots;
}

const scale = (p: number) => `scale(${backOut(p).toFixed(3)})`;
const remaining = (total: number, shots: Shot[]) =>
  Math.max(0.3, total - shots.reduce((s, x) => s + x.seconds, 0));

/** The fun locale: playful font and Gulf/English labels on regular cards. */
function funLocale(language: Language): Locale {
  const base = LOCALES[language];
  const t = FUN_TEXT[language];
  return {
    ...base,
    fontFamily: FUN_FONT_FAMILY,
    text: {
      ...base.text,
      tipLabel: t.tipLabel,
      macrosLabel: t.macrosLabel,
      recipeLabel: t.recipeLabel,
    },
  };
}

let faintBody: Buffer | undefined;
const faintBodyPng = () =>
  (faintBody ??= svgPng(bodySvg({ highlight: [], faces: false, opacity: 0.3 })));

async function coverShots(raw: unknown, ctx: FunContext, total: number, frames: number) {
  const c = parseContent("cover", raw, ctx.language) as CoverContent;
  const t = FUN_TEXT[ctx.language];
  const render = (p: number) =>
    compose(
      ctx.theme,
      [faintBodyPng()],
      textRoot(
        ctx.language,
        header(ctx.theme, c.slide),
        abs(
          { top: 560, left: 70, right: 70, flexDirection: "column", alignItems: "center", gap: 40 },
          c.kicker ? sticker(c.kicker, ctx.language, 40, { opacity: p > 0.3 ? 1 : 0 }) : null,
          div(
            {
              fontSize: c.title.length > 30 ? 84 : 100,
              fontWeight: 800,
              color: "#FFFFFF",
              lineHeight: 1.12,
              textAlign: "center",
              textShadow: `0 6px 0 ${DEEP}`,
              transform: scale(p),
            },
            c.title,
          ),
          c.subtitle
            ? div(
                {
                  fontSize: 44,
                  fontWeight: 600,
                  color: "#FFFFFFDD",
                  textAlign: "center",
                  lineHeight: 1.35,
                  opacity: p,
                },
                c.subtitle,
              )
            : null,
        ),
        abs(
          { top: 1330, left: 0, right: 0, justifyContent: "center" },
          div(
            {
              backgroundColor: "#FFFFFF22",
              color: "#FFFFFF",
              fontSize: 34,
              fontWeight: 800,
              padding: "8px 34px 14px",
              borderRadius: 999,
              border: "3px solid #FFFFFF88",
              opacity: p,
            },
            c.cta ?? t.watchTillEnd,
          ),
        ),
      ),
    );
  const shots = await pop(render, frames, "whoosh", 0);
  shots.push({ png: shots.at(-1)!.png, seconds: remaining(total, shots) });
  return shots;
}

/** Points as chat bubbles; with reveal they pop in one by one. */
async function tipShots(
  raw: unknown,
  ctx: FunContext,
  total: number,
  frames: number,
  reveal: boolean,
) {
  const c = parseContent("tip", raw, ctx.language) as TipContent;
  const t = FUN_TEXT[ctx.language];
  const chars = c.points.reduce((n, x) => n + x.length, 0);
  const size = c.points.length > 3 ? 40 : chars < 90 ? 50 : 44;
  const render = (visible: number, p: number) =>
    compose(
      ctx.theme,
      [],
      textRoot(
        ctx.language,
        header(ctx.theme, c.slide),
        abs(
          {
            top: 300,
            left: 70,
            right: 70,
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 26,
          },
          sticker(c.label ?? t.tipLabel, ctx.language, 34),
          div(
            {
              fontSize: c.title.length > 40 ? 58 : 68,
              fontWeight: 800,
              color: "#FFFFFF",
              lineHeight: 1.15,
              textShadow: `0 5px 0 ${DEEP}`,
            },
            c.title,
          ),
        ),
        abs(
          { top: 640, left: 70, right: 70, flexDirection: "column", gap: chars < 90 ? 44 : 30 },
          ...c.points.map((point, i) =>
            div(
              {
                alignItems: "center",
                gap: 24,
                backgroundColor: "#FFFFFF",
                border: `4px solid ${INK}`,
                borderRadius: 34,
                padding: "20px 28px 26px",
                boxShadow: `0 8px 0 ${DEEP}`,
                opacity: i < visible ? 1 : 0,
                transform: `rotate(${i % 2 ? 1.5 : -1.5}deg) ${i === visible - 1 ? scale(p) : ""}`,
              },
              div(
                {
                  width: 66,
                  height: 66,
                  flexShrink: 0,
                  borderRadius: 33,
                  backgroundColor: YELLOW,
                  border: `4px solid ${INK}`,
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 34,
                  fontWeight: 800,
                  color: INK,
                  direction: "ltr",
                },
                String(i + 1),
              ),
              div({ flex: 1, fontSize: size, fontWeight: 800, color: INK, lineHeight: 1.3 }, point),
            ),
          ),
        ),
      ),
    );
  if (!reveal) {
    const shots = await pop((p) => render(c.points.length, p), frames, "pop", 0);
    shots.push({ png: shots.at(-1)!.png, seconds: remaining(total, shots) });
    return shots;
  }
  // Title first, then one point at a time.
  const shots: Shot[] = [{ png: await render(0, 1), seconds: 0.8, cue: "whoosh" }];
  const each = Math.max(0.8, (total - 0.8 - frames * DT * c.points.length - 0.6) / c.points.length);
  for (let k = 1; k <= c.points.length; k++) {
    shots.push(...(await pop((p) => render(k, p), frames, "pop", k < c.points.length ? each : 0)));
  }
  shots.push({ png: shots.at(-1)!.png, seconds: remaining(total, shots) });
  return shots;
}

function stamp(kind: "x" | "check", colour: string, rtl: boolean): CardNode {
  const bar = (rotate: number, w: number, extra = {}) =>
    div({
      position: "absolute",
      width: w,
      height: 12,
      borderRadius: 6,
      backgroundColor: "#FFFFFF",
      transform: `rotate(${rotate}deg)`,
      ...extra,
    });
  return div(
    {
      position: "absolute",
      top: -34,
      // The far corner from where the label starts.
      ...(rtl ? { left: -20 } : { right: -20 }),
      width: 84,
      height: 84,
      borderRadius: 42,
      backgroundColor: colour,
      border: `4px solid ${INK}`,
      alignItems: "center",
      justifyContent: "center",
    },
    ...(kind === "x"
      ? [bar(45, 50), bar(-45, 50)]
      : [bar(45, 24, { left: 18, top: 42 }), bar(-50, 44, { left: 28, top: 34 })]),
  );
}

/** "They say" (buzz) → "Actually" (ding). */
async function mythFactShots(raw: unknown, ctx: FunContext, total: number, frames: number) {
  const c = parseContent("myth_fact", raw, ctx.language) as MythFactContent;
  const t = FUN_TEXT[ctx.language];
  const card = (
    label: string,
    text: string,
    bg: string,
    accent: string,
    kind: "x" | "check",
    visible: boolean,
    p: number,
    tilt: number,
    size: number,
  ) =>
    div(
      {
        position: "relative",
        flexDirection: "column",
        gap: 14,
        backgroundColor: bg,
        border: `4px solid ${INK}`,
        borderRadius: 36,
        padding: "28px 36px 34px",
        boxShadow: `0 10px 0 ${DEEP}`,
        opacity: visible ? 1 : 0,
        transform: `rotate(${tilt}deg) ${visible ? scale(p) : ""}`,
      },
      div({ fontSize: 38, fontWeight: 800, color: accent }, label),
      div({ fontSize: size, fontWeight: 800, color: INK, lineHeight: 1.3 }, text),
      stamp(kind, accent, ctx.language === "ar"),
    );
  const render = (step: 1 | 2, p: number) =>
    compose(
      ctx.theme,
      [],
      textRoot(
        ctx.language,
        header(ctx.theme, c.slide),
        abs(
          { top: 420, left: 70, right: 70, flexDirection: "column", gap: 64 },
          card(
            t.mythLabel,
            c.myth,
            "#FFE4E4",
            "#E63946",
            "x",
            true,
            step === 1 ? p : 1,
            -2.5,
            c.myth.length > 70 ? 46 : 54,
          ),
          card(
            t.factLabel,
            c.fact,
            "#DFF7EC",
            "#1F9D6B",
            "check",
            step === 2,
            p,
            2,
            c.fact.length > 140 ? 42 : c.fact.length > 90 ? 46 : 52,
          ),
          c.source
            ? div(
                { fontSize: 26, color: "#FFFFFFBB", opacity: step === 2 ? 1 : 0, paddingTop: 4 },
                c.source,
              )
            : null,
        ),
      ),
    );
  const myth = await pop((p) => render(1, p), frames, "buzz", Math.min(1.6, total * 0.35));
  const fact = await pop((p) => render(2, p), frames, "ding", 0);
  const shots = [...myth, ...fact];
  shots.push({ png: shots.at(-1)!.png, seconds: remaining(total, shots) });
  return shots;
}

/** Organs light up one by one and talk. */
async function bodyMapShots(raw: unknown, ctx: FunContext, total: number, frames: number) {
  const c = validateContent("body_map", bodyMapSchema, raw, ctx.language) as BodyMapContent;
  const f = (o: object) => renderBodyMapFrame(c, ctx.theme, ctx.language, o);
  const shots: Shot[] = await pop(
    (p) => f({ bubbles: 0, title: p, glow: 0.6 }),
    frames,
    "whoosh",
    0.4,
  );
  const n = c.organs.length;
  const each = Math.max(
    0.9,
    (total - shots.reduce((s, x) => s + x.seconds, 0) - 1.4) / n - frames * DT,
  );
  for (let k = 1; k <= n; k++) {
    shots.push(
      ...(await pop((p) => f({ bubbles: k, pop: p, glow: 1 - 0.4 * p }), frames, "pop", each)),
    );
  }
  // Gentle pulse on the lit organs.
  const pulse: Shot[] = [];
  for (let i = 0; i < 6; i++) {
    pulse.push({ png: await f({ glow: 0.6 + 0.4 * Math.sin((Math.PI * i) / 6) }), seconds: 0.12 });
  }
  shots.push(...pulse);
  shots.push({ png: shots.at(-1)!.png, seconds: remaining(total, shots) });
  return shots;
}

/** Regular macros/recipe card in the fun font, popping onto the green background. */
async function cardShots(
  template: "macros" | "recipe",
  raw: unknown,
  ctx: FunContext,
  total: number,
  frames: number,
) {
  const png = await renderCardPng(template, raw, ctx.theme, ctx.language, funLocale(ctx.language));
  const width = Math.round(W * 0.86);
  const height = Math.round(width * 1.25);
  const rounded = await sharp(png)
    .resize(width, height)
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="44" ry="44"/></svg>`,
        ),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
  const render = async (p: number) => {
    const s = Math.max(0.05, backOut(p));
    const w = Math.round(width * s);
    const h = Math.round(height * s);
    const img = await sharp(rounded)
      .resize(w, h)
      .rotate(ctx.language === "ar" ? 1.5 : -1.5, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const meta = await sharp(img).metadata();
    return compose(
      ctx.theme,
      [
        {
          input: img,
          left: Math.round((W - meta.width!) / 2),
          top: Math.round(830 - meta.height! / 2),
        },
      ],
      undefined,
    );
  };
  const shots = await pop(render, frames, "pop", 0);
  shots.push({ png: shots.at(-1)!.png, seconds: remaining(total, shots) });
  return shots;
}

/** "Your organs say: thank you!" + follow pill. */
async function followShots(raw: unknown, ctx: FunContext, total: number, frames: number) {
  const c = parseContent("follow", raw, ctx.language) as FollowContent;
  const t = FUN_TEXT[ctx.language];
  const body = await sharp(
    svgPng(bodySvg({ highlight: ["brain", "heart", "immune", "muscles", "bones"], glow: 0.7 })),
  )
    .extract({ left: 240, top: 420, width: 600, height: 1000 })
    .resize(390, 650)
    .png()
    .toBuffer();
  const actions = c.actions ?? [t.save, t.share];
  const render = (p: number) =>
    compose(
      ctx.theme,
      [{ input: body, left: Math.round((W - 390) / 2), top: 300 }],
      textRoot(
        ctx.language,
        header(ctx.theme, c.slide),
        abs(
          {
            top: 1000,
            left: 60,
            right: 60,
            flexDirection: "column",
            alignItems: "center",
            gap: 34,
          },
          div(
            {
              fontSize: 66,
              fontWeight: 800,
              color: "#FFFFFF",
              textAlign: "center",
              lineHeight: 1.2,
              textShadow: `0 5px 0 ${DEEP}`,
              transform: scale(Math.min(1, p * 1.4)),
            },
            c.headline ?? t.thanks,
          ),
          ctx.theme.handle
            ? div(
                {
                  backgroundColor: YELLOW,
                  color: INK,
                  fontSize: 54,
                  fontWeight: 800,
                  padding: "8px 44px 16px",
                  borderRadius: 999,
                  border: `5px solid ${INK}`,
                  gap: 16,
                  alignItems: "center",
                  transform: scale(p),
                },
                div({}, t.follow),
                div({ direction: "ltr" }, ctx.theme.handle),
              )
            : null,
          div(
            { fontSize: 38, fontWeight: 600, color: "#FFFFFFDD", opacity: p },
            actions.join(" · "),
          ),
        ),
      ),
    );
  const shots = await pop(render, frames, "ding", 0);
  shots.push({ png: shots.at(-1)!.png, seconds: remaining(total, shots) });
  return shots;
}

/** Turn one slide into shots. */
export async function slideShots(slide: FunSlide, ctx: FunContext): Promise<Shot[]> {
  const frames = ctx.popFrames ?? 8;
  const total = slide.seconds ?? FUN_DEFAULT_SECONDS[slide.template];
  switch (slide.template) {
    case "cover":
      return coverShots(slide.content, ctx, total, frames);
    case "tip":
      return tipShots(slide.content, ctx, total, frames, slide.reveal ?? true);
    case "myth_fact":
      return mythFactShots(slide.content, ctx, total, frames);
    case "body_map":
      return bodyMapShots(slide.content, ctx, total, frames);
    case "macros":
    case "recipe":
      return cardShots(slide.template, slide.content, ctx, total, frames);
    case "follow":
      return followShots(slide.content, ctx, total, frames);
  }
}
