import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "../src/cards/theme.js";
import { createContextFactory } from "../src/context.js";
import { createServer } from "../src/server.js";
import { anchor, ORGANS } from "../src/video/body/anatomy.js";
import { backOut, layoutBubbles, renderBodyMapFrame } from "../src/video/body/frame.js";
import { probe } from "../src/video/ffmpeg.js";
import { buildFunReel, cueTimes, funShots, shotsDuration } from "../src/video/fun/build.js";
import { slideShots, type FunSlide } from "../src/video/fun/slides.js";
import { soundExpression } from "../src/video/fun/sound.js";
import { FUN_TEXT } from "../src/video/fun/text.js";

const theme = { ...DEFAULT_THEME, handle: "@bodybloom" };
const ctx = { theme, language: "ar" as const, popFrames: 2 };
const BODY = {
  title: "فيتامين D يشتغل هنا!",
  badge: "فيتامين D3",
  organs: [
    { organ: "bones", says: "مشكور على الشمس! صرت أقوى" },
    { organ: "immune", says: "احنا جاهزين للشتا!" },
    { organ: "muscles", says: "أخيرا أقدر أشيل أكياس المقاضي!" },
  ],
  sources: ["الشمس", "السلمون"],
};

let dir: string;
beforeAll(async () => (dir = await mkdtemp(path.join(tmpdir(), "ig-fun-"))));
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("body map", () => {
  it("pops with an overshoot", () => {
    expect(backOut(0)).toBeCloseTo(0);
    expect(backOut(1)).toBeCloseTo(1);
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map(backOut))).toBeGreaterThan(1.05);
  });

  it("places bubbles beside their organs, top to bottom, without overlaps", () => {
    for (const organs of [
      BODY.organs,
      [
        { organ: "brain", says: "x".repeat(48) },
        { organ: "eyes", says: "y".repeat(48) },
        { organ: "heart", says: "z".repeat(48) },
      ],
      [
        { organ: "gut", says: "a" },
        { organ: "liver", says: "b" },
        { organ: "kidneys", says: "c" },
      ],
    ] as { organ: (typeof ORGANS)[number]; says: string }[][]) {
      const bubbles = layoutBubbles(organs);
      expect(bubbles.map((b) => anchor(b.organ).y)).toEqual(
        [...bubbles.map((b) => anchor(b.organ).y)].sort((a, b) => a - b),
      );
      for (const side of ["left", "right"] as const) {
        const list = bubbles.filter((b) => b.side === side).sort((a, b) => a.top - b.top);
        for (let i = 1; i < list.length; i++) {
          expect(list[i]!.top).toBeGreaterThanOrEqual(list[i - 1]!.top + list[i - 1]!.height);
        }
        for (const b of list) {
          expect(b.top).toBeGreaterThanOrEqual(470);
          expect(b.top + b.height).toBeLessThanOrEqual(1400);
        }
      }
    }
  });

  it("renders a 1080×1920 frame and validates organs and language", async () => {
    const png = await renderBodyMapFrame(BODY, theme, "ar");
    expect(await sharp(png).metadata()).toMatchObject({ width: 1080, height: 1920 });
    await expect(
      renderBodyMapFrame({ ...BODY, organs: [{ organ: "spleen", says: "x" }] }, theme, "ar"),
    ).rejects.toThrow(/organs\.0\.organ/);
    await expect(
      renderBodyMapFrame(
        { title: "Vitamin D", organs: [{ organ: "bones", says: "Thanks!" }] },
        theme,
        "ar",
      ),
    ).rejects.toThrow(/set to Arabic but its text is mostly English/);
  });
});

