/** "Ask Claude" for the selected text: an instruction, a streamed proposal shown as a comparison, and an Apply button. Nothing changes before the user applies it. */
import { button, el } from "../editor/bookmark-browser";
import { view } from "../editor/editor-view";
import { documentState } from "../documents/document-state";
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";
import { buildEditRequest, EDIT_SYSTEM, extractReplacement, hasChanges, lineDiff, type DiffLine } from "./ai-model";
import { askClaude, describeAiError, isAiCancelled, refusalMessage } from "./ai-client";
import { hasApiKey } from "./ai-settings";
import { openAiOptions } from "./ai-options";
import { bindModelSelect } from "./model-select";
import { themeSelect } from "../ui/custom-select";

const MAX_SELECTION_CHARS = 100000;

/** Ready-made instructions for a selection, in the interface language. */
function quickInstructions(): { label: string; text: string }[] {
  return [
    { label: langText("Popraw błędy", "Fix mistakes"), text: langText("Popraw błędy językowe i literówki, nie zmieniaj sensu ani stylu.", "Fix spelling and grammar mistakes without changing the meaning or style.") },
    { label: langText("Skróć", "Shorten"), text: langText("Skróć ten tekst, zachowując najważniejsze informacje.", "Shorten this text, keeping the important information.") },
    { label: langText("Rozwiń", "Expand"), text: langText("Rozwiń ten tekst o więcej szczegółów.", "Expand this text with more detail.") },
    { label: langText("Uprość", "Simplify"), text: langText("Napisz to prościej i bardziej zrozumiale.", "Rewrite this in simpler, clearer language.") },
    { label: langText("Po angielsku", "To English"), text: langText("Przetłumacz na angielski.", "Translate into English.") },
    { label: langText("Po polsku", "To Polish"), text: langText("Przetłumacz na polski.", "Translate into Polish.") },
  ];
}

