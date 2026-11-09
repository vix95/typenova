/** Spell checking in the settings: on or off, the languages, and the window with the personal dictionary. */
import { $ } from "../app/dom";
import { button, el } from "../editor/bookmark-browser";
import { langText } from "../i18n/language";
import { appConfirm } from "../ui/dialogs";
import { showToast } from "../ui/toast";
import { parseLanguages, serializeLanguages } from "./spell-model";
import { addPersonalWord, clearPersonalWords, personalWords, removePersonalWord, setSpellEnabled, setSpellLanguages, spellEnabled, spellLanguages, SPELL_CHANGED_EVENT } from "./spell-settings";

let wordsDialog: HTMLDialogElement | null = null;

function renderWords(list: HTMLElement, count: HTMLElement): void {
  const words = personalWords();
  count.textContent = String(words.length);
  list.replaceChildren();
  if (!words.length) {
    list.append(el("p", "bookmark-empty", langText("Słownik jest pusty. Dodaj słowo albo wybierz „Dodaj do słownika” w menu błędnego słowa.", "The dictionary is empty. Add a word, or choose “Add to the dictionary” in the menu of a misspelled word.")));
    return;
  }
  for (const word of words) {
    const row = el("div", "spell-word-row");
    row.setAttribute("role", "listitem");
    row.append(el("span", "spell-word", word), button("bookmark-icon-button", "trash", langText(`Usuń „${word}”`, `Remove “${word}”`), () => removePersonalWord(word)));
    list.append(row);
  }
}

/** The window with the words the user added: add a word, remove one, remove all. */
export function openSpellWordsDialog(): void {
  wordsDialog?.close();
  const dialog = el("dialog", "bookmark-dialog spell-words-dialog");
  const content = el("div", "dialog-content bookmark-content");
  const title = el("div", "dialog-title"); title.id = "spellWordsTitle";
  const count = el("span", "bookmark-count");
  title.append(el("span", "", langText("Słownik osobisty", "Personal dictionary")), count);
  dialog.setAttribute("aria-labelledby", title.id);
  const lead = el("p", "ai-options-lead", langText("Słowa z tego słownika nie są oznaczane jako błędy, bez względu na wielkość liter. Słownik jest zapisany tylko na tym komputerze.", "Words in this dictionary are not marked as mistakes, whatever their letter case. The dictionary is stored only on this computer."));
  const add = el("form", "spell-word-add");
  const input = el("input", "bookmark-input"); input.type = "text"; input.maxLength = 64; input.spellcheck = false;
  input.placeholder = langText("Nowe słowo", "New word");
  input.setAttribute("aria-label", input.placeholder);
  const submit = button("ai-flat-button", "plus", langText("Dodaj", "Add"), () => undefined, true);
  submit.type = "submit";
  add.append(input, submit);
  const list = el("div", "bookmark-list"); list.setAttribute("role", "list"); list.setAttribute("aria-label", langText("Słowa w słowniku", "Words in the dictionary"));
  const redraw = () => renderWords(list, count);
  add.addEventListener("submit", event => {
    event.preventDefault();
    if (addPersonalWord(input.value)) input.value = "";
    else if (input.value.trim()) showToast(langText("To nie jest słowo albo już jest w słowniku.", "That is not a word, or it is already in the dictionary."));
    input.focus();
  });
  const actions = el("div", "dialog-actions bookmark-actions");
  const clear = button("bookmark-delete", "trash", langText("Usuń wszystkie", "Remove all"), () => {
    if (!personalWords().length) return;
    void appConfirm(langText("Usunąć wszystkie słowa ze słownika osobistego?", "Remove all words from the personal dictionary?"), { confirmLabel: langText("Usuń", "Remove"), primaryAction: "cancel" }).then(ok => { if (ok) clearPersonalWords(); });
  }, true);
  const done = button("bookmark-confirm", "check", langText("Gotowe", "Done"), () => dialog.close(), true);
  actions.append(clear, el("span", "bookmark-actions-gap"), done);
  content.append(title, lead, add, list, actions);
  dialog.append(content);
  document.addEventListener(SPELL_CHANGED_EVENT, redraw);
  dialog.addEventListener("close", () => { document.removeEventListener(SPELL_CHANGED_EVENT, redraw); if (wordsDialog === dialog) wordsDialog = null; dialog.remove(); });
  wordsDialog = dialog;
  redraw();
  document.body.append(dialog);
  dialog.showModal();
  input.focus();
}

/** Binds the spell checking controls of the settings dialog. */
export function initSpellSettings(): void {
  const toggle = $<HTMLInputElement>("spellEnabledToggle");
  const select = $<HTMLSelectElement>("spellLanguagesSelect");
  toggle.checked = spellEnabled();
  select.value = serializeLanguages(spellLanguages());
  toggle.addEventListener("change", () => setSpellEnabled(toggle.checked));
  select.addEventListener("change", () => setSpellLanguages(parseLanguages(select.value)));
  $("spellOpenWords").addEventListener("click", openSpellWordsDialog);
  // A change made elsewhere (the command palette) shows in the settings too.
  document.addEventListener(SPELL_CHANGED_EVENT, () => { toggle.checked = spellEnabled(); });
}
