/** Resizable node-preview pane. */
import { $ } from "../app/dom";
import { renderGraph } from "./graph-renderer";
import { graphUi } from "./graph-state";
import { langText } from "../i18n/language";

export function applyGraphPreviewWidth(width = graphUi.graphPreviewWidth) {
  const max = Math.max(280, Math.min(760, window.innerWidth - 360)); graphUi.graphPreviewWidth = Math.round(Math.max(280, Math.min(max, width)));
  $("brainView").style.setProperty("--brain-preview-width", `${graphUi.graphPreviewWidth}px`);
  const separator = $("brainPreviewResizer"); separator.setAttribute("aria-valuemin", "280"); separator.setAttribute("aria-valuemax", String(max));
  if (!window.matchMedia("(max-width: 620px)").matches) separator.setAttribute("aria-valuenow", String(graphUi.graphPreviewWidth));
}
let graphPreviewHeight = Math.max(180, Math.min(Math.round(window.innerHeight * .42), Number(localStorage.getItem("typenova.brain.previewHeight")) || Math.round(window.innerHeight * .42)));
export function applyGraphPreviewHeight(height = graphPreviewHeight) {
  const contentHeight = ($("brainWorkspaceContent") as HTMLElement).clientHeight || window.innerHeight - 220;
  const max = Math.max(180, Math.min(Math.round(window.innerHeight * .65), contentHeight - 186)); graphPreviewHeight = Math.round(Math.max(180, Math.min(max, height)));
  $("brainView").style.setProperty("--brain-preview-height", `${graphPreviewHeight}px`);
  const separator = $("brainPreviewResizer"); separator.setAttribute("aria-valuemin", "180"); separator.setAttribute("aria-valuemax", String(max));
  if (window.matchMedia("(max-width: 620px)").matches) separator.setAttribute("aria-valuenow", String(graphPreviewHeight));
}
export function syncGraphPreviewResizer() {
  const separator = $("brainPreviewResizer"); const horizontal = window.matchMedia("(max-width: 620px)").matches;
  separator.setAttribute("aria-orientation", horizontal ? "horizontal" : "vertical");
  separator.setAttribute("aria-label", horizontal ? langText("Zmień wysokość panelu treści", "Resize content panel height") : langText("Zmień szerokość panelu treści", "Resize content panel width"));
  if (horizontal) applyGraphPreviewHeight(); else applyGraphPreviewWidth();
}
let graphPreviewResizeRenderTimer: number | undefined;
function scheduleGraphResizeRender() {
  if (graphPreviewResizeRenderTimer !== undefined) window.clearTimeout(graphPreviewResizeRenderTimer);
  graphPreviewResizeRenderTimer = window.setTimeout(() => { graphPreviewResizeRenderTimer = undefined; if (document.body.classList.contains("graph-mode") && graphUi.graphSections.length) renderGraph(); }, 80);
}
const graphPreviewResizer = $("brainPreviewResizer") as HTMLElement;
let graphResizePointer: { id: number; startX: number; startY: number; startSize: number; horizontal: boolean } | null = null;
const endGraphPreviewResize = (event: PointerEvent) => { if (!graphResizePointer || graphResizePointer.id !== event.pointerId) return; graphResizePointer = null; graphPreviewResizer.classList.remove("is-resizing"); localStorage.setItem("typenova.brain.previewWidth", String(graphUi.graphPreviewWidth)); localStorage.setItem("typenova.brain.previewHeight", String(graphPreviewHeight)); scheduleGraphResizeRender(); };

export function initPreviewResizer(): void {
  applyGraphPreviewWidth();
  applyGraphPreviewHeight();
  syncGraphPreviewResizer();
  graphPreviewResizer.addEventListener("pointerdown", event => {
    if ((event as PointerEvent).button !== 0 || ($("brainPreview") as HTMLElement).hidden) return;
    const e = event as PointerEvent; graphResizePointer = { id: e.pointerId, startX: e.clientX, startY: e.clientY, startSize: window.matchMedia("(max-width: 620px)").matches ? graphPreviewHeight : graphUi.graphPreviewWidth, horizontal: window.matchMedia("(max-width: 620px)").matches };
    e.preventDefault(); graphPreviewResizer.classList.add("is-resizing"); try { graphPreviewResizer.setPointerCapture(e.pointerId); } catch { }
  });
  graphPreviewResizer.addEventListener("pointermove", event => {
    const e = event as PointerEvent; if (!graphResizePointer || graphResizePointer.id !== e.pointerId) return;
    if (graphResizePointer.horizontal) applyGraphPreviewHeight(graphResizePointer.startSize - (e.clientY - graphResizePointer.startY));
    else applyGraphPreviewWidth(graphResizePointer.startSize - (e.clientX - graphResizePointer.startX));
  });
  graphPreviewResizer.addEventListener("pointerup", endGraphPreviewResize);
  graphPreviewResizer.addEventListener("pointercancel", endGraphPreviewResize);
  graphPreviewResizer.addEventListener("keydown", event => {
    const e = event as KeyboardEvent; const horizontal = window.matchMedia("(max-width: 620px)").matches; let next: number | null = null; const current = horizontal ? graphPreviewHeight : graphUi.graphPreviewWidth;
    if ((horizontal && e.key === "ArrowUp") || (!horizontal && e.key === "ArrowLeft")) next = current - 20;
    else if ((horizontal && e.key === "ArrowDown") || (!horizontal && e.key === "ArrowRight")) next = current + 20;
    else if (e.key === "Home") next = horizontal ? 180 : 280;
    else if (e.key === "End") next = horizontal ? Math.max(180, Math.min(Math.round(window.innerHeight * .65), ($("brainWorkspaceContent") as HTMLElement).clientHeight - 186)) : Math.min(760, window.innerWidth - 360);
    if (next === null) return; e.preventDefault(); if (horizontal) applyGraphPreviewHeight(next); else applyGraphPreviewWidth(next); localStorage.setItem("typenova.brain.previewWidth", String(graphUi.graphPreviewWidth)); localStorage.setItem("typenova.brain.previewHeight", String(graphPreviewHeight)); scheduleGraphResizeRender();
  });
}
