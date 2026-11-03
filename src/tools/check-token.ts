import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ContextFactory } from "../context.js";
import { checkToken } from "../instagram/token.js";
import { toolResult } from "./result.js";

export function registerCheckToken(server: McpServer, getContext: ContextFactory): void {
  server.registerTool(
    "check_token",
    {
      title: "Check Instagram token",
      description:
        "Check that the Instagram access token works, which account it belongs to, and when it " +
        "expires (if known). Use this when Instagram calls fail or to see if a refresh is due.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () =>
      toolResult(async () => {
        const { client, token } = await getContext();
        return checkToken(client, token);
      }),
  );
}
