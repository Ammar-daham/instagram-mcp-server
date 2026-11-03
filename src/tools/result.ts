import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Run a tool body, returning its value as JSON text, or a readable error result. */
export async function toolResult(run: () => Promise<unknown>): Promise<CallToolResult> {
  return rawToolResult(async () => ({
    content: [{ type: "text", text: JSON.stringify(await run(), null, 2) }],
  }));
}

/** Like toolResult, for tools that build their own content (e.g. images). */
export async function rawToolResult(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}
