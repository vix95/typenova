/** Right-click menu of the media viewer: copy the shown image to the clipboard (a Mermaid diagram as SVG code). */
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readFile } from "@tauri-apps/plugin-fs";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";
import { copyTextToClipboard } from "./code-blocks";

function drawToPng(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    canvas.getContext("2d")!.drawImage(source, 0, 0);
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("no image data"))), "image/png");
  });
}

/** The file behind an address of the asset protocol (what `convertFileSrc` makes), or null for any other address. */
export function pathOfAssetUrl(src: string): string | null {
  try {
    const url = new URL(src);
    if (url.hostname !== "asset.localhost" && !(url.protocol === "asset:" && url.hostname === "localhost")) return null;
    const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
    return path || null;
  } catch { return null; }
}

/** PNG data of picture bytes: a bitmap is decoded at once, an SVG (which is not a bitmap) is drawn through an object URL of its own (a canvas stays clean for those). */
async function bytesAsPng(bytes: Uint8Array): Promise<Blob> {
  const data = new Uint8Array(bytes);
  try {
    const bitmap = await createImageBitmap(new Blob([data]));
    const blob = await drawToPng(bitmap, bitmap.width, bitmap.height); bitmap.close();
    return blob;
  } catch { /* not a bitmap: try it as SVG */ }
  const url = URL.createObjectURL(new Blob([data], { type: "image/svg+xml" }));
  try {
    const picture = new Image();
    picture.src = url;
    await picture.decode();
    return await drawToPng(picture, picture.naturalWidth || 1024, picture.naturalHeight || 1024);
  } finally { URL.revokeObjectURL(url); }
}

/**
 * PNG data of an image. The element itself cannot be drawn on a canvas and read back when it comes from the asset protocol or from the web (the canvas is
 * tainted: "SecurityError"), so the bytes are read from the file or fetched by the program, and decoded here. An image that is already local data (a data:
 * or blob: address, a diagram) is drawn as it is.
 */
async function imageAsPng(image: HTMLImageElement): Promise<Blob> {
  const src = image.currentSrc || image.src;
  const path = image.dataset.localPath || pathOfAssetUrl(src);
  if (path) {
    try { return await bytesAsPng(await readFile(path)); } catch { /* not readable: the element is tried below */ }
  }
  if (/^https?:/i.test(src)) return bytesAsPng(new Uint8Array(await invoke<ArrayBuffer>("fetch_remote_image", { url: src })));
  return drawToPng(image, image.naturalWidth, image.naturalHeight);
}

/** The address on the web a picture was loaded from; null for a file on this computer (the asset protocol), for data in the page and for anything that is not a picture. */
export function imageWebAddress(image: HTMLImageElement | null | undefined): string | null {
  const src = image?.currentSrc || image?.src || "";
  try {
    const url = new URL(src);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) return null;
    return url.href;
  } catch { return null; }
}

/** Opens the address a picture comes from in the browser of the system. */
export async function openImageLink(image: HTMLImageElement | null | undefined): Promise<void> {
  const url = imageWebAddress(image);
  if (!url) return;
  try { await openUrl(url); } catch { showToast(langText("Nie udało się otworzyć linku w przeglądarce.", "Could not open the link in your browser.")); }
}

export async function copyImage(image: HTMLImageElement): Promise<void> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": await imageAsPng(image) })]);
    showToast(langText("Skopiowano obraz do schowka.", "Image copied to the clipboard."));
  } catch (error) {
    showToast(`${langText("Nie udało się skopiować obrazu", "Could not copy the image")}: ${String(error)}`);
  }
}

/** Copies what the viewer shows: a picture as an image, a diagram as SVG code. */
export function copyShownMedia(stage: HTMLElement): void {
  const image = stage.querySelector("img"), svg = stage.querySelector("svg");
  if (image) void copyImage(image);
  else if (svg) void copyTextToClipboard(svg.outerHTML).then(ok => showToast(ok ? langText("Skopiowano kod SVG.", "SVG code copied.") : langText("Nie udało się skopiować.", "Could not copy.")));
}

/** Opens the link of the picture the viewer shows (when it comes from the web). */
export function openShownMediaLink(stage: HTMLElement): void { void openImageLink(stage.querySelector("img")); }

/** Adds the menu to the viewer dialog (inside it, so it is drawn in the dialog's top layer). */
export function attachMediaContextMenu(dialog: HTMLDialogElement, stage: HTMLElement): void {
  const menu = document.createElement("div"); menu.className = "context-menu media-context-menu"; menu.setAttribute("role", "menu"); menu.hidden = true;
  dialog.append(menu);
  const hide = () => { menu.hidden = true; };

  stage.addEventListener("contextmenu", event => {
    event.preventDefault(); event.stopPropagation();
    const image = stage.querySelector("img"), svg = stage.querySelector("svg");
    if (!image && !svg) return;
    const items: HTMLButtonElement[] = [];
    const add = (label: string, run: () => void) => {
      const button = document.createElement("button"); button.type = "button"; button.role = "menuitem"; button.textContent = label;
      button.addEventListener("click", () => { hide(); run(); });
      items.push(button);
    };
    add(image ? langText("Kopiuj obraz", "Copy image") : langText("Kopiuj kod SVG", "Copy SVG code"), () => copyShownMedia(stage));
    if (imageWebAddress(image)) add(langText("Otwórz link obrazu", "Open image link"), () => openShownMediaLink(stage));
    const item = items[0];
    menu.replaceChildren(...items);
    menu.hidden = false; menu.style.visibility = "hidden";
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`;
    menu.style.visibility = "visible"; item.focus({ preventScroll: true });
  });
  dialog.addEventListener("pointerdown", event => { if (!menu.hidden && !(event.target instanceof Node && menu.contains(event.target))) hide(); }, true);
  dialog.addEventListener("keydown", event => { if (event.key === "Escape" && !menu.hidden) { event.preventDefault(); event.stopPropagation(); hide(); } }, true);
  dialog.addEventListener("close", hide);
  window.addEventListener("blur", hide);
  stage.addEventListener("wheel", hide, { passive: true });
}
