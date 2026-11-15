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
import { parseAnswer } from "./edit-proposals";
import { renderProposals, renderProse, renderSentSources } from "./project-answer";
import { EDIT_RULES, folderTaskRequest, projectSystemPart, type FolderTask, type Source } from "./project-prompt";
import { defaultFolder, folderLabel, folderTurn, questionTurn, type ProjectTurn } from "./project-turn";
import { displayName, setupHint } from "./provider-texts";
import { AI_ENABLED_EVENT, aiEnabled, installAiEnabled } from "./ai-enabled";
import { askAi, describeAiError, isAiCancelled, refusalMessage } from "./ai-client";
import { captureContext, renderContext } from "./chat-context";
import { openAiOptions } from "./ai-options";
import { isAiReady, providerReadiness, readProvider } from "./ai-settings";

const OPEN_KEY = "typenova.ai.open";
const WIDTH_KEY = "typenova.ai.width";
const PROJECT_KEY = "typenova.ai.project";
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const SPLITTER_WIDTH = 5;

const turns: ChatTurn[] = [];
let controller: AbortController | null = null;
let paneOpen = false;
let useDocument = true;
let useSelection = true;
/** Passages of the notes that match a question go to the model with it (off until the person switches it on). */
let useProject = readPreferenceFlag(PROJECT_KEY, false);

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
  if (open && !aiEnabled()) return;
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

/** What an answer may cite and change: the passages that were sent, and the notes an edit may name. */
interface AnswerContext { sources: Source[]; known: { file: string; path: string }[] }

