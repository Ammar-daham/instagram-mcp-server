import { z } from "zod";
import { div } from "../element.js";
import { column, frame, heading, numberBadge, pill } from "../layout.js";
import { cardText, slideField } from "../text.js";
import { tint, type Theme } from "../theme.js";

export const recipeSchema = z.strictObject({
  title: cardText(48).describe("Recipe name"),
  time: cardText(16).optional().describe("e.g. '15 min'"),
  servings: cardText(16).optional().describe("e.g. '2 servings'"),
  ingredients: z.array(cardText(40)).min(2).max(8).describe("2-8 short ingredient lines"),
  steps: z.array(cardText(90)).min(1).max(4).describe("1-4 short steps"),
  label: cardText(24).optional().describe("Pill text, default 'Recipe'"),
  slide: slideField,
});
export type RecipeContent = z.infer<typeof recipeSchema>;

export function recipeCard(c: RecipeContent, theme: Theme) {
  // Scale text down as the recipe gets longer so it always fits above the footer.
  const load = c.ingredients.length / 2 + c.steps.reduce((n, s) => n + (s.length > 45 ? 2 : 1), 0);
  const body = load <= 7 ? 36 : load <= 10 ? 32 : 28;
  const meta = [c.time, c.servings].filter((m): m is string => Boolean(m));
  const sectionTitle = (text: string) =>
    div(
      {
        fontSize: 28,
        fontWeight: 800,
        letterSpacing: 2,
        textTransform: "uppercase",
        color: theme.primary,
        marginBottom: 20,
      },
      text,
    );

  return frame(
    theme,
    { label: c.label ?? "Recipe", slide: c.slide },
    column(
      { flexGrow: 1 },
      heading(c.title, 68, theme.text),
      meta.length
        ? div(
            { gap: 16, marginTop: 24 },
            ...meta.map((m) => pill(m, tint(theme.accent, 0.2), theme.text)),
          )
        : null,
      column(
        { marginTop: 48 },
        sectionTitle("Ingredients"),
        div(
          { flexWrap: "wrap", columnGap: 32, rowGap: 12 },
          ...c.ingredients.map((item) =>
            div(
              { width: 436, alignItems: "flex-start", gap: 14, fontSize: body, lineHeight: 1.3 },
              div({ color: theme.accent, fontWeight: 800 }, "•"),
              div({ flex: 1 }, item),
            ),
          ),
        ),
      ),
      column(
        { marginTop: 44, gap: body > 30 ? 28 : 20 },
        sectionTitle("Method"),
        ...c.steps.map((step, i) =>
          div(
            { alignItems: "flex-start", gap: 24 },
            numberBadge(i + 1, theme, body + 20),
            div({ fontSize: body, lineHeight: 1.35, flex: 1, paddingTop: body > 30 ? 2 : 4 }, step),
          ),
        ),
      ),
    ),
  );
}
