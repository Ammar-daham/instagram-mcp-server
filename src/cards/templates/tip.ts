import { z } from "zod";
import { div } from "../element.js";
import { column, frame, heading, numberBadge } from "../layout.js";
import { cardText, slideField } from "../text.js";
import type { Theme } from "../theme.js";

export const tipSchema = z.strictObject({
  title: cardText(80).describe("The hook, e.g. '3 easy ways to eat more fibre'"),
  points: z.array(cardText(110)).min(1).max(4).describe("1-4 short tips"),
  label: cardText(24).optional().describe("Pill text, default 'Nutrition tip'"),
  slide: slideField,
});
export type TipContent = z.infer<typeof tipSchema>;

export function tipCard(c: TipContent, theme: Theme) {
  // Scale with the amount of text so 4 long tips still fit above the footer.
  const chars = c.points.reduce((n, p) => n + p.length, 0) + c.title.length;
  const roomy = c.points.length <= 3 && chars <= 300;
  const size = roomy ? 46 : chars <= 360 ? 40 : 34;
  const titleSize = c.title.length > 50 ? (roomy ? 72 : 60) : roomy ? 84 : 72;
  return frame(
    theme,
    { label: c.label ?? "Nutrition tip", slide: c.slide },
    column(
      { flexGrow: 1 },
      heading(c.title, titleSize, theme.text, { marginBottom: roomy ? 72 : 48 }),
      column(
        { gap: roomy ? 52 : size > 34 ? 36 : 28 },
        ...c.points.map((point, i) =>
          div(
            { alignItems: "flex-start", gap: 32 },
            numberBadge(i + 1, theme, roomy ? 68 : size + 18),
            div({ fontSize: size, lineHeight: 1.35, paddingTop: roomy ? 2 : 4, flex: 1 }, point),
          ),
        ),
      ),
    ),
  );
}
