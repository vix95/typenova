/** Word and byte statistics plus document-mode helpers. */
import { resolveDocumentMode } from "../editor/editor-preferences";
import { $ } from "../app/dom";
import { documentState } from "./document-state";
import { view } from "../editor/editor-view";

export let lastWordCount = 0;
let lastByteCount = 0;
export function documentMode(path = documentState.currentPath || documentState.untitledLabel): "markdown" | "plain" | "notebook" {
  return resolveDocumentMode(path);
}
export function updateQuickStats() {
  const chars = view.state.doc.length;
  const en = document.documentElement.lang === "en"; const locale = en ? "en-US" : "pl-PL";
  $("wordCount").textContent = en ? `${lastWordCount.toLocaleString(locale)} words` : `${lastWordCount.toLocaleString(locale)} słów`;
  $("characterCount").textContent = en ? `${chars.toLocaleString(locale)} characters` : `${chars.toLocaleString(locale)} znaków`;
  const bytes = chars;
  $("sizeStatus").textContent = bytes >= 1048576 ? `~${(bytes / 1048576).toFixed(2)} MB` : bytes >= 1024 ? `~${(bytes / 1024).toFixed(1)} KB` : `~${bytes} B`;
}
export function updateStats(stats?: { words: number; chars: number; bytes: number; fastMode?: boolean }) {
  if (stats) { lastWordCount = stats.words; lastByteCount = stats.bytes; }
  const chars = view.state.doc.length;
  const en = document.documentElement.lang === "en"; const locale = en ? "en-US" : "pl-PL";
  $("wordCount").textContent = en ? `${lastWordCount.toLocaleString(locale)} words` : `${lastWordCount.toLocaleString(locale)} słów`;
  $("characterCount").textContent = en ? `${chars.toLocaleString(locale)} characters` : `${chars.toLocaleString(locale)} znaków`;
  const bytes = lastByteCount || chars;
  $("sizeStatus").textContent = bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}
