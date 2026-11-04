import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NICHES, suggestHashtags } from "../content/hashtags.js";
import { toolResult } from "./result.js";

export function registerSuggestHashtags(server: McpServer): void {
  server.registerTool(
    "suggest_hashtags",
    {
      title: "Suggest nutrition hashtags",
      description:
        "Suggest a balanced set of curated nutrition hashtags (broad, specific and niche tags) " +
        "for one or more niches, in Arabic, English or both. Use them at the end of a caption; " +
        "10-20 is a good number (Instagram allows 30). Add 1-3 topic-specific tags of your own " +
        "if the post covers something these sets don't.",
      inputSchema: {
        niches: z.array(z.enum(NICHES)).min(1).max(3).describe("1-3 niches that fit the post"),
        language: z.enum(["ar", "en", "both"]).describe("Language of the hashtags"),
        count: z.number().int().min(5).max(30).default(15).describe("How many (default 15)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ niches, language, count }) =>
      toolResult(async () => {
        const { hashtags, byTier } = suggestHashtags(niches, language, count);
        return {
          hashtags,
          line: hashtags.join(" "),
          byTier,
          ...(hashtags.length < count
            ? {
                note: `Only ${hashtags.length} curated tags fit these niches; add a niche or a few topic tags of your own rather than unrelated ones.`,
              }
            : {}),
        };
      }),
  );
}
