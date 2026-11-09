/** The Bookmarks menu (commands only; the list of bookmarks is the Bookmarks panel of the sidebar) and the bookmark button of the project row. */
import { $ } from "./dom";
import { showBookmarksPanel } from "./bookmark-sidebar";
import { editBookmarkAtCaret } from "../editor/bookmark-dialogs";
import { goToNeighbourBookmark, toggleBookmark } from "../editor/bookmarks";
import { langText } from "../i18n/language";

/** Tooltip and accessible name of each command, in both languages (the tooltip system would otherwise keep the text it first saw). */
const COMMANDS: readonly { id: string; pl: string; en: string; shortcut?: string }[] = [
  { id: "menuBookmarkToggle", pl: "Dodaj lub usuń zakładkę", en: "Toggle bookmark", shortcut: "Ctrl+F2" },
  { id: "menuBookmarkEdit", pl: "Nazwa i notatka zakładki w miejscu kursora", en: "Name and note of the bookmark at the caret" },
  { id: "menuBookmarkNext", pl: "Przejdź do następnej zakładki", en: "Go to the next bookmark", shortcut: "F2" },
  { id: "menuBookmarkPrev", pl: "Przejdź do poprzedniej zakładki", en: "Go to the previous bookmark", shortcut: "Shift+F2" },
  { id: "menuBookmarkManage", pl: "Pokaż panel z listą zakładek", en: "Show the panel with the list of bookmarks" },
  { id: "openBookmarks", pl: "Zakładki: lista wszystkich zakładek", en: "Bookmarks: list of all bookmarks" },
];

function labelCommands(): void {
  for (const command of COMMANDS) {
    const item = $(command.id);
    const label = langText(command.pl, command.en);
    item.dataset.tooltip = command.shortcut ? `${label} (${command.shortcut})` : label;
    item.setAttribute("aria-label", command.shortcut ? `${label}, ${command.shortcut}` : label);
  }
}

export function initBookmarkMenu(): void {
  labelCommands();
  document.addEventListener("typenova:language-changed", labelCommands);
  $("menuBookmarkToggle").addEventListener("click", () => { void toggleBookmark(); });
  $("menuBookmarkEdit").addEventListener("click", () => editBookmarkAtCaret());
  $("menuBookmarkNext").addEventListener("click", () => goToNeighbourBookmark(1));
  $("menuBookmarkPrev").addEventListener("click", () => goToNeighbourBookmark(-1));
  $("menuBookmarkManage").addEventListener("click", () => showBookmarksPanel());
  // The bookmark button in the row of project buttons (next to Git history) shows the same panel.
  $("openBookmarks").addEventListener("click", () => showBookmarksPanel());
}
