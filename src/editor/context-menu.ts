/** Custom editor context menu. */
import { $ } from "../app/dom";
import { insertAtCursor, prefixLine, wrapSelection } from "./editing-commands";
import { view } from "./editor-view";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";

// Custom context menu aligned with the app's theme and editor commands.
const contextMenu = $("editorContextMenu") as HTMLElement;
const showEditorContextMenu = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); contextMenu.hidden = false; contextMenu.style.visibility = "hidden"; contextMenu.style.left = "0px"; contextMenu.style.top = "0px"; requestAnimationFrame(() => { const w = contextMenu.offsetWidth, h = contextMenu.offsetHeight; contextMenu.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - w - 8)) + "px"; contextMenu.style.top = Math.max(8, Math.min(event.clientY, window.innerHeight - h - 8)) + "px"; contextMenu.style.visibility = "visible"; }); };

export function initEditorContextMenu(): void {
  view.contentDOM.addEventListener("contextmenu", showEditorContextMenu, true);
  view.dom.addEventListener("contextmenu", showEditorContextMenu, true);
  contextMenu.addEventListener("click", async (event) => { const b = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-context]"); if (!b) return; contextMenu.hidden = true; const cmd = b.dataset.context; switch (cmd) { case "bold": wrapSelection("**", "**"); break; case "italic": wrapSelection("*", "*"); break; case "strike": wrapSelection("~~", "~~"); break; case "h1": prefixLine("# "); break; case "h2": prefixLine("## "); break; case "h3": prefixLine("### "); break; case "h4": prefixLine("#### "); break; case "h5": prefixLine("##### "); break; case "h6": prefixLine("###### "); break; case "code": wrapSelection("`", "`"); break; case "fence": insertAtCursor("\n```\n\n```\n"); break; case "link": wrapSelection("[", "](https://)"); break; case "quote": prefixLine("> "); break; case "list": prefixLine("- "); break; case "copy": document.execCommand("copy"); break; case "cut": document.execCommand("cut"); break; case "paste": try { const text = await navigator.clipboard.readText(); insertAtCursor(text); } catch { showToast(langText("Wklejanie wymaga uprawnienia do schowka.", "Pasting requires clipboard permission.")); } break; case "selectAll": view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }); view.focus(); break; } });
  document.addEventListener("pointerdown", event => { if (!contextMenu.hidden && !contextMenu.contains(event.target as Node)) contextMenu.hidden = true; });
  document.addEventListener("keydown", event => { if (event.key === "Escape") contextMenu.hidden = true; });
}
