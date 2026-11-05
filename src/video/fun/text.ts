import type { Language } from "../../cards/locale.js";

/**
 * Built-in wording for the fun Reel style. Arabic is Gulf dialect (decided 2026-11-05):
 * casual and funny, but still clear to any Arabic speaker.
 */
export interface FunText {
  findIt: string;
  watchTillEnd: string;
  tipLabel: string;
  macrosLabel: string;
  recipeLabel: string;
  mythLabel: string;
  factLabel: string;
  thanks: string;
  follow: string;
  save: string;
  share: string;
}

export const FUN_TEXT: Record<Language, FunText> = {
  ar: {
    findIt: "تلقاه في",
    watchTillEnd: "كمل للآخر",
    tipLabel: "نصيحة على السريع",
    macrosLabel: "وش فيه؟",
    recipeLabel: "وصفة سريعة",
    mythLabel: "يقولون:",
    factLabel: "بس الحقيقة:",
    thanks: "أعضاؤك تقول لك: مشكور!",
    follow: "تابع",
    save: "احفظ الفيديو",
    share: "ارسله لربعك",
  },
  en: {
    findIt: "Find it in",
    watchTillEnd: "Watch till the end",
    tipLabel: "Quick tip",
    macrosLabel: "What's inside?",
    recipeLabel: "Quick recipe",
    mythLabel: "They say:",
    factLabel: "Actually:",
    thanks: "Your organs say: thank you!",
    follow: "Follow",
    save: "Save this",
    share: "Send it to a friend",
  },
};
