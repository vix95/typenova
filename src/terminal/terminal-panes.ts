/** The screens of the terminals that are shown at once: one, or a layout of splits (side by side and one above the other, nested like the groups of a split editor), with a small bar on each screen and splitters between the parts. */
import { langText } from "../i18n/language";
import { ICONS } from "../ui/icons";
import { tabById, terminalState, type TerminalTab } from "./terminal-store";
import type { Layout, SplitDir } from "./terminal-model";

export interface PaneCallbacks {
  /** A pane got the keyboard or a click: its terminal becomes the active one. */
  onFocus: (id: string) => void;
  /** The user took a terminal off the screen (it stays open). */
  onHide: (id: string) => void;
}

const wrappers = new Map<string, HTMLElement>();
let signature = "";

/** Where the screen of this terminal goes (null when it is not on screen). */
export const paneBodyFor = (id: string): HTMLElement | null => wrappers.get(id)?.querySelector<HTMLElement>(".terminal-pane-body") ?? null;

function statusLabel(tab: TerminalTab): string {
  if (tab.status === "running") return langText("działa", "running");
  if (tab.status === "exited") return langText("zakończony", "ended");
  if (tab.status === "failed") return langText("nie uruchomiono", "failed to start");
  return langText("jeszcze nie uruchomiony", "not started yet");
}

function buildPane(tab: TerminalTab, callbacks: PaneCallbacks): HTMLElement {
  const pane = document.createElement("div");
  pane.className = "terminal-pane";
  pane.dataset.id = tab.setup.id;
  pane.setAttribute("role", "group");
  const bar = document.createElement("div");
  bar.className = "terminal-pane-bar";
  const dot = document.createElement("span"); dot.className = "terminal-status"; dot.setAttribute("aria-hidden", "true");
  const name = document.createElement("span"); name.className = "terminal-pane-name";
  const hide = document.createElement("button");
  hide.type = "button"; hide.className = "terminal-pane-close";
  hide.insertAdjacentHTML("afterbegin", ICONS.close);
  hide.addEventListener("click", () => callbacks.onHide(tab.setup.id));
  bar.append(dot, name, hide);
  const body = document.createElement("div");
  body.className = "terminal-pane-body";
  pane.append(bar, body);
  pane.addEventListener("focusin", () => callbacks.onFocus(tab.setup.id));
  bar.addEventListener("pointerdown", () => callbacks.onFocus(tab.setup.id));
  return pane;
}

/** Names, status and focus of the panes (cheap: runs on every change). */
function refreshBars(): void {
  const split = terminalState.panes.length > 1;
  for (const [id, pane] of wrappers) {
    const tab = tabById(id);
    if (!tab) continue;
    pane.classList.toggle("is-focused", id === terminalState.activeId);
    pane.setAttribute("aria-label", `${tab.setup.name}, ${statusLabel(tab)}`);
    const dot = pane.querySelector<HTMLElement>(".terminal-status");
    if (dot) dot.dataset.status = tab.status;
    const name = pane.querySelector<HTMLElement>(".terminal-pane-name");
    if (name) name.textContent = tab.setup.name;
    const hide = pane.querySelector<HTMLButtonElement>(".terminal-pane-close");
    if (hide) {
      const label = langText(`Ukryj „${tab.setup.name}” z widoku podzielonego (terminal nadal działa)`, `Hide “${tab.setup.name}” from the split view (the terminal keeps running)`);
      hide.dataset.tooltip = label; hide.setAttribute("aria-label", label); hide.hidden = !split;
    }
  }
}

