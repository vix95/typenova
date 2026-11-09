/** The Highlights view of the left panel (next to the project tree, the table of contents, the graph and the bookmarks): the list of all highlights. */
import { $ } from "./dom";
import { setSidebarTab, showSidebar } from "./sidebar";
import { createHighlightBrowser } from "../editor/highlight-browser";
import { openHighlightEditor } from "../editor/highlight-dialogs";
import { langText } from "../i18n/language";
import { outlineState } from "../outline/outline";

/** Opens the left panel (if it is collapsed) and switches it to the highlights. */
export function showHighlightsPanel(): void {
  if (!outlineState.outlineVisible) showSidebar();
  setSidebarTab("highlights");
  $("highlightsViewHost").querySelector<HTMLInputElement>("input")?.focus();
}

function labelBack(button: HTMLElement): void {
  const label = langText("Wróć do plików", "Back to files");
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);
}

export function initHighlightSidebar(): void {
  const count = $("highlightsViewCount");
  const back = $("highlightsViewBack");
  labelBack(back);
  document.addEventListener("typenova:language-changed", () => labelBack(back));
  back.addEventListener("click", () => setSidebarTab("files"));
  const browser = createHighlightBrowser({ onEdit: openHighlightEditor, onCount: total => { count.textContent = String(total); } });
  $("highlightsViewHost").append(browser.element);
}
