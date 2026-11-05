import path from "node:path";
import { PROJECT_ROOT } from "../paths.js";

/** Local data the server keeps (gitignored): follower snapshots. */
export function followersFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(PROJECT_ROOT, env.INSIGHTS_DATA_DIR?.trim() || ".data", "followers.json");
}