/** A splitter between two neighbours of a split: dragged (or moved with the arrow keys) it gives one the size the other loses. The sizes are set on the elements themselves. */
function buildSplitter(before: HTMLElement, after: HTMLElement, siblings: readonly HTMLElement[], dir: SplitDir): HTMLElement {
  const rows = dir === "rows";
  const splitter = document.createElement("div");
  splitter.className = "terminal-pane-splitter";
  splitter.setAttribute("role", "separator");
  splitter.setAttribute("aria-orientation", rows ? "horizontal" : "vertical");
  splitter.tabIndex = 0;
  splitter.setAttribute("aria-label", rows ? langText("Zmień wysokość terminali", "Resize the terminals (height)") : langText("Zmień szerokość terminali", "Resize the terminals (width)"));
  splitter.dataset.tooltip = rows ? langText("Przeciągnij, aby zmienić wysokość terminali", "Drag to change the height of the terminals") : langText("Przeciągnij, aby zmienić szerokość terminali", "Drag to change the width of the terminals");
  const size = (element: HTMLElement): number => { const box = element.getBoundingClientRect(); return rows ? box.height : box.width; };
  const minimum = rows ? 70 : 120;
  /** Fixes the size of every part (so that the others keep theirs) and returns the sizes. */
  const snapshot = (): Map<HTMLElement, number> => { const sizes = new Map(siblings.map(element => [element, size(element)] as const)); for (const [element, value] of sizes) element.style.flex = `${value} 1 0px`; return sizes; };
  const move = (delta: number, from: Map<HTMLElement, number>) => {
    const a = from.get(before) ?? 1, b = from.get(after) ?? 1;
    const shift = Math.max(-(a - minimum), Math.min(b - minimum, delta));
    before.style.flex = `${a + shift} 1 0px`; after.style.flex = `${b - shift} 1 0px`;
  };
  splitter.addEventListener("pointerdown", event => {
    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);
    const start = snapshot(), from = rows ? event.clientY : event.clientX;
    document.body.classList.add("resizing-terminal-panes");
    const drag = (e: PointerEvent) => move((rows ? e.clientY : e.clientX) - from, start);
    const done = () => { splitter.removeEventListener("pointermove", drag); splitter.removeEventListener("pointerup", done); splitter.removeEventListener("pointercancel", done); document.body.classList.remove("resizing-terminal-panes"); };
    splitter.addEventListener("pointermove", drag); splitter.addEventListener("pointerup", done); splitter.addEventListener("pointercancel", done);
  });
  splitter.addEventListener("keydown", event => {
    const forward = rows ? "ArrowDown" : "ArrowRight", back = rows ? "ArrowUp" : "ArrowLeft";
    if (event.key !== forward && event.key !== back) return;
    event.preventDefault();
    move(event.key === forward ? 40 : -40, snapshot());
  });
  return splitter;
}

function buildNode(node: Layout, callbacks: PaneCallbacks): HTMLElement | null {
  if (node.kind === "pane") {
    const tab = tabById(node.id);
    if (!tab) return null;
    const pane = buildPane(tab, callbacks);
    wrappers.set(node.id, pane);
    return pane;
  }
  const container = document.createElement("div");
  container.className = `terminal-split-node is-${node.dir}`;
  const parts = node.children.map(child => buildNode(child, callbacks)).filter((part): part is HTMLElement => part !== null);
  parts.forEach((part, index) => {
    if (index > 0) container.append(buildSplitter(parts[index - 1], part, parts, node.dir));
    container.append(part);
  });
  return container;
}

/**
 * Draws the layout in `body`. It is rebuilt only when the layout changed (a terminal added, removed or moved), so that typing is never interrupted;
 * otherwise only the bars are refreshed. Returns true when it was rebuilt (the screens must then be put into the panes again).
 */
export function renderPanes(body: HTMLElement, empty: HTMLElement, callbacks: PaneCallbacks): boolean {
  const layout = terminalState.layout;
  const next = JSON.stringify(layout);
  const rebuilt = next !== signature;
  if (rebuilt) {
    signature = next;
    const hadFocus = body.contains(document.activeElement);
    for (const child of [...body.children]) if (child !== empty) child.remove();
    wrappers.clear();
    const root = layout ? buildNode(layout, callbacks) : null;
    if (root) body.append(root);
    if (hadFocus) requestAnimationFrame(() => tabById(terminalState.activeId ?? "")?.session.focus());
  }
  body.classList.toggle("is-split", terminalState.panes.length > 1);
  empty.hidden = terminalState.panes.length > 0;
  refreshBars();
  return rebuilt;
}