describe("fun slides", () => {
  const cues = async (slide: FunSlide) => {
    const shots = await slideShots(slide, ctx);
    return { shots, cues: cueTimes(shots).map((c) => c.cue), total: shotsDuration(shots) };
  };

  it.each([
    [
      { template: "cover", content: { title: "فيتامين D: وش يسوي بجسمك؟", kicker: "احفظه" } },
      ["whoosh"],
      2.6,
    ],
    [
      { template: "tip", content: { title: "من وين تجيبه؟", points: ["شمس", "سلمون", "بيض"] } },
      ["whoosh", "pop", "pop", "pop"],
      5,
    ],
    [
      {
        template: "myth_fact",
        seconds: 4.5,
        content: { myth: "الأكل يكفيك", fact: "أغلبه من الشمس" },
      },
      ["buzz", "ding"],
      4.5,
    ],
    [{ template: "body_map", content: BODY }, ["whoosh", "pop", "pop", "pop"], 7],
    [
      {
        template: "macros",
        content: { title: "بيضة مسلوقة", calories: 72, protein_g: 6.3, carbs_g: 0.4, fat_g: 4.8 },
      },
      ["pop"],
      4,
    ],
    [{ template: "follow", content: {} }, ["ding"], 3],
  ] as [FunSlide, string[], number][])(
    "%o",
    async (slide, expected, seconds) => {
      const r = await cues(slide);
      expect(r.cues).toEqual(expected);
      expect(r.total).toBeCloseTo(seconds, 1);
      expect(await sharp(r.shots.at(-1)!.png).metadata()).toMatchObject({
        width: 1080,
        height: 1920,
      });
    },
    60_000,
  );

  it("shows tip points all at once when reveal is off", async () => {
    const { cues: c } = await cues({
      template: "tip",
      reveal: false,
      content: { title: "من وين تجيبه؟", points: ["شمس", "سلمون"] },
    });
    expect(c).toEqual(["pop"]);
  }, 30_000);

  it("labels errors with the slide number", async () => {
    await expect(
      funShots(
        [
          { template: "cover", content: { title: "x" } },
          { template: "tip", content: { title: "y" } },
        ],
        ctx,
      ),
    ).rejects.toThrow(/^Slide 1: The "cover" card is set to Arabic/);
  });

  it("uses Gulf wording in Arabic", () => {
    expect(FUN_TEXT.ar).toMatchObject({
      findIt: "تلقاه في",
      share: "ارسله لربعك",
      factLabel: "بس الحقيقة:",
    });
  });
});

describe("fun soundtrack and assembly", () => {
  it("puts a sound effect on every cue", () => {
    const expr = soundExpression(
      [
        { at: 0, cue: "whoosh" },
        { at: 1.5, cue: "pop" },
        { at: 3, cue: "ding" },
      ],
      5,
    );
    expect(expr).toContain("between(t,1.500,1.800)");
    expect(expr).toContain("1318.5");
    expect(expr).toMatch(/max\(0,5\.000-t\)/);
  });

  it("encodes a Reel with sound, or silent", async () => {
    const { shots } = await funShots(
      [
        { template: "cover", seconds: 1.6, content: { title: "فيتامين D" } },
        { template: "follow", seconds: 1.8, content: {} },
      ],
      ctx,
    );
    const file = path.join(dir, "fun.mp4");
    const total = await buildFunReel(shots, file, { sound: "fun" });
    const info = await probe(file);
    expect(info).toMatchObject({
      width: 1080,
      height: 1920,
      fps: 30,
      videoCodec: "h264",
      audioCodec: "aac",
      audioSampleRate: 48000,
    });
    expect(Math.abs(info.duration - total)).toBeLessThan(0.15);
    const silent = path.join(dir, "silent.mp4");
    await buildFunReel(shots, silent, { sound: "none" });
    expect((await probe(silent)).audioCodec).toBe("aac");
  }, 120_000);
});

describe("tools and prompt", () => {
  async function connect() {
    const env = { CARD_OUTPUT_DIR: dir, BRAND_HANDLE: "bodybloom" };
    const mcp = createServer(createContextFactory({}), {
      env,
      now: () => new Date("2026-11-05T10:00:00Z"),
    });
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(a), client.connect(b)]);
    return client;
  }

  it("render_reel uses the fun style by default and supports body_map", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "render_reel",
      arguments: {
        language: "ar",
        name: "fun-tool",
        slides: [
          {
            template: "body_map",
            seconds: 3.5,
            content: { ...BODY, organs: BODY.organs.slice(0, 1) },
          },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
    const info = JSON.parse((result.content as { text?: string }[])[1]!.text!);
    expect(info.path).toBe(path.join(dir, "fun-tool-ar.mp4"));
    expect(info.warnings.join(" ")).toMatch(/Placeholder soundtrack/);
  }, 120_000);

  it("rejects body_map in the clean style", async () => {
    const result = await (
      await connect()
    ).callTool({
      name: "render_reel",
      arguments: {
        language: "ar",
        style: "clean",
        slides: [{ template: "body_map", content: BODY }],
      },
    });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]!.text).toMatch(
      /body_map only exists in the fun style/,
    );
  });

  it("fun_reel prompt: Gulf dialect, evidence list, dry run first", async () => {
    const client = await connect();
    const get = async (args: Record<string, string>) =>
      (
        (await client.getPrompt({ name: "fun_reel", arguments: args })).messages[0]!.content as {
          text: string;
        }
      ).text;
    const ar = await get({ topic: "vitamin", language: "D" });
    expect(ar).toContain('"vitamin D"');
    const arabic = await get({ topic: "فيتامين د", language: "ar" });
    expect(arabic).toMatch(/GULF DIALECT/);
    expect(arabic).toMatch(/vitamin D: bones, muscles, immune/);
    expect(arabic).toMatch(/WITHOUT confirm \(dry run\)/);
    expect(arabic).toContain("@bodybloom");
    expect(await get({ topic: "water", language: "en" })).not.toMatch(/GULF DIALECT/);
  });
});
