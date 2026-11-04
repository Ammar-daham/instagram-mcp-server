import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ContextFactory } from "./context.js";
import { registerPrompts, type PromptOptions } from "./prompts/index.js";
import { registerCheckToken } from "./tools/check-token.js";
import { registerDeleteImage } from "./tools/delete-image.js";
import { registerGetAccountInfo } from "./tools/get-account-info.js";
import { registerPublishTools, type PublishToolOptions } from "./tools/publish.js";
import { registerRenderCard, type RenderCardOptions } from "./tools/render-card.js";
import { registerSuggestHashtags } from "./tools/suggest-hashtags.js";
import { registerUploadImage, type UploadImageOptions } from "./tools/upload-image.js";

export const SERVER_NAME = "instagram-nutrition-mcp";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
export const SERVER_VERSION = version;

export function createServer(
  getContext: ContextFactory,
  options: RenderCardOptions & UploadImageOptions & PublishToolOptions & PromptOptions = {},
): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerCheckToken(server, getContext);
  registerGetAccountInfo(server, getContext);
  registerRenderCard(server, options);
  registerUploadImage(server, options);
  registerDeleteImage(server, options);
  registerPublishTools(server, getContext, options);
  registerSuggestHashtags(server);
  registerPrompts(server, options);
  return server;
}
