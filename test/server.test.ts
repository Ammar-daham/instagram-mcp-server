import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { http, HttpResponse } from "msw";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContextFactory } from "../src/context.js";
import { createServer, SERVER_NAME } from "../src/server.js";
import { API, BASE, noSleep, useMsw } from "./helpers.js";

const server = useMsw();

async function connect(env: NodeJS.ProcessEnv) {
  const mcp = createServer(createContextFactory(env, { sleep: noSleep }), {
    env,
    now: () => new Date("2026-11-03T10:20:30Z"),
  });
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(a), client.connect(b)]);
  return client;
}

const env = {
  IG_ACCESS_TOKEN: "T",
  IG_API_BASE_URL: BASE,
  IG_TOKEN_STORE: "/nonexistent/token.json",
};
const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[])[0]!.text;

describe("MCP server", () => {
  it("identifies itself and lists the tools", async () => {
    const client = await connect(env);
    expect(client.getServerVersion()?.name).toBe(SERVER_NAME);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "check_token",
      "create_and_publish_card_post",
      "delete_image",
      "get_account_info",
      "publish_carousel",
      "publish_post",
      "render_card",
      "suggest_hashtags",
      "upload_image",
    ]);
  });

  it("get_account_info returns the account", async () => {
    server.use(
      http.get(`${API}/me`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("fields")).toContain("followers_count");
        return HttpResponse.json({
          user_id: "42",
          username: "eatwell",
          followers_count: 1234,
          media_count: 56,
        });
      }),
    );
    const client = await connect(env);
    const result = await client.callTool({ name: "get_account_info", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toMatchObject({ username: "eatwell", followers_count: 1234 });
  });

  it("get_account_info warns when IG_USER_ID doesn't match", async () => {
    server.use(
      http.get(`${API}/me`, () => HttpResponse.json({ user_id: "42", username: "eatwell" })),
    );
    const client = await connect({ ...env, IG_USER_ID: "99" });
    const result = await client.callTool({ name: "get_account_info", arguments: {} });
    expect(JSON.parse(text(result)).warning).toMatch(/doesn't match/);
  });

  it("check_token reports the token status", async () => {
    server.use(
      http.get(`${API}/me`, () => HttpResponse.json({ user_id: "42", username: "eatwell" })),
    );
    const client = await connect(env);
    const result = await client.callTool({ name: "check_token", arguments: {} });
    expect(JSON.parse(text(result))).toMatchObject({
      valid: true,
      username: "eatwell",
      source: "env",
    });
  });

  it("returns a readable tool error when config is missing", async () => {
    const client = await connect({});
    const result = await client.callTool({ name: "get_account_info", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/IG_ACCESS_TOKEN is missing/);
  });

  it("get_account_info reads the account by ID with a Facebook-login token", async () => {
    server.use(
      http.get(`${BASE}/v24.0/17841400000000001`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("fields")).toBe(
          "id,username,name,followers_count,follows_count,media_count",
        );
        return HttpResponse.json({
          id: "17841400000000001",
          username: "body.blooms.ai",
          followers_count: 28,
        });
      }),
    );
    const client = await connect({
      ...env,
      IG_ACCESS_TOKEN: "EAAT",
      IG_USER_ID: "17841400000000001",
    });
    const result = await client.callTool({ name: "get_account_info", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({
      user_id: "17841400000000001",
      username: "body.blooms.ai",
      followers_count: 28,
    });
  });

  describe("render_card", () => {
    let outDir: string;
    beforeEach(async () => (outDir = await mkdtemp(path.join(tmpdir(), "ig-cards-"))));
    afterEach(() => rm(outDir, { recursive: true, force: true }));

    it("renders, saves the JPEG and returns a preview image", async () => {
      // No IG token needed: rendering is offline.
      const client = await connect({ CARD_OUTPUT_DIR: outDir, BRAND_HANDLE: "body.blooms.ai" });
      const result = await client.callTool({
        name: "render_card",
        arguments: {
          language: "en",
          template: "myth_fact",
          content: { myth: "Carbs are bad.", fact: "Fibre-rich carbs fuel you." },
        },
      });
      expect(result.isError).toBeFalsy();
      const [image, info] = result.content as [
        { type: string; data: string; mimeType: string },
        { type: string; text: string },
      ];
      expect(image).toMatchObject({ type: "image", mimeType: "image/jpeg" });
      expect((await sharp(Buffer.from(image.data, "base64")).metadata()).width).toBe(540);
      const meta = JSON.parse(info.text);
      expect(meta).toMatchObject({
        language: "en",
        template: "myth_fact",
        width: 1080,
        height: 1350,
      });
      expect(meta.path).toBe(path.join(outDir, "20261103T102030-myth-fact-en.jpg"));
      expect((await sharp(await readFile(meta.path)).metadata()).height).toBe(1350);
    });

    it("uses the given file name", async () => {
      const client = await connect({ CARD_OUTPUT_DIR: outDir });
      const result = await client.callTool({
        name: "render_card",
        arguments: { language: "en", template: "follow", content: {}, file_name: "end-slide" },
      });
      const info = (result.content as { text?: string }[])[1]!;
      expect(JSON.parse(info.text!).path).toBe(path.join(outDir, "end-slide.jpg"));
    });

    it("returns validation problems as a tool error", async () => {
      const client = await connect({ CARD_OUTPUT_DIR: outDir });
      const result = await client.callTool({
        name: "render_card",
        arguments: { language: "en", template: "tip", content: { title: "Hi" } },
      });
      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Invalid content for the "tip" card:\n- points:/);
    });

    it("renders Arabic cards", async () => {
      const client = await connect({ CARD_OUTPUT_DIR: outDir });
      const result = await client.callTool({
        name: "render_card",
        arguments: { language: "ar", template: "follow", content: {} },
      });
      expect(result.isError).toBeFalsy();
      const info = JSON.parse((result.content as { text?: string }[])[1]!.text!);
      expect(info).toMatchObject({ language: "ar", template: "follow" });
      expect(info.path).toBe(path.join(outDir, "20261103T102030-follow-ar.jpg"));
    });

    it("requires a language", async () => {
      const client = await connect({ CARD_OUTPUT_DIR: outDir });
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "render_card")!;
      expect(tool.inputSchema.required).toContain("language");
      expect(tool.description).toMatch(/LANGUAGE FIRST/);
      const result = await client.callTool({
        name: "render_card",
        arguments: { template: "follow", content: {} },
      });
      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/language/);
    });
  });

  describe("upload_image", () => {
    let outDir: string;
    beforeEach(async () => (outDir = await mkdtemp(path.join(tmpdir(), "ig-up-"))));
    afterEach(() => rm(outDir, { recursive: true, force: true }));

    const cloudEnv = () => ({
      CARD_OUTPUT_DIR: outDir,
      CLOUDINARY_URL: "cloudinary://k:s@demo",
      CLOUDINARY_API_BASE_URL: "https://cloudinary.test",
    });
    const publicUrl = "https://res.cloudinary.test/demo/image/upload/v1/instagram/end-slide.jpg";

    it("renders, uploads and verifies a card", async () => {
      server.use(
        http.post("https://cloudinary.test/v1_1/demo/image/upload", () =>
          HttpResponse.json({
            secure_url: publicUrl,
            public_id: "instagram/end-slide",
            bytes: 50000,
            width: 1080,
            height: 1350,
            format: "jpg",
          }),
        ),
        http.head(
          publicUrl,
          () => new HttpResponse(null, { headers: { "Content-Type": "image/jpeg" } }),
        ),
      );
      const client = await connect(cloudEnv());
      const rendered = await client.callTool({
        name: "render_card",
        arguments: { language: "en", template: "follow", content: {}, file_name: "end-slide" },
      });
      const { path: file } = JSON.parse((rendered.content as { text?: string }[])[1]!.text!);
      const result = await client.callTool({ name: "upload_image", arguments: { path: file } });
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(text(result))).toMatchObject({
        url: publicUrl,
        width: 1080,
        height: 1350,
        publiclyReachable: true,
      });
    });

    it("delete_image removes an uploaded card", async () => {
      server.use(
        http.post("https://cloudinary.test/v1_1/demo/image/destroy", async ({ request }) => {
          expect((await request.formData()).get("public_id")).toBe("instagram/end-slide");
          return HttpResponse.json({ result: "ok" });
        }),
      );
      const client = await connect(cloudEnv());
      const result = await client.callTool({
        name: "delete_image",
        arguments: { image: publicUrl },
      });
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(text(result))).toEqual({
        publicId: "instagram/end-slide",
        status: "deleted",
      });
    });

    it("explains missing Cloudinary settings", async () => {
      const client = await connect({ CARD_OUTPUT_DIR: outDir });
      const result = await client.callTool({
        name: "upload_image",
        arguments: { path: path.join(outDir, "x.jpg") },
      });
      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Cloudinary isn't configured/);
    });
  });
});
