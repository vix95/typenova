/** The "show white space" button of the formatting toolbar: state, persistence and applying it to every open document. */
import { $ } from "./dom";
import { documentState } from "../documents/document-state";
import { whitespaceCompartment } from "../editor/compartments";
import { view } from "../editor/editor-view";
import { WHITESPACE_KEY, whitespaceExtension } from "../editor/whitespace-extension";
import { langText } from "../i18n/language";
import { scheduleToolbarLayout } from "../layout/toolbar-layout";
import { readPreferenceFlag, writePreferenceFlag } from "../settings/preferences";

let shown = readPreferenceFlag(WHITESPACE_KEY, false);

/** The button is a toggle: its pressed state, selected look, tooltip and accessible name all follow `shown`. */
function syncButton(): void {
  const button = $("toggleWhitespace");
  const label = shown
    ? langText("Ukryj znaki białe (spacje, tabulatory, końce wierszy)", "Hide white space (spaces, tabs, line ends)")
    : langText("Pokaż znaki białe (spacje, tabulatory, końce wierszy)", "Show white space (spaces, tabs, line ends)");
  button.setAttribute("aria-pressed", String(shown));
  button.classList.toggle("selected", shown);
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);
  button.dataset.overflowText = langText("Znaki białe", "White space");
  scheduleToolbarLayout(); // the label in the "more" menu is worked out there
}

export function setShowWhitespace(enabled: boolean): void {
  shown = enabled;
  writePreferenceFlag(WHITESPACE_KEY, enabled);
  const effect = whitespaceCompartment.reconfigure(whitespaceExtension(enabled));
  for (const tab of documentState.tabs) tab.state = tab.state.update({ effects: effect }).state;
  view.dispatch({ effects: effect });
  syncButton();
}

export function toggleShowWhitespace(): void { setShowWhitespace(!shown); }

export function initWhitespaceToggle(): void {
  syncButton();
  document.addEventListener("typenova:language-changed", syncButton);
  $("toggleWhitespace").addEventListener("click", toggleShowWhitespace);
}
