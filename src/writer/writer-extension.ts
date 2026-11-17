/** The CodeMirror extension of the Writer mode: the decorations for what is on screen (rebuilt only when the text, the viewport, the selection or the syntax tree changes), the cursor jumping over hidden syntax, and Ctrl+click on a link. It lives in a compartment, so every editor and every document gets the same switch. */
import { syntaxTree } from "@codemirror/language";
import { Compartment, Prec, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { classifyLink } from "./writer-model";
import { buildWriterDecorations } from "./writer-decorations";
import { writerBlocks } from "./writer-blocks";

class WriterPlugin {
  shown: DecorationSet = Decoration.none;
  atomic: DecorationSet = Decoration.none;
  constructor(view: EditorView) { this.build(view); }
  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.selectionSet || syntaxTree(update.state) !== syntaxTree(update.startState)) this.build(update.view);
  }
  build(view: EditorView): void {
    const built = buildWriterDecorations(view.state, view.visibleRanges);
    this.shown = built.shown; this.atomic = built.atomic;
  }
}

const writerPlugin = ViewPlugin.fromClass(WriterPlugin, {
  decorations: plugin => plugin.shown,
  provide: plugin => EditorView.atomicRanges.of(view => view.plugin(plugin)?.atomic ?? Decoration.none),
});

/** What a Ctrl+click on a link does is decided by the application (open a web address, open a note), so the extension only reports it. */
export type LinkOpener = (target: ReturnType<typeof classifyLink>) => void;
let openLink: LinkOpener = () => undefined;
export function setLinkOpener(opener: LinkOpener): void { openLink = opener; }

const linkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
    const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (at === null) return false;
    let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(at, -1);
    while (node && node.name !== "Link") node = node.parent;
    const url = node?.getChild("URL");
    if (!node || !url) return false;
    event.preventDefault();
    openLink(classifyLink(view.state.sliceDoc(url.from, url.to)));
    return true;
  },
});

/** Called when the shortcut that switches the mode is pressed (Ctrl+/, as in Typora's source mode). */
let toggleHandler: () => void = () => undefined;
export function setWriterToggleHandler(handler: () => void): void { toggleHandler = handler; }
/** In every editor, also when the mode is off, so that the same key switches it on and off. */
export const writerShortcut: Extension = Prec.highest(keymap.of([{ key: "Mod-/", preventDefault: true, run: () => { toggleHandler(); return true; } }]));

export const writerCompartment = new Compartment();

/** The extensions of the mode: lines wrap (it is prose now), and the Markdown is rendered. */
export function writerExtensions(enabled: boolean): Extension {
  return enabled ? [writerPlugin, writerBlocks, linkClicks, EditorView.lineWrapping, EditorView.contentAttributes.of({ class: "cm-writer-content" })] : [];
}
