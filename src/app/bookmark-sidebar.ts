/** The Bookmarks view of the left panel (next to the project tree, the table of contents and the graph): the searchable list of all bookmarks. */
import { $ } from "./dom";
import { setSidebarTab, showSidebar } from "./sidebar";
import { createBookmarkBrowser } from "../editor/bookmark-browser";
import { openBookmarkEditor } from "../editor/bookmark-dialogs";
import { langText } from "../i18n/language";
import { outlineState } from "../outline/outline";

/** Opens the left panel (if it is collapsed) and switches it to the bookmarks. */
export function showBookmarksPanel(): void {
  if (!outlineState.outlineVisible) showSidebar();
  setSidebarTab("bookmarks");
  $("bookmarksViewHost").querySelector<HTMLInputElement>("input")?.focus();
}

function labelBack(button: HTMLElement): void {
  const label = langText("Wróć do plików", "Back to files");
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);
}

export function initBookmarkSidebar(): void {
  const count = $("bookmarksViewCount");
  const back = $("bookmarksViewBack");
  labelBack(back);
  document.addEventListener("typenova:language-changed", () => labelBack(back));
  back.addEventListener("click", () => setSidebarTab("files"));
  const browser = createBookmarkBrowser({ onEdit: openBookmarkEditor, onCount: total => { count.textContent = String(total); } });
  $("bookmarksViewHost").append(browser.element);
}
