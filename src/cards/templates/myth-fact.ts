import { z } from "zod";
import { div } from "../element.js";
import { column, frame, pill } from "../layout.js";
import type { Locale } from "../locale.js";
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

export function mythFactCard(c: MythFactContent, theme: Theme, t: Locale) {
  const rtl = t.dir === "rtl";
  const mythSize = rtl && c.myth.length > 70 ? 40 : 48;
  const factSize = c.fact.length > 140 ? (rtl ? 38 : 44) : rtl && c.fact.length > 90 ? 46 : 52;
  const boxPad = rtl && c.fact.length > 140 ? 44 : 52;
  return frame(
    theme,
    t,
    { label: c.label ?? t.text.mythFactLabel, slide: c.slide },
    column(
      { flexGrow: 1, gap: 40 },
      column(
        { backgroundColor: tint(theme.highlight, 0.1), borderRadius: 36, padding: boxPad, gap: 24 },
        div({}, pill(t.text.myth, theme.highlight, "#FFFFFF", t)),
        div(
          {
            fontSize: mythSize,
            fontWeight: 600,
            lineHeight: t.lineHeight(1.25),
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
          padding: boxPad,
          gap: 24,
          flexGrow: 1,
        },
        div({}, pill(t.text.fact, theme.primary, "#FFFFFF", t)),
        div(
          {
            fontSize: factSize,
            fontWeight: 800,
            lineHeight: t.lineHeight(1.25),
          },
          c.fact,
        ),
        c.source
          ? div(
              { fontSize: 28, color: theme.muted, marginTop: "auto" },
              `${t.text.source}: ${c.source}`,
            )
          : null,
      ),
    ),
  );
}
