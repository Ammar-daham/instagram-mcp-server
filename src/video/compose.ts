/** Turn card slides into Reel segments: timing per template and "reveal" for tip cards. */
import { renderCardPng } from "../cards/render.js";
import type { Language } from "../cards/locale.js";
import type { TemplateName } from "../cards/templates/index.js";
import type { Theme } from "../cards/theme.js";
import { reelFrame } from "./frames.js";
import type { Segment } from "./reel.js";

export interface ReelSlide {
  template: TemplateName;
  content: Record<string, unknown>;
  seconds?: number;
  /** tip cards only: show the points one at a time. */
  reveal?: boolean;
}

/** Seconds per slide when not given: short hook and end, more time for dense cards. */
export const DEFAULT_SECONDS: Record<TemplateName, number> = {
  cover: 2.5,
  tip: 3.5,
  macros: 3.5,
  myth_fact: 4,
  recipe: 4.5,
  follow: 2.5,
};

export interface ComposedReel {
  segments: Segment[];
  /** Final frame of each slide (for previews and the contact sheet). */
  slideFrames: Buffer[];
}

export async function composeReel(
  slides: ReelSlide[],
  theme: Theme,
  language: Language,
): Promise<ComposedReel> {
  const segments: Segment[] = [];
  const slideFrames: Buffer[] = [];
  for (const [i, slide] of slides.entries()) {
    const seconds = slide.seconds ?? DEFAULT_SECONDS[slide.template];
    const render = async (content: Record<string, unknown>) =>
      reelFrame(await renderCardPng(slide.template, content, theme, language));
    const points = slide.content.points;
    const label = (e: unknown) => new Error(`Slide ${i + 1}: ${(e as Error).message}`);

    if (slide.reveal && slide.template === "tip" && Array.isArray(points) && points.length > 1) {
      // Step k shows the first k points. First step a bit longer (title + point 1).
      const steps = points.length;
      const first = 1.6;
      const each = 1.2;
      const lastExtra = Math.max(0, seconds - first - each * (steps - 1));
      for (let k = 1; k <= steps; k++) {
        const image = await render({ ...slide.content, points: points.slice(0, k) }).catch((e) => {
          throw label(e);
        });
        segments.push({
          image,
          seconds: k === 1 ? first : k === steps ? Math.max(2, each + lastExtra) : each,
          transition: k === 1 ? "fade" : "cut",
          zoom: false,
        });
        if (k === steps) slideFrames.push(image);
      }
      continue;
    }
    if (slide.reveal) {
      throw label(new Error("reveal only works on tip cards with 2+ points."));
    }
    const image = await render(slide.content).catch((e) => {
      throw label(e);
    });
    segments.push({ image, seconds, transition: "fade", zoom: true });
    slideFrames.push(image);
  }
  return { segments, slideFrames };
}