/** Draws an assistant answer: prose as paragraphs (plain text, never HTML; citations become buttons), fenced code as blocks with actions, and, once the answer is complete, the proposed changes as differences to approve. */
function renderAnswer(container: HTMLElement, answer: string, context: AnswerContext | null = null, final = false): void {
  container.replaceChildren();
  const parsed = context ? parseAnswer(answer) : null;
  for (const part of splitCodeBlocks(parsed ? parsed.prose : answer)) {
    if (part.kind === "code") container.append(codeBlock(part.text, part.language));
    else if (context) renderProse(container, part.text, context.sources);
    else container.append(el("p", "ai-text", part.text));
  }
  if (context && parsed?.pending && !final) container.append(el("p", "ai-text ai-thinking", langText("Przygotowuję propozycje zmian…", "Preparing proposed changes…")));
  if (context && parsed && final) renderProposals(container, parsed.proposals, context.known);
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

/** A task on a whole folder: summarize it, or look for contradictions in it. */
interface FolderJob { kind: FolderTask; folder: string }

/** What the model is told besides the person's words: the open document, the selection, and the project passages with the rules for citing and proposing changes. */
function systemFor(context: ReturnType<typeof captureContext>, turn: ProjectTurn | null, job: FolderJob | undefined): string {
  const base = buildChatSystem({ documentName: documentName(), documentText: useDocument && !job ? view.state.doc.toString() : "", selection: context.selection?.text ?? "" });
  return turn ? `${base}

${projectSystemPart(turn.sources)}

${EDIT_RULES}` : base;
}

function folderNote(turn: ProjectTurn): string {
  const parts = [turn.clipped ? "The notes were shortened to fit; say that your answer rests on shortened passages." : "", turn.dropped ? `${turn.dropped} passages did not fit and were left out; say so.` : ""];
  return parts.filter(Boolean).join(" ");
}

async function send(raw: string, job?: FolderJob): Promise<void> {
  const text = raw.trim();
  if (!text || controller) return;
  if (!isAiReady()) { refreshSetup(); return; }
  // What is sent along is shown with the message, so that it is clear afterwards which document, passage and notes the answer is about.
  const context = captureContext(useDocument && !job, useSelection && !job);
  const userBubble = addBubble("user", text);
  const sent = el("ul", "ai-context-list ai-context-sent");
  renderContext(sent, context);
  if (sent.childElementCount) userBubble.append(el("p", "ai-context-caption", langText(`Wysłano do ${aiName()} razem z wiadomością:`, `Sent to ${aiName()} with the message:`)), sent);
  const answerBubble = addBubble("assistant");
  input().value = "";
  controller = new AbortController();
  setBusy(true);
  let answer = "";
  let turn: ProjectTurn | null = null;
  try {
    if (job || useProject) {
      turn = job ? await folderTurn(job.folder) : await questionTurn(text);
      userBubble.append(renderSentSources(turn, aiName()));
      if (turn.tooLarge || (job && !turn.sources.length)) {
        answerBubble.remove();
        addBubble("error", turn.tooLarge ? langText("Projekt ma za dużo plików, żeby go przeszukać.", "The project has too many files to search.") : langText("W tym folderze nie ma notatek Markdown.", "There are no Markdown notes in this folder."));
        return;
      }
    }
    const request = job ? folderTaskRequest(job.kind, folderLabel(job.folder), document.documentElement.lang === "en" ? "en" : "pl", folderNote(turn!)) : text;
    turns.push({ role: "user", text: request });
    const answerContext: AnswerContext | null = turn ? { sources: turn.sources, known: turn.known } : null;
    const result = await askAi({
      system: systemFor(context, turn, job), messages: toApiMessages(turns), signal: controller.signal,
      onText: (_delta, full) => { answer = full; renderAnswer(answerBubble, full, answerContext); messages().scrollTop = messages().scrollHeight; },
    });
    answer = result.text || answer;
    renderAnswer(answerBubble, answer, answerContext, true);
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

/** The summary and the contradiction search run on one folder: the folder of the note in use (or the first project folder), or the one named. */
export function runFolderTask(kind: FolderTask, folder: string | null = defaultFolder()): void {
  if (!aiEnabled()) return;
  if (!folder) { showToast(langText("Otwórz folder projektu, żeby uruchomić to zadanie.", "Open a project folder to run this task.")); return; }
  setAiPaneOpen(true);
  const name = folderLabel(folder);
  void send(kind === "summary" ? langText(`Podsumuj folder „${name}”`, `Summarize the folder “${name}”`) : langText(`Znajdź sprzeczności w folderze „${name}”`, `Find contradictions in the folder “${name}”`), { kind, folder });
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
  for (const id of ["aiSummarizeFolder", "aiFindContradictions"]) $(id).toggleAttribute("disabled", missing);
}

function labelButton(id: string, label: string): void {
  const control = $(id);
  control.dataset.tooltip = label;
  control.setAttribute("aria-label", label);
}

function labelQuick(id: string, label: string, tooltip: string): void {
  const control = $(id);
  control.querySelector("span")!.textContent = label;
  control.dataset.tooltip = tooltip;
  control.setAttribute("aria-label", tooltip);
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
  labelChip("aiUseProject", langText("Projekt", "Project"), useProject);
  $("aiUseProject").dataset.tooltip = useProject
    ? langText(`Przy każdym pytaniu pasujące fragmenty notatek z projektu są wysyłane do ${name} (lista pod wiadomością). Kliknij, aby nie wysyłać.`, `With every question the matching passages of the project's notes are sent to ${name} (listed under the message). Click to stop.`)
    : langText("Notatki z projektu nie są wysyłane. Kliknij, aby przy każdym pytaniu wysyłać pasujące fragmenty; odpowiedź cytuje sekcje.", "No notes from the project are sent. Click to send the matching passages with every question; the answer cites the sections.");
  labelQuick("aiSummarizeFolder", langText("Podsumuj folder", "Summarize folder"), langText(`Podsumuj folder otwartej notatki (jego notatki są wysyłane do ${name})`, `Summarize the folder of the open note (its notes are sent to ${name})`));
  labelQuick("aiFindContradictions", langText("Znajdź sprzeczności", "Find contradictions"), langText(`Znajdź sprzeczności w folderze otwartej notatki (jego notatki są wysyłane do ${name})`, `Find contradictions in the folder of the open note (its notes are sent to ${name})`));
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
  installAiEnabled();
  document.addEventListener(AI_ENABLED_EVENT, () => { if (!aiEnabled()) setAiPaneOpen(false); });
  $("toggleAi").addEventListener("click", toggleAiPane);
  $("aiPaneClose").addEventListener("click", () => setAiPaneOpen(false));
  $("aiNewChat").addEventListener("click", newConversation);
  $("aiStop").addEventListener("click", () => controller?.abort());
  $("aiUseDocument").addEventListener("click", () => { useDocument = !useDocument; refreshLabels(); });
  $("aiUseSelection").addEventListener("click", () => { useSelection = !useSelection; refreshLabels(); });
  $("aiUseProject").addEventListener("click", () => { useProject = !useProject; writePreferenceFlag(PROJECT_KEY, useProject); refreshLabels(); });
  $("aiSummarizeFolder").addEventListener("click", () => runFolderTask("summary"));
  $("aiFindContradictions").addEventListener("click", () => runFolderTask("contradictions"));
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
  if (aiEnabled() && readPreferenceFlag(OPEN_KEY, false)) applyPane(true);
}
