/** Shared instructions the content prompts build on. Written for Claude, not the reader. */
import { TEMPLATE_NAMES, TEMPLATES } from "../cards/templates/index.js";

export type PromptLanguage = "ar" | "en";

export const DISCLAIMER: Record<PromptLanguage, string> = {
  en: "This post is for education, not medical advice. Talk to your doctor or a registered dietitian before big changes or supplements.",
  ar: "المحتوى للتوعية وليس بديلا عن استشارة مختص. استشر طبيبك أو أخصائي تغذية قبل أي تغيير كبير أو مكملات.",
};

export function languageStep(language: PromptLanguage | undefined): string {
  if (!language) {
    return (
      "LANGUAGE: The user hasn't chosen a language. Before anything else, ask: " +
      '"Should this be in Arabic or English?" and wait for the answer. Then write everything ' +
      "(cards and caption) in that language."
    );
  }
  return language === "ar"
    ? 'LANGUAGE: Arabic. Write the cards and the caption in Arabic (render with language "ar").'
    : 'LANGUAGE: English. Write the cards and the caption in English (render with language "en").';
}

export const HEALTH_GUARDRAIL = `HEALTH-CLAIMS GUARDRAIL (non-negotiable):
- Only state what mainstream evidence supports (WHO, NIH, EFSA, national dietary guidelines, systematic reviews). If unsure, leave it out or soften it ("may help", "is linked to").
- Never claim a food, diet or supplement cures, treats or prevents a disease, "detoxes", "burns fat" or "boosts metabolism". No guaranteed or specific weight-loss results ("lose 5 kg in a week").
- Supplements and doses: only cite official reference intakes (e.g. NIH RDAs), say people's needs differ, and recommend asking a doctor before supplementing. Never suggest megadoses.
- Medical conditions, pregnancy, children, eating disorders, medications: keep it general and point to a professional.
- No body shaming, fear-mongering, "good/bad food" moralising, or before/after promises.
- If a claim could be read as medical advice, end the caption with the disclaimer line.
- Prefer one clear, accurate takeaway over many shaky ones. Name the source on myth_fact cards.`;

export function cardRules(): string {
  const templates = TEMPLATE_NAMES.map((n) => `  - ${n}: ${TEMPLATES[n].summary}`).join("\n");
  return `CARDS (rendered by the server, 1080x1350):
${templates}
- Every card takes an optional "label" (pill text) and "slide" ("2/7"); use "slide" on every carousel slide.
- Cards are read in a second: short, concrete lines. Limits: titles <= 48-80 chars, tip points <= 110 chars (max 4), myth <= 110, fact <= 200, recipe steps <= 90 (max 4), ingredients <= 40 (2-8). The tools reject text that doesn't fit and say what to shorten.
- No emoji on cards (the font can't draw them); emoji belong in the caption.`;
}

export const ARABIC_STYLE = `ARABIC STYLE:
- Clear, warm Modern Standard Arabic that reads naturally on Instagram; write it directly in Arabic, don't translate English word for word. Hooks should feel native.
- No tashkeel (it's stripped anyway). Western digits (420) are fine.
- Number ranges in words on cards: "من 600 إلى 800", never "600-800" (it renders reversed).
- Hashtags: Arabic words joined with underscores (#تغذية_صحية); a few English tags are fine for reach.
- The "swipe" emoji points left in Arabic: 👈.`;

export function captionRules(
  language: PromptLanguage | undefined,
  handle: string | undefined,
): string {
  const who = handle ?? "the account";
  const disclaimer = language
    ? `"${DISCLAIMER[language]}"`
    : `the disclaimer in the chosen language (English: "${DISCLAIMER.en}" / Arabic: "${DISCLAIMER.ar}")`;
  return `CAPTION (max 2,200 characters, 30 hashtags, 20 mentions):
1. Hook: the first line must make people stop scrolling and fit in ~125 characters (that's all that shows before "more"). A surprising fact, a question or a clear promise of value; 1 emoji max.
2. Value: 2-5 short lines or a mini-list that add to the cards, not repeat them. Line breaks between ideas.
3. Call to action: save + share, and follow ${who} for more (e.g. "Save this for your next grocery run").
4. Disclaimer when the post touches health effects or supplements: ${disclaimer}
5. Hashtags: call suggest_hashtags (1-3 niches, same language, or "both" for an Arabic post that also targets English speakers), use 10-20, at the very end, optionally plus 1-3 topic tags of your own.`;
}

export const APPROVAL_FLOW = `PUBLISHING FLOW:
1. Draft the slides and caption, then call create_and_publish_card_post WITHOUT confirm (dry run). It renders every slide and returns a preview image and checks; nothing is uploaded or posted.
2. Show the user the preview, the full caption and the dry-run result. Fix any problems it reports and re-run the dry run.
3. Ask: "Publish this to Instagram?" Only after an explicit yes, call the same tool again with the exact same arguments plus confirm: true. If they want changes, edit and dry-run again.
4. After publishing, share the permalink.`;

export const GULF_STYLE = `GULF DIALECT (Arabic fun Reels: on-screen text, organ lines and caption):
- Write in light, friendly Khaleeji: e.g. وش (what), ليش (why), وايد (a lot), شوي (a bit), ربعك (your friends), مقاضي (groceries), يبي/تبي (want), خلنا (let's), عشان (so that), احنا (we). Natural and warm, never crude; any Arabic speaker should still follow it.
- The humour comes from the organs talking like people (grateful, dramatic, cheeky), not from mocking anyone's body or food choices.
- No tashkeel; number ranges in words ("من 600 إلى 800"); end Arabic titles with an Arabic word, not a Latin letter + "؟".
- The disclaimer line can stay in Modern Standard Arabic.`;

/** Links between nutrients and organs that mainstream evidence supports (for body_map). */
export const ORGAN_EVIDENCE = `WHICH ORGANS MAY "TALK" (body_map): only light up an organ if the link is well supported, e.g.:
- vitamin D: bones, muscles, immune · calcium: bones · vitamin K: bones, blood (clotting)
- omega-3 (EPA/DHA from fish): heart, brain, eyes · fibre: gut, heart (cholesterol)
- iron: blood (red blood cells carry oxygen), brain (tiredness/focus when low) · vitamin B12: blood, brain (nerves)
- vitamin C: immune, skin (collagen), blood (helps absorb plant iron) · vitamin A: eyes, skin, immune
- zinc: immune, skin · potassium: heart (blood pressure), muscles · magnesium: muscles, bones, brain (nerves)
- protein: muscles, skin · water: kidneys, brain, skin · probiotics/fermented foods: gut
When in doubt, light up fewer organs. Never imply a cure, "detox" or guaranteed result.`;
