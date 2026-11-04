/**
 * Curated nutrition hashtag sets. Tiers are editorial judgement, not live volume data:
 * "broad" = huge, very competitive tags; "specific" = the niche's main tags; "niche" = smaller,
 * more targeted tags where a small account can still be seen. A good mix uses all three.
 */
export type HashtagLanguage = "en" | "ar";
export type Tier = "broad" | "specific" | "niche";

export const NICHES = [
  "general",
  "weight_management",
  "high_protein",
  "plant_based",
  "meal_prep",
  "healthy_recipes",
  "gut_health",
  "vitamins_minerals",
  "hydration",
  "sports_nutrition",
  "healthy_breakfast",
  "healthy_snacks",
] as const;
export type Niche = (typeof NICHES)[number];

type Sets = Record<Tier, string[]>;

const EN: Record<Niche, Sets> = {
  general: {
    broad: ["#nutrition", "#healthyeating", "#healthylifestyle", "#health", "#wellness"],
    specific: ["#nutritiontips", "#eatwell", "#balanceddiet", "#healthyhabits", "#healthychoices"],
    niche: [
      "#nutritionfacts",
      "#nutritioneducation",
      "#eatbetter",
      "#foodasfuel",
      "#mindfuleating",
    ],
  },
  weight_management: {
    broad: ["#weightloss", "#healthylifestyle", "#fitness"],
    specific: ["#weightlossjourney", "#caloriedeficit", "#portioncontrol", "#healthyweight"],
    niche: ["#sustainableweightloss", "#nodietmentality", "#eatforyourgoals", "#flexibledieting"],
  },
  high_protein: {
    broad: ["#protein", "#fitfood", "#gains"],
    specific: ["#highprotein", "#proteinpacked", "#highproteinmeals", "#proteinrecipes"],
    niche: ["#highproteinbreakfast", "#proteinsnacks", "#proteingoals", "#musclefood"],
  },
  plant_based: {
    broad: ["#vegan", "#plantbased", "#vegetarian"],
    specific: ["#plantbasednutrition", "#plantprotein", "#veganfood", "#eatmoreplants"],
    niche: ["#plantbasedprotein", "#veganprotein", "#wholefoodplantbased", "#plantpowered"],
  },
  meal_prep: {
    broad: ["#mealprep", "#healthyfood", "#foodprep"],
    specific: ["#mealprepideas", "#mealprepsunday", "#healthymealprep", "#batchcooking"],
    niche: ["#mealprepmonday", "#lunchprep", "#prepahead", "#mealplanning"],
  },
  healthy_recipes: {
    broad: ["#healthyrecipes", "#healthyfood", "#recipes"],
    specific: ["#easyrecipes", "#healthymeals", "#cleaneating", "#homecooking"],
    niche: ["#quickhealthymeals", "#15minutemeals", "#simplerecipes", "#nutritiousanddelicious"],
  },
  gut_health: {
    broad: ["#guthealth", "#healthylifestyle", "#wellness"],
    specific: ["#happygut", "#fiber", "#probiotics", "#digestivehealth"],
    niche: ["#prebiotics", "#fermentedfoods", "#guthealthmatters", "#eatthefiber"],
  },
  vitamins_minerals: {
    broad: ["#vitamins", "#health", "#nutrition"],
    specific: ["#micronutrients", "#vitamind", "#minerals", "#nutrientdense"],
    niche: ["#vitaminc", "#iron", "#magnesium", "#nutrientdeficiency"],
  },
  hydration: {
    broad: ["#hydration", "#water", "#healthyhabits"],
    specific: ["#drinkmorewater", "#stayhydrated", "#hydrate", "#waterintake"],
    niche: ["#hydrationtips", "#infusedwater", "#electrolytes", "#waterchallenge"],
  },
  sports_nutrition: {
    broad: ["#fitness", "#gym", "#workout"],
    specific: ["#sportsnutrition", "#fitnessnutrition", "#preworkout", "#postworkout"],
    niche: ["#recoveryfood", "#athletenutrition", "#fuelyourbody", "#trainingnutrition"],
  },
  healthy_breakfast: {
    broad: ["#breakfast", "#healthybreakfast", "#healthyfood"],
    specific: ["#breakfastideas", "#oats", "#overnightoats", "#breakfastbowl"],
    niche: ["#highproteinbreakfast", "#quickbreakfast", "#breakfastinspo", "#morningfuel"],
  },
  healthy_snacks: {
    broad: ["#snacks", "#healthysnacks", "#healthyfood"],
    specific: ["#snackideas", "#healthysnacking", "#smartsnacking", "#guiltfreesnack"],
    niche: ["#snackprep", "#proteinsnack", "#afterschoolsnack", "#officesnacks"],
  },
};

