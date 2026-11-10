/** `[[links]]` in the editor: they are underlined, a tooltip says how to follow one, and Ctrl+click (Cmd+click on macOS) follows it to its section; while the key is held the pointer turns into a hand. */
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { followWikiLink } from "../app/wiki-link-navigation";
import { langText } from "../i18n/language";

// An embed (`![[image]]`) is not a link to a section.
const LINK = /(?<!!)\[\[([^\]\n]+)\]\]/g;
const HELD_CLASS = "cm-follow-key-held";
const isMac = (): boolean => /mac|iphone|ipad/i.test(navigator.platform || "");

/** The tooltip is written in the language that is current when the link is drawn. */
const markFor = () => Decoration.mark({
  class: "cm-wikilink",
  attributes: { "data-tooltip": isMac()
    ? langText("Cmd+klik, aby przejść do sekcji", "Cmd+click to go to the section")
    : langText("Ctrl+klik, aby przejść do sekcji", "Ctrl+click to go to the section") },
});
const decorator = new MatchDecorator({ regexp: LINK, decoration: () => markFor() });

const decorations = ViewPlugin.fromClass(class {
  set: DecorationSet;
  private readonly onKey = (event: KeyboardEvent): void => { this.setHeld(isMac() ? event.metaKey : event.ctrlKey); };
  private readonly onBlur = (): void => this.setHeld(false);
  constructor(private readonly view: EditorView) {
    this.set = decorator.createDeco(view);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    window.addEventListener("blur", this.onBlur);
  }
  update(update: ViewUpdate) { this.set = decorator.updateDeco(update, this.set); }
  /** Marks the editor while the key that follows a link is held: the style turns the pointer into a hand over links. */
  private setHeld(held: boolean): void { this.view.dom.classList.toggle(HELD_CLASS, held); }
  destroy(): void {
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    window.removeEventListener("blur", this.onBlur);
  }
}, { decorations: plugin => plugin.set });

/** The link under a position of the document, or null. */
function linkAt(view: EditorView, pos: number): string | null {
  const line = view.state.doc.lineAt(pos);
  const offset = pos - line.from;
  for (const match of line.text.matchAll(LINK)) {
    const from = match.index ?? 0;
    if (offset >= from && offset <= from + match[0].length) return match[1];
  }
  return null;
}

const follow = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const inner = pos === null ? null : linkAt(view, pos);
    if (inner === null) return false;
    event.preventDefault();
    void followWikiLink(inner);
    return true;
  },
});

export const wikiLinkExtension = [decorations, follow];
