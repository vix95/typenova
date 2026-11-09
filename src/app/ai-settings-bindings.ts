/** The "Claude options" fields: the API key (masked unless revealed) and the model. */
import { $ } from "./dom";
import { openAiOptions } from "../ai/ai-options";
import { bindModelSelect } from "../ai/model-select";
import { readApiKey, saveApiKey } from "../ai/ai-settings";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";

function labelButtons(reveal: HTMLElement, clear: HTMLElement, paste: HTMLElement, shown: boolean): void {
  const revealLabel = shown ? langText("Ukryj klucz", "Hide key") : langText("Pokaż klucz", "Show key");
  reveal.dataset.tooltip = revealLabel; reveal.setAttribute("aria-label", revealLabel);
  reveal.setAttribute("aria-pressed", String(shown)); reveal.classList.toggle("selected", shown);
  const clearLabel = langText("Usuń klucz", "Remove key");
  clear.dataset.tooltip = clearLabel; clear.setAttribute("aria-label", clearLabel);
  const pasteLabel = langText("Wklej klucz ze schowka", "Paste the key from the clipboard");
  paste.dataset.tooltip = pasteLabel; paste.setAttribute("aria-label", pasteLabel);
}

/** Puts text from the clipboard into the field, in place of the selection. */
function insertText(input: HTMLInputElement, text: string): void {
  const clean = text.trim();
  if (!clean) return;
  input.setRangeText(clean, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, "end");
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function pasteFromClipboard(input: HTMLInputElement): Promise<void> {
  try { insertText(input, await navigator.clipboard.readText()); }
  catch { showToast(langText("Nie można odczytać schowka. Spróbuj Ctrl+V w polu klucza.", "The clipboard could not be read. Try Ctrl+V in the key field.")); }
  input.focus();
}

/**
 * Ctrl+V (or Shift+Insert) normally pastes by itself. If the webview does not deliver a paste within a moment, the
 * clipboard is read directly, so the key can always be pasted.
 */
function guardPaste(input: HTMLInputElement): void {
  let pasted = false;
  input.addEventListener("paste", () => { pasted = true; });
  input.addEventListener("keydown", event => {
    const paste = ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "v") || (event.shiftKey && event.key === "Insert");
    if (!paste) return;
    pasted = false;
    window.setTimeout(() => { if (!pasted) void pasteFromClipboard(input); }, 150);
  });
}

export function initAiSettingsBindings(): void {
  const key = $("aiApiKeyInput") as HTMLInputElement;
  const reveal = $("aiApiKeyReveal");
  const clear = $("aiApiKeyClear");
  const paste = $("aiApiKeyPaste");
  const model = $("aiModelSelect") as HTMLSelectElement;
  key.value = readApiKey();
  const sync = () => labelButtons(reveal, clear, paste, key.classList.contains("revealed"));
  sync();
  document.addEventListener("typenova:language-changed", sync);
  guardPaste(key);
  // The key is saved as it is typed or pasted, so closing the window never loses it.
  key.addEventListener("input", () => saveApiKey(key.value));
  key.addEventListener("change", () => showToast(key.value.trim() ? langText("Zapisano klucz API.", "API key saved.") : langText("Usunięto klucz API.", "API key removed.")));
  paste.addEventListener("click", () => { void pasteFromClipboard(key); });
  reveal.addEventListener("click", () => { key.classList.toggle("revealed"); sync(); });
  clear.addEventListener("click", () => { key.value = ""; saveApiKey(""); key.classList.remove("revealed"); sync(); showToast(langText("Usunięto klucz API.", "API key removed.")); });
  $("aiOpenOptions").addEventListener("click", openAiOptions);
  $("aiOptionsClose").addEventListener("click", () => ($("aiOptionsDialog") as HTMLDialogElement).close());
  bindModelSelect(model);
  bindModelSelect($("aiModelQuick") as HTMLSelectElement);
}
