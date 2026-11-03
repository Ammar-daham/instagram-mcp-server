/** `npm run token:refresh`: swap the current long-lived token for a fresh 60-day one. */
import { loadConfig, loadDotEnv } from "../config.js";
import { refreshAccessToken } from "../instagram/token.js";

try {
  loadDotEnv();
  const config = loadConfig();
  const stored = await refreshAccessToken(config);
  console.log(`Token refreshed. New expiry: ${stored.expiresAt}`);
  console.log(`Saved to ${config.tokenStorePath} (the MCP server uses it automatically).`);
} catch (error) {
  console.error(`Token refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
