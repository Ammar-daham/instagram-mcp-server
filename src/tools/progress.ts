import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * Report progress to the client when it asked for it (a progressToken). Clients like the MCP
 * Inspector reset their request timeout on each update, so long publishes don't time out.
 */
export function progressReporter(extra: ToolExtra | undefined): (message: string) => void {
  const token = extra?._meta?.progressToken;
  if (token === undefined || !extra) return () => {};
  let step = 0;
  return (message) => {
    step += 1;
    void extra
      .sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress: step, message },
      })
      .catch(() => {});
  };
}
