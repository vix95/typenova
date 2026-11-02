/** Right-click menu of the media viewer: copy the shown image to the clipboard (a Mermaid diagram as SVG code). */
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

/** PNG data of an image: read from the file when its path is known (the asset protocol would taint a canvas), otherwise drawn from the element. */
async function imageAsPng(image: HTMLImageElement): Promise<Blob> {
  const path = image.dataset.localPath;
  if (path) {
    try {
      const bitmap = await createImageBitmap(new Blob([await readFile(path)]));
      const blob = await drawToPng(bitmap, bitmap.width, bitmap.height); bitmap.close();
      return blob;
    } catch { /* not readable or not a bitmap (SVG): draw the element below */ }
  }
  return drawToPng(image, image.naturalWidth, image.naturalHeight);
}

export async function copyImage(image: HTMLImageElement): Promise<void> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": await imageAsPng(image) })]);
    showToast(langText("Skopiowano obraz do schowka.", "Image copied to the clipboard."));
  } catch (error) {
    showToast(`${langText("Nie udało się skopiować obrazu", "Could not copy the image")}: ${String(error)}`);
  }
}

/** Adds the menu to the viewer dialog (inside it, so it is drawn in the dialog's top layer). */
export function attachMediaContextMenu(dialog: HTMLDialogElement, stage: HTMLElement): void {
  const menu = document.createElement("div"); menu.className = "context-menu media-context-menu"; menu.setAttribute("role", "menu"); menu.hidden = true;
  dialog.append(menu);
  const hide = () => { menu.hidden = true; };

  stage.addEventListener("contextmenu", event => {
    event.preventDefault(); event.stopPropagation();
    const image = stage.querySelector("img"), svg = stage.querySelector("svg");
    if (!image && !svg) return;
    const item = document.createElement("button"); item.type = "button"; item.role = "menuitem";
    item.textContent = image ? langText("Kopiuj obraz", "Copy image") : langText("Kopiuj kod SVG", "Copy SVG code");
    item.addEventListener("click", () => {
      hide();
      if (image) void copyImage(image);
      else if (svg) void copyTextToClipboard(svg.outerHTML).then(ok => showToast(ok ? langText("Skopiowano kod SVG.", "SVG code copied.") : langText("Nie udało się skopiować.", "Could not copy.")));
    });
    menu.replaceChildren(item);
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
