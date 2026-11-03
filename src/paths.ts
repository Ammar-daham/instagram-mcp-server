import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root. Works from both `src/` (tsx) and `dist/` (compiled), which sit one level below it. */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
