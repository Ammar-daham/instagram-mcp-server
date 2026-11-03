import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";
import { PROJECT_ROOT } from "../src/paths.js";

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig({ IG_ACCESS_TOKEN: " abc " });
    expect(config).toEqual({
      accessToken: "abc",
      userId: undefined,
      apiVersion: "v24.0",
      baseUrl: "https://graph.instagram.com",
      tokenStorePath: path.join(PROJECT_ROOT, ".tokens/token.json"),
    });
  });

  it("explains a missing token", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ IG_ACCESS_TOKEN: "" })).toThrow(/IG_ACCESS_TOKEN is missing/);
  });

  it("treats empty values as unset and validates the rest", () => {
    expect(loadConfig({ IG_ACCESS_TOKEN: "t", IG_USER_ID: "" }).userId).toBeUndefined();
    expect(() => loadConfig({ IG_ACCESS_TOKEN: "t", IG_USER_ID: "abc" })).toThrow(/digits only/);
    expect(() => loadConfig({ IG_ACCESS_TOKEN: "t", IG_API_VERSION: "24" })).toThrow(/v24\.0/);
  });

  it("strips a trailing slash from the base URL", () => {
    expect(loadConfig({ IG_ACCESS_TOKEN: "t", IG_API_BASE_URL: "https://x.test/" }).baseUrl).toBe(
      "https://x.test",
    );
  });
});
