/** Shows the encoding and line endings of the active document in the status bar (kept free of other document modules so any of them can call it). */
import { DEFAULT_FORMAT, formatLabel, type LineEnding, type TextFormat } from "../filesystem/text-codec";
import { langText } from "../i18n/language";
import { documentState } from "./document-state";

export const LINE_ENDING_LABELS: Record<LineEnding, string> = { lf: "LF", crlf: "CRLF", cr: "CR" };

export const activeFormat = (): TextFormat => documentState.tabs.find(tab => tab.id === documentState.activeTabId)?.format ?? DEFAULT_FORMAT;

export function updateFormatStatus(): void {
  const encoding = document.getElementById("encodingStatus"), eol = document.getElementById("eolStatus");
  if (!encoding || !eol) return;
  const format = activeFormat();
  encoding.textContent = formatLabel(format);
  eol.textContent = LINE_ENDING_LABELS[format.lineEnding];
  encoding.title = langText("Kodowanie pliku (kliknij, aby zmienić)", "File encoding (click to change)");
  eol.title = langText("Końce linii (kliknij, aby zmienić)", "Line endings (click to change)");
}
