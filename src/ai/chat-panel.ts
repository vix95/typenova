/** The chat pane at the right edge of the window (Claude or Ollama, whichever is on): a conversation about the open document, with its selection as context. */
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { button, el } from "../editor/bookmark-browser";
import { view } from "../editor/editor-view";
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { applyWidths, layoutState } from "../layout/layout";
import { readPreferenceFlag, readPreferenceNumber, writePreferenceFlag } from "../settings/preferences";
import { ICONS } from "../ui/icons";
import { showToast } from "../ui/toast";
import { buildChatSystem, splitCodeBlocks, toApiMessages, type ChatTurn } from "./ai-model";
import { displayName, setupHint } from "./provider-texts";
import { askAi, describeAiError, isAiCancelled, refusalMessage } from "./ai-client";
import { captureContext, renderContext } from "./chat-context";
import { openAiOptions } from "./ai-options";
import { isAiReady, providerReadiness, readProvider } from "./ai-settings";

const OPEN_KEY = "typenova.ai.open";
const WIDTH_KEY = "typenova.ai.width";
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const SPLITTER_WIDTH = 5;

const turns: ChatTurn[] = [];
let controller: AbortController | null = null;
let paneOpen = false;
let useDocument = true;
let useSelection = true;

const pane = () => $("aiPane");
const messages = () => $("aiMessages");
const input = () => $("aiInput") as HTMLTextAreaElement;

function documentName(): string { return documentState.currentPath ? basename(documentState.currentPath) : documentState.untitledLabel; }
function selectedText(): string { const range = view.state.selection.main; return range.empty ? "" : view.state.sliceDoc(range.from, range.to); }
const aiName = (): string => displayName(readProvider());

/** The width of the pane, never more than the window can spare. */
function paneWidth(): number {
  const room = ($("layout") as HTMLElement).getBoundingClientRect().width;
  const wanted = readPreferenceNumber(WIDTH_KEY, 380, MIN_WIDTH, MAX_WIDTH);
  return Math.round(Math.max(MIN_WIDTH, Math.min(wanted, Math.max(MIN_WIDTH, room * 0.5))));
}

function applyPane(open: boolean): void {
  paneOpen = open;
  pane().hidden = !open;
  $("aiSplitter").hidden = !open;
  if (open) pane().style.width = `${paneWidth()}px`;
  layoutState.reservedRight = open ? paneWidth() + SPLITTER_WIDTH : 0;
  const toggle = $("toggleAi");
  toggle.setAttribute("aria-pressed", String(open));
  toggle.classList.toggle("selected", open);
  // The same two classes as the Preview button, so the active state looks the same.
  toggle.classList.toggle("primary", open);
  applyWidths();
  view.requestMeasure();
  if (open) { refreshLabels(); input().focus(); }
}

export function setAiPaneOpen(open: boolean): void {
  writePreferenceFlag(OPEN_KEY, open);
  applyPane(open);
}

export function toggleAiPane(): void { setAiPaneOpen(!paneOpen); }
export function isAiPaneOpen(): boolean { return paneOpen; }

/** Puts text from an answer into the document: at the caret, or in place of the selection. */
function putIntoDocument(text: string, replaceSelection: boolean): void {
  const range = view.state.selection.main;
  const from = replaceSelection ? range.from : range.head;
  const to = replaceSelection ? range.to : range.head;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: "input.ai", scrollIntoView: true });
  view.focus();
}

function codeBlock(text: string, language: string): HTMLElement {
  const block = el("div", "ai-code");
  const bar = el("div", "ai-code-bar");
  bar.append(el("span", "ai-code-language", language));
  const actions = el("div", "ai-code-actions");
  actions.append(
    button("ai-icon-button", "copy", langText("Kopiuj", "Copy"), () => { void navigator.clipboard?.writeText(text).then(() => showToast(langText("Skopiowano.", "Copied."))).catch(() => undefined); }),
    button("ai-icon-button", "insertText", langText("Wstaw w miejscu kursora", "Insert at the caret"), () => putIntoDocument(text, false)),
    button("ai-icon-button", "replaceText", langText("Zamień zaznaczenie", "Replace the selection"), () => putIntoDocument(text, true)),
  );
  bar.append(actions);
  block.append(bar, el("pre", "ai-code-text", text));
  return block;
}

/** Draws an assistant answer: prose as paragraphs (plain text, never HTML) and fenced code as blocks with actions. */
function renderAnswer(container: HTMLElement, answer: string): void {
  container.replaceChildren();
  for (const part of splitCodeBlocks(answer)) {
    if (part.kind === "text") container.append(el("p", "ai-text", part.text));
    else container.append(codeBlock(part.text, part.language));
  }
  if (!container.childNodes.length) container.append(el("p", "ai-text ai-thinking", "…"));
}

