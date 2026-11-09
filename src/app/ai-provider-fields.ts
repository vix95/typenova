/** The part of the assistant options window that belongs to each provider: its address, its API key, its model and "Check the connection". It is drawn from the provider list (`ai/providers.ts`), one group per provider, and only the group of the provider that is on is enabled. */
import { aiBackendAvailable, getKeyInfo, readModel, readProvider, readUrl, removeApiKey, saveApiKey, saveUrl } from "../ai/ai-settings";
import { refreshModels } from "../ai/model-list";
import { bindModelSelect } from "../ai/model-select";
import { connectionStatus, displayName, keyNote, modelNote } from "../ai/provider-texts";
import { AI_PROVIDERS, maskedKey, type AiProvider, type ProviderInfo } from "../ai/providers";
import { langText } from "../i18n/language";
import { themeSelect } from "../ui/custom-select";
import { showToast } from "../ui/toast";

const SVG = {
  edit: '<path d="m4 20 1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z"/><path d="m14.5 6.5 3 3"/>',
  remove: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.9 12.5h9.2L17.5 7M10 11v5.5M14 11v5.5"/>',
  paste: '<rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9.5 5V3.5h5V5M9.5 11h5M9.5 15h5"/>',
  reveal: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="M8 3v5M16 3v5M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v3"/>',
};

/** Providers whose user asked to enter a new key although one is stored. */
const replacing = new Set<AiProvider>();

const partId = (provider: AiProvider, part: string): string => `aiField-${provider}-${part}`;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function iconButton(provider: AiProvider, part: string, icon: string, pressable = false): HTMLButtonElement {
  const button = make("button", "settings-icon-button");
  button.type = "button";
  button.id = partId(provider, part);
  if (pressable) button.setAttribute("aria-pressed", "false");
  button.insertAdjacentHTML("afterbegin", `<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`);
  return button;
}

function field(provider: AiProvider, part: string): HTMLElement {
  const box = make("div", "ai-options-field");
  const label = make("label");
  label.htmlFor = partId(provider, part);
  label.dataset.part = `${part}-label`;
  box.append(label);
  return box;
}

const get = <T extends HTMLElement>(provider: AiProvider, part: string): T | null => document.getElementById(partId(provider, part)) as T | null;
const note = (className: string, part: string, provider: AiProvider): HTMLElement => { const p = make("p", className); p.id = partId(provider, part); return p; };

function setTip(control: HTMLElement | null, label: string): void {
  if (!control) return;
  control.dataset.tooltip = label;
  control.setAttribute("aria-label", label);
}

function urlField(info: ProviderInfo): HTMLElement {
  const box = field(info.id, "url");
  const input = make("input");
  input.id = partId(info.id, "url");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = info.urlPlaceholder;
  input.addEventListener("change", () => {
    if (saveUrl(info.id, input.value)) { input.value = readUrl(info.id); if (readProvider() === info.id) void refreshModels(info.id); }
    else { showToast(langText("Adres musi zaczynać się od http:// lub https://.", "The address must start with http:// or https://.")); input.value = readUrl(info.id); }
  });
  box.append(input, note("ai-options-help", "url-help", info.id));
  return box;
}

/** Encrypts and stores the key typed or pasted into a provider's field; the field is emptied, so the key is not shown again. */
export async function commitKey(provider: AiProvider): Promise<void> {
  const input = get<HTMLInputElement>(provider, "key");
  const value = input?.value.trim() ?? "";
  if (!input || !value) return;
  if (await saveApiKey(provider, value)) {
    input.value = "";
    input.classList.remove("revealed");
    replacing.delete(provider);
    showToast(langText("Klucz zaszyfrowany i zapisany.", "The key was encrypted and saved."));
  } else showToast(langText("Nie udało się zapisać klucza. Sprawdź, czy jest poprawny.", "The key could not be saved. Check that it is valid."));
  renderProviderFields();
}

/** The window was closed: nobody is entering a new key any more. */
export function endKeyEditing(): void { replacing.clear(); }

export async function commitAllKeys(): Promise<void> { for (const info of AI_PROVIDERS) if (info.key !== "none") await commitKey(info.id); }

/** Puts text from the clipboard into the key field, in place of the selection. */
async function pasteKey(input: HTMLInputElement): Promise<void> {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (text) input.setRangeText(text, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, "end");
  } catch { showToast(langText("Nie można odczytać schowka. Spróbuj Ctrl+V w polu klucza.", "The clipboard could not be read. Try Ctrl+V in the key field.")); }
  input.focus();
}