// Arabic users often drop the hamza (اكل rather than أكل); the more common spelling is used.
const AR: Record<Niche, Sets> = {
  general: {
    broad: ["#صحة", "#تغذية", "#اكل_صحي", "#نمط_حياة_صحي"],
    specific: ["#تغذية_صحية", "#نصائح_صحية", "#معلومة_صحية", "#غذاء_صحي"],
    niche: ["#نصائح_غذائية", "#ثقافة_غذائية", "#عادات_صحية", "#توعية_صحية"],
  },
  weight_management: {
    broad: ["#رجيم", "#دايت", "#خسارة_الوزن"],
    specific: ["#نزول_الوزن", "#حمية_غذائية", "#رشاقة", "#سعرات_حرارية"],
    niche: ["#نقص_الوزن", "#وزن_صحي", "#رجيم_صحي", "#عجز_السعرات"],
  },
  high_protein: {
    broad: ["#بروتين", "#لياقة", "#رياضة"],
    specific: ["#اكل_بروتين", "#وجبات_بروتين", "#بروتين_عالي", "#وصفات_بروتين"],
    niche: ["#فطور_بروتين", "#سناك_بروتين", "#بناء_العضلات", "#بروتين_نباتي"],
  },
  plant_based: {
    broad: ["#نباتي", "#نباتيين", "#اكل_نباتي"],
    specific: ["#وصفات_نباتية", "#بروتين_نباتي", "#غذاء_نباتي", "#خضروات"],
    niche: ["#نباتي_صرف", "#بقوليات", "#اكل_نباتي_صحي", "#صحن_نباتي"],
  },
  meal_prep: {
    broad: ["#تحضير_الوجبات", "#وجبات_صحية", "#اكل_صحي"],
    specific: ["#ميل_بريب", "#تحضير_الاكل", "#وجبات_الاسبوع", "#تنظيم_الوجبات"],
    niche: ["#وجبات_العمل", "#غداء_صحي", "#تخطيط_الوجبات", "#وجبات_جاهزة_صحية"],
  },
  healthy_recipes: {
    broad: ["#وصفات", "#وصفات_صحية", "#طبخ"],
    specific: ["#وصفات_سهلة", "#اكلات_صحية", "#مطبخ_صحي", "#وصفات_سريعة"],
    niche: ["#وصفات_دايت", "#وصفات_رجيم", "#طبخ_صحي", "#وصفة_اليوم"],
  },
  gut_health: {
    broad: ["#صحة", "#الجهاز_الهضمي", "#تغذية"],
    specific: ["#صحة_الامعاء", "#الالياف", "#بروبيوتيك", "#صحة_الجهاز_الهضمي"],
    niche: ["#الهضم", "#اطعمة_مخمرة", "#القولون", "#بريبيوتيك"],
  },
  vitamins_minerals: {
    broad: ["#فيتامينات", "#صحة", "#تغذية"],
    specific: ["#فيتامين_د", "#معادن", "#مكملات_غذائية", "#نقص_الفيتامينات"],
    niche: ["#فيتامين_سي", "#الحديد", "#المغنيسيوم", "#فيتامين_ب12"],
  },
  hydration: {
    broad: ["#ماء", "#صحة", "#عادات_صحية"],
    specific: ["#شرب_الماء", "#اشرب_ماء", "#ترطيب_الجسم", "#الماء_حياة"],
    niche: ["#تحدي_شرب_الماء", "#ماء_منكه", "#الجفاف", "#كم_كوب_ماء"],
  },
  sports_nutrition: {
    broad: ["#رياضة", "#لياقة", "#جيم"],
    specific: ["#تغذية_رياضية", "#لياقة_بدنية", "#قبل_التمرين", "#بعد_التمرين"],
    niche: ["#تغذية_الرياضيين", "#استشفاء", "#وقود_التمرين", "#اكل_رياضي"],
  },
  healthy_breakfast: {
    broad: ["#فطور", "#فطور_صحي", "#اكل_صحي"],
    specific: ["#افكار_فطور", "#شوفان", "#فطور_سريع", "#وجبة_الفطور"],
    niche: ["#شوفان_ليلي", "#فطور_بروتين", "#فطور_دايت", "#صباح_صحي"],
  },
  healthy_snacks: {
    broad: ["#سناك", "#سناك_صحي", "#اكل_صحي"],
    specific: ["#وجبات_خفيفة", "#سناكات_صحية", "#افكار_سناك", "#سناك_دايت"],
    niche: ["#سناك_بروتين", "#سناك_المدرسة", "#سناك_العمل", "#تصبيرة_صحية"],
  },
};

