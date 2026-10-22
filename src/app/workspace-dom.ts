/** Owns the Preview, Outline and print scaffolding elements that the panels render into. */
import { $ } from "./dom";

export const preview = $("preview") as HTMLElement;
export const outlineRoot = $("outline") as HTMLElement;
export const outlineTopSpacer = document.createElement("div");
export const outlineContent = document.createElement("div");
export const outlineBottomSpacer = document.createElement("div");
export const previewTopSpacer = document.createElement("div");
export const previewContent = document.createElement("div");
export const previewBottomSpacer = document.createElement("div");
export const printArea = document.createElement("article");

export function initWorkspaceDom(): void {
  outlineTopSpacer.className = "outline-spacer";
  outlineBottomSpacer.className = "outline-spacer";
  outlineContent.className = "outline-content";
  outlineRoot.replaceChildren(outlineTopSpacer, outlineContent, outlineBottomSpacer);
  previewTopSpacer.className = "preview-spacer";
  previewBottomSpacer.className = "preview-spacer";
  previewContent.className = "preview-content";
  preview.replaceChildren(previewTopSpacer, previewContent, previewBottomSpacer);
  printArea.id = "printArea";
  document.body.append(printArea);
}
