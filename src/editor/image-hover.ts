/** Ctrl+hover preview for Markdown image syntax and links to images. */
import { convertFileSrc } from "@tauri-apps/api/core";
import { normalizePath } from "../filesystem/path-utils";
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { view } from "./editor-view";
import { langText } from "../i18n/language";

let leftCtrlHeld = false;
let lastEditorPointer: { x: number; y: number } | null = null;
let imageHoverPreview: HTMLDivElement | null = null;
let imageHoverImage: HTMLImageElement | null = null;
let imageHoverCaption: HTMLElement | null = null;
let imageHoverTimer = 0;
let imageHoverTargetKey = "";
let imageHoverSequence = 0;
const IMAGE_EXTENSIONS = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
function markdownImageLinkAtPosition(position: number): { target: string; alt: string } | null {
  const line = view.state.doc.lineAt(position);
  // Match both image syntax ![alt](path.png) and ordinary Markdown links pointing to images.
  const pattern = /(!?)\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line.text))) {
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (position < from || position > to) continue;
    const target = (match[3] || match[4] || "").trim().replace(/\\([()])/g, "$1");
    const targetPath = target.split(/[?#]/, 1)[0];
    if (!IMAGE_EXTENSIONS.test(targetPath) && !/^data:image\//i.test(target) && !/^blob:/i.test(target)) return null;
    return { target, alt: (match[2] || "").trim() };
  }
  return null;
}
function resolveHoverImageUrl(target: string): string | null {
  const trimmed = target.trim();
  if (/^(?:https?:\/\/|data:image\/|blob:|asset:|https:\/\/asset\.localhost)/i.test(trimmed)) return trimmed;
  let clean = trimmed.replace(/^file:\/\//i, "").split(/[?#]/, 1)[0];
  try { clean = decodeURIComponent(clean); } catch { /* Keep a literal percent in a valid local path. */ }
  if (!clean || !documentState.currentPath) return null;
  const isAbsolute = /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(clean);
  const parent = documentState.currentPath.replace(/[\\/][^\\/]*$/, "");
  const combined = isAbsolute ? clean : `${parent}/${clean.replace(/^\.\//, "")}`;
  return convertFileSrc(normalizePath(combined));
}
export function hideImageHoverPreview() {
  window.clearTimeout(imageHoverTimer);
  if (!imageHoverTargetKey && (!imageHoverPreview || imageHoverPreview.hidden)) return;
  imageHoverSequence++;
  imageHoverTargetKey = "";
  if (imageHoverPreview) imageHoverPreview.hidden = true;
}
function positionImageHoverPreview() {
  if (!imageHoverPreview || !lastEditorPointer) return;
  const editorRect = ($("editor") as HTMLElement).getBoundingClientRect();
  if (editorRect.width < 190 || editorRect.height < 120) return;
  const width = Math.min(420, editorRect.width - 16);
  const height = Math.min(340, editorRect.height - 16);
  let left = lastEditorPointer.x + 16;
  let top = lastEditorPointer.y + 18;
  if (left + width > editorRect.right - 8) left = lastEditorPointer.x - width - 16;
  if (top + height > editorRect.bottom - 8) top = lastEditorPointer.y - height - 16;
  left = Math.max(editorRect.left + 8, Math.min(left, editorRect.right - width - 8));
  top = Math.max(editorRect.top + 8, Math.min(top, editorRect.bottom - height - 8));
  imageHoverPreview.style.left = `${left}px`;
  imageHoverPreview.style.top = `${top}px`;
  imageHoverPreview.style.width = `${width}px`;
  imageHoverPreview.style.maxHeight = `${height}px`;
}
function updateImageHoverAt(x: number, y: number) {
  lastEditorPointer = { x, y };
  if (!leftCtrlHeld) { hideImageHoverPreview(); return; }
  const position = view.posAtCoords({ x, y }, false);
  if (position == null) { hideImageHoverPreview(); return; }
  const link = markdownImageLinkAtPosition(position);
  if (!link) { hideImageHoverPreview(); return; }
  const url = resolveHoverImageUrl(link.target);
  if (!url) { hideImageHoverPreview(); return; }
  const key = `${documentState.activeTabId}|${url}`;
  if (key === imageHoverTargetKey) {
    if (imageHoverPreview && !imageHoverPreview.hidden) positionImageHoverPreview();
    return;
  }
  window.clearTimeout(imageHoverTimer);
  imageHoverTargetKey = key;
  const sequence = ++imageHoverSequence;
  if (!imageHoverPreview) {
    imageHoverPreview = document.createElement("div");
    imageHoverPreview.id = "imageHoverPreview";
    imageHoverPreview.className = "image-hover-preview";
    imageHoverPreview.setAttribute("role", "tooltip");
    imageHoverPreview.hidden = true;
    imageHoverCaption = document.createElement("div");
    imageHoverCaption.className = "image-hover-preview-caption";
    imageHoverImage = document.createElement("img");
    imageHoverImage.className = "image-hover-preview-image";
    imageHoverImage.alt = "";
    imageHoverImage.decoding = "async";
    imageHoverImage.loading = "eager";
    imageHoverPreview.append(imageHoverCaption, imageHoverImage);
    document.body.append(imageHoverPreview);
  }
  const displayName = link.alt || link.target.split(/[\\/]/).pop() || link.target;
  if (imageHoverCaption) imageHoverCaption.textContent = `${langText("Podgląd obrazu", "Image preview")} · ${displayName}`;
  const image = imageHoverImage!;
  image.alt = displayName;
  let revealScheduled = false;
  const revealPreview = () => {
    if (revealScheduled || sequence !== imageHoverSequence || !leftCtrlHeld || imageHoverTargetKey !== key) return;
    revealScheduled = true;
    imageHoverTimer = window.setTimeout(() => {
      if (sequence !== imageHoverSequence || !leftCtrlHeld || imageHoverTargetKey !== key) return;
      positionImageHoverPreview();
      if (imageHoverPreview) imageHoverPreview.hidden = false;
    }, 130);
  };
  image.onerror = () => { if (sequence === imageHoverSequence) hideImageHoverPreview(); };
  image.onload = revealPreview;
  image.src = url;
  if (image.complete && image.naturalWidth > 0) revealPreview();
}
export function setupImageHoverPreview() {
  view.dom.addEventListener("pointermove", (event: PointerEvent) => {
    lastEditorPointer = { x: event.clientX, y: event.clientY };
    if (leftCtrlHeld) updateImageHoverAt(event.clientX, event.clientY);
    else hideImageHoverPreview();
  });
  view.dom.addEventListener("pointerleave", () => { lastEditorPointer = null; hideImageHoverPreview(); });
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.code === "ControlLeft" && !leftCtrlHeld) {
      leftCtrlHeld = true;
      if (lastEditorPointer) updateImageHoverAt(lastEditorPointer.x, lastEditorPointer.y);
    }
  }, true);
  document.addEventListener("keyup", (event: KeyboardEvent) => {
    if (event.code === "ControlLeft") { leftCtrlHeld = false; hideImageHoverPreview(); }
  }, true);
  window.addEventListener("blur", () => { leftCtrlHeld = false; lastEditorPointer = null; hideImageHoverPreview(); });
}
