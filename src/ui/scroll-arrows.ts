/** Small up and down arrows at the right edge of the editors and of the preview: a click scrolls a page, Shift (or Ctrl) + click goes to the start or the end of the document. */
import { $ } from "../app/dom";
import { registerViewSetup } from "../editor/editor-view";
import { langText } from "../i18n/language";
import { ICONS } from "./icons";
import { canScroll, scrollDestination, type ScrollStep } from "./scroll-arrows-model";

/**
 * The end of the preview is estimated until its blocks are drawn, and drawing them can move the scroll position, so a jump to the end is repeated frame by frame
 * until the view has stayed at the end for `FRAMES_AT_END` frames in a row (or `SETTLE_FRAMES` frames have passed: half a second).
 */
const SETTLE_FRAMES = 30;
const FRAMES_AT_END = 6;

function labelFor(direction: "up" | "down"): { text: string; tooltip: string } {
  return direction === "up"
    ? { text: langText("Przewiń w górę", "Scroll up"), tooltip: langText("Przewiń w górę (Shift: na początek)", "Scroll up (Shift: to the start)") }
    : { text: langText("Przewiń w dół", "Scroll down"), tooltip: langText("Przewiń w dół (Shift: na koniec)", "Scroll down (Shift: to the end)") };
}

function reducedMotion(): boolean { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }

const canScrollDown = (scroller: HTMLElement): boolean => canScroll("down", scroller.scrollTop, scroller.clientHeight, scroller.scrollHeight);

function settleAtEnd(scroller: HTMLElement): void {
  let frames = 0, framesAtEnd = 0;
  const frame = (): void => {
    const more = canScrollDown(scroller);
    framesAtEnd = more ? 0 : framesAtEnd + 1;
    if (more) scroller.scrollTop = scrollDestination("bottom", scroller.scrollTop, scroller.clientHeight, scroller.scrollHeight);
    if (framesAtEnd < FRAMES_AT_END && ++frames < SETTLE_FRAMES) requestAnimationFrame(frame);
  };
  frame();
}

function go(scroller: HTMLElement, step: ScrollStep): void {
  if (step === "bottom") { settleAtEnd(scroller); return; }
  const top = scrollDestination(step, scroller.scrollTop, scroller.clientHeight, scroller.scrollHeight);
  if (step === "top") scroller.scrollTop = top;
  else scroller.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
}

function createButton(direction: "up" | "down", scroller: HTMLElement): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "scroll-arrow";
  button.dataset.direction = direction;
  button.innerHTML = direction === "up" ? ICONS.chevronUp : ICONS.chevronDown;
  // The editor keeps its focus (and its caret) when an arrow is pressed.
  button.addEventListener("mousedown", event => event.preventDefault());
  button.addEventListener("click", event => {
    const edge = event.shiftKey || event.ctrlKey;
    go(scroller, direction === "up" ? (edge ? "top" : "page-up") : (edge ? "bottom" : "page-down"));
  });
  return button;
}

/** Puts the arrows into `host` (a positioned element that frames `scroller`) and keeps them in step with the scroll position, the size and the language. */
export function attachScrollArrows(host: HTMLElement, scroller: HTMLElement): void {
  if (host.querySelector(":scope > .scroll-arrows")) return;
  const box = document.createElement("div");
  box.className = "scroll-arrows";
  const up = createButton("up", scroller), down = createButton("down", scroller);
  box.append(up, down);
  host.append(box);
  let frame = 0;
  const refresh = () => {
    frame = 0;
    const { scrollTop, clientHeight, scrollHeight } = scroller;
    up.disabled = !canScroll("up", scrollTop, clientHeight, scrollHeight);
    down.disabled = !canScroll("down", scrollTop, clientHeight, scrollHeight);
    // A document that fits in the view has nothing to scroll: the arrows are hidden, not just dimmed.
    box.hidden = up.disabled && down.disabled;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
  const label = () => {
    for (const button of [up, down]) {
      const { text, tooltip } = labelFor(button.dataset.direction as "up" | "down");
      button.setAttribute("aria-label", text);
      button.dataset.tooltip = tooltip;
    }
  };
  label();
  scroller.addEventListener("scroll", schedule, { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    // The content grows and shrinks while it is edited, rendered in blocks or folded; the preview replaces its children as it draws, so they are watched as they come.
    const watchChildren = () => { for (const child of Array.from(scroller.children)) observer.observe(child); schedule(); };
    watchChildren();
    new MutationObserver(watchChildren).observe(scroller, { childList: true });
  }
  document.addEventListener("typenova:language-changed", label);
  refresh();
}

/** Arrows for every editor (now and for each one a new group creates) and for the preview. Called by the scroll synchronisation, which owns the scrolling of both. */
export function installScrollArrows(): void {
  registerViewSetup(target => attachScrollArrows(target.dom, target.scrollDOM));
  attachScrollArrows($("previewPane"), $("preview"));
}
