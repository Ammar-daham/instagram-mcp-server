import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { captionStats } from "../src/content/caption.js";
import { HASHTAGS, NICHES, suggestHashtags } from "../src/content/hashtags.js";
import { createContextFactory } from "../src/context.js";
import { parseLanguage, recoverTopicArgs } from "../src/prompts/args.js";
import { DISCLAIMER } from "../src/prompts/guidelines.js";
import { createServer } from "../src/server.js";

async function connect(env: NodeJS.ProcessEnv = { BRAND_HANDLE: "body.blooms.ai" }) {
  const mcp = createServer(createContextFactory({}), { env });
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(a), client.connect(b)]);
  return client;
}

const promptText = async (client: Client, name: string, args: Record<string, string>) => {
  const result = await client.getPrompt({ name, arguments: args });
  return (result.messages[0]!.content as { text: string }).text;
};

describe("prompts", () => {
  it("lists the content prompts", async () => {
    const { prompts } = await (await connect()).listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      "carousel_series",
      "nutrition_post",
      "performance_review",
      "weekly_content_plan",
    ]);
    const post = prompts.find((p) => p.name === "nutrition_post")!;
    expect(post.arguments?.map((a) => [a.name, a.required ?? false])).toEqual([
      ["topic", true],
      ["language", false],
      ["audience", false],
    ]);
  });

  it("asks for the language when none is given", async () => {
    const text = await promptText(await connect(), "nutrition_post", { topic: "fibre" });
    expect(text).toContain('"fibre"');
    expect(text).toMatch(/Should this be in Arabic or English\?/);
    // Both disclaimers are offered until the language is known.
    expect(text).toContain(DISCLAIMER.en);
    expect(text).toContain(DISCLAIMER.ar);
  });

  it("builds an Arabic post prompt with the guardrail and approval flow", async () => {
    const text = await promptText(await connect(), "nutrition_post", {
      topic: "الألياف",
      language: "ar",
      audience: "الأمهات المشغولات",
    });
    expect(text).toMatch(/LANGUAGE: Arabic/);
    expect(text).toMatch(/ARABIC STYLE/);
    expect(text).toContain("من 600 إلى 800");
    expect(text).toContain(DISCLAIMER.ar);
    expect(text).not.toContain(DISCLAIMER.en);
    expect(text).toMatch(/HEALTH-CLAIMS GUARDRAIL/);
    expect(text).toMatch(/Never claim a food, diet or supplement cures/);
    expect(text).toMatch(/WITHOUT confirm \(dry run\)/);
    expect(text).toMatch(/Only after an explicit yes/);
    expect(text).toContain("@body.blooms.ai");
    expect(text).toContain("الأمهات المشغولات");
  });

  it("leaves Arabic guidance out of English prompts", async () => {
    const text = await promptText(await connect(), "nutrition_post", {
      topic: "fibre",
      language: "en",
    });
    expect(text).toMatch(/LANGUAGE: English/);
    expect(text).not.toMatch(/ARABIC STYLE/);
  });

  it("sizes the carousel", async () => {
    const client = await connect();
    const six = await promptText(client, "carousel_series", { topic: "protein", slides: "6" });
    expect(six).toMatch(/STRUCTURE \(8 slides\)/);
    expect(six).toMatch(/Slides 2-7: 6 content slides/);
    expect(six).toContain('"1/8"');
    const dflt = await promptText(client, "carousel_series", { topic: "protein" });
    expect(dflt).toMatch(/STRUCTURE \(7 slides\)/);
    await expect(
      client.getPrompt({ name: "carousel_series", arguments: { topic: "x", slides: "12" } }),
    ).rejects.toThrow(/4 to 8/);
  });

  it("accepts how Claude Code passes arguments (space-split, empty, spelled out)", async () => {
    const client = await connect();
    // "/mcp__instagram__nutrition_post vitamin D ar" → topic, language, audience = vitamin, D, ar
    const split = await promptText(client, "nutrition_post", {
      topic: "vitamin",
      language: "D",
      audience: "ar",
    });
    expect(split).toContain('"vitamin D"');
    expect(split).toMatch(/LANGUAGE: Arabic/);

    // No language word at all: everything is topic, and Claude asks for the language.
    const noLang = await promptText(client, "nutrition_post", {
      topic: "high-protein",
      language: "breakfasts",
    });
    expect(noLang).toContain('"high-protein breakfasts"');
    expect(noLang).toMatch(/Should this be in Arabic or English\?/);

    const empty = await promptText(client, "nutrition_post", { topic: "fibre", language: "" });
    expect(empty).toMatch(/Should this be in Arabic or English\?/);

    const spelled = await promptText(client, "nutrition_post", {
      topic: "fibre",
      language: "Arabic",
      audience: "busy parents",
    });
    expect(spelled).toMatch(/LANGUAGE: Arabic/);
    expect(spelled).toContain("for busy parents");
  });

  it("recovers carousel arguments split on spaces", async () => {
    const client = await connect();
    // "/…carousel_series high protein breakfasts ar 6 gym beginners"
    const text = await promptText(client, "carousel_series", {
      topic: "high",
      language: "protein",
      slides: "breakfasts",
      audience: "ar 6 gym beginners",
    });
    expect(text).toContain('"high protein breakfasts" for gym beginners');
    expect(text).toMatch(/LANGUAGE: Arabic/);
    expect(text).toMatch(/STRUCTURE \(8 slides\)/);
  });

  it("treats a non-language first word of the weekly plan as the focus", async () => {
    const text = await promptText(await connect(), "weekly_content_plan", {
      language: "gut",
      focus: "health",
    });
    expect(text).toContain('"gut health"');
    expect(text).toMatch(/Should this be in Arabic or English\?/);
  });

  it("plans a week around a focus", async () => {
    const text = await promptText(await connect(), "weekly_content_plan", {
      language: "ar",
      focus: "Ramadan",
      start_date: "2026-11-09",
    });
    expect(text).toContain('"Ramadan"');
    expect(text).toContain("2026-11-09");
    expect(text).toMatch(/Day \| Pillar \| Format/);
    expect(text).toMatch(/Don't invent "best posting times"/);
  });
});

