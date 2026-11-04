import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  APPROVAL_FLOW,
  ARABIC_STYLE,
  captionRules,
  cardRules,
  HEALTH_GUARDRAIL,
  languageStep,
  type PromptLanguage,
} from "./guidelines.js";

export interface PromptOptions {
  env?: NodeJS.ProcessEnv;
}

const language = z
  .enum(["ar", "en"])
  .optional()
  .describe('"ar" (Arabic) or "en" (English); Claude asks if left empty');
const audience = z
  .string()
  .optional()
  .describe("Who it's for, e.g. 'busy parents', 'gym beginners' (optional)");

const message = (text: string): GetPromptResult => ({
  messages: [{ role: "user", content: { type: "text", text } }],
});

const sections = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join("\n\n");

export function registerPrompts(server: McpServer, options: PromptOptions = {}): void {
  const env = options.env ?? process.env;
  const handle = () => {
    const h = env.BRAND_HANDLE?.trim();
    return h ? `@${h.replace(/^@/, "")}` : undefined;
  };
  const arabic = (lang: PromptLanguage | undefined) => lang !== "en" && ARABIC_STYLE;

  server.registerPrompt(
    "nutrition_post",
    {
      title: "Nutrition post",
      description:
        "Turn a topic into a ready-to-approve single-card post: hook, card, caption, hashtags.",
      argsSchema: {
        topic: z.string().describe("e.g. 'fibre', 'protein at breakfast'"),
        language,
        audience,
      },
    },
    ({ topic, language: lang, audience: who }) =>
      message(
        sections(
          `You are the content strategist for a nutrition Instagram account${handle() ? ` (${handle()})` : ""}. Create ONE single-image post about: "${topic}"${who ? ` for ${who}` : ""}.`,
          languageStep(lang),
          `PLAN: Pick the single card template that makes this topic most useful and saveable (tip for practical how-tos, macros for a specific food or meal, recipe for a dish, myth_fact for a misconception). Aim for one clear takeaway people will save or share.`,
          cardRules(),
          captionRules(lang, handle()),
          arabic(lang),
          HEALTH_GUARDRAIL,
          APPROVAL_FLOW,
        ),
      ),
  );

  server.registerPrompt(
    "carousel_series",
    {
      title: "Carousel series",
      description:
        "Turn a topic into a ready-to-approve carousel: cover, 4-8 content slides, follow slide, caption.",
      argsSchema: {
        topic: z.string().describe("e.g. 'high-protein breakfasts'"),
        language,
        slides: z
          .string()
          .regex(/^([4-8])?$/, "a number from 4 to 8")
          .optional()
          .describe("Number of content slides between cover and follow slide, 4-8 (default 5)"),
        audience,
      },
    },
    ({ topic, language: lang, slides, audience: who }) => {
      const n = slides ? Number(slides) : 5;
      return message(
        sections(
          `You are the content strategist for a nutrition Instagram account${handle() ? ` (${handle()})` : ""}. Create a carousel about: "${topic}"${who ? ` for ${who}` : ""}. Carousels earn the most saves and shares, so make every slide worth swiping to.`,
          languageStep(lang),
          `STRUCTURE (${n + 2} slides):
- Slide 1: "cover" with a curiosity-driven title (a number or a promise works well), a short subtitle and a kicker such as "Save for later".
- Slides 2-${n + 1}: ${n} content slides that build on each other, one idea per slide, mixing templates where it helps (tip, macros, recipe, myth_fact). Start strong; put the most surprising point early.
- Slide ${n + 2}: "follow" end slide.
- Set "slide": "1/${n + 2}", "2/${n + 2}", … on every slide.`,
          cardRules(),
          captionRules(lang, handle()),
          arabic(lang),
          HEALTH_GUARDRAIL,
          APPROVAL_FLOW,
        ),
      );
    },
  );

  server.registerPrompt(
    "weekly_content_plan",
    {
      title: "Weekly content plan",
      description: "Plan 7 days of posts across the content pillars, ready to produce one by one.",
      argsSchema: {
        language,
        focus: z
          .string()
          .optional()
          .describe(
            "Theme for the week, e.g. 'Ramadan', 'gut health', 'back to school' (optional)",
          ),
        start_date: z.string().optional().describe("First day, e.g. '2026-11-09' (optional)"),
        audience,
      },
    },
    ({ language: lang, focus, start_date, audience: who }) =>
      message(
        sections(
          `You are the content strategist for a nutrition Instagram account${handle() ? ` (${handle()})` : ""}. Plan the next 7 days of posts${start_date ? ` starting ${start_date}` : ""}${focus ? `, with the week's theme: "${focus}"` : ""}${who ? `, for ${who}` : ""}.`,
          languageStep(lang),
          `PLAN RULES:
- Mix the content pillars across the week: practical tips, recipes, myth-busting, macros/food breakdowns, and one Q&A or engagement post (a question to answer in the comments).
- 3-4 carousels and 3-4 single posts. No two days in a row on the same pillar.
- Each idea should be specific (not "protein tips" but "3 high-protein swaps for your usual breakfast") and saveable.
- If get_recent_posts or insights tools are available, check what performed well first and lean into it.
- Don't invent "best posting times"; suggest the user tests times and reviews insights.`,
          `OUTPUT: A table with one row per day: Day | Pillar | Format (post/carousel + slide count) | Topic | Hook (first caption line, in the chosen language) | Card templates. Then a short note on why this mix. Then ask which day to produce first; produce it with the nutrition_post or carousel_series approach (dry run, preview, approval).`,
          arabic(lang),
          HEALTH_GUARDRAIL,
        ),
      ),
  );
}
