/** The spelling count in the status bar: how many misspelled words the document in use has now. A click goes to the next one. */
import { $ } from "../app/dom";
import { view } from "../editor/editor-view";
import { langText } from "../i18n/language";
import { goToMisspelling } from "./spell-commands";
import { SPELL_MARKS_EVENT, spellEnabled, SPELL_CHANGED_EVENT } from "./spell-settings";
import { misspelledRanges, wholeDocumentCount } from "./spellcheck";

/** Events after which the count may be different: the marks changed, another document was shown, a setting or the language changed. */
const REFRESH_EVENTS = [SPELL_MARKS_EVENT, SPELL_CHANGED_EVENT, "typenova:document-shown", "typenova:language-changed"];

function refresh(): void {
  const status = $<HTMLButtonElement>("spellStatus");
  status.hidden = !spellEnabled();
  if (status.hidden) return;
  // A large document is counted whole in the background; until that is done (and for a small one) the marks are the count.
  const count = wholeDocumentCount() ?? misspelledRanges(view.state).length;
  status.textContent = `${langText("Pisownia", "Spelling")}: ${count}`;
  status.classList.toggle("has-errors", count > 0);
  status.disabled = count === 0;
  const label = count
    ? langText(`Błędy pisowni w dokumencie: ${count}. Kliknij, aby przejść do następnego.`, `Spelling mistakes in the document: ${count}. Click to go to the next one.`)
    : langText("Nie znaleziono błędów pisowni.", "No spelling mistakes found.");
  status.dataset.tooltip = label;
  status.setAttribute("aria-label", label);
}

export function installSpellStatus(): void {
  for (const event of REFRESH_EVENTS) document.addEventListener(event, refresh);
  $("spellStatus").addEventListener("click", () => goToMisspelling(1));
  refresh();
}
