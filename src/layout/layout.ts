/** Pane width persistence and application. */
import { readPreferenceJson, isRecord } from "../settings/storage";
import { $ } from "../app/dom";

const initialUsableWidth = Math.max(700, window.innerWidth - 10);
export const preferences = { outline: Math.round(initialUsableWidth * .20), editor: Math.round(initialUsableWidth * .49), preview: Math.round(initialUsableWidth * .31) };
if (localStorage.getItem("typenova.layoutVersion") !== "2") {
  localStorage.removeItem("typenova.widths");
  localStorage.setItem("typenova.layoutVersion", "2");
}
export const layoutState = {
  savedWidthRatios: { unit: "ratio", outline: .20, editor: .49, preview: .31 } as { unit?: string; outline: number; editor: number; preview: number } | null,
};
const storedWidths = readPreferenceJson("typenova.widths", isRecord, {});
if (storedWidths.unit === "ratio"
  && [storedWidths.outline, storedWidths.editor, storedWidths.preview].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)
  && Math.abs(Number(storedWidths.outline) + Number(storedWidths.editor) + Number(storedWidths.preview) - 1) < 0.08) {
  layoutState.savedWidthRatios = {
    unit: "ratio",
    outline: Number(storedWidths.outline),
    editor: Number(storedWidths.editor),
    preview: Number(storedWidths.preview),
  };
} else if (typeof storedWidths.outline === "number" && Number.isFinite(storedWidths.outline) && storedWidths.outline > 0) {
  // Migrate legacy pixel values only when the entire saved layout is numeric and sane.
  const legacyWidths = [storedWidths.outline, storedWidths.editor, storedWidths.preview];
  if (legacyWidths.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) {
    Object.assign(preferences, { outline: storedWidths.outline, editor: storedWidths.editor, preview: storedWidths.preview });
    layoutState.savedWidthRatios = null;
  }
}
export function applyWidths() {
  const layout = $("layout") as HTMLElement;
  const width = layout.getBoundingClientRect().width || window.innerWidth;
  const usable = Math.max(1, width - 10);
  if (layoutState.savedWidthRatios) {
    preferences.outline = Math.round(usable * layoutState.savedWidthRatios.outline);
    preferences.editor = Math.round(usable * layoutState.savedWidthRatios.editor);
    preferences.preview = Math.round(usable * layoutState.savedWidthRatios.preview);
  }
  // Use the actual available width: a forced 760px minimum caused overflow and unexpected compression.
  const minPane = usable >= 760 ? 260 : Math.max(120, Math.floor(usable / 3));
  const minOutline = Math.min(245, Math.max(130, usable - 2 * minPane));
  const maxOutline = Math.max(minOutline, Math.min(460, usable - 2 * minPane));
  preferences.outline = Math.max(minOutline, Math.min(maxOutline, preferences.outline));
  const remaining = Math.max(1, usable - preferences.outline);
  const paneMin = Math.min(minPane, remaining / 2);
  preferences.editor = Math.max(paneMin, Math.min(remaining - paneMin, preferences.editor));
  preferences.preview = Math.max(paneMin, remaining - preferences.editor);
  layout.style.setProperty("--outline-width", `${preferences.outline}px`);
  layout.style.setProperty("--editor-width", `${preferences.editor}px`);
  layout.style.setProperty("--preview-width", `${preferences.preview}px`);
}
export function saveWidths() {
  const width = Math.max(1, ($("layout") as HTMLElement).getBoundingClientRect().width - 10);
  localStorage.setItem("typenova.widths", JSON.stringify({ unit: "ratio", outline: preferences.outline / width, editor: preferences.editor / width, preview: preferences.preview / width }));
  layoutState.savedWidthRatios = { unit: "ratio", outline: preferences.outline / width, editor: preferences.editor / width, preview: preferences.preview / width };
}
