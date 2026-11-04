import type { PromptLanguage } from "./guidelines.js";

const ARABIC = new Set(["ar", "arabic", "arab", "عربي", "عربية", "العربية", "بالعربي", "بالعربية"]);
const ENGLISH = new Set([
  "en",
  "english",
  "eng",
  "انجليزي",
  "إنجليزي",
  "انجليزية",
  "الانجليزية",
  "الإنجليزية",
  "بالانجليزي",
  "بالإنجليزي",
]);

/** "Arabic", "AR", "عربي" → "ar"; empty → undefined (ask); anything else → null. */
export function parseLanguage(value: string | undefined): PromptLanguage | undefined | null {
  const v = value?.trim().toLowerCase();
  if (!v) return undefined;
  if (ARABIC.has(v)) return "ar";
  if (ENGLISH.has(v)) return "en";
  return null;
}

const words = (...parts: (string | undefined)[]) =>
  parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(" ");

/**
 * Claude Code splits prompt arguments on spaces, so "/…nutrition_post vitamin D ar" arrives as
 * topic "vitamin", language "D", audience "ar". Recover: the first recognisable language word
 * anywhere after the topic is the language, and the other words before it belong to the topic.
 */
export function recoverTopicArgs(
  topic: string,
  rest: (string | undefined)[],
): { topic: string; language: PromptLanguage | undefined; rest: (string | undefined)[] } {
  const first = parseLanguage(rest[0]);
  if (first !== null) return { topic: topic.trim(), language: first, rest: rest.slice(1) };
  const tokens = rest.flatMap((r) => (r?.trim() ? r.trim().split(/\s+/) : []));
  const index = tokens.findIndex((t) => parseLanguage(t));
  if (index === -1) {
    return { topic: words(topic, ...tokens), language: undefined, rest: [] };
  }
  return {
    topic: words(topic, ...tokens.slice(0, index)),
    language: parseLanguage(tokens[index]) ?? undefined,
    rest: tokens.length > index + 1 ? [tokens.slice(index + 1).join(" ")] : [],
  };
}
