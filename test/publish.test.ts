import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { http, HttpResponse } from "msw";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContextFactory } from "../src/context.js";
import { runPublish, type FlowDeps } from "../src/publishing/flow.js";
import { createServer } from "../src/server.js";
import { API, BASE, noSleep, useMsw } from "./helpers.js";

const server = useMsw();
const CLOUD_API = "https://cloudinary.test";
const CDN = "https://res.cloudinary.test/demo/image/upload/v1";

/** Fake Instagram + Cloudinary that record every call. */
function fakes(options: { statuses?: string[]; quotaUsed?: number; publishFails?: boolean } = {}) {
  const log: string[] = [];
  const containers: Record<string, Record<string, string>> = {};
  const statusQueue = [...(options.statuses ?? [])];
  let n = 0;
  let published = false;

  server.use(
    http.get(`${API}/42/content_publishing_limit`, () =>
      HttpResponse.json({
        data: [{ quota_usage: options.quotaUsed ?? 3, config: { quota_total: 100 } }],
      }),
    ),
    http.post(`${API}/42/media`, async ({ request }) => {
      const body = Object.fromEntries(new URLSearchParams(await request.text()));
      const id = `C${++n}`;
      containers[id] = body;
      log.push(`container ${id} ${body.media_type ?? (body.is_carousel_item ? "item" : "image")}`);
      return HttpResponse.json({ id });
    }),
    http.post(`${API}/42/media_publish`, async ({ request }) => {
      const body = new URLSearchParams(await request.text());
      log.push(`publish ${body.get("creation_id")}`);
      published = true;
      if (options.publishFails) {
        return HttpResponse.json({ error: { message: "Timeout", code: 2 } }, { status: 500 });
      }
      return HttpResponse.json({ id: "M1" });
    }),
    http.get(`${API}/42/media`, () => HttpResponse.json({ data: [{ id: "M1" }] })),
    http.get(`${API}/:id`, ({ params }) => {
      const id = String(params.id);
      if (id === "me") return HttpResponse.json({ user_id: "42", username: "body.blooms.ai" });
      if (id === "M1") {
        return HttpResponse.json({
          id: "M1",
          permalink: "https://www.instagram.com/p/abc/",
          timestamp: "2026-11-04T09:00:00+0000",
        });
      }
      const code =
        statusQueue.shift() ?? (published && options.publishFails ? "PUBLISHED" : "FINISHED");
      log.push(`status ${id} ${code}`);
      return HttpResponse.json({
        status_code: code,
        ...(code === "ERROR" ? { status: "Error: Media download has failed." } : {}),
      });
    }),
    http.post(`${CLOUD_API}/v1_1/demo/image/upload`, async ({ request }) => {
      const form = await request.formData();
      const id = `${form.get("folder")}/${form.get("public_id")}`;
      log.push(`upload ${id}`);
      return HttpResponse.json({
        secure_url: `${CDN}/${id}.jpg`,
        public_id: id,
        bytes: 1,
        width: 1080,
        height: 1350,
        format: "jpg",
      });
    }),
    http.post(`${CLOUD_API}/v1_1/demo/image/destroy`, async ({ request }) => {
      log.push(`delete ${(await request.formData()).get("public_id")}`);
      return HttpResponse.json({ result: "ok" });
    }),
  );
  return { log, containers };
}

let outDir: string;
let env: NodeJS.ProcessEnv;
let deps: FlowDeps;
const card = (name: string) => path.join(outDir, name);

beforeEach(async () => {
  outDir = await mkdtemp(path.join(tmpdir(), "ig-pub-"));
  const jpeg = await sharp({
    create: { width: 1080, height: 1350, channels: 3, background: "#2E7D5B" },
  })
    .jpeg()
    .toBuffer();
  for (const name of ["a.jpg", "b.jpg", "c.jpg"]) await writeFile(card(name), jpeg);
  await writeFile(
    card("wide.jpg"),
    await sharp({ create: { width: 1080, height: 400, channels: 3, background: "#fff" } })
      .jpeg()
      .toBuffer(),
  );
  env = {
    IG_ACCESS_TOKEN: "T",
    IG_USER_ID: "42",
    IG_API_BASE_URL: BASE,
    IG_TOKEN_STORE: "/nonexistent/token.json",
    CARD_OUTPUT_DIR: outDir,
    CLOUDINARY_URL: "cloudinary://k:s@demo",
    CLOUDINARY_API_BASE_URL: CLOUD_API,
  };
  let clock = 0;
  deps = {
    getContext: createContextFactory(env, { sleep: noSleep }),
    env,
    poll: { intervalMs: 1000, timeoutMs: 5000, sleep: noSleep, now: () => (clock += 1000) },
    hosting: { sleep: noSleep },
    randomSuffix: () => "r4nd",
  };
});
afterEach(() => rm(outDir, { recursive: true, force: true }));

