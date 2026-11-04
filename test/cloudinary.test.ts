import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { http, HttpResponse } from "msw";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteImage,
  HostingError,
  publicIdFromUrl,
  loadCloudinaryConfig,
  signParams,
  uploadImage,
  verifyPublicUrl,
  type CloudinaryConfig,
} from "../src/hosting/cloudinary.js";
import { PROJECT_ROOT } from "../src/paths.js";
import { noSleep, useMsw } from "./helpers.js";

const server = useMsw();
const API = "https://cloudinary.test";
const UPLOAD = `${API}/v1_1/demo/image/upload`;

let dir: string;
let outDir: string;
let config: CloudinaryConfig;
let jpegPath: string;

const jpeg = () =>
  sharp({ create: { width: 4, height: 5, channels: 3, background: "#2E7D5B" } })
    .jpeg()
    .toBuffer();

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ig-upload-"));
  outDir = path.join(dir, "out");
  await mkdir(outDir);
  jpegPath = path.join(outDir, "fibre tips (ar).jpg");
  await writeFile(jpegPath, await jpeg());
  config = {
    cloudName: "demo",
    apiKey: "key123",
    apiSecret: "secret456",
    folder: "instagram",
    allowedDirs: [outDir],
    apiBaseUrl: API,
  };
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("loadCloudinaryConfig", () => {
  it("reads the three variables, with defaults", () => {
    const c = loadCloudinaryConfig({
      CLOUDINARY_CLOUD_NAME: "demo",
      CLOUDINARY_API_KEY: "k",
      CLOUDINARY_API_SECRET: "s",
    });
    expect(c).toEqual({
      cloudName: "demo",
      apiKey: "k",
      apiSecret: "s",
      folder: "instagram",
      allowedDirs: [path.join(PROJECT_ROOT, "out")],
      apiBaseUrl: "https://api.cloudinary.com",
    });
  });

  it("reads CLOUDINARY_URL and extra upload folders", () => {
    const c = loadCloudinaryConfig({
      CLOUDINARY_URL: "cloudinary://k:s@demo",
      CARD_OUTPUT_DIR: "/tmp/cards",
      UPLOAD_ALLOWED_DIRS: "/photos, assets",
      CLOUDINARY_FOLDER: "ig/cards",
    });
    expect(c).toMatchObject({ cloudName: "demo", apiKey: "k", apiSecret: "s", folder: "ig/cards" });
    expect(c.allowedDirs).toEqual(["/tmp/cards", "/photos", path.join(PROJECT_ROOT, "assets")]);
  });

  it("explains what is missing or malformed", () => {
    expect(() => loadCloudinaryConfig({ CLOUDINARY_CLOUD_NAME: "demo" })).toThrow(
      /set CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET \(or CLOUDINARY_URL\)/,
    );
    expect(() => loadCloudinaryConfig({ CLOUDINARY_URL: "https://x" })).toThrow(
      /cloudinary:\/\/<api_key>/,
    );
  });
});

describe("signParams", () => {
  it("matches Cloudinary's documented example", () => {
    // https://cloudinary.com/documentation/authentication_signatures
    expect(
      signParams(
        {
          timestamp: "1315060510",
          public_id: "sample_image",
          eager: "w_400,h_300,c_pad|w_260,h_200,c_crop",
        },
        "abcd",
      ),
    ).toBe("bfd09f95f331f558cbd1320e67aa8d488770583e");
  });
});

describe("uploadImage", () => {
  const ok = (overrides = {}) =>
    HttpResponse.json({
      secure_url: "https://res.cloudinary.com/demo/image/upload/v1/instagram/x.jpg",
      public_id: "instagram/x",
      bytes: 1234,
      width: 1080,
      height: 1350,
      format: "jpg",
      ...overrides,
    });

  it("sends a signed multipart upload and returns the public URL", async () => {
    let form: FormData | undefined;
    server.use(
      http.post(UPLOAD, async ({ request }) => {
        form = await request.formData();
        return ok();
      }),
    );
    const now = () => new Date("2026-11-04T08:00:00Z");
    const result = await uploadImage(jpegPath, config, { now });

    expect(result).toEqual({
      url: "https://res.cloudinary.com/demo/image/upload/v1/instagram/x.jpg",
      publicId: "instagram/x",
      bytes: 1234,
      width: 1080,
      height: 1350,
      format: "jpg",
    });
    const sent = Object.fromEntries([...form!.entries()].filter(([k]) => k !== "file"));
    const signed = {
      folder: "instagram",
      overwrite: "true",
      public_id: "fibre-tips-ar-",
      timestamp: String(Date.parse("2026-11-04T08:00:00Z") / 1000),
    };
    expect(sent).toEqual({
      ...signed,
      api_key: "key123",
      signature: signParams(signed, "secret456"),
    });
    expect(sent).not.toHaveProperty("api_secret");
    const file = form!.get("file") as File;
    expect(file.type).toBe("image/jpeg");
    expect(file.size).toBeGreaterThan(0);
  });

  it("uses a given public id", async () => {
    let publicId: unknown = null;
    server.use(
      http.post(UPLOAD, async ({ request }) => {
        publicId = (await request.formData()).get("public_id");
        return ok();
      }),
    );
    await uploadImage(jpegPath, config, { publicId: "slide-1" });
    expect(publicId).toBe("slide-1");
  });

  it("maps credential errors", async () => {
    server.use(
      http.post(UPLOAD, () =>
        HttpResponse.json({ error: { message: "Invalid Signature" } }, { status: 401 }),
      ),
    );
    await expect(uploadImage(jpegPath, config)).rejects.toThrow(
      /rejected the credentials.*Invalid Signature/,
    );
  });

  it("retries server errors", async () => {
    let calls = 0;
    server.use(
      http.post(UPLOAD, () => (++calls < 2 ? new HttpResponse(null, { status: 503 }) : ok())),
    );
    const sleep = vi.fn(noSleep);
    await expect(uploadImage(jpegPath, config, { sleep })).resolves.toMatchObject({
      format: "jpg",
    });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("refuses files outside the allowed folders, including via symlinks", async () => {
    const outside = path.join(dir, "secret.jpg");
    await writeFile(outside, await jpeg());
    await expect(uploadImage(outside, config)).rejects.toThrow(/Refusing to upload/);
    const link = path.join(outDir, "link.jpg");
    await symlink(outside, link);
    await expect(uploadImage(link, config)).rejects.toThrow(/Refusing to upload/);
  });

  it("refuses non-JPEG, missing and oversized files", async () => {
    const png = path.join(outDir, "card.png");
    await writeFile(
      png,
      await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } })
        .png()
        .toBuffer(),
    );
    await expect(uploadImage(png, config)).rejects.toThrow(/isn't a JPEG/);

    const fake = path.join(outDir, "notes.jpg");
    await writeFile(fake, "IG_ACCESS_TOKEN=secret");
    await expect(uploadImage(fake, config)).rejects.toThrow(/isn't a JPEG/);

    await expect(uploadImage(path.join(outDir, "nope.jpg"), config)).rejects.toThrow(
      /File not found/,
    );

    const big = path.join(outDir, "big.jpg");
    await writeFile(
      big,
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(8 * 1024 * 1024)]),
    );
    await expect(uploadImage(big, config)).rejects.toThrow(/up to 8 MB/);
  });

  it("is a HostingError", async () => {
    await expect(uploadImage("/nope.jpg", config)).rejects.toBeInstanceOf(HostingError);
  });
});

