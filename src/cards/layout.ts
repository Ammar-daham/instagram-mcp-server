import { div, img, type Child, type CardNode } from "./element.js";
import { tint, type Theme } from "./theme.js";

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
const PAD = 88;

export interface FrameOptions {
  label?: string | undefined;
  /** e.g. "2/7" on carousel slides. */
  slide?: string | undefined;
  background?: string;
  /** Footer handle colour; defaults to the primary colour. */
  handleColor?: string;
}

/** Shared card chrome: label pill + slide counter on top, handle/logo footer at the bottom. */
export function frame(theme: Theme, options: FrameOptions, body: CardNode): CardNode {
  const header =
    options.label || options.slide
      ? div(
          { justifyContent: "space-between", alignItems: "center", marginBottom: 56 },
          options.label ? pill(options.label, theme.primary, "#FFFFFF") : div({}),
          options.slide
            ? div({ fontSize: 28, fontWeight: 600, color: theme.muted }, options.slide)
            : null,
        )
      : null;

  const footer = div(
    {
      justifyContent: "space-between",
      alignItems: "center",
      borderTop: `2px solid ${tint(theme.text, 0.12)}`,
      paddingTop: 32,
      marginTop: 40,
    },
    div(
      { fontSize: 30, fontWeight: 600, color: options.handleColor ?? theme.primary },
      theme.handle ?? "",
    ),
    theme.logo
      ? img(theme.logo, { height: 64, width: 64, objectFit: "contain" })
      : div({ width: 20, height: 20, borderRadius: 10, backgroundColor: theme.accent }),
  );

  return div(
    {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      // Satori defaults to content-box: without this the padding grows the card past 1080×1350.
      boxSizing: "border-box",
      flexDirection: "column",
      padding: PAD,
      backgroundColor: options.background ?? theme.background,
      color: theme.text,
      fontFamily: "Inter",
    },
    header,
    div({ flexDirection: "column", flexGrow: 1 }, body),
    footer,
  );
}

export function pill(text: string, background: string, color: string): CardNode {
  return div(
    {
      backgroundColor: background,
      color,
      fontSize: 26,
      fontWeight: 800,
      letterSpacing: 2,
      textTransform: "uppercase",
      padding: "12px 28px",
      borderRadius: 999,
    },
    text,
  );
}

export function heading(text: string, size: number, color: string, extra = {}): CardNode {
  return div(
    { fontSize: size, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1.5, color, ...extra },
    text,
  );
}

export function numberBadge(n: number, theme: Theme, size = 64): CardNode {
  return div(
    {
      width: size,
      height: size,
      flexShrink: 0,
      borderRadius: size / 2,
      backgroundColor: theme.primary,
      color: "#FFFFFF",
      fontSize: size * 0.45,
      fontWeight: 800,
      alignItems: "center",
      justifyContent: "center",
    },
    String(n),
  );
}

export function column(style: Record<string, string | number>, ...children: Child[]): CardNode {
  return div({ flexDirection: "column", ...style }, ...children);
}
