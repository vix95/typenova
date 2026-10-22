/** Preview image lightbox: a click on a rendered image shows it enlarged in a modal dialog. */
import { preview } from "../app/workspace-dom";
import { langText } from "../i18n/language";

let dialog: HTMLDialogElement | null = null;

function lightboxElements() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "imageLightbox"; dialog.className = "image-lightbox";
  const header = document.createElement("div"); header.className = "image-lightbox-header";
  const caption = document.createElement("span"); caption.className = "image-lightbox-caption";
  const close = document.createElement("button");
  close.type = "button"; close.className = "image-lightbox-close";
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  header.append(caption, close);
  const image = document.createElement("img");
  image.className = "image-lightbox-image"; image.decoding = "async";
  dialog.append(header, image);
  // A click on the backdrop or on the margin around the image targets the dialog itself; the header and the image stay inert.
  dialog.addEventListener("click", event => {
    const target = event.target as Element;
    if (target === dialog || target.closest(".image-lightbox-close")) dialog?.close();
  });
  document.body.append(dialog);
  return dialog;
}

function openLightbox(source: HTMLImageElement) {
  const box = lightboxElements();
  const image = box.querySelector<HTMLImageElement>(".image-lightbox-image")!;
  const close = box.querySelector<HTMLButtonElement>(".image-lightbox-close")!;
  const closeLabel = langText("Zamknij podgląd obrazu", "Close image preview");
  close.setAttribute("aria-label", closeLabel); close.dataset.tooltip = closeLabel;
  const label = source.alt.trim() || langText("Powiększony obraz", "Enlarged image");
  box.setAttribute("aria-label", label);
  box.querySelector<HTMLElement>(".image-lightbox-caption")!.textContent = source.alt.trim();
  image.alt = source.alt; image.src = source.currentSrc || source.src;
  if (!box.open) box.showModal();
}

export function initImageLightbox(): void {
  preview.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || target.classList.contains("image-unavailable")) return;
    if (!target.complete || !target.naturalWidth || target.closest("a, button")) return;
    event.preventDefault(); openLightbox(target);
  });
}
