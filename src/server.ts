import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ContextFactory } from "./context.js";
import { registerCheckToken } from "./tools/check-token.js";
import { registerDeleteImage } from "./tools/delete-image.js";
import { registerGetAccountInfo } from "./tools/get-account-info.js";
import { registerRenderCard, type RenderCardOptions } from "./tools/render-card.js";
import { registerUploadImage, type UploadImageOptions } from "./tools/upload-image.js";

export const SERVER_NAME = "instagram-nutrition-mcp";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
export const SERVER_VERSION = version;

export function createServer(
  getContext: ContextFactory,
  options: RenderCardOptions & UploadImageOptions = {},
): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerCheckToken(server, getContext);
  registerGetAccountInfo(server, getContext);
  registerRenderCard(server, options);
  registerUploadImage(server, options);
  registerDeleteImage(server, options);
  return server;
}
