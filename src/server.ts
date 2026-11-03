import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ContextFactory } from "./context.js";
import { registerCheckToken } from "./tools/check-token.js";
import { registerGetAccountInfo } from "./tools/get-account-info.js";

export const SERVER_NAME = "instagram-nutrition-mcp";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
export const SERVER_VERSION = version;

export function createServer(getContext: ContextFactory): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerCheckToken(server, getContext);
  registerGetAccountInfo(server, getContext);
  return server;
}
