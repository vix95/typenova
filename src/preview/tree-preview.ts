/** Tree view for JSON and XML files: the structure with arrows to fold and unfold branches, like a code editor's outline. */
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { documentMode } from "../documents/document-stats";
import { view } from "../editor/editor-view";
import { langText } from "../i18n/language";
import { ICONS } from "../ui/icons";
import { structuredTree, type StructuredKind, type TreeNode } from "./structured-preview";

/** Levels that are open when a file is shown for the first time. */
const OPEN_LEVELS = 2, REFRESH_DELAY = 140;

let root: HTMLElement | null = null, list: HTMLElement, notice: HTMLElement;
let timer = 0, shownText: string | null = null, shownPath = "", lastRoot: TreeNode | null = null, lastCut = false;
/** Which branches the user opened or closed, by their position; kept while the same file is edited. */
let openState = new Map<string, boolean>();

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};
const iconButton = (icon: string, label: () => string, onClick: () => void) => {
  const node = el("button", "tree-preview-tool"); node.type = "button"; node.innerHTML = icon;
  const apply = () => { node.title = label(); node.setAttribute("aria-label", label()); };
  apply(); node.addEventListener("click", onClick); node.addEventListener("mouseenter", apply);
  return node;
};

function treeKind(): StructuredKind | null {
  const mode = documentMode(documentState.currentPath || documentState.untitledLabel);
  return mode === "json" || mode === "xml" ? mode : null;
}
export const treePreviewActive = (): boolean => treeKind() !== null;

const isOpen = (path: string, depth: number) => openState.get(path) ?? depth < OPEN_LEVELS;

function setOpen(item: HTMLElement, node: TreeNode, path: string, depth: number, open: boolean): void {
  openState.set(path, open);
  item.setAttribute("aria-expanded", String(open));
  item.classList.toggle("open", open);
  const group = item.querySelector<HTMLElement>(":scope > ul");
  if (open && !group) item.append(renderChildren(node, path, depth));
  else if (group) group.hidden = !open;
  const toggle = item.querySelector<HTMLButtonElement>(":scope > .tree-row > .tree-toggle");
  if (toggle) { const label = open ? langText("Zwiń", "Collapse") : langText("Rozwiń", "Expand"); toggle.title = label; toggle.setAttribute("aria-label", label); }
}

function renderChildren(node: TreeNode, path: string, depth: number): HTMLElement {
  const group = el("ul", "tree-group"); group.setAttribute("role", "group");
  node.children.forEach((child, index) => group.append(renderNode(child, `${path}/${index}`, depth + 1)));
  return group;
}

function renderNode(node: TreeNode, path: string, depth: number): HTMLElement {
  const item = el("li", `tree-item tree-${node.kind}`); item.setAttribute("role", "treeitem");
  const row = el("div", "tree-row");
  const branch = node.children.length > 0;
  if (branch) {
    const toggle = el("button", "tree-toggle"); toggle.type = "button"; toggle.innerHTML = ICONS.chevronRight;
    toggle.addEventListener("click", event => { event.stopPropagation(); setOpen(item, node, path, depth, item.getAttribute("aria-expanded") !== "true"); });
    row.append(toggle);
  } else row.append(el("span", "tree-spacer"));
  const key = node.kind === "element" ? `<${node.key}>` : node.key;
  if (key) row.append(el("span", "tree-key", key));
  if (node.meta) row.append(el("span", "tree-meta", node.meta));
  if (node.value) row.append(el("span", `tree-value tree-value-${node.kind}`, node.value));
  item.append(row);
  if (branch) {
    row.addEventListener("click", () => setOpen(item, node, path, depth, item.getAttribute("aria-expanded") !== "true"));
    setOpen(item, node, path, depth, isOpen(path, depth));
  }
  return item;
}

function setAll(open: boolean): void {
  if (!lastRoot) return;
  openState = new Map();
  const walk = (node: TreeNode, path: string) => { if (node.children.length) openState.set(path, open); node.children.forEach((child, index) => walk(child, `${path}/${index}`)); };
  walk(lastRoot, "");
  if (!open) openState.set("", true); // the top level stays visible
  draw();
}

function draw(): void {
  list.replaceChildren();
  if (lastRoot) list.append(renderNode(lastRoot, "", 0));
  const cutText = lastCut ? langText("Pokazano tylko początek drzewa.", "Only the beginning of the tree is shown.") : "";
  if (!notice.dataset.error) { notice.textContent = cutText; notice.hidden = !cutText; }
}

function rebuild(kind: StructuredKind): void {
  const text = view.state.doc.toString();
  const path = documentState.currentPath || documentState.untitledLabel;
  if (text === shownText && shownPath === path) return;
  if (shownPath !== path) { openState = new Map(); lastRoot = null; }
  shownText = text; shownPath = path;
  const result = structuredTree(kind, text);
  if (result.error) {
    // The last good tree stays visible while the text is being typed.
    notice.dataset.error = "1";
    notice.textContent = langText(`Niepoprawny ${kind.toUpperCase()}: ${result.error}`, `Invalid ${kind.toUpperCase()}: ${result.error}`); notice.hidden = false;
    return;
  }
  delete notice.dataset.error;
  lastRoot = result.root; lastCut = result.cut;
  draw();
}

/** Shows or hides the tree for the active document and rebuilds it after the text changed. */
export function refreshTreePreview(immediate = false): void {
  if (!root) return;
  const kind = treeKind();
  $("previewPane").classList.toggle("tree-mode", kind !== null);
  root.hidden = kind === null;
  window.clearTimeout(timer);
  if (!kind) { shownText = null; lastRoot = null; list.replaceChildren(); return; }
  if (immediate) rebuild(kind); else timer = window.setTimeout(() => rebuild(kind), REFRESH_DELAY);
}

export function initTreePreview(): void {
  root = el("section", "tree-preview"); root.hidden = true;
  const bar = el("div", "tree-preview-bar");
  notice = el("span", "tree-preview-notice"); notice.setAttribute("role", "status"); notice.hidden = true;
  bar.append(notice,
    iconButton(ICONS.expandAll, () => langText("Rozwiń wszystko", "Expand all"), () => setAll(true)),
    iconButton(ICONS.collapseAll, () => langText("Zwiń wszystko", "Collapse all"), () => setAll(false)));
  list = el("ul", "tree-root"); list.setAttribute("role", "tree"); list.setAttribute("aria-label", langText("Struktura pliku", "File structure"));
  root.append(bar, list);
  $("preview").after(root);
}