/** Ctrl+V normally pastes by itself. If the webview does not deliver a paste within a moment, the clipboard is read directly, so the key can always be pasted. */
function guardPaste(input: HTMLInputElement): void {
  let pasted = false;
  input.addEventListener("paste", () => { pasted = true; });
  input.addEventListener("keydown", event => {
    const paste = ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "v") || (event.shiftKey && event.key === "Insert");
    if (!paste) return;
    pasted = false;
    window.setTimeout(() => { if (!pasted) void pasteKey(input); }, 150);
  });
}

function keyField(info: ProviderInfo): HTMLElement {
  const provider = info.id;
  const box = field(provider, "key");
  const stored = make("div", "ai-key-stored");
  stored.id = partId(provider, "stored");
  const mask = make("span", "ai-key-mask");
  mask.id = partId(provider, "mask");
  const replace = iconButton(provider, "replace", SVG.edit);
  const remove = iconButton(provider, "remove", SVG.remove);
  stored.append(mask, replace, remove);
  const entry = make("div", "settings-secret-row");
  entry.id = partId(provider, "entry");
  const input = make("input", "ai-secret");
  input.id = partId(provider, "key");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocapitalize", "off");
  input.placeholder = info.keyPlaceholder;
  const paste = iconButton(provider, "paste", SVG.paste);
  const reveal = iconButton(provider, "reveal", SVG.reveal, true);
  entry.append(input, paste, reveal);
  guardPaste(input);
  paste.addEventListener("click", () => { void pasteKey(input); });
  reveal.addEventListener("click", () => { input.classList.toggle("revealed"); renderProviderFields(); });
  replace.addEventListener("click", () => { replacing.add(provider); renderProviderFields(); input.focus(); });
  remove.addEventListener("click", () => { void removeApiKey(provider).then(() => { replacing.delete(provider); showToast(langText("Usunięto klucz API.", "The API key was removed.")); renderProviderFields(); }); });
  input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void commitKey(provider); } });
  box.append(stored, entry, note("ai-options-help ai-options-note", "key-warning", provider), note("ai-options-help", "key-note", provider));
  if (info.keyHelpUrl) { const help = note("ai-options-help", "key-link", provider); box.append(help); }
  return box;
}

function modelField(info: ProviderInfo): HTMLElement {
  const box = field(info.id, "model");
  const select = make("select");
  select.id = partId(info.id, "model");
  box.append(select, note("ai-options-help", "model-note", info.id));
  return box;
}

function testRow(info: ProviderInfo): HTMLElement {
  const row = make("div", "ai-options-test");
  const button = make("button", "ai-flat-button");
  button.type = "button";
  button.id = partId(info.id, "test");
  button.insertAdjacentHTML("afterbegin", `<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">${SVG.check}</svg>`);
  button.append(make("span"));
  // The key typed in the field is saved first, so that what is checked is what was typed.
  button.addEventListener("click", () => { void commitKey(info.id).then(() => refreshModels(info.id)); });
  row.append(button, note("ai-options-help ai-options-note", "status", info.id));
  (row.lastElementChild as HTMLElement).setAttribute("role", "status");
  return row;
}

/** Draws one group per provider into `root`, once. */
export function buildProviderFields(root: HTMLElement): void {
  root.replaceChildren();
  for (const info of AI_PROVIDERS) {
    const group = make("fieldset", "ai-options-group");
    group.dataset.provider = info.id;
    group.append(make("legend"));
    if (info.url !== "none") group.append(urlField(info));
    if (info.key !== "none") group.append(keyField(info));
    group.append(modelField(info), testRow(info));
    root.append(group);
    const select = get<HTMLSelectElement>(info.id, "model")!;
    themeSelect(select);
    bindModelSelect(select, info.id);
  }
}

function setText(provider: AiProvider, part: string, text: string): void {
  const node = get(provider, part);
  if (!node) return;
  node.textContent = text;
  if ("hidden" in node) node.hidden = text === "";
}

