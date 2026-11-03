import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ContextFactory } from "../context.js";
import { getAccountInfo } from "../instagram/account.js";
import { toolResult } from "./result.js";

export function registerGetAccountInfo(server: McpServer, getContext: ContextFactory): void {
  server.registerTool(
    "get_account_info",
    {
      title: "Get Instagram account info",
      description:
        "Get the connected Instagram account's username, name, account type, follower and " +
        "following counts, and number of posts.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () =>
      toolResult(async () => {
        const { client, config } = await getContext();
        const info = await getAccountInfo(client);
        if (config.userId && info.user_id && config.userId !== info.user_id) {
          return {
            ...info,
            warning: `IG_USER_ID (${config.userId}) doesn't match this token's account (${info.user_id}). Fix IG_USER_ID before publishing.`,
          };
        }
        return info;
      }),
  );
}