function addBubble(kind: "user" | "assistant" | "error", text = ""): HTMLElement {
  messages().querySelector(".ai-empty")?.remove();
  const bubble = el("div", `ai-message ai-${kind}`);
  if (kind === "assistant") renderAnswer(bubble, text); else bubble.append(el("p", "ai-text", text));
  messages().append(bubble);
  messages().scrollTop = messages().scrollHeight;
  return bubble;
}

function showEmptyHint(): void {
  messages().replaceChildren(el("p", "ai-empty", langText(
    "Zapytaj o dokument, poproś o tekst albo zaznacz fragment i napisz, co z nim zrobić. Odpowiedzi z kodem możesz wstawić do dokumentu jednym kliknięciem.",
    "Ask about the document, ask for some text, or select a passage and say what to do with it. Code in an answer can be put into the document with one click.")));
}

function setBusy(busy: boolean): void {
  $("aiSend").hidden = busy;
  $("aiStop").hidden = !busy;
  input().disabled = false;
  messages().setAttribute("aria-busy", String(busy));
}

async function send(raw: string): Promise<void> {
  const text = raw.trim();
  if (!text || controller) return;
  if (!isAiReady()) { refreshSetup(); return; }
  // What is sent along is shown with the message, so that it is clear afterwards which document and passage the answer is about.
  const context = captureContext(useDocument, useSelection);
  turns.push({ role: "user", text });
  const userBubble = addBubble("user", text);
  const sent = el("ul", "ai-context-list ai-context-sent");
  renderContext(sent, context);
  if (sent.childElementCount) userBubble.append(el("p", "ai-context-caption", langText(`Wysłano do ${aiName()} razem z wiadomością:`, `Sent to ${aiName()} with the message:`)), sent);
  const answerBubble = addBubble("assistant");
  input().value = "";
  controller = new AbortController();
  setBusy(true);
  const system = buildChatSystem({ documentName: documentName(), documentText: useDocument ? view.state.doc.toString() : "", selection: context.selection?.text ?? "" });
  let answer = "";
  try {
    const result = await askAi({
      system, messages: toApiMessages(turns), signal: controller.signal,
      onText: (_delta, full) => { answer = full; renderAnswer(answerBubble, full); messages().scrollTop = messages().scrollHeight; },
    });
    answer = result.text || answer;
    renderAnswer(answerBubble, answer);
    if (result.refused) { answerBubble.remove(); addBubble("error", refusalMessage()); }
    else {
      turns.push({ role: "assistant", text: answer });
      if (result.truncated) addBubble("error", langText("Odpowiedź została przycięta, bo osiągnęła limit długości.", "The answer was cut off because it reached the length limit."));
    }
  } catch (error) {
    if (isAiCancelled(error)) { if (answer) turns.push({ role: "assistant", text: answer }); else answerBubble.remove(); }
    else { answerBubble.remove(); addBubble("error", describeAiError(error)); }
  } finally {
    controller = null;
    setBusy(false);
    input().focus();
  }
}

function newConversation(): void {
  controller?.abort();
  turns.length = 0;
  showEmptyHint();
  input().focus();
}

function refreshSetup(): void {
  const missing = !isAiReady();
  $("aiSetup").hidden = !missing;
  $("aiSetupText").textContent = setupHint(readProvider(), providerReadiness(readProvider()));
  $("aiOpenSettings").querySelector("span")!.textContent = langText("Opcje asystenta…", "Assistant options…");
  $("aiSend").toggleAttribute("disabled", missing);
}

function labelButton(id: string, label: string): void {
  const control = $(id);
  control.dataset.tooltip = label;
  control.setAttribute("aria-label", label);
}

function labelChip(id: string, label: string, on: boolean): void {
  const chip = $(id);
  // The icon (a check mark) is shown only while the item is sent; an item that is off is dimmed.
  chip.replaceChildren();
  if (on) chip.insertAdjacentHTML("afterbegin", ICONS.check);
  chip.append(el("span", "", label));
  chip.setAttribute("aria-pressed", String(on));
  chip.classList.toggle("selected", on);
  chip.dataset.tooltip = on ? langText(`${label}: wysyłane do ${aiName()}. Kliknij, aby nie wysyłać.`, `${label}: sent to ${aiName()}. Click to stop sending it.`) : langText(`${label}: nie jest wysyłane. Kliknij, aby wysyłać.`, `${label}: not sent. Click to send it.`);
}

