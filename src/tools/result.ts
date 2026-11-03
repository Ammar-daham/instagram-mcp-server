import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Run a tool body, returning its value as JSON text, or a readable error result. */
export async function toolResult(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const value = await run();
    return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}
