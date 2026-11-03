import type { z } from "zod";
import type { CardNode } from "../element.js";
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
  render: (content: z.infer<S>, theme: Theme) => CardNode;
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
export function parseContent(name: TemplateName, content: unknown): unknown {
  const result = TEMPLATES[name].schema.safeParse(content);
  if (result.success) return result.data;
  const problems = result.error.issues
    .map((i) => `- ${i.path.length ? i.path.join(".") : "content"}: ${i.message}`)
    .join("\n");
  throw new CardContentError(`Invalid content for the "${name}" card:\n${problems}`);
}
