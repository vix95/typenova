/** The Highlights menu (commands only; the list is the Highlights panel of the left column), the marker button of the formatting toolbar and the highlights button of the project row. */
import { $ } from "./dom";
import { showHighlightsPanel } from "./highlight-sidebar";
import { editHighlightAtSelection } from "../editor/highlight-dialogs";
import { copyHighlightsAsMarkdown, getHighlights, goToNeighbourHighlight, toggleHighlight } from "../editor/highlights";
import { langText } from "../i18n/language";

/** Tooltip and accessible name of each command, in both languages (the tooltip system would otherwise keep the text it first saw). */
const COMMANDS: readonly { id: string; pl: string; en: string; shortcut?: string }[] = [
  { id: "menuHighlightToggle", pl: "Wyróżnij zaznaczenie lub usuń wyróżnienie", en: "Highlight the selection or remove the highlight", shortcut: "Ctrl+Shift+H" },
  { id: "menuHighlightEdit", pl: "Kolor, grupa i notatka wyróżnienia", en: "Colour, group and note of the highlight" },
  { id: "menuHighlightNext", pl: "Przejdź do następnego wyróżnienia", en: "Go to the next highlight", shortcut: "F4" },
  { id: "menuHighlightPrev", pl: "Przejdź do poprzedniego wyróżnienia", en: "Go to the previous highlight", shortcut: "Shift+F4" },
  { id: "menuHighlightPanel", pl: "Pokaż panel z listą wyróżnień", en: "Show the panel with the list of highlights" },
  { id: "menuHighlightCopy", pl: "Skopiuj wszystkie wyróżnienia jako Markdown", en: "Copy all highlights as Markdown" },
  { id: "openHighlights", pl: "Wyróżnienia: lista wszystkich wyróżnień", en: "Highlights: list of all highlights" },
  { id: "toggleHighlight", pl: "Wyróżnij zaznaczenie (Ctrl+Shift+H)", en: "Highlight the selection (Ctrl+Shift+H)" },
];

function labelCommands(): void {
  for (const command of COMMANDS) {
    const item = $(command.id);
    const label = langText(command.pl, command.en);
    const withKey = command.shortcut && !label.includes(command.shortcut) ? `${label} (${command.shortcut})` : label;
    item.dataset.tooltip = withKey;
    item.setAttribute("aria-label", command.shortcut && !label.includes(command.shortcut) ? `${label}, ${command.shortcut}` : label.replace(/\s*\(([^)]*)\)\s*$/, ", $1"));
  }
  // In the "more" menu of the toolbar the button is shown by this short name.
  $("toggleHighlight").dataset.overflowText = langText("Wyróżnij zaznaczenie", "Highlight selection");
}

export function initHighlightMenu(): void {
  labelCommands();
  document.addEventListener("typenova:language-changed", labelCommands);
  $("menuHighlightToggle").addEventListener("click", () => { void toggleHighlight(); });
  $("menuHighlightEdit").addEventListener("click", () => editHighlightAtSelection());
  $("menuHighlightNext").addEventListener("click", () => goToNeighbourHighlight(1));
  $("menuHighlightPrev").addEventListener("click", () => goToNeighbourHighlight(-1));
  $("menuHighlightPanel").addEventListener("click", () => showHighlightsPanel());
  $("menuHighlightCopy").addEventListener("click", () => { void copyHighlightsAsMarkdown(getHighlights(), "file"); });
  $("openHighlights").addEventListener("click", () => showHighlightsPanel());
  $("toggleHighlight").addEventListener("click", () => { void toggleHighlight(); });
}
