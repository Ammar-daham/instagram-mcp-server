import { describe, expect, it } from "vitest";
import { SERVER_NAME } from "../src/index.js";

describe("project setup", () => {
  it("exports the server name", () => {
    expect(SERVER_NAME).toBe("instagram-nutrition-mcp");
  });
});
