/** Custom editor context menu. */
import { openAiEdit } from "../ai/edit-dialog";
import { prepareSpellSection } from "../spelling/spell-menu";
import { editHighlightAtSelection } from "./highlight-dialogs";
import { toggleHighlight } from "./highlights";
import { $ } from "../app/dom";
import { insertAtCursor, prefixLine, wrapSelection } from "./editing-commands";
import { registerViewSetup, view } from "./editor-view";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";
import { editBookmarkAtCaret } from "./bookmark-dialogs";
import { toggleBookmark } from "./bookmarks";

// Custom context menu aligned with the app's theme and editor commands.
const contextMenu = $("editorContextMenu") as HTMLElement;
/** Where the menu was asked to open, so that it can be placed again when its content changes. */
let menuPoint = { x: 0, y: 0 };

/** Puts the menu with its top left corner at the point, moved inside the window if it would not fit. */
function placeContextMenu(): void {
  const w = contextMenu.offsetWidth, h = contextMenu.offsetHeight;
  contextMenu.style.left = Math.max(8, Math.min(menuPoint.x, window.innerWidth - w - 8)) + "px";
  contextMenu.style.top = Math.max(8, Math.min(menuPoint.y, window.innerHeight - h - 8)) + "px";
  contextMenu.style.visibility = "visible";
}

/** Places the menu again after its content changed (the spelling suggestions arrive after the menu opened). */
export function relayoutEditorContextMenu(): void { placeContextMenu(); }

/** Shows the menu near a point (a mouse click, or a word when the menu is opened from the keyboard). */
export function openEditorContextMenuAt(x: number, y: number): void {
  menuPoint = { x, y };
  contextMenu.hidden = false; contextMenu.style.visibility = "hidden"; contextMenu.style.left = "0px"; contextMenu.style.top = "0px";
  requestAnimationFrame(placeContextMenu);
}

const showEditorContextMenu = (event: MouseEvent) => {
  event.preventDefault(); event.stopPropagation();
  prepareSpellSection(event.target, event.clientX, event.clientY, placeContextMenu);
  openEditorContextMenuAt(event.clientX, event.clientY);
};

export function initEditorContextMenu(): void {
  registerViewSetup(target => {
    target.contentDOM.addEventListener("contextmenu", showEditorContextMenu, true);
    target.dom.addEventListener("contextmenu", showEditorContextMenu, true);
  });
  contextMenu.addEventListener("click", async (event) => { const b = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-context]"); if (!b) return; contextMenu.hidden = true; const cmd = b.dataset.context; switch (cmd) { case "bold": wrapSelection("**", "**"); break; case "italic": wrapSelection("*", "*"); break; case "strike": wrapSelection("~~", "~~"); break; case "h1": prefixLine("# "); break; case "h2": prefixLine("## "); break; case "h3": prefixLine("### "); break; case "h4": prefixLine("#### "); break; case "h5": prefixLine("##### "); break; case "h6": prefixLine("###### "); break; case "code": wrapSelection("`", "`"); break; case "fence": insertAtCursor("\n```\n\n```\n"); break; case "link": wrapSelection("[", "](https://)"); break; case "quote": prefixLine("> "); break; case "list": prefixLine("- "); break; case "copy": document.execCommand("copy"); break; case "cut": document.execCommand("cut"); break; case "paste": try { const text = await navigator.clipboard.readText(); insertAtCursor(text); } catch { showToast(langText("Wklejanie wymaga uprawnienia do schowka.", "Pasting requires clipboard permission.")); } break; case "askClaude": openAiEdit(); break; case "highlight": void toggleHighlight(); break; case "highlightNote": editHighlightAtSelection(); break; case "bookmark": void toggleBookmark(); break; case "bookmarkNote": editBookmarkAtCaret(); break; case "selectAll": view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }); view.focus(); break; } });
  document.addEventListener("pointerdown", event => { if (!contextMenu.hidden && !contextMenu.contains(event.target as Node)) contextMenu.hidden = true; });
  document.addEventListener("keydown", event => { if (event.key === "Escape") contextMenu.hidden = true; });
}