describe("hashtag sets", () => {
  it("are well-formed, unique per language and parsed by the caption checker", () => {
    for (const lang of ["en", "ar"] as const) {
      for (const niche of NICHES) {
        const tags = Object.values(HASHTAGS[lang][niche]).flat();
        expect(tags.length).toBeGreaterThanOrEqual(10);
        for (const tag of tags) {
          expect(tag).toMatch(/^#[\p{L}\p{N}_]+$/u);
          if (lang === "ar") expect(tag).toMatch(/\p{Script=Arabic}/u);
        }
        expect(new Set(tags).size).toBe(tags.length);
        expect(captionStats(tags.join(" ")).hashtags).toEqual(tags);
      }
    }
  });
});

describe("suggestHashtags", () => {
  it("returns the requested number, balanced across tiers, without duplicates", () => {
    const { hashtags, byTier } = suggestHashtags(["high_protein", "healthy_breakfast"], "en", 15);
    expect(hashtags).toHaveLength(15);
    expect(new Set(hashtags).size).toBe(15);
    expect(byTier.broad.length).toBeGreaterThanOrEqual(3);
    expect(byTier.specific.length).toBeGreaterThanOrEqual(5);
    expect(byTier.niche.length).toBeGreaterThanOrEqual(4);
    expect(hashtags[0]).toBe("#highprotein");
  });

  it("supports Arabic and bilingual sets", () => {
    const ar = suggestHashtags(["vitamins_minerals"], "ar", 12).hashtags;
    expect(ar).toHaveLength(12);
    expect(ar.every((t) => /\p{Script=Arabic}/u.test(t))).toBe(true);
    const both = suggestHashtags(["hydration"], "both", 16).hashtags;
    expect(both.filter((t) => /\p{Script=Arabic}/u.test(t)).length).toBe(8);
  });

  it("caps at 30, topping up from general but never with off-topic niches", () => {
    const three = ["high_protein", "healthy_breakfast", "sports_nutrition"] as const;
    expect(suggestHashtags([...three], "en", 30).hashtags).toHaveLength(30);
    expect(suggestHashtags([...three], "en", 99).hashtags).toHaveLength(30);
    const hydration = suggestHashtags(["hydration"], "en", 30).hashtags;
    expect(hydration.length).toBeLessThan(30);
    expect(hydration).toContain("#nutritiontips"); // from general
    expect(hydration).not.toContain("#gym");
  });

  it("says when it returns fewer than asked", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "suggest_hashtags",
      arguments: { niches: ["hydration"], language: "en", count: 30 },
    });
    expect(JSON.parse((result.content as { text: string }[])[0]!.text).note).toMatch(
      /Only \d+ curated tags fit these niches/,
    );
  });

  it("is exposed as a tool", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "suggest_hashtags",
      arguments: { niches: ["gut_health"], language: "ar", count: 10 },
    });
    const body = JSON.parse((result.content as { text: string }[])[0]!.text);
    expect(body.hashtags).toHaveLength(10);
    expect(body.line).toBe(body.hashtags.join(" "));
  });
});

describe("prompt argument parsing", () => {
  it.each([
    ["ar", "ar"],
    [" Arabic ", "ar"],
    ["عربي", "ar"],
    ["العربية", "ar"],
    ["EN", "en"],
    ["english", "en"],
    ["انجليزي", "en"],
    ["", undefined],
    [undefined, undefined],
    ["D", null],
  ] as const)("parseLanguage(%j) → %j", (input, expected) => {
    expect(parseLanguage(input)).toBe(expected);
  });

  it("keeps clean arguments as they are", () => {
    expect(recoverTopicArgs("vitamin D", ["en", "students"])).toEqual({
      topic: "vitamin D",
      language: "en",
      rest: ["students"],
    });
  });
});
