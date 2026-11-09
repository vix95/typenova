/** Spell checking commands for the keyboard, the command palette and the menus: suggestions at the caret, next and previous error, on and off. */
import { EditorView } from "@codemirror/view";
import { openEditorContextMenuAt, relayoutEditorContextMenu } from "../editor/context-menu";
import { view } from "../editor/editor-view";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";
import { prepareSpellSectionFor } from "./spell-menu";
import { setSpellEnabled, spellEnabled } from "./spell-settings";
import { misspelledAt, misspelledRanges } from "./spellcheck";

/** Opens the context menu for the misspelled word at the caret (the word the caret is in or right after). */
export function openSpellSuggestionsAtCaret(): void {
  const head = view.state.selection.main.head;
  const found = misspelledAt(view.state, head);
  if (!found) {
    showToast(spellEnabled() ? langText("Przy kursorze nie ma błędnego słowa.", "There is no misspelled word at the caret.") : langText("Sprawdzanie pisowni jest wyłączone.", "Spell checking is off."));
    return;
  }
  const box = view.coordsAtPos(found.from);
  const fallback = view.dom.getBoundingClientRect();
  prepareSpellSectionFor(found, relayoutEditorContextMenu);
  openEditorContextMenuAt(box ? box.left : fallback.left + 24, box ? box.bottom + 4 : fallback.top + 24);
}

/** Goes to the next (1) or previous (-1) misspelled word, continuing from the end to the start of the document. */
export function goToMisspelling(direction: 1 | -1): void {
  const found = misspelledRanges(view.state);
  if (!found.length) { showToast(spellEnabled() ? langText("Nie znaleziono błędów pisowni.", "No spelling mistakes found.") : langText("Sprawdzanie pisowni jest wyłączone.", "Spell checking is off.")); return; }
  const range = view.state.selection.main;
  const target = direction === 1
    ? found.find(item => item.from >= range.to && item.from > range.from) ?? found[0]
    : [...found].reverse().find(item => item.from < range.from) ?? found[found.length - 1];
  view.dispatch({ selection: { anchor: target.from, head: target.to }, effects: EditorView.scrollIntoView(target.from, { y: "center" }) });
  view.focus();
}

export function toggleSpellChecking(): void {
  const next = !spellEnabled();
  setSpellEnabled(next);
  showToast(next ? langText("Sprawdzanie pisowni włączone.", "Spell checking turned on.") : langText("Sprawdzanie pisowni wyłączone.", "Spell checking turned off."));
}
