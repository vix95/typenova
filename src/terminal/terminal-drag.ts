/** Dragging a terminal, as with documents: by its tab or by the bar of its screen, onto the side of a screen to split there, onto the middle of one to show it in its place, or along the tabs to move it. */
import { dropZone, zoneRect, type Zone } from "../documents/group-model";
import { langText } from "../i18n/language";
import { dropTerminal, moveTerminalTab, tabById } from "./terminal-store";

const START_DISTANCE = 6;

interface Drag { id: string; x: number; y: number; active: boolean }
type Target = { kind: "pane"; id: string; zone: Zone } | { kind: "tabs"; slot: number } | null;

let drag: Drag | null = null;
let ghost: HTMLElement | null = null, overlay: HTMLElement | null = null, line: HTMLElement | null = null;
let target: Target = null;

/** The terminal a pointer press belongs to: a tab, or the bar of a screen (not its buttons). */
function sourceOf(event: PointerEvent): string | null {
  const element = event.target as HTMLElement | null;
  if (!element || event.button !== 0 || element.closest("button, input, .terminal-tab-close")) return null;
  const tab = element.closest<HTMLElement>(".terminal-tab[data-id]");
  if (tab) return tab.dataset.id ?? null;
  const bar = element.closest<HTMLElement>(".terminal-pane-bar");
  return bar?.closest<HTMLElement>(".terminal-pane")?.dataset.id ?? null;
}

function targetAt(x: number, y: number): Target {
  const under = document.elementFromPoint(x, y);
  const strip = document.getElementById("terminalTabs");
  if (strip && under && strip.contains(under)) {
    const middles = [...strip.querySelectorAll<HTMLElement>(".terminal-tab[data-id]")].filter(tab => tab.dataset.id !== drag?.id).map(tab => { const box = tab.getBoundingClientRect(); return box.left + box.width / 2; });
    return { kind: "tabs", slot: middles.filter(middle => middle < x).length };
  }
  const pane = under?.closest<HTMLElement>("#terminalBody .terminal-pane[data-id]");
  if (!pane || pane.dataset.id === drag?.id) return null;
  const box = pane.getBoundingClientRect();
  return { kind: "pane", id: pane.dataset.id!, zone: dropZone(box.width, box.height, x - box.left, y - box.top) };
}

function paneBox(id: string): DOMRect | null { return document.querySelector<HTMLElement>(`#terminalBody .terminal-pane[data-id="${id}"]`)?.getBoundingClientRect() ?? null; }

function showTarget(next: Target, x: number): void {
  target = next;
  if (next?.kind === "pane") {
    const box = paneBox(next.id);
    if (!box) { hideMarks(); return; }
    overlay ??= document.body.appendChild(Object.assign(document.createElement("div"), { className: "group-drop-overlay" }));
    overlay.setAttribute("aria-hidden", "true");
    const part = zoneRect(next.zone);
    Object.assign(overlay.style, { left: `${box.left + part.left * box.width}px`, top: `${box.top + part.top * box.height}px`, width: `${part.width * box.width}px`, height: `${part.height * box.height}px` });
    overlay.dataset.zone = next.zone;
    overlay.textContent = next.zone === "center" ? langText("Upuść, aby pokazać tutaj", "Drop to show here") : langText("Upuść, aby podzielić ekran", "Drop to split the screen");
    line?.remove(); line = null;
  } else if (next?.kind === "tabs") {
    const strip = document.getElementById("terminalTabs")!.getBoundingClientRect();
    line ??= document.body.appendChild(Object.assign(document.createElement("div"), { className: "terminal-tab-drop-line" }));
    Object.assign(line.style, { left: `${x}px`, top: `${strip.top + 4}px`, height: `${strip.height - 8}px` });
    overlay?.remove(); overlay = null;
  } else hideMarks();
}

function hideMarks(): void { overlay?.remove(); overlay = null; line?.remove(); line = null; }

function finish(apply: boolean): void {
  const done = drag, chosen = target;
  drag = null; target = null;
  ghost?.remove(); ghost = null; hideMarks();
  document.body.classList.remove("terminal-dragging");
  window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("keydown", onKey, true);
  if (!done?.active) return;
  // The release would also click the tab or the bar: that click is not wanted.
  const swallow = (event: Event) => { event.stopPropagation(); event.preventDefault(); };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
  if (!apply || !chosen) return;
  if (chosen.kind === "pane") dropTerminal(done.id, chosen.id, chosen.zone);
  else moveTerminalTab(done.id, chosen.slot);
}

function onMove(event: PointerEvent): void {
  if (!drag) return;
  if (!drag.active) {
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < START_DISTANCE) return;
    drag.active = true;
    document.body.classList.add("terminal-dragging");
    ghost = document.body.appendChild(Object.assign(document.createElement("div"), { className: "terminal-drag-ghost", textContent: tabById(drag.id)?.setup.name ?? "" }));
    ghost.setAttribute("aria-hidden", "true");
  }
  if (ghost) { ghost.style.left = `${event.clientX + 12}px`; ghost.style.top = `${event.clientY + 12}px`; }
  showTarget(targetAt(event.clientX, event.clientY), event.clientX);
}

const onUp = (): void => finish(true);
function onKey(event: KeyboardEvent): void { if (event.key === "Escape") { event.stopPropagation(); finish(false); } }

/** Lets terminals be dragged by their tabs and screen bars. */
export function installTerminalDrag(): void {
  document.addEventListener("pointerdown", event => {
    const id = sourceOf(event);
    if (!id || drag) return;
    drag = { id, x: event.clientX, y: event.clientY, active: false };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp); window.addEventListener("keydown", onKey, true);
  });
}
