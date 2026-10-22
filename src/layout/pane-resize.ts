/** Splitter dragging and responsive pane behaviour. */
import { $ } from "../app/dom";
import { applyWidths, layoutState, preferences, saveWidths } from "./layout";
import { outlineState } from "../outline/outline";
import { previewState } from "../preview/preview-state";

// Resizers use viewport coordinates and window-level pointer events. This avoids
// pointer-capture edge cases and prevents the flex layout from feeding movement back.
let activeResize: { pointerId: number; lastX: number; which: string } | null = null;
function finishResize(event?: PointerEvent) { if (!activeResize) return; if (event && event.pointerId !== activeResize.pointerId) return; activeResize = null; document.body.classList.remove("resizing-panels"); saveWidths(); }

export function initPaneResize(): void {
  for (const splitter of Array.from(document.querySelectorAll<HTMLElement>(".splitter"))) {
    splitter.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const outlineWidth = $("outlinePane").getBoundingClientRect().width;
      const editorWidth = $("editorPane").getBoundingClientRect().width;
      const previewWidth = $("previewPane").getBoundingClientRect().width;
      if (outlineWidth > 0) preferences.outline = outlineWidth;
      if (editorWidth > 0) preferences.editor = editorWidth;
      if (previewWidth > 0) preferences.preview = previewWidth;
      layoutState.savedWidthRatios = null;
      activeResize = { pointerId: event.pointerId, lastX: event.clientX, which: splitter.dataset.split || "outline" };
      document.body.classList.add("resizing-panels");
    });
  }
  window.addEventListener("pointermove", (event: PointerEvent) => {
    const drag = activeResize; if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const delta = event.clientX - drag.lastX; drag.lastX = event.clientX;
    const layout = $("layout") as HTMLElement; const width = layout.getBoundingClientRect().width;
    const visibleOutline = outlineState.outlineVisible, visiblePreview = previewState.previewVisible;
    const visibleSplitters = (visibleOutline ? 1 : 0) + (visiblePreview ? 1 : 0);
    const usable = Math.max(1, width - visibleSplitters * 5), minPane = usable >= 760 ? 260 : Math.max(120, Math.floor(usable / 3));
    if (drag.which === "outline" && visibleOutline) {
      const minOther = Math.min(minPane, Math.max(1, (usable - 130) / 2));
      const minOutline = Math.min(245, Math.max(130, usable - 2 * minPane));
      const maxOutline = Math.max(minOutline, Math.min(460, usable - (visiblePreview ? 2 * minOther : minOther)));
      const next = Math.max(minOutline, Math.min(maxOutline, preferences.outline + delta));
      if (next === preferences.outline) return;
      const keepPreview = visiblePreview ? preferences.preview : 0;
      const remaining = usable - next;
      preferences.outline = next;
      // Keep the preview pane stable and let the editor absorb the delta; once
      // either other pane reaches its minimum, clamp the sidebar instead of shrinking them.
      if (visiblePreview) {
        const nextEditor = remaining - keepPreview;
        if (nextEditor >= minOther) { preferences.editor = nextEditor; preferences.preview = keepPreview; }
        else { preferences.outline = Math.max(minOutline, Math.min(maxOutline, usable - minOther - keepPreview)); preferences.editor = usable - preferences.outline - keepPreview; preferences.preview = keepPreview; }
      } else { preferences.editor = remaining; }
    } else if (drag.which === "preview" && visiblePreview) {
      const maxEditor = Math.max(minPane, usable - preferences.outline - minPane);
      const next = Math.max(minPane, Math.min(maxEditor, preferences.editor + delta));
      if (next === preferences.editor) return;
      preferences.editor = next;
      preferences.preview = Math.max(minPane, usable - preferences.outline - preferences.editor);
    }
    layoutState.savedWidthRatios = null; applyWidths();
  }, { passive: false });
  window.addEventListener("resize", () => { if (!activeResize) { applyWidths(); } });
  if (window.innerWidth <= 900) { outlineState.outlineVisible = false; $("outlinePane").classList.add("hidden"); $("layout").classList.add("outline-hidden"); $("toggleOutline").classList.remove("selected"); $("sidebarExpandButton").hidden = false; }
  window.addEventListener("pointerup", finishResize);
  window.addEventListener("pointercancel", finishResize);
}
