import { describe, expect, it } from "vitest";
import { cleanFileName } from "../src/tools/names.js";

describe("cleanFileName", () => {
  it.each([
    ["vitamin-d-fun", "vitamin-d-fun"],
    ['"vitamin-d-fun"', "vitamin-d-fun"],
    ["'vitamin-d-fun'", "vitamin-d-fun"],
    ["  Vitamin D Fun  ", "vitamin-d-fun"],
    ["vitamin_d_fun.mp4", "vitamin-d-fun"],
    ["Fibre Tips.JPG", "fibre-tips"],
    ["../../etc/passwd", "etc-passwd"],
    ["a--b__c", "a-b-c"],
    ["فيتامين د", undefined],
    ["", undefined],
    [undefined, undefined],
    ["---", undefined],
  ])("%j → %j", (input, expected) => {
    expect(cleanFileName(input)).toBe(expected);
  });

  it("caps the length without a trailing dash", () => {
    const name = cleanFileName(`${"a".repeat(40)} b`)!;
    expect(name.length).toBeLessThanOrEqual(41);
    expect(name.endsWith("-")).toBe(false);
  });
});
