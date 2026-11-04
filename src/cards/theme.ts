import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PROJECT_ROOT } from "../paths.js";

export interface Theme {
  background: string;
  text: string;
  muted: string;
  primary: string;
  accent: string;
  /** Third colour, used for fat in the macros card. */
  highlight: string;
  /** e.g. "@body.blooms.ai"; shown in every card's footer. */
  handle: string | undefined;
  /** Logo as a data URI, shown in the footer. */
  logo: string | undefined;
}

export const DEFAULT_THEME: Theme = {
  background: "#FAF6EF",
  text: "#1E2A26",
  muted: "#5E6D66",
  primary: "#2E7D5B",
  accent: "#E9964A",
  highlight: "#D0645A",
  handle: undefined,
  logo: undefined,
};

const hex = (name: string) =>
  z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, `${name} must be a hex colour like #2E7D5B.`)
    .optional();

const ThemeEnv = z.object({
  BRAND_BACKGROUND: hex("BRAND_BACKGROUND"),
  BRAND_TEXT: hex("BRAND_TEXT"),
  BRAND_MUTED: hex("BRAND_MUTED"),
  BRAND_PRIMARY: hex("BRAND_PRIMARY"),
  BRAND_ACCENT: hex("BRAND_ACCENT"),
  BRAND_HIGHLIGHT: hex("BRAND_HIGHLIGHT"),
  BRAND_HANDLE: z
    .string()
    .trim()
    .regex(/^@?[A-Za-z0-9._]{1,30}$/, "BRAND_HANDLE must be an Instagram handle like @you.")
    .optional(),
  BRAND_LOGO: z.string().trim().optional(),
});

const LOGO_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

/** Build the card theme from BRAND_* env vars (all optional). */
export function loadTheme(env: NodeJS.ProcessEnv = process.env): Theme {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
  const parsed = ThemeEnv.safeParse(cleaned);
  if (!parsed.success) {
    throw new Error(
      `Invalid brand settings:\n${parsed.error.issues.map((i) => `- ${i.message}`).join("\n")}`,
    );
  }
  const e = parsed.data;
  return {
    background: e.BRAND_BACKGROUND ?? DEFAULT_THEME.background,
    text: e.BRAND_TEXT ?? DEFAULT_THEME.text,
    muted: e.BRAND_MUTED ?? DEFAULT_THEME.muted,
    primary: e.BRAND_PRIMARY ?? DEFAULT_THEME.primary,
    accent: e.BRAND_ACCENT ?? DEFAULT_THEME.accent,
    highlight: e.BRAND_HIGHLIGHT ?? DEFAULT_THEME.highlight,
    handle: e.BRAND_HANDLE ? `@${e.BRAND_HANDLE.replace(/^@/, "")}` : undefined,
    logo: e.BRAND_LOGO ? loadLogo(e.BRAND_LOGO) : undefined,
  };
}

function loadLogo(file: string): string {
  const full = path.resolve(PROJECT_ROOT, file);
  const type = LOGO_TYPES[path.extname(full).toLowerCase()];
  if (!type) throw new Error(`BRAND_LOGO must be a .png, .jpg or .svg file (got ${file}).`);
  let data: Buffer;
  try {
    data = readFileSync(full);
  } catch {
    throw new Error(`BRAND_LOGO file not found: ${full}`);
  }
  return `data:${type};base64,${data.toString("base64")}`;
}

/** `#RRGGBB` + alpha → `rgba(...)`, for tints. */
export function tint(hexColour: string, alpha: number): string {
  const n = Number.parseInt(hexColour.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
