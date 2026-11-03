/** Card language: drives direction, fonts, typography and the built-in wording. */
export type Language = "en" | "ar";
export const LANGUAGES = ["en", "ar"] as const satisfies readonly Language[];

export interface Locale {
  lang: Language;
  dir: "ltr" | "rtl";
  fontFamily: string;
  /** Letter spacing. Always 0 in Arabic: spacing breaks the joins between letters. */
  tracking: (px: number) => number;
  /** Arabic needs taller lines for its ascenders, descenders and dots. */
  lineHeight: (base: number) => number;
  textTransform: "uppercase" | "none";
  /** Points "forward" through a carousel: right in English, left in Arabic. */
  swipeArrow: string;
  text: {
    tipLabel: string;
    macrosLabel: string;
    recipeLabel: string;
    mythFactLabel: string;
    protein: string;
    carbs: string;
    fat: string;
    grams: string;
    kcal: string;
    ingredients: string;
    method: string;
    myth: string;
    fact: string;
    source: string;
    swipe: string;
    followHeadline: string;
    followActions: string[];
  };
}

export const LOCALES: Record<Language, Locale> = {
  en: {
    lang: "en",
    dir: "ltr",
    fontFamily: "Inter",
    tracking: (px) => px,
    lineHeight: (base) => base,
    textTransform: "uppercase",
    swipeArrow: "›››",
    text: {
      tipLabel: "Nutrition tip",
      macrosLabel: "Macros",
      recipeLabel: "Recipe",
      mythFactLabel: "Myth vs fact",
      protein: "Protein",
      carbs: "Carbs",
      fat: "Fat",
      grams: "g",
      kcal: "kcal",
      ingredients: "Ingredients",
      method: "Method",
      myth: "Myth",
      fact: "Fact",
      source: "Source",
      swipe: "Swipe",
      followHeadline: "Follow for daily nutrition tips",
      followActions: ["Save this for later", "Share it with a friend", "Follow for more"],
    },
  },
  ar: {
    lang: "ar",
    dir: "rtl",
    // Arabic glyphs from IBM Plex Sans Arabic; Latin letters and digits fall back to Inter.
    fontFamily: "IBM Plex Sans Arabic",
    tracking: () => 0,
    lineHeight: (base) => base + 0.3,
    textTransform: "none",
    swipeArrow: "‹‹‹",
    text: {
      tipLabel: "نصيحة غذائية",
      macrosLabel: "القيم الغذائية",
      recipeLabel: "وصفة",
      mythFactLabel: "خرافة أم حقيقة",
      protein: "بروتين",
      carbs: "كربوهيدرات",
      fat: "دهون",
      grams: "غ",
      kcal: "سعرة حرارية",
      ingredients: "المكونات",
      method: "طريقة التحضير",
      myth: "خرافة",
      fact: "حقيقة",
      source: "المصدر",
      swipe: "اسحب",
      followHeadline: "تابعنا لنصائح غذائية يومية",
      followActions: ["احفظ المنشور للرجوع إليه", "شاركه مع صديق", "تابعنا للمزيد"],
    },
  },
};
