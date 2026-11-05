/**
 * Make a safe file name from whatever the client sent: clients like the MCP Inspector may send
 * quotes, an empty string, capitals, spaces or an extension. Returns undefined when nothing
 * usable is left (e.g. an Arabic-only name), so callers fall back to a timestamped name.
 */
export function cleanFileName(value: string | undefined, maxLength = 41): string | undefined {
  if (!value) return undefined;
  const name = value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\.(mp4|mov|jpe?g|png)$/i, "")
    .toLowerCase()
    .replace(/[\s_./\\]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
  return name || undefined;
}