describe("dry run", () => {
  it("validates everything but uploads and posts nothing", async () => {
    const { log } = fakes();
    const result = await runPublish(
      { images: [card("a.jpg")], caption: "Drink water 💧 #hydration", confirm: false },
      deps,
    );
    expect(result).toMatchObject({
      mode: "dry_run",
      type: "post",
      account: "@body.blooms.ai",
      caption: { characters: 24, hashtags: ["#hydration"] },
      images: [{ kind: "local", width: 1080, height: 1350 }],
      publishingLimit: { used: 3, total: 100, remaining: 97 },
      ready: true,
      problems: [],
    });
    expect(log).toEqual([]);
  });

  it("reports blockers: limit reached and missing hosting", async () => {
    fakes({ quotaUsed: 100 });
    const result = await runPublish(
      { images: [card("a.jpg")], caption: "Hi", confirm: false },
      { ...deps, env: { ...env, CLOUDINARY_URL: "" } },
    );
    expect(result).toMatchObject({ ready: false });
    expect(result.mode === "dry_run" && result.problems.join("\n")).toMatch(
      /Publishing limit reached: 100\/100[\s\S]*Cloudinary isn't configured/,
    );
  });

  it("rejects bad inputs before calling anything", async () => {
    fakes();
    await expect(
      runPublish({ images: [card("wide.jpg")], caption: "Hi", confirm: false }, deps),
    ).rejects.toThrow(/1080×400.*between 4:5 and 1.91:1/);
    await expect(
      runPublish({ images: ["http://x.test/a.jpg"], caption: "Hi", confirm: false }, deps),
    ).rejects.toThrow(/must use https/);
    await expect(
      runPublish({ images: [card("a.jpg")], caption: "#a ".repeat(31), confirm: false }, deps),
    ).rejects.toThrow(/31 hashtags/);
    await expect(
      runPublish({ images: Array(11).fill(card("a.jpg")), caption: "Hi", confirm: false }, deps),
    ).rejects.toThrow(/2-10 images/);
  });
});

