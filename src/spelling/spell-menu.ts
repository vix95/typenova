/** The spelling part of the editor's context menu: suggestions for the misspelled word, and "add to dictionary" / "ignore". */
import { $ } from "../app/dom";
import { view } from "../editor/editor-view";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";
import { suggestWord } from "./spell-client";
import { addPersonalWord, ignoreWordForNow, spellLanguages } from "./spell-settings";
import { misspelledAt, type Misspelling } from "./spellcheck";

const MAX_SHOWN = 5;
/** The word the menu is open for. */
let target: Misspelling | null = null;

function item(label: string, onClick: (() => void) | null, className = ""): HTMLButtonElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = `spell-menu-item ${className}`.trim();
  control.textContent = label;
  if (onClick) control.addEventListener("click", () => { $("editorContextMenu").hidden = true; onClick(); });
  else control.disabled = true;
  return control;
}

function replaceWord(found: Misspelling, replacement: string): void {
  // The word must still be where it was; otherwise the text changed and nothing is replaced.
  if (view.state.sliceDoc(found.from, found.to) !== found.word) return;
  view.dispatch({ changes: { from: found.from, to: found.to, insert: replacement }, selection: { anchor: found.from + replacement.length }, userEvent: "input.spell" });
  view.focus();
}

function rule(): HTMLElement { return document.createElement("hr"); }

/** Builds the section for a misspelled word; the suggestions arrive a moment later and are put in place then. */
function fillSection(found: Misspelling, relayout: () => void): void {
  const section = $("spellMenuSection");
  target = found;
  section.hidden = false;
  const suggestions = document.createElement("div");
  suggestions.append(item(langText("Szukam podpowiedzi…", "Looking for suggestions…"), null));
  section.replaceChildren(
    suggestions, rule(),
    item(langText(`Dodaj „${found.word}” do słownika`, `Add “${found.word}” to the dictionary`), () => {
      if (addPersonalWord(found.word)) showToast(langText(`Dodano „${found.word}” do słownika osobistego.`, `“${found.word}” was added to the personal dictionary.`));
    }),
    item(langText(`Ignoruj „${found.word}”`, `Ignore “${found.word}”`), () => ignoreWordForNow(found.word)),
    rule(),
  );
  void suggestWord(found.word, spellLanguages()).then(words => {
    if (target !== found || section.hidden) return;
    const shown = words.slice(0, MAX_SHOWN);
    suggestions.replaceChildren(...(shown.length
      ? shown.map(word => item(word, () => replaceWord(found, word), "spell-suggestion"))
      : [item(langText("Brak podpowiedzi", "No suggestions"), null)]));
    relayout();
  });
}

/** Prepares the spelling section for a click at a point of the editor (the section is hidden when the click was not on a misspelled word). */
export function prepareSpellSection(eventTarget: EventTarget | null, clientX: number, clientY: number, relayout: () => void): void {
  const section = $("spellMenuSection");
  target = null;
  const onWord = eventTarget instanceof Element && eventTarget.closest(".cm-misspelled") !== null;
  const position = onWord ? view.posAtCoords({ x: clientX, y: clientY }) : null;
  const found = position === null ? null : misspelledAt(view.state, position);
  if (!found) { section.hidden = true; section.replaceChildren(); return; }
  fillSection(found, relayout);
}

/** Prepares the section for a word given directly (when the menu is opened from the keyboard). */
export function prepareSpellSectionFor(found: Misspelling, relayout: () => void): void { fillSection(found, relayout); }
