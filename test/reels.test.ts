import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { http, HttpResponse } from "msw";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "../src/cards/theme.js";
import { createContextFactory } from "../src/context.js";
import { uploadReelVideo } from "../src/instagram/publish.js";
import { runReelPublish, type ReelDeps } from "../src/publishing/reel-flow.js";
import { createServer } from "../src/server.js";
import { composeReel } from "../src/video/compose.js";
import { ffmpeg, probe } from "../src/video/ffmpeg.js";
import { reelFrame } from "../src/video/frames.js";
import { checkAudio, checkReelVideo } from "../src/video/inputs.js";
import { buildReel, reelDuration } from "../src/video/reel.js";
import { API, BASE, noSleep, useMsw } from "./helpers.js";

const server = useMsw();
const theme = { ...DEFAULT_THEME, handle: "@bodybloom" };
const UPLOAD = "https://rupload.facebook.com/ig-api-upload/v24.0";
let dir: string;
let out: string;
let video: string;

const lavfiVideo = (file: string, seconds: number, size = "1080x1920") =>
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=0x2E7D5B:s=${size}:d=${seconds}:r=30`,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-t",
    String(seconds),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    file,
  ]);

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ig-reels-"));
  out = path.join(dir, "out");
  await mkdir(out);
  video = path.join(out, "reel.mp4");
  await lavfiVideo(video, 3.5);
}, 60_000);
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("frames and composition", () => {
  it("places the card on a 9:16 canvas in its own background colour", async () => {
    const card = await sharp({
      create: { width: 1080, height: 1350, channels: 3, background: "#2E7D5B" },
    })
      .png()
      .toBuffer();
    const frame = await reelFrame(card);
    const meta = await sharp(frame).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1920]);
    const { data } = await sharp(frame)
      .extract({ left: 5, top: 1900, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([0x2e, 0x7d, 0x5b]);
  });

  it("reveals tip points one at a time, without zoom, joined by cuts", async () => {
    const { segments, slideFrames } = await composeReel(
      [
        { template: "cover", content: { title: "Water" } },
        {
          template: "tip",
          reveal: true,
          seconds: 5,
          content: { title: "Drink more", points: ["One", "Two", "Three"] },
        },
      ],
      theme,
      "en",
    );
    expect(segments.map((s) => [s.transition, s.zoom, s.seconds])).toEqual([
      ["fade", true, 2.5],
      ["fade", false, 1.6],
      ["cut", false, 1.2],
      ["cut", false, 2.2],
    ]);
    expect(slideFrames).toHaveLength(2);
  });

  it("names the slide when content or reveal is wrong", async () => {
    await expect(
      composeReel(
        [
          { template: "follow", content: {} },
          { template: "tip", content: { title: "x" } },
        ],
        theme,
        "en",
      ),
    ).rejects.toThrow(/^Slide 2: Invalid content/);
    await expect(
      composeReel([{ template: "cover", reveal: true, content: { title: "x" } }], theme, "en"),
    ).rejects.toThrow(/Slide 1: reveal only works on tip cards/);
  });

  it("computes the length after transitions overlap", () => {
    expect(
      reelDuration([
        { seconds: 3 },
        { seconds: 3, transition: "fade" },
        { seconds: 2, transition: "cut" },
      ]),
    ).toBeCloseTo(3 + 2.6 + 2 - 1 / 30);
  });
});

describe("buildReel", () => {
  it("encodes an Instagram-ready MP4 with music, zoom, cuts and a progress bar", async () => {
    const { segments } = await composeReel(
      [
        { template: "cover", seconds: 1.5, content: { title: "فيتامين D3" } },
        {
          template: "tip",
          reveal: true,
          seconds: 3,
          content: { title: "مصادره", points: ["الشمس.", "السمك."] },
        },
      ],
      theme,
      "ar",
    );
    const music = path.join(out, "music.m4a");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "aac", music]);
    const file = path.join(out, "built.mp4");
    const total = await buildReel(segments, file, {
      audio: music,
      progressBar: { colour: "#E9964A", rtl: true },
    });
    const info = await probe(file);
    expect(info).toMatchObject({
      width: 1080,
      height: 1920,
      fps: 30,
      videoCodec: "h264",
      audioCodec: "aac",
      audioSampleRate: 48000,
      pixelFormat: "yuv420p",
    });
    expect(info.duration).toBeGreaterThan(total - 0.15);
    expect(info.duration).toBeLessThan(total + 0.15);
  }, 120_000);

  it("adds a silent track when there's no audio", async () => {
    const { segments } = await composeReel(
      [{ template: "follow", seconds: 3, content: {} }],
      theme,
      "en",
    );
    const file = path.join(out, "silent.mp4");
    await buildReel(segments, file, { progressBar: false });
    expect((await probe(file)).audioCodec).toBe("aac");
  }, 60_000);
});

describe("input checks", () => {
  it("accepts a valid Reel and warns about non-9:16 video", async () => {
    await expect(checkReelVideo(video, [out])).resolves.toMatchObject({
      warnings: ["No audio track."].filter(() => false),
    });
    const square = path.join(out, "square.mp4");
    await lavfiVideo(square, 3.2, "1080x1080");
    const { warnings } = await checkReelVideo(square, [out]);
    expect(warnings.join(" ")).toMatch(/1080×1080, not 9:16/);
  }, 60_000);

  it("rejects short, misplaced and non-video files", async () => {
    const short = path.join(out, "short.mp4");
    await lavfiVideo(short, 2);
    await expect(checkReelVideo(short, [out])).rejects.toThrow(/minimum 3 s/);
    await expect(checkReelVideo(video, [path.join(dir, "elsewhere")])).rejects.toThrow(
      /Refusing to use/,
    );
    const fake = path.join(out, "notes.mp4");
    await writeFile(fake, "not a video");
    await expect(checkReelVideo(fake, [out])).rejects.toThrow(/Not a readable video/);
  }, 60_000);

  it("checks audio files", async () => {
    await expect(checkAudio(video, [out])).rejects.toThrow(/isn't a supported audio file/);
    const fake = path.join(out, "fake.mp3");
    await writeFile(fake, "nope");
    await expect(checkAudio(fake, [out])).rejects.toThrow(/has no audio/);
  });
});

describe("uploadReelVideo", () => {
  it("sends the bytes with OAuth and size headers", async () => {
    let headers: Headers | undefined;
    let size = 0;
    server.use(
      http.post(`${UPLOAD}/123`, async ({ request }) => {
        headers = request.headers;
        size = (await request.arrayBuffer()).byteLength;
        return HttpResponse.json({ success: true });
      }),
    );
    await uploadReelVideo(`${UPLOAD}/123`, "TOKEN", Buffer.alloc(1234));
    expect(headers!.get("authorization")).toBe("OAuth TOKEN");
    expect(headers!.get("offset")).toBe("0");
    expect(headers!.get("file_size")).toBe("1234");
    expect(size).toBe(1234);
  });

  it("never sends the token to another host", async () => {
    await expect(
      uploadReelVideo("https://evil.example/upload", "TOKEN", Buffer.alloc(1)),
    ).rejects.toThrow(/unexpected host evil.example/);
  });

  it("retries server errors and redacts tokens in errors", async () => {
    let calls = 0;
    server.use(
      http.post(`${UPLOAD}/123`, () =>
        ++calls < 2
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json({ error: "bad token EAAsecret123" }, { status: 400 }),
      ),
    );
    const err = await uploadReelVideo(`${UPLOAD}/123`, "T", Buffer.alloc(1), {
      sleep: noSleep,
    }).catch((e: Error) => e);
    expect(calls).toBe(2);
    expect((err as Error).message).toMatch(/HTTP 400/);
    expect((err as Error).message).not.toContain("EAAsecret123");
  });
});

describe("runReelPublish", () => {
  function fakes(options: { statuses?: string[]; quotaUsed?: number } = {}) {
    const log: string[] = [];
    const queue = [...(options.statuses ?? ["IN_PROGRESS", "FINISHED"])];
    let container: Record<string, string> = {};
    server.use(
      http.get(`${API}/42/content_publishing_limit`, () =>
        HttpResponse.json({
          data: [{ quota_usage: options.quotaUsed ?? 0, config: { quota_total: 100 } }],
        }),
      ),
      http.post(`${API}/42/media`, async ({ request }) => {
        container = Object.fromEntries(new URLSearchParams(await request.text()));
        log.push("container");
        return HttpResponse.json({ id: "R1", uri: `${UPLOAD}/R1` });
      }),
      http.post(`${UPLOAD}/R1`, async ({ request }) => {
        log.push(`upload ${(await request.arrayBuffer()).byteLength > 0}`);
        return HttpResponse.json({ success: true });
      }),
      http.post(`${API}/42/media_publish`, () => {
        log.push("publish");
        return HttpResponse.json({ id: "M9" });
      }),
      http.get(`${API}/:id`, ({ params }) => {
        if (params.id === "me")
          return HttpResponse.json({ user_id: "42", username: "bodybloom" });
        if (params.id === "M9")
          return HttpResponse.json({ id: "M9", permalink: "https://www.instagram.com/reel/xyz/" });
        const code = queue.shift() ?? "FINISHED";
        log.push(`status ${code}`);
        return HttpResponse.json({
          status_code: code,
          ...(code === "ERROR" ? { status: "Error: video too short" } : {}),
        });
      }),
    );
    return { log, container: () => container };
  }

  const deps = (): ReelDeps => {
    const env = {
      IG_ACCESS_TOKEN: "T",
      IG_USER_ID: "42",
      IG_API_BASE_URL: BASE,
      IG_TOKEN_STORE: "/nonexistent/t.json",
      CARD_OUTPUT_DIR: out,
    };
    let clock = 0;
    return {
      getContext: createContextFactory(env, { sleep: noSleep }),
      env,
      poll: { intervalMs: 5000, timeoutMs: 60_000, sleep: noSleep, now: () => (clock += 5000) },
    };
  };

  it("dry run checks everything but sends nothing", async () => {
    const { log } = fakes();
    const r = await runReelPublish(
      { video, caption: "Water 💧 #hydration", confirm: false },
      deps(),
    );
    expect(r).toMatchObject({
      mode: "dry_run",
      type: "reel",
      account: "@bodybloom",
      video: { width: 1080, height: 1920 },
      shareToFeed: true,
      ready: true,
    });
    expect(log).toEqual([]);
  });

  it("creates a resumable container, uploads directly, waits and publishes", async () => {
    const { log, container } = fakes();
    const steps: string[] = [];
    const r = await runReelPublish(
      {
        video,
        caption: "Reel!",
        confirm: true,
        thumbOffsetMs: 1000,
        onProgress: (m) => steps.push(m),
      },
      deps(),
    );
    expect(r).toEqual({
      mode: "published",
      type: "reel",
      mediaId: "M9",
      permalink: "https://www.instagram.com/reel/xyz/",
    });
    expect(container()).toMatchObject({
      media_type: "REELS",
      upload_type: "resumable",
      caption: "Reel!",
      share_to_feed: "true",
      thumb_offset: "1000",
    });
    expect(container()).not.toHaveProperty("video_url");
    expect(log).toEqual([
      "container",
      "upload true",
      "status IN_PROGRESS",
      "status FINISHED",
      "publish",
    ]);
    expect(steps[0]).toBe("Creating the Reel");
    expect(steps[1]).toMatch(/^Uploading the video \(0\.\d MB\)/);
    expect(steps.some((m) => /^Instagram is processing the video \(\d+ s\)$/.test(m))).toBe(true);
    expect(steps.at(-1)).toBe("Publishing");
  });

  it("publishes nothing when Instagram rejects the video", async () => {
    const { log } = fakes({ statuses: ["ERROR"] });
    await expect(runReelPublish({ video, caption: "x", confirm: true }, deps())).rejects.toThrow(
      /couldn't process the media.*video too short[\s\S]*Nothing was published/,
    );
    expect(log).not.toContain("publish");
  });

  it("stops before publishing when cancelled during processing", async () => {
    const { log } = fakes({ statuses: Array(5).fill("IN_PROGRESS") });
    const controller = new AbortController();
    const d = deps();
    let polls = 0;
    d.poll = { ...d.poll, sleep: async () => void (++polls === 2 && controller.abort()) };
    await expect(
      runReelPublish({ video, caption: "x", confirm: true, signal: controller.signal }, d),
    ).rejects.toThrow(/Cancelled while Instagram was processing[\s\S]*Nothing was published/);
    expect(log).not.toContain("publish");
  });

  it("refuses at the limit and rejects a cover past the end", async () => {
    fakes({ quotaUsed: 100 });
    await expect(runReelPublish({ video, caption: "x", confirm: true }, deps())).rejects.toThrow(
      /limit reached/,
    );
    await expect(
      runReelPublish({ video, caption: "x", confirm: false, thumbOffsetMs: 99_000 }, deps()),
    ).rejects.toThrow(/past the end/);
  });
});

describe("MCP reel tools", () => {
  it("render_reel returns a preview sheet and the MP4 details", async () => {
    const env = { CARD_OUTPUT_DIR: out, BRAND_HANDLE: "bodybloom" };
    const mcp = createServer(createContextFactory({}), {
      env,
      now: () => new Date("2026-11-05T10:00:00Z"),
    });
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(a), client.connect(b)]);
    const result = await client.callTool({
      name: "render_reel",
      arguments: {
        language: "en",
        name: "water",
        slides: [
          { template: "cover", seconds: 1.5, content: { title: "Drink more water" } },
          { template: "follow", seconds: 2, content: {} },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
    const [sheet, info] = result.content as { type: string; data?: string; text?: string }[];
    expect(sheet!.type).toBe("image");
    const meta = await sharp(Buffer.from(sheet!.data!, "base64")).metadata();
    expect(meta.height).toBeGreaterThan(meta.width! / 2);
    const body = JSON.parse(info!.text!);
    expect(body).toMatchObject({ path: path.join(out, "water-en.mp4"), width: 1080, height: 1920 });
    expect(body.duration).toBeCloseTo(3.1, 1);
    expect(body.warnings.join(" ")).toMatch(/Silent Reel/);
  }, 120_000);
});
