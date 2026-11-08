/** Mermaid editor dialog: diagram source with starter templates, quick-insert lines and a flowchart builder, next to a live pannable preview. */
import { $ } from "../app/dom";
import { langText } from "../i18n/language";
import { renderMermaidSvg } from "../preview/mermaid";
import { releaseCustomSelects, refreshCustomSelect, syncCustomSelectControl, themeSelect } from "../ui/custom-select";
import { appConfirm } from "../ui/dialogs";
import { showToast } from "../ui/toast";
import { createDiagramViewport } from "./diagram-viewport";
import { createInspector, type Inspector } from "./mermaid-inspector";
import { createLineInspector } from "./mermaid-line-inspector";
import { createTextHistory } from "./text-history";
import { documentState } from "../documents/document-state";
import { view } from "./editor-view";
import { findMermaidBlockAt, flowchartNodeIds, mermaidKind, mermaidMarkdown } from "./formula-block";
import { LINK_STYLES, MERMAID_TEMPLATES, NODE_SHAPES, QUICK_LINES } from "./mermaid-templates";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};
const svgIcon = (paths: string) => `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${paths}</svg>`;
const ICON_ZOOM_IN = svgIcon('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14M7 5v4M5 7h4"/>');
const ICON_ZOOM_OUT = svgIcon('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14M5 7h4"/>');
const ICON_FIT = svgIcon('<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>');
const ICON_UNDO = svgIcon('<path d="M5 3 2 6l3 3"/><path d="M2 6h7a4 4 0 0 1 0 8H6"/>');
const ICON_REDO = svgIcon('<path d="m11 3 3 3-3 3"/><path d="M14 6H7a4 4 0 0 0 0 8h3"/>');
const option = (value: string, label: string) => { const node = el("option", "", label); node.value = value; return node; };

/** Inserts `text` on a new line after the line the caret is in, then puts the caret after it. */
function insertLine(source: HTMLTextAreaElement, text: string): void {
  const value = source.value, caret = source.selectionEnd;
  const lineEnd = value.indexOf("\n", caret) === -1 ? value.length : value.indexOf("\n", caret);
  const insert = (lineEnd === 0 && !value ? "" : "\n") + text;
  source.value = value.slice(0, lineEnd) + insert + value.slice(lineEnd);
  const position = lineEnd + insert.length;
  source.setSelectionRange(position, position); source.focus();
  source.dispatchEvent(new Event("input", { bubbles: true }));
}

function nextFreeId(ids: string[]): string {
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!ids.includes(letter)) return letter;
  return `N${ids.length + 1}`;
}

/** Row of buttons that insert ready-made lines for the kind of diagram being edited. */
function renderQuickLines(host: HTMLElement, kind: string, source: HTMLTextAreaElement): void {
  host.replaceChildren();
  const lines = QUICK_LINES[kind] ?? [];
  host.hidden = !lines.length;
  for (const line of lines) {
    const button = el("button", "mermaid-quick", langText(line.pl, line.en)); button.type = "button";
    button.title = line.text.trim(); button.addEventListener("click", () => insertLine(source, line.text)); host.append(button);
  }
}

