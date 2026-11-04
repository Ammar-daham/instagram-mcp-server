import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { deleteImage, loadCloudinaryConfig } from "../hosting/cloudinary.js";
import { toolResult } from "./result.js";
import type { UploadImageOptions } from "./upload-image.js";

export function registerDeleteImage(server: McpServer, options: UploadImageOptions = {}): void {
  const env = options.env ?? process.env;

  server.registerTool(
    "delete_image",
    {
      title: "Delete an uploaded image",
      description:
        "Delete an image previously uploaded with upload_image from Cloudinary and purge it " +
        "from the CDN, so its public URL stops working. Use it once a post is live on " +
        "Instagram (Instagram keeps its own copy) or to remove uploads that won't be posted. " +
        "Only images in this server's Cloudinary folder can be deleted.",
      inputSchema: {
        image: z
          .string()
          .min(1)
          .describe("The Cloudinary URL or public_id returned by upload_image"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ image }) =>
      toolResult(async () => {
        const config = loadCloudinaryConfig(env);
        return deleteImage(image, config, options.fetch ? { fetch: options.fetch } : {});
      }),
  );
}
