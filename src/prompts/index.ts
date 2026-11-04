import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { parseLanguage, recoverTopicArgs } from "./args.js";
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

// Plain strings: Claude Code fills prompt arguments from space-separated words, so values are
// normalised (and recovered) in the handlers instead of being rejected by the schema.
const language = z
  .string()
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
    (args) => {
      const {
        topic,
        language: lang,
        rest: [who],
      } = recoverTopicArgs(args.topic, [args.language, args.audience]);
      return message(
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
      );
    },
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
          .optional()
          .describe("Number of content slides between cover and follow slide, 4-8 (default 5)"),
        audience,
      },
    },
    (args) => {
      const recovered = recoverTopicArgs(args.topic, [args.language, args.slides, args.audience]);
      const { topic, language: lang } = recovered;
      // After recovery the remaining words are [slides?, audience…].
      let [slides, ...audienceWords] = recovered.rest.join(" ").split(/\s+/).filter(Boolean);
      if (slides && !/^\d+$/.test(slides)) {
        audienceWords = [slides, ...audienceWords];
        slides = undefined;
      }
      if (slides && (Number(slides) < 4 || Number(slides) > 8)) {
        throw new Error(`slides must be a number from 4 to 8 (got ${slides}).`);
      }
      const who = audienceWords.join(" ") || undefined;
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
    (args) => {
      // A non-language first word is part of the focus (space-split arguments).
      let lang = parseLanguage(args.language);
      let focus = args.focus;
      if (lang === null) {
        focus = [args.language, args.focus].filter(Boolean).join(" ");
        lang = undefined;
      }
      const { start_date, audience: who } = args;
      return message(
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
      );
    },
  );

  server.registerPrompt(
    "performance_review",
    {
      title: "Performance review",
      description:
        "Review recent posts and account results: what brought followers, saves and reach, and what to post next.",
      argsSchema: {
        language,
        days: z.string().optional().describe("How far back, in days (default 30, max 30)"),
      },
    },
    (args) => {
      const lang = parseLanguage(args.language) ?? undefined;
      const daysNum = Number(args.days);
      const days =
        Number.isFinite(daysNum) && daysNum >= 1 ? Math.min(30, Math.round(daysNum)) : 30;
      return message(
        sections(
          `You are the growth analyst for a nutrition Instagram account${handle() ? ` (${handle()})` : ""}. Review the last ${days} days and recommend what to post next.`,
          lang
            ? `Write the review in ${lang === "ar" ? "Arabic" : "English"}.`
            : "Write the review in the language the user writes in.",
          `STEPS:
1. get_account_insights with days: ${days} (reach, engagement, follower growth).
2. get_recent_posts with since_days: ${days} (up to 25), then get_post_insights with those post ids.
3. Rank posts by what grows the account, in this order: follows (feed posts only; reels have no follows data), then saves and shares (strongest signals of value), then reach. Use rates (% of reach) to compare posts with different reach.
4. Compare formats (carousel vs reel vs single image), topics, hooks (first caption line) and card templates.`,
          `OUTPUT:
- Headline numbers for the period (reach, engaged accounts, follower change if known).
- "What worked": the top 3 posts with the numbers that put them there and a one-line reason why.
- "What didn't": 1-2 patterns to drop or change.
- "Post next": 3-5 concrete ideas (topic + format + hook), each tied to a finding. Offer to create the first one with carousel_series or nutrition_post.`,
          `RULES:
- Use only numbers the tools returned; never invent or estimate metrics. Say when data is missing (e.g. no follows for reels, follower history still building, insights lag up to 48 h).
- Small accounts have small, noisy numbers: talk about patterns across several posts, not single-post wins, and say when the sample is too small to conclude.
- Be specific and practical; skip generic social-media advice.`,
        ),
      );
    },
  );
}
