/** Theme, font size, wrapping and line-number preferences. */
import { type FontSizeLevel, FONT_SIZE_PIXELS } from "../editor/editor-preferences";
import { editorThemeFor, syntaxThemeFor } from "../editor/themes";
import { EditorView, lineNumbers } from "@codemirror/view";
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { editorThemeCompartment, lineNumbersCompartment, syntaxThemeCompartment, wrapping } from "../editor/compartments";
import { view } from "../editor/editor-view";
import { scheduleMinimapDraw } from "../editor/minimap";
import { renderGraphTree } from "../graph-ui/tree-renderer";
import { refreshMermaidTheme } from "../preview/mermaid";
import { heightCache, previewState } from "../preview/preview-state";
import { rebuildBlockOffsets, renderVirtualWindow } from "../preview/virtual-window";
import { syncCustomSelectControl } from "../ui/custom-select";

export let lineNumbersEnabled = localStorage.getItem("typenova.lineNumbers") !== "false";
let editorFontSizeLevel: FontSizeLevel = "small";
let previewFontSizeLevel: FontSizeLevel = "small";
export function applyFontSize(target: "editor" | "preview", requested: string, persist = true) {
  const level: FontSizeLevel = requested === "medium" || requested === "large" ? requested : "small";
  const oldLevel = target === "editor" ? editorFontSizeLevel : previewFontSizeLevel;
  const oldPixels = FONT_SIZE_PIXELS[oldLevel];
  const newPixels = FONT_SIZE_PIXELS[level];
  if (target === "editor") editorFontSizeLevel = level;
  else previewFontSizeLevel = level;
  document.documentElement.style.setProperty(`--${target}-font-size`, `${newPixels}px`);
  const select = $(target === "editor" ? "editorFontSizeSelect" : "previewFontSizeSelect") as HTMLSelectElement | null;
  if (select && select.value !== level) select.value = level;
  syncCustomSelectControl(select);
  if (persist) localStorage.setItem(`typenova.${target}FontSize`, level);
  if (target === "editor") {
    requestAnimationFrame(() => view.requestMeasure());
  } else if (oldPixels !== newPixels) {
    // Virtualized preview uses cached block heights for off-screen content. Scale estimates
    // immediately, then ResizeObserver replaces them with actual heights for mounted blocks.
    const ratio = newPixels / Math.max(1, oldPixels);
    for (const [key, height] of heightCache) heightCache.set(key, Math.max(24, height * ratio));
    previewState.previewBlocks = previewState.previewBlocks.map(block => ({ ...block, estimatedHeight: Math.max(24, block.estimatedHeight * ratio) }));
    rebuildBlockOffsets();
    previewState.lastRenderedRange = [-1, -1];
    requestAnimationFrame(() => renderVirtualWindow(true));
  }
}
export function applyTheme(theme: string) {
  const supported = ["midnight", "light", "newsprint", "retro", "contrast"];
  const selected = supported.includes(theme) ? theme : "midnight";
  document.documentElement.dataset.theme = selected;
  document.body.dataset.theme = selected;
  localStorage.setItem("typenova.theme", selected);
  for (const tab of documentState.tabs) {
    tab.state = tab.state.update({
      effects: [
        editorThemeCompartment.reconfigure(editorThemeFor(selected)),
        syntaxThemeCompartment.reconfigure(syntaxThemeFor(selected))
      ]
    }).state;
  }
  if (view) view.dispatch({ effects: [editorThemeCompartment.reconfigure(editorThemeFor(selected)), syntaxThemeCompartment.reconfigure(syntaxThemeFor(selected))] });
  const selector = $("themeSelect") as HTMLSelectElement; if (selector) selector.value = selected;
  syncCustomSelectControl(selector);
  const meta = document.querySelector('meta[name="color-scheme"]'); if (meta) meta.setAttribute("content", ["light", "newsprint"].includes(selected) ? "light" : "dark");
  scheduleMinimapDraw();
  refreshMermaidTheme();
  if (document.body.classList.contains("graph-mode") && document.getElementById("brainView")?.classList.contains("tree-view-mode")) {
    window.requestAnimationFrame(() => renderGraphTree());
  }
}
export function setWrapping(enabled: boolean) {
  localStorage.setItem("typenova.wrap", String(enabled));
  const toggle = $("wrapToggle") as HTMLInputElement; if (toggle) toggle.checked = enabled;
  for (const tab of documentState.tabs) tab.state = tab.state.update({ effects: wrapping.reconfigure(enabled ? EditorView.lineWrapping : []) }).state;
  view.dispatch({ effects: wrapping.reconfigure(enabled ? EditorView.lineWrapping : []) });
}
export function setLineNumbers(enabled: boolean) {
  lineNumbersEnabled = enabled;
  localStorage.setItem("typenova.lineNumbers", String(enabled));
  const toggle = $("lineNumbersToggle") as HTMLInputElement | null;
  if (toggle) toggle.checked = enabled;
  const extension = enabled ? lineNumbers() : [];
  for (const tab of documentState.tabs) {
    tab.state = tab.state.update({ effects: lineNumbersCompartment.reconfigure(extension) }).state;
  }
  view.dispatch({ effects: lineNumbersCompartment.reconfigure(extension) });
}