describe("verifyPublicUrl", () => {
  const url = "https://res.cloudinary.com/demo/image/upload/v1/instagram/x.jpg";

  it("accepts a public JPEG", async () => {
    server.use(
      http.head(url, () => new HttpResponse(null, { headers: { "Content-Type": "image/jpeg" } })),
    );
    await expect(verifyPublicUrl(url)).resolves.toEqual({
      ok: true,
      status: 200,
      contentType: "image/jpeg",
    });
  });

  it("flags missing or non-JPEG responses", async () => {
    server.use(http.head(url, () => new HttpResponse(null, { status: 404 })));
    await expect(verifyPublicUrl(url)).resolves.toMatchObject({ ok: false, status: 404 });
  });
});

describe("publicIdFromUrl", () => {
  it.each([
    ["https://res.cloudinary.com/demo/image/upload/v1730700000/instagram/tip.jpg", "instagram/tip"],
    ["https://res.cloudinary.com/demo/image/upload/instagram/cards/a-b.jpg", "instagram/cards/a-b"],
    ["https://res.cloudinary.com/demo/image/upload/w_540/v1/instagram/x.jpg", "instagram/x"],
  ])("%s → %s", (url, id) => {
    expect(publicIdFromUrl(url, "demo")).toBe(id);
  });

  it("rejects other clouds and non-image URLs", () => {
    expect(
      publicIdFromUrl("https://res.cloudinary.com/other/image/upload/v1/instagram/x.jpg", "demo"),
    ).toBeUndefined();
    expect(publicIdFromUrl("https://example.com/x.jpg", "demo")).toBeUndefined();
    expect(publicIdFromUrl("not a url", "demo")).toBeUndefined();
  });
});

describe("deleteImage", () => {
  const DESTROY = `${API}/v1_1/demo/image/destroy`;

  it("sends a signed destroy request that purges the CDN", async () => {
    let form: FormData | undefined;
    server.use(
      http.post(DESTROY, async ({ request }) => {
        form = await request.formData();
        return HttpResponse.json({ result: "ok" });
      }),
    );
    const now = () => new Date("2026-11-04T08:00:00Z");
    await expect(
      deleteImage("https://res.cloudinary.com/demo/image/upload/v17/instagram/tip.jpg", config, {
        now,
      }),
    ).resolves.toEqual({ publicId: "instagram/tip", status: "deleted" });
    const signed = {
      invalidate: "true",
      public_id: "instagram/tip",
      timestamp: String(Date.parse("2026-11-04T08:00:00Z") / 1000),
    };
    expect(Object.fromEntries(form!.entries())).toEqual({
      ...signed,
      api_key: "key123",
      signature: signParams(signed, "secret456"),
    });
  });

  it("accepts a public id and reports images that are already gone", async () => {
    server.use(http.post(DESTROY, () => HttpResponse.json({ result: "not found" })));
    await expect(deleteImage("instagram/tip", config)).resolves.toEqual({
      publicId: "instagram/tip",
      status: "not found",
    });
  });

  it("only deletes images in the configured folder", async () => {
    await expect(deleteImage("profile/photo", config)).rejects.toThrow(
      /only images in the "instagram\/" folder/,
    );
    await expect(deleteImage("instagram/../profile/photo", config)).rejects.toThrow(/Refusing/);
    await expect(
      deleteImage("https://res.cloudinary.com/other/image/upload/v1/instagram/x.jpg", config),
    ).rejects.toThrow(/isn't an image URL of the Cloudinary cloud "demo"/);
  });

  it("maps errors and retries server errors", async () => {
    let calls = 0;
    server.use(
      http.post(DESTROY, () =>
        ++calls < 2
          ? new HttpResponse(null, { status: 502 })
          : HttpResponse.json({ error: { message: "Invalid Signature" } }, { status: 401 }),
      ),
    );
    await expect(deleteImage("instagram/tip", config, { sleep: noSleep })).rejects.toThrow(
      /rejected the credentials.*Invalid Signature/,
    );
    expect(calls).toBe(2);
  });
});
