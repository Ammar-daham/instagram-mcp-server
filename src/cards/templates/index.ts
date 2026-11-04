import type { z } from "zod";
import type { CardNode } from "../element.js";
import type { Locale, Language } from "../locale.js";
import { scriptCounts } from "../text.js";
import type { Theme } from "../theme.js";
import { coverCard, coverSchema } from "./cover.js";
import { followCard, followSchema } from "./follow.js";
import { macrosCard, macrosSchema } from "./macros.js";
import { mythFactCard, mythFactSchema } from "./myth-fact.js";
import { recipeCard, recipeSchema } from "./recipe.js";
import { tipCard, tipSchema } from "./tip.js";

interface Template<S extends z.ZodType> {
  summary: string;
  schema: S;
  render: (content: z.infer<S>, theme: Theme, locale: Locale) => CardNode;
}

const template = <S extends z.ZodType>(t: Template<S>) => t as unknown as Template<z.ZodType>;

export const TEMPLATES = {
  tip: template({
    summary: "hook + 1-4 numbered tips. Fields: title, points[]",
    schema: tipSchema,
    render: tipCard,
  }),
  macros: template({
    summary:
      "calories + protein/carbs/fat bars. Fields: title, serving?, calories, protein_g, carbs_g, fat_g, note?",
    schema: macrosSchema,
    render: macrosCard,
  }),
  recipe: template({
    summary: "Fields: title, time?, servings?, ingredients[] (2-8), steps[] (1-4)",
    schema: recipeSchema,
    render: recipeCard,
  }),
  myth_fact: template({
    summary: "Fields: myth, fact, source?",
    schema: mythFactSchema,
    render: mythFactCard,
  }),
  cover: template({
    summary: "carousel cover. Fields: title, subtitle?, kicker?, cta?",
    schema: coverSchema,
    render: coverCard,
  }),
  follow: template({
    summary: "'follow for more' end slide. Fields: headline?, actions[]?",
    schema: followSchema,
    render: followCard,
  }),
} as const;

export type TemplateName = keyof typeof TEMPLATES;
export const TEMPLATE_NAMES = Object.keys(TEMPLATES) as [TemplateName, ...TemplateName[]];

export class CardContentError extends Error {
  override name = "CardContentError";
}

/** Validate content for a template, with messages that name the offending field. */
export function parseContent(name: TemplateName, content: unknown, language: Language): unknown {
  const result = TEMPLATES[name].schema.safeParse(content);
  if (result.success) {
    checkLanguage(name, result.data, language);
    return language === "ar" ? mapStrings(result.data, stripTashkeel) : result.data;
  }
  const problems = result.error.issues
    .map((i) => `- ${i.path.length ? i.path.join(".") : "content"}: ${i.message}`)
    .join("\n");
  throw new CardContentError(`Invalid content for the "${name}" card:\n${problems}`);
}

function collectText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(collectText).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(collectText).join(" ");
  return "";
}

/** Catch Arabic text on an English card (or the reverse), which would lay out the wrong way. */
function checkLanguage(name: TemplateName, content: unknown, language: Language): void {
  const { arabic, latin } = scriptCounts(collectText(content));
  if (language === "en" && arabic > latin) {
    throw new CardContentError(
      `The "${name}" card is set to English but its text is mostly Arabic. Use language "ar" for Arabic cards.`,
    );
  }
  // Satori's simplified bidi shows "600-800" as "800-600" inside Arabic text.
  const range = language === "ar" ? collectText(content).match(/\d+\s*[-–—]\s*\d+/) : null;
  if (range) {
    throw new CardContentError(
      `The "${name}" card has the number range "${range[0]}", which renders reversed on Arabic ` +
        'cards. Write it in words, e.g. "من 600 إلى 800".',
    );
  }
  if (language === "ar" && latin > arabic) {
    throw new CardContentError(
      `The "${name}" card is set to Arabic but its text is mostly English. Write the text in Arabic, or use language "en".`,
    );
  }
}

/**
 * Remove Arabic short-vowel marks (tashkeel: fatha, damma, kasra, tanween, shadda, sukun, …).
 * Satori positions these marks badly (e.g. tanween under the alif), and everyday Arabic on
 * social media is written without them anyway.
 */
export function stripTashkeel(text: string): string {
  return text.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
}

function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  }
  return value;
}
