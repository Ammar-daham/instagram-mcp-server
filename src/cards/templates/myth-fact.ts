import { z } from "zod";
import { div } from "../element.js";
import { column, frame, pill } from "../layout.js";
import { cardText, slideField } from "../text.js";
import { tint, type Theme } from "../theme.js";

export const mythFactSchema = z.strictObject({
  myth: cardText(110).describe("The common belief, e.g. 'Eating fat makes you fat'"),
  fact: cardText(200).describe("The evidence-based correction"),
  source: cardText(70).optional().describe("Short source, e.g. 'WHO, 2023'"),
  label: cardText(24).optional().describe("Pill text, default 'Myth vs fact'"),
  slide: slideField,
});
export type MythFactContent = z.infer<typeof mythFactSchema>;

export function mythFactCard(c: MythFactContent, theme: Theme) {
  return frame(
    theme,
    { label: c.label ?? "Myth vs fact", slide: c.slide },
    column(
      { flexGrow: 1, gap: 40 },
      column(
        {
          backgroundColor: tint(theme.highlight, 0.1),
          borderRadius: 36,
          padding: 52,
          gap: 24,
        },
        div({}, pill("Myth", theme.highlight, "#FFFFFF")),
        div(
          {
            fontSize: 48,
            fontWeight: 600,
            lineHeight: 1.25,
            color: theme.muted,
            textDecoration: "line-through",
            textDecorationColor: theme.highlight,
          },
          c.myth,
        ),
      ),
      column(
        {
          backgroundColor: tint(theme.primary, 0.12),
          borderRadius: 36,
          padding: 52,
          gap: 24,
          flexGrow: 1,
        },
        div({}, pill("Fact", theme.primary, "#FFFFFF")),
        div({ fontSize: c.fact.length > 140 ? 44 : 52, fontWeight: 800, lineHeight: 1.25 }, c.fact),
        c.source
          ? div({ fontSize: 28, color: theme.muted, marginTop: "auto" }, `Source: ${c.source}`)
          : null,
      ),
    ),
  );
}
