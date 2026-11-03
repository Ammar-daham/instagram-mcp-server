import { z } from "zod";
import { div } from "../element.js";
import { column, frame, heading } from "../layout.js";
import { cardText, slideField } from "../text.js";
import { tint, type Theme } from "../theme.js";

const grams = z.number().min(0).max(500);

export const macrosSchema = z.strictObject({
  title: cardText(48).describe("Food or meal, e.g. 'Greek yogurt bowl'"),
  serving: cardText(40).optional().describe("e.g. '1 bowl (350 g)'"),
  calories: z.number().int().min(0).max(5000).describe("kcal per serving"),
  protein_g: grams,
  carbs_g: grams,
  fat_g: grams,
  note: cardText(100).optional().describe("One-line takeaway"),
  label: cardText(24).optional().describe("Pill text, default 'Macros'"),
  slide: slideField,
});
export type MacrosContent = z.infer<typeof macrosSchema>;

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function macrosCard(c: MacrosContent, theme: Theme) {
  const rows = [
    { name: "Protein", g: c.protein_g, kcal: c.protein_g * 4, colour: theme.primary },
    { name: "Carbs", g: c.carbs_g, kcal: c.carbs_g * 4, colour: theme.accent },
    { name: "Fat", g: c.fat_g, kcal: c.fat_g * 9, colour: theme.highlight },
  ];
  const total = rows.reduce((sum, r) => sum + r.kcal, 0) || 1;
  const BAR = 904;
  // Long titles wrap; shrink them (and the spacing) so the note never hits the bars.
  const long = c.title.length > 26;
  const compact = long && Boolean(c.note && c.note.length > 60);

  return frame(
    theme,
    { label: c.label ?? "Macros", slide: c.slide },
    column(
      { flexGrow: 1 },
      heading(c.title, long ? 60 : 76, theme.text),
      c.serving ? div({ fontSize: 34, color: theme.muted, marginTop: 16 }, c.serving) : null,
      div(
        {
          alignItems: "baseline",
          gap: 20,
          marginTop: compact ? 32 : 56,
          marginBottom: compact ? 36 : 56,
        },
        div(
          {
            fontSize: compact ? 136 : 168,
            fontWeight: 800,
            color: theme.primary,
            letterSpacing: -6,
            lineHeight: 1,
          },
          String(c.calories),
        ),
        div({ fontSize: 44, fontWeight: 600, color: theme.muted }, "kcal"),
      ),
      column(
        { gap: compact ? 30 : 44 },
        ...rows.map((r) => {
          const pct = Math.round((r.kcal / total) * 100);
          return column(
            { gap: 14 },
            div(
              { justifyContent: "space-between", alignItems: "baseline" },
              div({ fontSize: 40, fontWeight: 600 }, r.name),
              div(
                { alignItems: "baseline", gap: 16 },
                div({ fontSize: 40, fontWeight: 800 }, `${fmt(r.g)} g`),
                div({ fontSize: 30, color: theme.muted }, `${pct}%`),
              ),
            ),
            div(
              { width: BAR, height: 28, borderRadius: 14, backgroundColor: tint(r.colour, 0.18) },
              div({
                width: Math.max(28, Math.round((BAR * pct) / 100)),
                height: 28,
                borderRadius: 14,
                backgroundColor: r.colour,
              }),
            ),
          );
        }),
      ),
      c.note
        ? div(
            {
              fontSize: compact ? 30 : 34,
              lineHeight: 1.35,
              color: theme.muted,
              marginTop: "auto",
              paddingTop: 24,
            },
            c.note,
          )
        : null,
    ),
  );
}
