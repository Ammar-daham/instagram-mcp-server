import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { previewJpeg, renderCard, renderSvg } from "../src/cards/render.js";
import {
  CardContentError,
  stripTashkeel,
  TEMPLATE_NAMES,
  type TemplateName,
} from "../src/cards/templates/index.js";
import { scriptCounts, unsupportedChars } from "../src/cards/text.js";
import { DEFAULT_THEME, loadTheme, tint } from "../src/cards/theme.js";

const theme = { ...DEFAULT_THEME, handle: "@body.blooms.ai" };

/** Satori emits one <text> per word (sometimes per glyph); join them, ignoring spaces. */
const textOf = (svg: string) =>
  [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
    .map((m) => m[1])
    .join("")
    .replace(/\s+/g, "");
const has = (svg: string, text: string) => expect(textOf(svg)).toContain(text.replace(/\s+/g, ""));

export const SAMPLES: Record<TemplateName, Record<string, unknown>> = {
  tip: {
    title: "3 easy ways to eat more fibre",
    points: [
      "Swap white bread for whole-grain.",
      "Add berries to breakfast.",
      "Keep the skin on potatoes.",
    ],
    slide: "2/7",
  },
  macros: {
    title: "Greek yogurt bowl",
    serving: "1 bowl (350 g)",
    calories: 420,
    protein_g: 32,
    carbs_g: 48,
    fat_g: 11,
    note: "30 g of protein keeps you full until lunch.",
  },
  recipe: {
    title: "Overnight protein oats",
    time: "5 min",
    servings: "1 serving",
    ingredients: ["50 g rolled oats", "150 g Greek yogurt", "1 tbsp chia seeds"],
    steps: ["Mix everything in a jar.", "Refrigerate overnight."],
  },
  myth_fact: {
    myth: "Eating fat makes you fat.",
    fact: "Weight gain comes from a calorie surplus over time.",
    source: "WHO",
  },
  cover: {
    title: "5 high-protein breakfasts",
    subtitle: "All under 10 minutes.",
    kicker: "Save this",
  },
  follow: { slide: "7/7" },
};

describe("card templates", () => {
  it.each(TEMPLATE_NAMES)("%s renders a stable layout", async (name) => {
    // embedFont: false keeps text as <text> elements, so the snapshot shows words and positions.
    const svg = await renderSvg(name, SAMPLES[name], theme, { embedFont: false });
    expect(svg).toMatch(/^<svg width="1080" height="1350"/);
    has(svg, "@body.blooms.ai");
    expect(svg).toMatchSnapshot();
  });

  it("puts the content on the card", async () => {
    const svg = await renderSvg("macros", SAMPLES.macros, theme, { embedFont: false });
    for (const text of [
      "Greek yogurt bowl",
      "420",
      "kcal",
      "Protein",
      "32 g",
      "31%",
      "Fat",
      "24%",
    ]) {
      has(svg, text);
    }
  });

  it("renders a 1080x1350 JPEG and a half-size preview", async () => {
    const { jpeg, width, height } = await renderCard("tip", SAMPLES.tip, theme);
    expect([width, height]).toEqual([1080, 1350]);
    expect(await sharp(jpeg).metadata()).toMatchObject({
      format: "jpeg",
      width: 1080,
      height: 1350,
    });
    const preview = await previewJpeg(jpeg);
    expect(await sharp(preview).metadata()).toMatchObject({ width: 540, height: 675 });
  });
});

describe("content validation", () => {
  const error = (template: TemplateName, content: unknown) =>
    renderSvg(template, content, theme).then(
      () => undefined,
      (e: unknown) => e as Error,
    );

  it("names missing and invalid fields", async () => {
    const e = await error("macros", { title: "Oats", calories: -5, protein_g: 10, carbs_g: 10 });
    expect(e).toBeInstanceOf(CardContentError);
    expect(e?.message).toMatch(/Invalid content for the "macros" card/);
    expect(e?.message).toMatch(/- calories: /);
    expect(e?.message).toMatch(/- fat_g: /);
  });

  it("rejects text that would not fit", async () => {
    const e = await error("tip", { title: "x".repeat(81), points: ["ok"] });
    expect(e?.message).toMatch(/title: must be at most 80 characters/);
  });

  it("rejects emoji with a hint to use the caption", async () => {
    const e = await error("tip", { title: "Eat more greens 🥦", points: ["ok"] });
    expect(e?.message).toMatch(/can't draw \(🥦\).*caption/);
  });

  it("rejects unknown fields and too many items", async () => {
    expect((await error("myth_fact", { myth: "a", fact: "b", extra: 1 }))?.message).toMatch(
      /extra/,
    );
    expect(
      (await error("tip", { title: "t", points: ["1", "2", "3", "4", "5"] }))?.message,
    ).toMatch(/points/);
  });

  it("knows which characters the font covers", () => {
    expect(unsupportedChars("Crème brûlée — 3× “fibre” €5 ½ ›")).toEqual([]);
    expect(unsupportedChars("Kale → 🥬")).toEqual(["→", "🥬"]);
  });
});

describe("theme", () => {
  it("uses defaults and normalises the handle", () => {
    expect(loadTheme({})).toEqual(DEFAULT_THEME);
    expect(loadTheme({ BRAND_HANDLE: "body.blooms.ai", BRAND_PRIMARY: "#112233" })).toMatchObject({
      handle: "@body.blooms.ai",
      primary: "#112233",
    });
  });

  it("validates settings", () => {
    expect(() => loadTheme({ BRAND_PRIMARY: "green" })).toThrow(/BRAND_PRIMARY must be a hex/);
    expect(() => loadTheme({ BRAND_HANDLE: "not a handle!" })).toThrow(/BRAND_HANDLE/);
    expect(() => loadTheme({ BRAND_LOGO: "/nope/logo.png" })).toThrow(/not found/);
    expect(() => loadTheme({ BRAND_LOGO: "logo.gif" })).toThrow(/\.png, \.jpg or \.svg/);
  });

  it("embeds a logo and renders it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ig-logo-"));
    try {
      const file = path.join(dir, "logo.png");
      await writeFile(
        file,
        await sharp({ create: { width: 8, height: 8, channels: 3, background: "#2E7D5B" } })
          .png()
          .toBuffer(),
      );
      const withLogo = loadTheme({ BRAND_LOGO: file });
      expect(withLogo.logo).toMatch(/^data:image\/png;base64,/);
      const svg = await renderSvg("follow", {}, withLogo, { embedFont: false });
      expect(svg).toContain("<image");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("tints colours", () => {
    expect(tint("#2E7D5B", 0.5)).toBe("rgba(46, 125, 91, 0.5)");
  });
});

const SAMPLES_AR: Record<TemplateName, Record<string, unknown>> = {
  tip: {
    title: "٣ طرق سهلة لتناول المزيد من الألياف",
    points: ["استبدل الخبز الأبيض بخبز القمح الكامل.", "أضف التوت إلى فطورك."],
    slide: "2/7",
  },
  macros: {
    title: "وعاء الزبادي اليوناني",
    serving: "وعاء واحد (350 غ)",
    calories: 420,
    protein_g: 32,
    carbs_g: 48,
    fat_g: 11,
    note: "البروتين على الفطور يبقيك شبعانا حتى الغداء.",
  },
  recipe: {
    title: "شوفان البروتين الليلي",
    time: "5 دقائق",
    ingredients: ["50 غ شوفان", "150 غ زبادي يوناني"],
    steps: ["اخلط المكونات في برطمان.", "اتركه في الثلاجة طوال الليل."],
  },
  myth_fact: { myth: "تناول الدهون يجعلك سمينا.", fact: "زيادة الوزن تأتي من فائض السعرات." },
  cover: { title: "٥ وجبات فطور غنية بالبروتين", kicker: "احفظ المنشور" },
  follow: {},
};

/** x of the first <text> containing `needle` (satori splits text into words). */
const xOf = (svg: string, needle: string) => {
  const m = [...svg.matchAll(/<text x="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].find((t) =>
    t[2]!.includes(needle),
  );
  if (!m) throw new Error(`"${needle}" not found in SVG`);
  return Number(m[1]);
};

describe("Arabic cards", () => {
  it.each(TEMPLATE_NAMES)("%s renders a stable RTL layout", async (name) => {
    const svg = await renderSvg(name, SAMPLES_AR[name], theme, {
      embedFont: false,
      language: "ar",
    });
    has(svg, "@body.blooms.ai");
    expect(svg).toMatchSnapshot();
  });

  it("uses Arabic labels and mirrors the layout", async () => {
    const svg = await renderSvg("tip", SAMPLES_AR.tip, theme, { embedFont: false, language: "ar" });
    has(svg, "نصيحة غذائية");
    // The number badge sits to the right of its tip text, and the pill to the right of "2/7".
    expect(xOf(svg, "1")).toBeGreaterThan(xOf(svg, "استبدل"));
    expect(xOf(svg, "نصيحة")).toBeGreaterThan(xOf(svg, "/"));
    // "2/7" stays left-to-right instead of being reordered to "7/2".
    has(svg, "2/7");
  });

  it("translates the built-in macro labels", async () => {
    const svg = await renderSvg("macros", SAMPLES_AR.macros, theme, {
      embedFont: false,
      language: "ar",
    });
    for (const text of ["بروتين", "كربوهيدرات", "دهون", "سعرة حرارية", "32 غ", "31%"]) {
      has(svg, text);
    }
  });

  it("renders an Arabic JPEG", async () => {
    const { jpeg } = await renderCard("cover", SAMPLES_AR.cover, theme, "ar");
    expect(await sharp(jpeg).metadata()).toMatchObject({ width: 1080, height: 1350 });
  });

  it("rejects content in the other language", async () => {
    await expect(renderSvg("tip", SAMPLES_AR.tip, theme)).rejects.toThrow(
      /set to English but its text is mostly Arabic/,
    );
    await expect(renderSvg("tip", SAMPLES.tip, theme, { language: "ar" })).rejects.toThrow(
      /set to Arabic but its text is mostly English/,
    );
  });

  it("allows Latin terms and numbers inside Arabic text", async () => {
    await expect(
      renderSvg(
        "tip",
        { title: "فوائد أوميغا 3 (Omega-3)", points: ["تناول السلمون مرتين أسبوعيا."] },
        theme,
        { language: "ar" },
      ),
    ).resolves.toMatch(/^<svg/);
  });

  it("removes tashkeel before rendering", async () => {
    expect(stripTashkeel("يوميًّا شبعانًا مُفِيد")).toBe("يوميا شبعانا مفيد");
    const svg = await renderSvg("tip", { title: "كُلْ يوميًّا", points: ["مُفِيد"] }, theme, {
      embedFont: false,
      language: "ar",
    });
    has(svg, "كل يوميا");
  });

  it("counts scripts", () => {
    expect(scriptCounts("بروتين protein 32")).toEqual({ arabic: 6, latin: 7 });
    expect(unsupportedChars("بروتين ٣٢ ، ؟")).toEqual([]);
  });
});
