/** Preview context menu. */
import { preview } from "../app/workspace-dom";
import { langText } from "../i18n/language";
import { copyTextToClipboard } from "./code-blocks";
import { showToast } from "../ui/toast";

let previewContextSelection = "";
let previewContextCodeText: string | null = null;
function previewContextMenuElement() {
  let menu = document.getElementById("previewContextMenu") as HTMLDivElement | null;
  if (menu) return menu;
  menu = document.createElement("div"); menu.id = "previewContextMenu"; menu.className = "context-menu preview-context-menu"; menu.hidden = true;
  menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", langText("Operacje na podglądzie", "Preview actions")); document.body.append(menu); return menu;
}
function showPreviewContextMenu(event: MouseEvent) {
  event.preventDefault(); event.stopPropagation();
  const target = event.target instanceof Element ? event.target : null;
  previewContextSelection = window.getSelection()?.toString() || "";
  const code = target?.closest("pre")?.querySelector("code");
  previewContextCodeText = code ? code.textContent || "" : null;
  const menu = previewContextMenuElement(); menu.replaceChildren();
  const add = (label: string, action: string, disabled = false, shortcut = "") => {
    const button = document.createElement("button"); button.type = "button"; button.role = "menuitem"; button.dataset.previewContext = action; button.textContent = label; button.disabled = disabled;
    if (shortcut) { const key = document.createElement("kbd"); key.textContent = shortcut; button.append(key); } menu.append(button); return button;
  };
  add(langText("Kopiuj zaznaczenie", "Copy selection"), "selection", !previewContextSelection.trim(), "Ctrl+C");
  if (previewContextCodeText !== null) add(langText("Kopiuj kod", "Copy code"), "code", false);
  if (!previewContextSelection.trim() && previewContextCodeText === null) { const hint = document.createElement("p"); hint.className = "context-menu-hint"; hint.textContent = langText("Najpierw zaznacz tekst w podglądzie.", "Select text in the preview first."); menu.append(hint); }
  menu.hidden = false; menu.style.visibility = "hidden"; menu.style.left = "0px"; menu.style.top = "0px";
  requestAnimationFrame(() => { const rect = menu.getBoundingClientRect(); menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8))}px`; menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`; menu.style.visibility = "visible"; (menu.querySelector("button:not(:disabled)") as HTMLButtonElement | null)?.focus({ preventScroll: true }); });
}
export let previewContextMenu!: HTMLDivElement;

export function initPreviewContextMenu(): void {
  preview.addEventListener("contextmenu", showPreviewContextMenu);
  previewContextMenu = previewContextMenuElement();
  previewContextMenu.addEventListener("click", async event => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-preview-context]"); if (!button || button.disabled) return;
    previewContextMenu.hidden = true;
    const text = button.dataset.previewContext === "code" ? (previewContextCodeText || "") : previewContextSelection;
    const copied = await copyTextToClipboard(text);
    showToast(copied ? langText("Skopiowano do schowka.", "Copied to clipboard.") : langText("Nie udało się skopiować treści.", "Could not copy the content."));
  });
  previewContextMenu.addEventListener("keydown", event => { const e = event as KeyboardEvent; const items = Array.from(previewContextMenu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')); if (!items.length) return; const current = items.indexOf(document.activeElement as HTMLButtonElement); if (e.key === "ArrowDown") { e.preventDefault(); items[(current + 1 + items.length) % items.length].focus(); } else if (e.key === "ArrowUp") { e.preventDefault(); items[(current - 1 + items.length) % items.length].focus(); } else if (e.key === "Escape") { e.preventDefault(); previewContextMenu.hidden = true; } });
}
