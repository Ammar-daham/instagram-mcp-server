import { z } from "zod";

/** Code points the bundled Inter subsets (latin + latin-ext) can draw. */
const RENDERABLE: [number, number][] = [
  [0x0000, 0x024f],
  [0x0250, 0x02ff],
  [0x0300, 0x036f],
  [0x1d00, 0x1dbf],
  [0x1e00, 0x1eff],
  [0x2000, 0x206f],
  [0x20a0, 0x20c0],
  [0x2113, 0x2113],
  [0x2122, 0x2122],
  [0x2191, 0x2191],
  [0x2193, 0x2193],
  [0x2212, 0x2212],
  [0x2215, 0x2215],
  [0x2c60, 0x2c7f],
  [0xa720, 0xa7ff],
];

export function unsupportedChars(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (!RENDERABLE.some(([lo, hi]) => cp >= lo && cp <= hi)) bad.add(ch);
  }
  return [...bad];
}

/** A trimmed, length-limited string the card font can render. */
export function cardText(max: number) {
  return z
    .string()
    .trim()
    .min(1, "must not be empty")
    .max(max, `must be at most ${max} characters so it fits on the card`)
    .refine((s) => unsupportedChars(s).length === 0, {
      error: (issue) =>
        `contains characters the card font can't draw (${unsupportedChars(String(issue.input)).join(" ")}). Emoji and symbols belong in the caption, not on the card.`,
    });
}

export const slideField = z
  .string()
  .regex(/^\d{1,2}\/\d{1,2}$/, 'must look like "2/7"')
  .optional()
  .describe('Slide counter for carousels, e.g. "2/7"');
