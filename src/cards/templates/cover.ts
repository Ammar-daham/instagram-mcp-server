import { z } from "zod";
import { div } from "../element.js";
import { column, frame, pill } from "../layout.js";
import { cardText, slideField } from "../text.js";
import type { Theme } from "../theme.js";

export const coverSchema = z.strictObject({
  title: cardText(70).describe("Big carousel title, e.g. '5 high-protein breakfasts'"),
  subtitle: cardText(100).optional().describe("One supporting line"),
  kicker: cardText(24).optional().describe("Small pill above the title, e.g. 'Save for later'"),
  cta: cardText(24).optional().describe("Bottom call to action, default 'Swipe'"),
  slide: slideField,
});
export type CoverContent = z.infer<typeof coverSchema>;

export function coverCard(c: CoverContent, theme: Theme) {
  return frame(
    { ...theme, text: "#FFFFFF", muted: "rgba(255,255,255,0.75)" },
    { slide: c.slide, background: theme.primary, handleColor: "#FFFFFF" },
    column(
      { flexGrow: 1, justifyContent: "center" },
      c.kicker ? div({ marginBottom: 40 }, pill(c.kicker, theme.accent, theme.text)) : null,
      div(
        {
          fontSize: c.title.length > 40 ? 100 : 120,
          fontWeight: 800,
          lineHeight: 1.02,
          letterSpacing: -3,
          color: "#FFFFFF",
        },
        c.title,
      ),
      c.subtitle
        ? div(
            { fontSize: 44, lineHeight: 1.3, color: "rgba(255,255,255,0.85)", marginTop: 40 },
            c.subtitle,
          )
        : null,
      div(
        {
          marginTop: 72,
          alignItems: "center",
          gap: 16,
          fontSize: 36,
          fontWeight: 800,
          color: theme.accent,
        },
        c.cta ?? "Swipe",
        div({ fontSize: 48, lineHeight: 1 }, "›››"),
      ),
    ),
  );
}
