import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadCloudinaryConfig, uploadImage, verifyPublicUrl } from "../hosting/cloudinary.js";
import { toolResult } from "./result.js";

export interface UploadImageOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

export function registerUploadImage(server: McpServer, options: UploadImageOptions = {}): void {
  const env = options.env ?? process.env;

  server.registerTool(
    "upload_image",
    {
      title: "Upload an image to get a public URL",
      description:
        "Upload a rendered card (a JPEG from render_card, saved in out/) to Cloudinary and " +
        "return its public HTTPS URL, which Instagram needs for publishing. The image becomes " +
        "publicly accessible until deleted: call delete_image with the returned URL once the " +
        "post is live (Instagram keeps its own copy). Re-uploading a file with the same name " +
        "replaces it.",
      inputSchema: {
        path: z.string().min(1).describe("Local path of the JPEG, as returned by render_card"),
        public_id: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,100}$/, "letters, digits, dashes and underscores only")
          .optional()
          .describe("Optional Cloudinary name; defaults to the file name"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ path, public_id }) =>
      toolResult(async () => {
        const config = loadCloudinaryConfig(env);
        const result = await uploadImage(path, config, {
          ...(public_id ? { publicId: public_id } : {}),
          ...(options.fetch ? { fetch: options.fetch } : {}),
        });
        const check = await verifyPublicUrl(result.url, options.fetch);
        return {
          ...result,
          publiclyReachable: check.ok,
          ...(check.ok
            ? {}
            : {
                warning: `The URL didn't respond as a public JPEG (HTTP ${check.status}, ${check.contentType ?? "no content type"}). Instagram may not be able to fetch it.`,
              }),
        };
      }),
  );
}
