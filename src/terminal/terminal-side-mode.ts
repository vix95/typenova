/** "Terminal + preview" mode: the work area is split in two, the terminals on the left (stacked one above another, up to four) and the preview of the open document on the right, with a divider that can be moved. The editor is out of the way until the mode is left. */
import { $ } from "../app/dom";
import { langText } from "../i18n/language";
import { previewState } from "../preview/preview-state";
import { readPreferenceFlag, readPreferenceNumber, writePreferenceFlag } from "../settings/preferences";

const SIDE_KEY = "typenova.terminal.sideMode";
const WIDTH_KEY = "typenova.terminal.sideShare";
/** The share of the work area the terminals may take. */
const MIN_SHARE = 0.2, MAX_SHARE = 0.8, DEFAULT_SHARE = 0.5, KEY_STEP = 0.03;

let active = false;
let share = DEFAULT_SHARE;
let splitter: HTMLElement | null = null;

const panel = (): HTMLElement => $("terminalPanel");

export const sideModeActive = (): boolean => active;

function applyShare(): void {
  // On the parent, so that the terminals and the preview (siblings) both read it.
  $("layout").style.setProperty("--side-terminal-grow", String(share));
  splitter?.setAttribute("aria-valuenow", String(Math.round(share * 100)));
}

function setShare(next: number, remember = true): void {
  share = Math.min(MAX_SHARE, Math.max(MIN_SHARE, next));
  applyShare();
  if (remember) { try { localStorage.setItem(WIDTH_KEY, String(share)); } catch { /* storage unavailable */ } }
}

function buildSplitter(): HTMLElement {
  const node = document.createElement("div");
  node.className = "terminal-side-splitter";
  node.setAttribute("role", "separator"); node.setAttribute("aria-orientation", "vertical");
  node.setAttribute("aria-valuemin", String(MIN_SHARE * 100)); node.setAttribute("aria-valuemax", String(MAX_SHARE * 100));
  node.tabIndex = 0;
  const label = langText("Zmień szerokość terminali i podglądu", "Resize the terminals and the preview");
  node.setAttribute("aria-label", label); node.dataset.tooltip = langText("Przeciągnij, aby zmienić podział między terminalami a podglądem", "Drag to change the split between the terminals and the preview");
  node.addEventListener("pointerdown", event => {
    event.preventDefault(); node.setPointerCapture(event.pointerId);
    const left = panel().getBoundingClientRect().left, total = panel().getBoundingClientRect().width + $("previewPane").getBoundingClientRect().width + node.getBoundingClientRect().width;
    document.body.classList.add("resizing-terminal-side");
    const move = (e: PointerEvent) => setShare((e.clientX - left) / Math.max(1, total), false);
    const done = () => { node.removeEventListener("pointermove", move); node.removeEventListener("pointerup", done); node.removeEventListener("pointercancel", done); document.body.classList.remove("resizing-terminal-side"); setShare(share); };
    node.addEventListener("pointermove", move); node.addEventListener("pointerup", done); node.addEventListener("pointercancel", done);
  });
  node.addEventListener("keydown", event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault(); setShare(share + (event.key === "ArrowRight" ? KEY_STEP : -KEY_STEP));
  });
  return node;
}

function applyLabels(): void {
  const label = active ? langText("Wyjdź z trybu terminal + podgląd (wróć do edytora)", "Leave the terminal + preview mode (back to the editor)") : langText("Terminal po lewej, podgląd po prawej (50/50)", "Terminal on the left, preview on the right (50/50)");
  const button = document.getElementById("terminalSideMode");
  if (button) { button.dataset.tooltip = label; button.setAttribute("aria-label", label); button.setAttribute("aria-pressed", String(active)); button.classList.toggle("is-active", active); }
  const menu = document.getElementById("menuViewTerminalSide");
  if (menu) menu.setAttribute("aria-pressed", String(active));
}

/** Turns the mode on or off. On: the terminal panel moves beside the preview and is shown (with a terminal), and the preview is shown. Off: the panel goes back under the editor. */
export function setSideMode(on: boolean, showPanel: (show: boolean) => void): void {
  if (on === active) return;
  active = on;
  writePreferenceFlag(SIDE_KEY, on);
  document.body.classList.toggle("side-terminal-mode", on);
  const preview = $("previewPane");
  if (on) {
    splitter ??= buildSplitter();
    preview.before(panel(), splitter);
    applyShare();
    showPanel(true);
    if (!previewState.previewVisible) ($("togglePreview") as HTMLButtonElement).click();
  } else {
    splitter?.remove();
    $("layout").style.removeProperty("--side-terminal-grow");
    $("layout").after(panel());
  }
  applyLabels();
  // The screens measure themselves when their box changes (a resize observer per screen); this makes sure the preview does too.
  window.requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

/** Reads what was saved and keeps the labels in step; the caller wires the buttons. */
export function restoreSideMode(showPanel: (show: boolean) => void): void {
  share = Math.min(MAX_SHARE, Math.max(MIN_SHARE, readPreferenceNumber(WIDTH_KEY, DEFAULT_SHARE, MIN_SHARE, MAX_SHARE)));
  applyLabels();
  if (readPreferenceFlag(SIDE_KEY, false)) setSideMode(true, showPanel);
}

export { applyLabels as applySideModeLabels };