export const HASHTAGS: Record<HashtagLanguage, Record<Niche, Sets>> = { en: EN, ar: AR };

export interface HashtagSuggestion {
  hashtags: string[];
  byTier: Record<Tier, string[]>;
}

/**
 * Pick a balanced mix: the niche's tags first (specific, niche, broad), topped up from
 * "general". For "both", alternate Arabic and English. Never more than Instagram's 30, and
 * fewer if the chosen niches don't have enough tags (padding with off-topic tags hurts reach).
 */
export function suggestHashtags(
  niches: Niche[],
  language: HashtagLanguage | "both",
  count = 15,
): HashtagSuggestion {
  const n = Math.max(1, Math.min(30, Math.round(count)));
  const langs: HashtagLanguage[] = language === "both" ? ["ar", "en"] : [language];
  const order: Niche[] = [...new Set([...niches, "general" as const])];
  // Share per tier: roughly 25% broad, 40% specific, 35% niche.
  const quota: Record<Tier, number> = {
    broad: Math.max(1, Math.round(n * 0.25)),
    specific: Math.max(1, Math.round(n * 0.4)),
    niche: 0,
  };
  quota.niche = Math.max(0, n - quota.broad - quota.specific);

  const byTier: Record<Tier, string[]> = { broad: [], specific: [], niche: [] };
  const seen = new Set<string>();
  const take = (tier: Tier, limit: number) => {
    const pools = langs.map((lang) => order.flatMap((niche) => HASHTAGS[lang][niche][tier]));
    for (let i = 0; byTier[tier].length < limit && pools.some((p) => i < p.length); i++) {
      for (const pool of pools) {
        const tag = pool[i];
        if (tag && byTier[tier].length < limit && !seen.has(tag.toLowerCase())) {
          seen.add(tag.toLowerCase());
          byTier[tier].push(tag);
        }
      }
    }
  };
  take("specific", quota.specific);
  take("niche", quota.niche);
  take("broad", quota.broad);
  // Top up if a tier ran short.
  for (const tier of ["specific", "niche", "broad"] as Tier[]) {
    const total = () => byTier.broad.length + byTier.specific.length + byTier.niche.length;
    if (total() < n) take(tier, byTier[tier].length + (n - total()));
  }
  return { hashtags: [...byTier.specific, ...byTier.niche, ...byTier.broad], byTier };
}
