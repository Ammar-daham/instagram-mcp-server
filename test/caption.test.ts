import { describe, expect, it } from "vitest";
import { captionStats, validateCaption } from "../src/content/caption.js";

describe("caption", () => {
  it("counts characters, hashtags and mentions (Arabic included)", () => {
    expect(
      captionStats(
        "High protein 💪 breakfast! #protein #تغذية_صحية Follow @body.blooms.ai email a@b.com",
      ),
    ).toEqual({
      characters: 83,
      hashtags: ["#protein", "#تغذية_صحية"],
      mentions: ["@body.blooms.ai"],
    });
  });

  it("ignores # inside words and URLs fragments like page#x", () => {
    expect(captionStats("page#x C# #ok").hashtags).toEqual(["#ok"]);
  });

  it("accepts captions within the limits", () => {
    expect(validateCaption(`Tip ${"#a ".repeat(30)}`).hashtags).toHaveLength(30);
  });

  it("lists every broken limit", () => {
    const tooLong = "x".repeat(2201);
    expect(() => validateCaption(tooLong)).toThrow(/2201 characters \(max 2200\); shorten it by 1/);
    expect(() => validateCaption("#a ".repeat(31))).toThrow(/31 hashtags \(max 30\)/);
    expect(() => validateCaption("@a ".repeat(21))).toThrow(/21 @mentions \(max 20\)/);
    expect(() => validateCaption("   ")).toThrow(/empty/);
  });
});