/** Forms that add a node or a connection to a flowchart without typing the syntax. */
function buildFlowchartBuilder(source: HTMLTextAreaElement): { element: HTMLElement; sync: () => void } {
  const element = el("div", "mermaid-builder");
  const nodeRow = el("div", "mermaid-builder-row");
  const nodeId = el("input"); nodeId.type = "text"; nodeId.placeholder = langText("Id (np. A)", "Id (e.g. A)"); nodeId.setAttribute("aria-label", nodeId.placeholder);
  const nodeLabel = el("input"); nodeLabel.type = "text"; nodeLabel.placeholder = langText("Tekst węzła", "Node text"); nodeLabel.setAttribute("aria-label", nodeLabel.placeholder);
  const shape = el("select"); shape.setAttribute("aria-label", langText("Kształt węzła", "Node shape"));
  NODE_SHAPES.forEach((item, index) => shape.append(option(String(index), langText(item.pl, item.en))));
  const addNode = el("button", "", langText("Dodaj węzeł", "Add node")); addNode.type = "button";
  nodeRow.append(el("span", "mermaid-builder-title", langText("Nowy węzeł", "New node")), nodeId, nodeLabel, shape, addNode);

  const linkRow = el("div", "mermaid-builder-row");
  const from = el("select"), to = el("select"), style = el("select");
  from.setAttribute("aria-label", langText("Z węzła", "From node")); to.setAttribute("aria-label", langText("Do węzła", "To node")); style.setAttribute("aria-label", langText("Rodzaj połączenia", "Link style"));
  LINK_STYLES.forEach((item, index) => style.append(option(String(index), langText(item.pl, item.en))));
  const linkLabel = el("input"); linkLabel.type = "text"; linkLabel.placeholder = langText("Etykieta (opcjonalnie)", "Label (optional)"); linkLabel.setAttribute("aria-label", linkLabel.placeholder);
  const addLink = el("button", "", langText("Połącz", "Connect")); addLink.type = "button";
  linkRow.append(el("span", "mermaid-builder-title", langText("Nowe połączenie", "New link")), from, style, to, linkLabel, addLink);
  element.append(el("div", "mermaid-builder-head", langText("Kreator schematu – bez pisania składni", "Flowchart builder – no syntax needed")), nodeRow, linkRow);

  const sync = () => {
    const ids = flowchartNodeIds(source.value);
    for (const select of [from, to]) {
      const previous = select.value;
      select.replaceChildren(...ids.map(id => option(id, id)));
      if (ids.includes(previous)) select.value = previous;
    }
    if (to.options.length > 1 && from.value === to.value) to.selectedIndex = to.options.length - 1;
    refreshCustomSelect(from); refreshCustomSelect(to);
    addLink.disabled = ids.length < 2;
    nodeId.placeholder = nextFreeId(ids);
  };
  addNode.addEventListener("click", () => {
    const ids = flowchartNodeIds(source.value);
    const id = nodeId.value.trim() || nextFreeId(ids);
    if (!/^[A-Za-z_]\w*$/.test(id)) { showToast(langText("Id węzła: litery, cyfry i _ (bez spacji).", "Node id: letters, digits and _ (no spaces).")); nodeId.focus(); return; }
    const kind = NODE_SHAPES[Number(shape.value)];
    const text = nodeLabel.value.trim().replace(/["\n]/g, " ") || id;
    insertLine(source, `  ${id}${kind.open}"${text}"${kind.close}`); nodeId.value = ""; nodeLabel.value = "";
    if (ids.length) { from.value = ids[ids.length - 1]; to.value = id; syncCustomSelectControl(from); syncCustomSelectControl(to); } // the new node is ready as the target of a link
  });
  addLink.addEventListener("click", () => {
    if (!from.value || !to.value) return;
    const arrow = LINK_STYLES[Number(style.value)].arrow, label = linkLabel.value.trim().replace(/[|\n]/g, " ");
    insertLine(source, `  ${from.value} ${label ? `${arrow}|${label}|` : arrow} ${to.value}`); linkLabel.value = "";
  });
  return { element, sync };
}

/** Undo and redo buttons for the code, covering typing, templates, builders and clicks in the preview. */
function createHistoryControls(source: HTMLTextAreaElement) {
  const history = createTextHistory(source.value);
  let restoring = false;
  const make = (icon: string, label: string) => { const button = el("button", "mermaid-historybtn"); button.type = "button"; button.innerHTML = icon; button.title = label; button.setAttribute("aria-label", label.replace(/\s*\(.*\)$/, "")); return button; };
  const undoButton = make(ICON_UNDO, langText("Cofnij (Ctrl+Z)", "Undo (Ctrl+Z)")), redoButton = make(ICON_REDO, langText("Ponów (Ctrl+Y)", "Redo (Ctrl+Y)"));
  const sync = () => { undoButton.disabled = !history.canUndo(); redoButton.disabled = !history.canRedo(); };
  const restore = (value: string | null) => {
    if (value === null) return;
    restoring = true; source.value = value; source.dispatchEvent(new Event("input", { bubbles: true })); restoring = false; sync();
  };
  undoButton.addEventListener("click", () => { restore(history.undo()); source.focus(); });
  redoButton.addEventListener("click", () => { restore(history.redo()); source.focus(); });
  sync();
  return {
    undoButton, redoButton,
    /** For changes made by code that do not fire an input event. */
    record() { if (!restoring) { history.record(source.value, false); sync(); } },
    onInput(event: Event) { if (!restoring) { history.record(source.value, event instanceof InputEvent && !!event.inputType); sync(); } },
    /** Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z anywhere in the dialog except the small text fields, which keep their own undo. */
    handleKey(event: KeyboardEvent): boolean {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return false;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return false;
      event.preventDefault();
      restore(key === "y" || event.shiftKey ? history.redo() : history.undo());
      return true;
    },
  };
}

/** The flowchart inspector (nodes and links) and the line inspector (every other diagram type); the one matching the diagram's type is shown. */
function createInspectors(source: HTMLTextAreaElement) {
  const host = { getSource: () => source.value, setSource: (text: string) => { source.value = text; source.dispatchEvent(new Event("input", { bubbles: true })); } };
  const flow = createInspector(host), lines = createLineInspector(host);
  let current: Inspector = flow;
  return {
    elements: [flow.element, lines.element],
    pick: (target: Element | null) => current.pick(target),
    refresh: (root: HTMLElement) => { flow.refresh(root); lines.refresh(root); },
    setKind(kind: string) { current = kind === "flowchart" ? flow : lines; flow.setActive(kind === "flowchart"); lines.setActive(kind !== "flowchart"); },
    cancelLink: () => flow.cancelLink(),
  };
}

interface MermaidChoice { source: string }

async function askMermaid(initial: string, editing: boolean): Promise<MermaidChoice | null> {
  return new Promise(resolve => {
    const dialog = el("dialog", "mermaid-dialog"); dialog.setAttribute("aria-labelledby", "mermaidTitle");
    const content = el("div", "dialog-content mermaid-content");
    const title = el("div", "dialog-title", editing ? langText("Edytuj diagram", "Edit diagram") : langText("Edytor diagramów Mermaid", "Mermaid diagram editor")); title.id = "mermaidTitle";

    const templates = el("select", "mermaid-templates"); templates.setAttribute("aria-label", langText("Typ diagramu", "Diagram type"));
    templates.append(option("", langText("Zacznij od szablonu…", "Start from a template…")));
    MERMAID_TEMPLATES.forEach(template => templates.append(option(template.id, langText(template.pl, template.en))));
    const quick = el("div", "mermaid-quicklines");
    const source = el("textarea", "mermaid-source-input"); source.spellcheck = false; source.value = initial; source.setAttribute("aria-label", langText("Kod diagramu Mermaid", "Mermaid diagram code"));
    const history = createHistoryControls(source);
    const top = el("div", "mermaid-toolbar-top"); top.append(templates, history.undoButton, history.redoButton);
    const toolbar = el("div", "mermaid-toolbar"); toolbar.append(top, quick);

    const builder = buildFlowchartBuilder(source);
    const left = el("div", "mermaid-left"); left.append(toolbar, source, builder.element);

    const inspector = createInspectors(source);
    const viewport = createDiagramViewport(target => inspector.pick(target));
    const tools = el("div", "mermaid-viewtools");
    const toolButton = (label: string, icon: string, action: () => void) => { const button = el("button", "mermaid-viewtool"); button.innerHTML = icon; button.type = "button"; button.title = label; button.setAttribute("aria-label", label); button.addEventListener("click", action); return button; };
    tools.append(toolButton(langText("Powiększ", "Zoom in"), ICON_ZOOM_IN, () => viewport.zoomBy(1.25)), toolButton(langText("Pomniejsz", "Zoom out"), ICON_ZOOM_OUT, () => viewport.zoomBy(0.8)), toolButton(langText("Dopasuj do okna", "Fit to window"), ICON_FIT, () => viewport.fit()));
    const status = el("div", "mermaid-status"); status.setAttribute("role", "status");
    const right = el("div", "mermaid-right"); right.append(viewport.element, tools, ...inspector.elements, status);
    const columns = el("div", "mermaid-columns"); columns.append(left, right);

    const actions = el("div", "dialog-actions");
    const cancel = el("button", "", langText("Anuluj", "Cancel")); cancel.type = "button";
    const insert = el("button", "primary", editing ? langText("Zapisz", "Update") : langText("Wstaw", "Insert")); insert.type = "button";
    const hint = el("div", "dialog-hint", langText("Wybierz szablon albo pisz kod – podgląd odświeża się sam. W podglądzie: kółko myszy powiększa, przeciąganie przesuwa, dwuklik dopasowuje, a kliknięcie elementu diagramu pozwala go edytować. Ctrl+Enter wstawia diagram.", "Pick a template or write the code – the preview updates by itself. In the preview: mouse wheel zooms, dragging pans, double-click fits, and clicking an element of the diagram edits it. Ctrl+Enter puts the diagram into the document."));
    insert.title = "Ctrl+Enter"; source.placeholder = langText("Tu wpisz kod diagramu albo wybierz szablon powyżej…", "Write the diagram code here or pick a template above…");
    actions.append(cancel, insert); content.append(title, hint, columns, actions); dialog.append(content); document.body.append(dialog);
    dialog.querySelectorAll("select").forEach(themeSelect);

    let token = 0, timer: number | undefined, lastKind = "";
    const render = async () => {
      const mine = ++token, text = source.value;
      const kind = mermaidKind(text);
      if (kind !== lastKind) { lastKind = kind; renderQuickLines(quick, kind, source); builder.element.hidden = kind !== "flowchart"; inspector.setKind(kind); }
      builder.sync(); insert.disabled = !text.trim();
      if (!text.trim()) { viewport.clear(); status.textContent = ""; status.classList.remove("error"); return; }
      try {
        const svg = await renderMermaidSvg(text, `typenova-editor-${mine}-${Date.now()}`);
        if (mine !== token) return;
        viewport.setSvg(svg); inspector.refresh(viewport.element); status.textContent = langText("Diagram poprawny", "Diagram is valid"); status.classList.remove("error");
      } catch (error) {
        if (mine !== token) return;
        status.textContent = String((error as { message?: string })?.message ?? error).split("\n").slice(0, 4).join("\n"); status.classList.add("error");
      }
    };
    source.addEventListener("input", event => { history.onInput(event); window.clearTimeout(timer); timer = window.setTimeout(() => void render(), 300); builder.sync(); insert.disabled = !source.value.trim(); });
    source.addEventListener("keydown", event => {
      if (event.key !== "Tab" || event.shiftKey) return;
      event.preventDefault(); const { selectionStart: start, selectionEnd: end } = source;
      source.setRangeText("  ", start, end, "end"); source.dispatchEvent(new Event("input", { bubbles: true }));
    });
    templates.addEventListener("change", async () => {
      const template = MERMAID_TEMPLATES.find(item => item.id === templates.value); templates.value = "";
      if (!template) return;
      if (source.value.trim() && !await appConfirm(langText("Zastąpić obecny kod wybranym szablonem?", "Replace the current code with this template?"), { confirmLabel: langText("Zastąp", "Replace"), primaryAction: "cancel" })) return;
      source.value = template.source; history.record(); viewport.clear(); void render(); source.focus();
    });

    let settled = false;
    const finish = (choice: MermaidChoice | null) => { if (settled) return; settled = true; window.clearTimeout(timer); dialog.close(); releaseCustomSelects(dialog); dialog.remove(); resolve(choice); };
    cancel.addEventListener("click", () => finish(null));
    insert.addEventListener("click", () => finish({ source: source.value }));
    dialog.addEventListener("cancel", event => { event.preventDefault(); if (!inspector.cancelLink()) finish(null); });
    dialog.addEventListener("keydown", event => {
      if (history.handleKey(event)) return;
      if (event.key === "Escape" && inspector.cancelLink()) { event.preventDefault(); return; } if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !insert.disabled) { event.preventDefault(); insert.click(); } });
    dialog.showModal(); void render(); source.focus();
  });
}

/** Opens the editor for the diagram at the caret, or for a new one. */
export async function openMermaidEditor(): Promise<void> {
  // A .mmd / .mermaid file is one diagram: the editor works on the whole file.
  if (/\.(mmd|mermaid)$/i.test(documentState.currentPath || documentState.untitledLabel)) {
    const whole = view.state.doc.toString();
    const wholeChoice = await askMermaid(whole.trim() ? whole.replace(/\s+$/, "") : MERMAID_TEMPLATES[0].source, !!whole.trim());
    if (wholeChoice && wholeChoice.source.trim()) view.dispatch({ changes: { from: 0, to: whole.length, insert: wholeChoice.source.replace(/\s+$/, "") + "\n" }, userEvent: "input.diagram" });
    view.focus();
    return;
  }
  const { from, to } = view.state.selection.main;
  const found = findMermaidBlockAt(view.state.doc.toString(), from);
  const choice = await askMermaid(found ? found.source : MERMAID_TEMPLATES[0].source, !!found);
  if (!choice || !choice.source.trim()) { view.focus(); return; }
  const doc = view.state.doc;
  let insert = mermaidMarkdown(choice.source);
  let start = found ? found.from : from, end = found ? found.to : to;
  if (!found) {
    if (start > doc.lineAt(start).from) insert = "\n" + insert;
    if (end < doc.lineAt(end).to) insert += "\n";
  }
  view.dispatch({ changes: { from: start, to: end, insert }, selection: { anchor: start + insert.length }, scrollIntoView: true }); view.focus();
}

export function initMermaidEditor(): void {
  $("insertMermaid").addEventListener("click", () => void openMermaidEditor());
}