describe("publishing", () => {
  it("uploads, publishes a single image, then deletes the upload", async () => {
    const { log, containers } = fakes({ statuses: ["IN_PROGRESS", "FINISHED"] });
    const result = await runPublish(
      { images: [card("a.jpg")], caption: "Drink water #hydration", confirm: true },
      deps,
    );
    expect(result).toEqual({
      mode: "published",
      type: "post",
      mediaId: "M1",
      permalink: "https://www.instagram.com/p/abc/",
      timestamp: "2026-11-04T09:00:00+0000",
      deleted: ["instagram/a-r4nd"],
      leftOnCloudinary: [],
    });
    expect(log).toEqual([
      "upload instagram/a-r4nd",
      "container C1 image",
      "status C1 IN_PROGRESS",
      "status C1 FINISHED",
      "publish C1",
      "delete instagram/a-r4nd",
    ]);
    expect(containers.C1).toMatchObject({
      image_url: `${CDN}/instagram/a-r4nd.jpg`,
      caption: "Drink water #hydration",
    });
  });

  it("publishes a carousel in order and deletes every slide", async () => {
    const { log, containers } = fakes();
    const result = await runPublish(
      { images: [card("a.jpg"), card("b.jpg"), card("c.jpg")], caption: "Carousel", confirm: true },
      deps,
    );
    expect(result).toMatchObject({ type: "carousel", mediaId: "M1" });
    expect(containers.C4).toEqual({
      media_type: "CAROUSEL",
      children: "C1,C2,C3",
      caption: "Carousel",
      access_token: "T",
    });
    expect(containers.C1).not.toHaveProperty("caption");
    expect(containers.C1).toMatchObject({ is_carousel_item: "true" });
    expect(log.filter((l) => l.startsWith("delete"))).toEqual([
      "delete instagram/a-r4nd",
      "delete instagram/b-r4nd",
      "delete instagram/c-r4nd",
    ]);
    expect(log.indexOf("publish C4")).toBeLessThan(log.indexOf("delete instagram/a-r4nd"));
  });

  it("keeps uploads when asked", async () => {
    const { log } = fakes();
    const result = await runPublish(
      { images: [card("a.jpg")], caption: "Hi", confirm: true, keepUploads: true },
      deps,
    );
    expect(result).toMatchObject({ deleted: [], leftOnCloudinary: ["instagram/a-r4nd"] });
    expect(log.some((l) => l.startsWith("delete"))).toBe(false);
  });

  it("publishes https URLs as given, deleting only this server's own uploads", async () => {
    const { log } = fakes();
    await runPublish(
      {
        images: [`${CDN}/instagram/old.jpg`, "https://example.test/photo.jpg"],
        caption: "Hi",
        confirm: true,
      },
      deps,
    );
    expect(log.filter((l) => /upload|delete/.test(l))).toEqual(["delete instagram/old"]);
  });

  it("on a container ERROR: publishes nothing and deletes the uploads", async () => {
    const { log } = fakes({ statuses: ["ERROR"] });
    await expect(
      runPublish({ images: [card("a.jpg")], caption: "Hi", confirm: true }, deps),
    ).rejects.toThrow(
      /couldn't process the media.*Media download has failed[\s\S]*Nothing was published\. The uploaded images were deleted again\./,
    );
    expect(log).not.toContain("publish C1");
    expect(log).toContain("delete instagram/a-r4nd");
  });

  it("times out without publishing", async () => {
    const { log } = fakes({ statuses: Array(20).fill("IN_PROGRESS") });
    await expect(
      runPublish({ images: [card("a.jpg")], caption: "Hi", confirm: true }, deps),
    ).rejects.toThrow(/still processing the media after 5 s[\s\S]*Nothing was published/);
    expect(log.some((l) => l.startsWith("publish"))).toBe(false);
    expect(log).toContain("delete instagram/a-r4nd");
  });

  it("refuses when the publishing limit is reached, before uploading", async () => {
    const { log } = fakes({ quotaUsed: 100 });
    await expect(
      runPublish({ images: [card("a.jpg")], caption: "Hi", confirm: true }, deps),
    ).rejects.toThrow(/Publishing limit reached/);
    expect(log).toEqual([]);
  });

  it("doesn't double-post when media_publish errors but Instagram published", async () => {
    const { log } = fakes({ publishFails: true });
    const result = await runPublish(
      { images: [card("a.jpg")], caption: "Hi", confirm: true },
      { ...deps, getContext: createContextFactory(env, { sleep: noSleep, maxRetries: 0 }) },
    );
    expect(result).toMatchObject({ mode: "published", mediaId: "M1" });
    expect(log.filter((l) => l.startsWith("publish"))).toHaveLength(1);
  });

  it("reports each step", async () => {
    fakes();
    const steps: string[] = [];
    await runPublish(
      {
        images: [card("a.jpg"), card("b.jpg")],
        caption: "Hi",
        confirm: true,
        onProgress: (m) => steps.push(m),
      },
      deps,
    );
    expect(steps).toEqual([
      "Uploading image 1/2",
      "Uploading image 2/2",
      "Instagram is processing slide 1/2",
      "Instagram is processing slide 2/2",
      "Creating the carousel",
      "Waiting for Instagram to finish processing",
      "Publishing",
      "Published. Deleting the uploaded images",
    ]);
  });

  it("stops before publishing when cancelled, and deletes the uploads", async () => {
    const { log } = fakes({ statuses: ["IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS"] });
    const controller = new AbortController();
    let polls = 0;
    const result = runPublish(
      { images: [card("a.jpg")], caption: "Hi", confirm: true, signal: controller.signal },
      {
        ...deps,
        poll: {
          ...deps.poll,
          // The client gives up while Instagram is still processing.
          sleep: async () => {
            if (++polls === 2) controller.abort();
          },
        },
      },
    );
    await expect(result).rejects.toThrow(
      /Cancelled while Instagram was processing[\s\S]*Nothing was published\. The uploaded images were deleted again/,
    );
    expect(log.some((l) => l.startsWith("publish"))).toBe(false);
    expect(log).toContain("delete instagram/a-r4nd");
  });

  it("does nothing when already cancelled", async () => {
    const { log } = fakes();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runPublish(
        { images: [card("a.jpg")], caption: "Hi", confirm: true, signal: controller.signal },
        deps,
      ),
    ).rejects.toThrow(/cancelled \(or timed out\) before publishing[\s\S]*Nothing was published/);
    expect(log).toEqual([]);
  });

  it("reports uploads it couldn't delete", async () => {
    fakes();
    server.use(
      http.post(`${CLOUD_API}/v1_1/demo/image/destroy`, () =>
        HttpResponse.json({ error: { message: "down" } }, { status: 401 }),
      ),
    );
    const result = await runPublish(
      { images: [card("a.jpg")], caption: "Hi", confirm: true },
      deps,
    );
    expect(result).toMatchObject({
      mode: "published",
      deleted: [],
      leftOnCloudinary: ["instagram/a-r4nd"],
    });
  });
});