function renderKey(info: ProviderInfo): void {
  const provider = info.id;
  const key = getKeyInfo(provider);
  const stored = key.present && key.readable && !replacing.has(provider);
  get(provider, "stored")!.hidden = !stored;
  get(provider, "entry")!.hidden = stored;
  const mask = get(provider, "mask")!;
  mask.textContent = maskedKey(key.lastChars);
  mask.setAttribute("aria-label", langText(`Zapisany klucz, kończy się na ${key.lastChars}`, `Stored key, ends with ${key.lastChars}`));
  const input = get<HTMLInputElement>(provider, "key")!;
  input.disabled = !aiBackendAvailable();
  const shown = input.classList.contains("revealed");
  const reveal = get(provider, "reveal")!;
  setTip(reveal, shown ? langText("Ukryj wpisany klucz", "Hide the typed key") : langText("Pokaż wpisany klucz (tylko przed zapisaniem)", "Show the typed key (only before saving)"));
  reveal.setAttribute("aria-pressed", String(shown));
  reveal.classList.toggle("selected", shown);
  setTip(get(provider, "paste"), langText("Wklej klucz ze schowka", "Paste the key from the clipboard"));
  setTip(get(provider, "replace"), langText("Wpisz nowy klucz", "Enter a new key"));
  setTip(get(provider, "remove"), langText("Usuń zapisany klucz", "Remove the stored key"));
  const optional = info.key === "optional";
  setLabel(provider, "key", optional ? langText("Klucz API (jeśli usługa go wymaga)", "API key (if the service asks for one)") : langText(`Klucz API ${info.account}`, `${info.account} API key`));
  let warning = "";
  if (!aiBackendAvailable()) warning = langText("Klucz można zapisać tylko w aplikacji desktopowej.", "A key can be stored only in the desktop program.");
  else if (key.present && !key.readable) warning = langText("Zapisanego klucza nie można odczytać na tym komputerze (np. dane zostały skopiowane z innego). Wprowadź go ponownie.", "The stored key cannot be read on this computer (for example the data was copied from another one). Enter it again.");
  setText(provider, "key-warning", warning);
  setText(provider, "key-note", keyNote(provider));
  const link = get(provider, "key-link");
  if (link) { link.textContent = ""; const a = make("a", "", langText("Gdzie zdobyć klucz", "Where to get a key")); a.href = info.keyHelpUrl; a.target = "_blank"; a.rel = "noopener noreferrer"; link.append(a); }
}

function setLabel(provider: AiProvider, part: string, text: string): void {
  const label = get(provider, part)?.closest(".ai-options-field")?.querySelector<HTMLElement>(`[data-part="${part}-label"]`);
  if (label) label.textContent = text;
}

/** Brings every group up to date: which one is enabled, the stored values, the texts in the language in use. */
export function renderProviderFields(): void {
  const active = readProvider();
  for (const info of AI_PROVIDERS) {
    const provider = info.id;
    const group = document.querySelector<HTMLFieldSetElement>(`fieldset[data-provider="${provider}"]`);
    if (!group) continue;
    group.disabled = provider !== active;
    group.querySelector("legend")!.textContent = displayName(provider);
    if (info.url !== "none") {
      const url = get<HTMLInputElement>(provider, "url")!;
      if (document.activeElement !== url) url.value = readUrl(provider);
      setLabel(provider, "url", info.where === "yours" ? langText("Adres usługi", "Service address") : langText(`Adres ${displayName(provider)}`, `${displayName(provider)} address`));
      setText(provider, "url-help", info.url === "optional"
        ? langText(`Zostaw puste, aby użyć ${info.defaultUrl}.`, `Leave empty to use ${info.defaultUrl}.`)
        : langText("Adres usługi zgodnej z API OpenAI, razem ze ścieżką (zwykle kończy się na /v1).", "The address of the OpenAI-compatible service, with its path (it usually ends with /v1)."));
    }
    if (info.key !== "none") renderKey(info);
    setLabel(provider, "model", langText("Model", "Model"));
    setText(provider, "model-note", modelNote(provider));
    const test = get(provider, "test")!;
    test.querySelector("span")!.textContent = langText("Sprawdź połączenie", "Check the connection");
    setTip(test, info.models === "fetched" ? langText("Sprawdź połączenie i pobierz listę modeli", "Check the connection and get the list of models") : langText("Sprawdź, czy klucz działa", "Check that the key works"));
    test.toggleAttribute("disabled", !aiBackendAvailable());
    setText(provider, "status", connectionStatus(provider, readUrl(provider), readModel(provider)));
  }
}
