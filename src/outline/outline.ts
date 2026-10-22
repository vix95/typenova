/** Virtualised heading outline: building, folding and active-heading tracking. */
import { readPreferenceJson, isStringArray } from "../settings/storage";
import { EditorView } from "@codemirror/view";
import { $ } from "../app/dom";
import { outlineBottomSpacer, outlineContent, outlineRoot, outlineTopSpacer } from "../app/workspace-dom";
import { documentState } from "../documents/document-state";
import { view } from "../editor/editor-view";
import { scrollSyncState, syncPreviewToEditor } from "../editor/scroll-sync";
import { langText } from "../i18n/language";
import { updateHeadingBreadcrumbs } from "./breadcrumbs";

export let outlineHeadings: { level: number; text: string; line: number; key: string }[] = [];
export let outlineParentIndexes: number[] = [];
export const outlineState = {
  outlineVisible: true as boolean,
  outlineTabId: "" as string,
  lastHeadingBreadcrumbSignature: "" as string,
};
let visibleOutlineHeadings: typeof outlineHeadings = [];
let visibleOutlineIndex = new Map<string, number>();
let headingIndexByKey = new Map<string, number>();
let lastOutlineRange: [number, number] = [-1, -1];
const OUTLINE_ROW_HEIGHT = 31;
export let collapsedHeadings = new Set<string>(readPreferenceJson("typenova.collapsed", isStringArray, []));
let lastOutlineActive = "";
const outlineButtons = new Map<string, HTMLButtonElement>();
export function buildOutline(headings: { level: number; text: string; line: number }[]) {
  const occurrences = new Map<string, number>();
  outlineHeadings = headings.map(h => { const base = `${h.level}:${h.text}`; const occurrence = occurrences.get(base) || 0; occurrences.set(base, occurrence + 1); return { ...h, key: `${base}:${occurrence}` }; });
  // Precompute the parent of every heading once. Cursor movement then walks only
  // the active heading's ancestry instead of scanning all headings in huge files.
  outlineParentIndexes = new Array(outlineHeadings.length).fill(-1);
  const hierarchyStack: number[] = [];
  for (let i = 0; i < outlineHeadings.length; i++) {
    const level = outlineHeadings[i].level;
    while (hierarchyStack.length && outlineHeadings[hierarchyStack[hierarchyStack.length - 1]].level >= level) hierarchyStack.pop();
    outlineParentIndexes[i] = hierarchyStack.length ? hierarchyStack[hierarchyStack.length - 1] : -1;
    hierarchyStack.push(i);
  }
  outlineState.outlineTabId = documentState.activeTabId;
  outlineState.lastHeadingBreadcrumbSignature = "";
  const validKeys = new Set(outlineHeadings.map(h => h.key));
  collapsedHeadings = new Set([...collapsedHeadings].filter(key => validKeys.has(key)));
  localStorage.setItem("typenova.collapsed", JSON.stringify([...collapsedHeadings]));
  $("headingCount").textContent = outlineHeadings.length.toLocaleString(document.documentElement.lang === "en" ? "en-US" : "pl-PL");
  headingIndexByKey = new Map(outlineHeadings.map((h, i) => [h.key, i]));
  lastOutlineActive = ""; recomputeVisibleOutline(); lastOutlineRange = [-1, -1]; renderOutlineWindow(true); updateActiveOutline(); updateHeadingBreadcrumbs();
}
export function navigateToHeadingLine(line: number) {
  const safeLine = Math.max(1, Math.min(view.state.doc.lines, Math.trunc(line) || 1));
  const pos = view.state.doc.line(safeLine).from;
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
  view.focus();
  if (scrollSyncState.syncScroll) syncPreviewToEditor();
}
function recomputeVisibleOutline() {
  const stack: number[] = []; visibleOutlineHeadings = [];
  for (const h of outlineHeadings) {
    while (stack.length && stack[stack.length - 1] >= h.level) stack.pop();
    const hidden = stack.length > 0;
    if (!hidden) visibleOutlineHeadings.push(h);
    if (collapsedHeadings.has(h.key)) stack.push(h.level);
  }
  visibleOutlineIndex = new Map(visibleOutlineHeadings.map((h, i) => [h.key, i]));
}
function scheduleOutlineWindow() {
  if ((scheduleOutlineWindow as any).pending) return;
  (scheduleOutlineWindow as any).pending = true;
  requestAnimationFrame(() => { (scheduleOutlineWindow as any).pending = false; renderOutlineWindow(); });
}
export function renderOutlineWindow(force = false) {
  if (!outlineHeadings.length) { outlineTopSpacer.style.height = "0px"; outlineBottomSpacer.style.height = "0px"; outlineContent.replaceChildren(); const p = document.createElement("p"); p.className = "muted"; p.textContent = langText("Brak nagłówków.", "No headings yet."); outlineContent.append(p); lastOutlineRange = [-1, -1]; return; }
  const viewportHeight = Math.max(300, outlineRoot.clientHeight || 500);
  const first = Math.max(0, Math.floor(outlineRoot.scrollTop / OUTLINE_ROW_HEIGHT) - 5);
  const last = Math.min(visibleOutlineHeadings.length - 1, Math.ceil((outlineRoot.scrollTop + viewportHeight) / OUTLINE_ROW_HEIGHT) + 5);
  outlineTopSpacer.style.height = `${first * OUTLINE_ROW_HEIGHT}px`;
  outlineBottomSpacer.style.height = `${Math.max(0, (visibleOutlineHeadings.length - last - 1) * OUTLINE_ROW_HEIGHT)}px`;
  if (!force && first === lastOutlineRange[0] && last === lastOutlineRange[1]) return;
  const fragment = document.createDocumentFragment(); outlineButtons.clear();
  for (let index = first; index <= last; index++) {
    const h = visibleOutlineHeadings[index]; const fullIndex = headingIndexByKey.get(h.key) ?? -1;
    const hasChildren = fullIndex >= 0 && fullIndex + 1 < outlineHeadings.length && outlineHeadings[fullIndex + 1].level > h.level;
    const row = document.createElement("div"); row.className = "outline-row"; row.dataset.key = h.key; row.style.height = `${OUTLINE_ROW_HEIGHT}px`; row.style.setProperty("--outline-depth", String(Math.max(0, h.level - 1)));
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = `outline-fold${hasChildren && !collapsedHeadings.has(h.key) ? " expanded" : ""}`;
    toggle.disabled = !hasChildren;
    toggle.setAttribute("aria-expanded", String(hasChildren && !collapsedHeadings.has(h.key)));
    if (hasChildren) {
      toggle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m6 3 5 5-5 5" /></svg>';
      toggle.title = langText(collapsedHeadings.has(h.key) ? "Rozwiń sekcję" : "Zwiń sekcję", collapsedHeadings.has(h.key) ? "Expand section" : "Collapse section");
      toggle.setAttribute("aria-label", toggle.title);
    } else {
      toggle.setAttribute("aria-hidden", "true");
      toggle.tabIndex = -1;
    }
    toggle.addEventListener("click", e => { e.stopPropagation(); if (collapsedHeadings.has(h.key)) collapsedHeadings.delete(h.key); else collapsedHeadings.add(h.key); localStorage.setItem("typenova.collapsed", JSON.stringify([...collapsedHeadings])); recomputeVisibleOutline(); lastOutlineRange = [-1, -1]; renderOutlineWindow(true); updateActiveOutline(); });
    const button = document.createElement("button"); button.className = `outline-item level-${h.level}${h.key === lastOutlineActive ? " active" : ""}`; button.textContent = h.text; button.title = `${langText("Linia", "Line")} ${h.line}`;
    button.addEventListener("click", () => { const line = Math.min(h.line, view.state.doc.lines), pos = view.state.doc.line(line).from; view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) }); view.focus(); if (scrollSyncState.syncScroll) syncPreviewToEditor(); });
    row.append(toggle, button); fragment.append(row); outlineButtons.set(h.key, button);
  }
  outlineContent.replaceChildren(fragment); lastOutlineRange = [first, last];
}
export function applyOutlineCollapse() { recomputeVisibleOutline(); lastOutlineRange = [-1, -1]; renderOutlineWindow(true); updateActiveOutline(); }
export function updateActiveOutline() {
  if (!outlineHeadings.length) return;
  const line = view.state.doc.lineAt(view.state.selection.main.head).number;
  let lo = 0, hi = outlineHeadings.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (outlineHeadings[mid].line <= line) lo = mid + 1; else hi = mid; }
  let active = outlineHeadings[Math.max(0, lo - 1)];
  if (active && visibleOutlineIndex.get(active.key) === undefined) {
    for (let i = Math.max(0, lo - 2); i >= 0; i--) { if (outlineHeadings[i].level < active.level && visibleOutlineIndex.has(outlineHeadings[i].key)) { active = outlineHeadings[i]; break; } }
  }
  if (!active || active.key === lastOutlineActive) return;
  outlineButtons.get(lastOutlineActive)?.classList.remove("active"); lastOutlineActive = active.key;
  let button = outlineButtons.get(active.key);
  if (scrollSyncState.syncScroll) {
    const index = visibleOutlineIndex.get(active.key);
    if (index !== undefined) { const top = index * OUTLINE_ROW_HEIGHT, bottom = top + OUTLINE_ROW_HEIGHT; if (top < outlineRoot.scrollTop || bottom > outlineRoot.scrollTop + outlineRoot.clientHeight) { outlineRoot.scrollTop = Math.max(0, top - outlineRoot.clientHeight / 2); lastOutlineRange = [-1, -1]; renderOutlineWindow(true); } button = outlineButtons.get(active.key); }
  }
  button?.classList.add("active");
}

export function initOutline(): void {
  outlineRoot.addEventListener("scroll", scheduleOutlineWindow, { passive: true });
}