function diffView(diff: readonly DiffLine[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const marks = { same: " ", del: "−", add: "+" } as const;
  const names = { same: "", del: langText("Usunięto: ", "Removed: "), add: langText("Dodano: ", "Added: ") } as const;
  for (const line of diff) {
    const row = el("div", `ai-diff-line ai-diff-${line.kind}`);
    const mark = el("span", "ai-diff-mark", marks[line.kind]); mark.setAttribute("aria-hidden", "true");
    row.append(mark);
    if (names[line.kind]) row.append(el("span", "sr-only", names[line.kind]));
    row.append(el("span", "ai-diff-text", line.text || " "));
    fragment.append(row);
  }
  return fragment;
}

interface Target { from: number; to: number; selection: string; before: string; after: string }

function captureTarget(): Target | null {
  const range = view.state.selection.main;
  const selection = view.state.sliceDoc(range.from, range.to);
  if (selection.length > MAX_SELECTION_CHARS) {
    showToast(langText("Zaznaczenie jest za duże dla tej funkcji. Zaznacz krótszy fragment.", "The selection is too large for this. Select a shorter passage."));
    return null;
  }
  return { from: range.from, to: range.to, selection, before: view.state.sliceDoc(0, range.from), after: view.state.sliceDoc(range.to) };
}

/** The row of ready-made instructions (only for a selection: they all work on existing text). */
function quickChips(replacing: boolean, instruction: HTMLTextAreaElement): HTMLElement {
  const chips = el("div", "ai-edit-chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", langText("Gotowe polecenia", "Ready-made instructions"));
  if (!replacing) return chips;
  for (const quick of quickInstructions()) {
    const chip = el("button", "ai-chip", quick.label); chip.type = "button";
    chip.addEventListener("click", () => { instruction.value = quick.text; instruction.focus(); });
    chips.append(chip);
  }
  return chips;
}

/** Opens the window for the current selection (or the caret, to write something new there). */
export function openAiEdit(): void {
  if (!hasApiKey()) {
    showToast(langText("Dodaj klucz API Anthropic w opcjach Claude, aby go używać.", "Add your Anthropic API key in the Claude options to use it."));
    openAiOptions();
    return;
  }
  const captured = captureTarget();
  if (!captured) return;
  const target: Target = captured;
  const replacing = target.selection.length > 0;

  const dialog = el("dialog", "ai-edit-dialog");
  const content = el("div", "dialog-content ai-edit-content");
  const title = el("div", "dialog-title", langText("Zapytaj Claude", "Ask Claude")); title.id = "aiEditTitle";
  dialog.setAttribute("aria-labelledby", title.id);
  const info = el("p", "ai-edit-info", replacing
    ? langText(`Zaznaczony tekst (${target.selection.length} znaków) zostanie zastąpiony po Twojej akceptacji.`, `The selected text (${target.selection.length} characters) is replaced only after you accept.`)
    : langText("Nic nie jest zaznaczone: wynik zostanie wstawiony w miejscu kursora po Twojej akceptacji.", "Nothing is selected: the result is inserted at the caret after you accept."));
  const instruction = el("textarea", "ai-edit-instruction");
  instruction.rows = 3;
  instruction.placeholder = replacing ? langText("Co zrobić z zaznaczonym tekstem?", "What should be done with the selected text?") : langText("Co mam napisać w tym miejscu?", "What should I write here?");
  instruction.setAttribute("aria-label", instruction.placeholder);
  const chips = quickChips(replacing, instruction);
  const modelRow = el("label", "ai-edit-model");
  const modelSelect = el("select", "ai-model-select");
  modelRow.append(el("span", "", langText("Model", "Model")), modelSelect);
  const result = el("div", "ai-edit-result"); result.hidden = true; result.setAttribute("aria-live", "polite");
  const status = el("p", "ai-edit-status"); status.setAttribute("role", "status");

  let controller: AbortController | null = null;
  let proposal: string | null = null;
  const actions = el("div", "dialog-actions ai-edit-actions");
  const cancel = button("ai-flat-button", "close", langText("Anuluj", "Cancel"), () => dialog.close(), true);
  const generate = button("ai-flat-button", "sparkle", langText("Wygeneruj", "Generate"), () => void run(), true);
  const stop = button("ai-flat-button", "close", langText("Zatrzymaj", "Stop"), () => controller?.abort(), true); stop.hidden = true;
  const apply = button("ai-flat-button primary-flat", "check", langText("Zastosuj", "Apply"), () => applyProposal(), true); apply.hidden = true;
  actions.append(cancel, el("span", "ai-edit-gap"), stop, generate, apply);

  const show = (text: string) => {
    const diff = replacing ? lineDiff(target.selection, text) : text ? lineDiff("", text) : [];
    result.hidden = false;
    result.replaceChildren(diffView(diff));
    return diff;
  };

  async function run(): Promise<void> {
    const wanted = instruction.value.trim();
    if (!wanted || controller) { if (!wanted) instruction.focus(); return; }
    controller = new AbortController();
    proposal = null; apply.hidden = true; stop.hidden = false; generate.hidden = true; status.textContent = langText("Claude pisze…", "Claude is writing…");
    const request = buildEditRequest({ instruction: wanted, selection: target.selection, before: target.before, after: target.after, documentName: documentState.currentPath ? basename(documentState.currentPath) : documentState.untitledLabel });
    let latest = "";
    try {
      const answer = await askClaude({
        system: EDIT_SYSTEM, messages: [{ role: "user", content: request }], signal: controller.signal,
        onText: (_delta, full) => { latest = extractReplacement(full); show(latest); },
      });
      if (answer.refused) { status.textContent = refusalMessage(); result.hidden = true; return; }
      latest = extractReplacement(answer.text);
      const diff = show(latest);
      if (answer.truncated) status.textContent = langText("Odpowiedź została przycięta (limit długości); sprawdź ją przed zastosowaniem.", "The answer was cut off (length limit); check it before applying.");
      else status.textContent = hasChanges(diff) ? langText("Sprawdź zmiany i zastosuj je albo wygeneruj ponownie.", "Check the changes and apply them, or generate again.") : langText("Claude nie zaproponował zmian.", "Claude proposed no changes.");
      if (latest && hasChanges(diff)) { proposal = latest; apply.hidden = false; apply.focus(); }
    } catch (error) {
      if (isAiCancelled(error)) { status.textContent = langText("Zatrzymano.", "Stopped."); if (latest) { proposal = latest; apply.hidden = false; } }
      else { status.textContent = describeAiError(error); result.hidden = true; }
    } finally {
      controller = null; stop.hidden = true; generate.hidden = false;
      generate.querySelector("span")!.textContent = langText("Wygeneruj ponownie", "Generate again");
    }
  }

  function applyProposal(): void {
    if (proposal === null) return;
    // The window is modal, so the text cannot have changed; check anyway before replacing anything.
    if (view.state.sliceDoc(target.from, target.to) !== target.selection) { showToast(langText("Dokument się zmienił. Otwórz okno ponownie.", "The document changed. Open the window again.")); dialog.close(); return; }
    view.dispatch({ changes: { from: target.from, to: target.to, insert: proposal }, selection: { anchor: target.from, head: target.from + proposal.length }, userEvent: "input.ai", scrollIntoView: true });
    dialog.close();
    view.focus();
    showToast(langText("Zastosowano zmianę (Ctrl+Z cofa).", "Change applied (Ctrl+Z undoes it)."));
  }

  instruction.addEventListener("keydown", event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void run(); } });
  content.append(title, info, instruction, chips, modelRow, status, result, actions);
  dialog.append(content);
  dialog.addEventListener("close", () => { controller?.abort(); dialog.remove(); view.focus(); });
  document.body.append(dialog);
  bindModelSelect(modelSelect);
  themeSelect(modelSelect);
  dialog.showModal();
  instruction.focus();
}