/** All the texts of the pane in the interface language (called when it opens, when the language changes and when settings change). */
function refreshLabels(): void {
  const name = aiName();
  // The title and the top-bar button do not depend on the provider; the provider and model are shown in the chooser and in the texts.
  const title = langText("Czat AI", "AI Chat");
  $("aiPaneTitle").textContent = title;
  $("toggleAi").querySelector("span")!.textContent = title;
  labelButton("aiNewChat", langText("Nowa rozmowa", "New conversation"));
  labelButton("aiPaneClose", langText("Zamknij czat", "Close the chat"));
  labelButton("toggleAi", paneOpen ? langText("Ukryj czat AI (Ctrl+Shift+M)", "Hide the AI chat (Ctrl+Shift+M)") : langText("Pokaż czat AI (Ctrl+Shift+M)", "Show the AI chat (Ctrl+Shift+M)"));
  const selection = selectedText().length;
  $("aiContextLabel").textContent = langText(`Wyślij do ${name}:`, `Send to ${name}:`);
  $("aiContextRow").setAttribute("aria-label", langText(`Co wysłać do ${name}`, `What to send to ${name}`));
  $("aiContextList").setAttribute("aria-label", langText("Wysyłany kontekst", "Context that is sent"));
  labelChip("aiUseDocument", langText("Dokument", "Document"), useDocument);
  labelChip("aiUseSelection", selection ? langText(`Zaznaczenie (${selection})`, `Selection (${selection})`) : langText("Zaznaczenie", "Selection"), useSelection);
  input().placeholder = langText(`Napisz do ${name}… (Enter wysyła, Shift+Enter nowy wiersz)`, `Message ${name}… (Enter sends, Shift+Enter for a new line)`);
  input().setAttribute("aria-label", langText(`Wiadomość do ${name}`, `Message to ${name}`));
  const sendLabel = langText("Wyślij", "Send");
  $("aiSend").querySelector("span")!.textContent = sendLabel; labelButton("aiSend", sendLabel);
  const stopLabel = langText("Zatrzymaj", "Stop");
  $("aiStop").querySelector("span")!.textContent = stopLabel; labelButton("aiStop", stopLabel);
  const modelLabel = langText(`Model ${name}`, `${name} model`);
  $("aiModelQuick").setAttribute("aria-label", modelLabel); $("aiModelQuick").dataset.tooltip = modelLabel;
  $("aiPane").setAttribute("aria-label", langText(`Czat AI (${name})`, `AI chat (${name})`));
  if (!turns.length && !controller) showEmptyHint();
  renderLiveContext();
  refreshSetup();
}

/** The list of what would be sent now (the document with its path, the selection with its section), above the message field. */
function renderLiveContext(): void {
  const list = $("aiContextList");
  renderContext(list, captureContext(useDocument, useSelection));
  list.hidden = list.childElementCount === 0;
}

let selectionRefreshQueued = false;
/** The "Selection" button shows how many characters are selected; called whenever the selection changes (at most once per frame, and only while the pane is open). */
export function refreshSelectionContext(): void {
  if (!paneOpen || selectionRefreshQueued) return;
  selectionRefreshQueued = true;
  requestAnimationFrame(() => {
    selectionRefreshQueued = false;
    if (!paneOpen) return;
    const count = selectedText().length;
    labelChip("aiUseSelection", count ? langText(`Zaznaczenie (${count})`, `Selection (${count})`) : langText("Zaznaczenie", "Selection"), useSelection);
    renderLiveContext();
  });
}

/** The splitter between the editor/preview and the pane: dragging (or the arrow keys) changes the pane's width. */
function initSplitter(): void {
  const splitter = $("aiSplitter");
  let drag: { pointerId: number } | null = null;
  const setWidth = (width: number) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
    try { localStorage.setItem(WIDTH_KEY, String(clamped)); } catch { /* storage unavailable */ }
    applyPane(true);
  };
  splitter.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { pointerId: event.pointerId };
    document.body.classList.add("resizing-panels");
  });
  window.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    setWidth(($("layout") as HTMLElement).getBoundingClientRect().right - event.clientX - SPLITTER_WIDTH / 2);
  });
  const finish = (event: PointerEvent) => { if (drag && event.pointerId === drag.pointerId) { drag = null; document.body.classList.remove("resizing-panels"); } };
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  splitter.addEventListener("keydown", event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setWidth(paneWidth() + (event.key === "ArrowLeft" ? 24 : -24));
  });
  window.addEventListener("resize", () => { if (paneOpen) applyPane(true); });
}

export function initChatPanel(): void {
  $("toggleAi").addEventListener("click", toggleAiPane);
  $("aiPaneClose").addEventListener("click", () => setAiPaneOpen(false));
  $("aiNewChat").addEventListener("click", newConversation);
  $("aiStop").addEventListener("click", () => controller?.abort());
  $("aiUseDocument").addEventListener("click", () => { useDocument = !useDocument; refreshLabels(); });
  $("aiUseSelection").addEventListener("click", () => { useSelection = !useSelection; refreshLabels(); });
  $("aiOpenSettings").addEventListener("click", openAiOptions);
  $("aiForm").addEventListener("submit", event => { event.preventDefault(); void send(input().value); });
  input().addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(input().value); }
  });
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "m") { event.preventDefault(); toggleAiPane(); }
    else if (event.key === "Escape" && controller && pane().contains(document.activeElement)) controller.abort();
  });
  document.addEventListener("typenova:language-changed", refreshLabels);
  document.addEventListener("typenova:ai-settings-changed", refreshLabels);
  initSplitter();
  setBusy(false);
  refreshLabels();
  if (readPreferenceFlag(OPEN_KEY, false)) applyPane(true);
}
