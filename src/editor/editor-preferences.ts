export type FontSizeLevel = "small" | "medium" | "large";
export const FONT_SIZE_PIXELS: Readonly<Record<FontSizeLevel, number>> = Object.freeze({ small: 13, medium: 15, large: 17 });
import { MARKDOWN_EXTENSIONS } from "../filesystem/file-types.js";
import { JSON_PREVIEW_EXTENSIONS, XML_PREVIEW_EXTENSIONS } from "../preview/structured-preview.js";

/** "table" (CSV, TSV) and "diagram" (Mermaid files) are previewed by turning them into Markdown first; "page" (HTML files) shows the rendered web page; "json" and "xml" (XML, XAML...) are shown as a tree. */
export type DocumentMode = "markdown" | "plain" | "notebook" | "table" | "diagram" | "page" | "json" | "xml" | "canvas";

export function resolveDocumentMode(path: string): DocumentMode {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (ext === "ipynb") return "notebook";
  if (ext === "csv" || ext === "tsv") return "table";
  if (ext === "mmd" || ext === "mermaid") return "diagram";
  if (ext === "canvas") return "canvas";
  if (JSON_PREVIEW_EXTENSIONS.has(ext)) return "json";
  if (XML_PREVIEW_EXTENSIONS.has(ext)) return "xml";
  if (ext === "html" || ext === "htm" || ext === "xhtml") return "page";
  return MARKDOWN_EXTENSIONS.has(ext) ? "markdown" : "plain";
}
