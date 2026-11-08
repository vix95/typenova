/** What is sent to the preview renderer for the active document: the text as it is, or CSV, Mermaid, JSON and XML files turned into Markdown first. */
import { documentMode } from "../documents/document-stats";
import { documentState } from "../documents/document-state";
import { langText } from "../i18n/language";
import { previewSourceFor } from "./preview-source";

export type RendererMode = "markdown" | "plain" | "notebook";

export function previewRequest(text: string): { text: string; mode: RendererMode } {
  const path = documentState.currentPath || documentState.untitledLabel;
  const mode = documentMode(path);
  if (mode === "page" || mode === "json" || mode === "xml") return { text, mode: "plain" };
  if (mode !== "table" && mode !== "diagram" && mode !== "canvas") return { text, mode };
  const extension = path.split(".").pop()?.toLowerCase() || "";
  const note = (rows: number, total: number) => langText(`Pokazano ${rows} z ${total} wierszy.`, `Showing ${rows} of ${total} rows.`);
  return { text: previewSourceFor(mode, extension, text, note, {
    invalid: detail => langText(`Nie można pokazać struktury: ${detail}`, `Cannot show the structure: ${detail}`),
    limit: shown => langText(`Pokazano tylko pierwsze ${shown} pozycji.`, `Only the first ${shown} items are shown.`),
  }), mode: "markdown" };
}
