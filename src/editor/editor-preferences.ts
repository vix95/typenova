export type FontSizeLevel = "small" | "medium" | "large";
export const FONT_SIZE_PIXELS: Readonly<Record<FontSizeLevel, number>> = Object.freeze({ small: 13, medium: 15, large: 17 });
export type DocumentMode = "markdown" | "plain" | "notebook";
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd", "mdx"]);

export function resolveDocumentMode(path: string): DocumentMode {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (ext === "ipynb") return "notebook";
  return MARKDOWN_EXTENSIONS.has(ext) ? "markdown" : "plain";
}
