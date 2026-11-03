import { z } from "zod";
import { div } from "../element.js";
import { column, frame, heading } from "../layout.js";
import { cardText, slideField } from "../text.js";
import { tint, type Theme } from "../theme.js";

export const followSchema = z.strictObject({
  headline: cardText(60).optional().describe("Default 'Follow for daily nutrition tips'"),
  actions: z
    .array(cardText(30))
    .min(1)
    .max(3)
    .optional()
    .describe("Up to 3 short actions, default Save / Share / Follow"),
  slide: slideField,
});
export type FollowContent = z.infer<typeof followSchema>;

const DEFAULT_ACTIONS = ["Save this for later", "Share it with a friend", "Follow for more"];

export function followCard(c: FollowContent, theme: Theme) {
  return frame(
    theme,
    { slide: c.slide },
    column(
      { flexGrow: 1, justifyContent: "center", alignItems: "center" },
      heading(c.headline ?? "Follow for daily nutrition tips", 84, theme.text, {
        textAlign: "center",
      }),
      theme.handle
        ? div(
            {
              marginTop: 48,
              backgroundColor: theme.primary,
              color: "#FFFFFF",
              fontSize: 48,
              fontWeight: 800,
              padding: "24px 56px",
              borderRadius: 999,
            },
            theme.handle,
          )
        : null,
      column(
        { marginTop: 72, gap: 20, alignItems: "stretch", width: 760 },
        ...(c.actions ?? DEFAULT_ACTIONS).map((action) =>
          div(
            {
              justifyContent: "center",
              fontSize: 38,
              fontWeight: 600,
              padding: "24px 32px",
              borderRadius: 24,
              backgroundColor: tint(theme.primary, 0.1),
            },
            action,
          ),
        ),
      ),
    ),
  );
}