describe("MCP tools", () => {
  async function connect() {
    const mcp = createServer(deps.getContext, {
      ...deps,
      now: () => new Date("2026-11-04T09:00:00Z"),
    });
    const client = new Client({ name: "test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(a), client.connect(b)]);
    return client;
  }
  const parts = (r: Awaited<ReturnType<Client["callTool"]>>) =>
    r.content as { type: string; text?: string; data?: string }[];

  it("lists the publishing tools", async () => {
    const { tools } = await (await connect()).listTools();
    for (const name of ["publish_post", "publish_carousel", "create_and_publish_card_post"]) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.description).toMatch(
        /Only set confirm: true after the user has explicitly approved/,
      );
    }
  });

  it("publish_post defaults to a dry run", async () => {
    const { log } = fakes();
    const client = await connect();
    const result = await client.callTool({
      name: "publish_post",
      arguments: { image: card("a.jpg"), caption: "Hi" },
    });
    expect(JSON.parse(parts(result)[0]!.text!)).toMatchObject({ mode: "dry_run", ready: true });
    expect(log).toEqual([]);
  });

  it("create_and_publish_card_post previews every slide, then publishes on confirm", async () => {
    const { log } = fakes();
    const client = await connect();
    const args = {
      language: "ar",
      name: "water",
      caption: "اشرب الماء #تغذية_صحية",
      cards: [
        { template: "cover", content: { title: "اشرب المزيد من الماء" } },
        { template: "follow", content: {} },
      ],
    };
    const dry = await client.callTool({ name: "create_and_publish_card_post", arguments: args });
    expect(dry.isError).toBeFalsy();
    const [preview, summary] = parts(dry);
    expect(preview!.type).toBe("image");
    expect((await sharp(Buffer.from(preview!.data!, "base64")).metadata()).width).toBe(
      2 * 270 + 3 * 12,
    );
    const info = JSON.parse(summary!.text!);
    expect(info).toMatchObject({ mode: "dry_run", type: "carousel" });
    expect(info.files).toEqual([card("water-ar-1.jpg"), card("water-ar-2.jpg")]);
    expect(log).toEqual([]);

    const live = await client.callTool({
      name: "create_and_publish_card_post",
      arguments: { ...args, confirm: true },
    });
    expect(live.isError).toBeFalsy();
    expect(JSON.parse(parts(live)[0]!.text!)).toMatchObject({
      mode: "published",
      type: "carousel",
      permalink: "https://www.instagram.com/p/abc/",
      deleted: ["instagram/water-ar-1-r4nd", "instagram/water-ar-2-r4nd"],
    });
  });

  it("sends progress notifications, so clients don't time out", async () => {
    fakes();
    const client = await connect();
    const messages: string[] = [];
    const result = await client.callTool(
      {
        name: "create_and_publish_card_post",
        arguments: {
          language: "en",
          caption: "Hi",
          confirm: true,
          cards: [
            { template: "follow", content: {} },
            { template: "follow", content: {} },
          ],
        },
      },
      undefined,
      { onprogress: (p) => messages.push(p.message ?? ""), resetTimeoutOnProgress: true },
    );
    expect(result.isError).toBeFalsy();
    expect(messages.slice(0, 3)).toEqual([
      "Rendering slide 1/2",
      "Rendering slide 2/2",
      "Uploading image 1/2",
    ]);
    expect(messages).toContain("Publishing");
  });

  it("names the slide with invalid content", async () => {
    fakes();
    const client = await connect();
    const result = await client.callTool({
      name: "create_and_publish_card_post",
      arguments: {
        language: "en",
        caption: "Hi",
        cards: [
          { template: "follow", content: {} },
          { template: "tip", content: { title: "x" } },
        ],
      },
    });
    expect(result.isError).toBe(true);
    expect(parts(result)[0]!.text).toMatch(/^Slide 2: Invalid content for the "tip" card/);
  });
});
