/** Visible white space in the editor: dots for spaces, arrows for tabs and a paragraph mark at the end of every line. */
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, highlightWhitespace, type DecorationSet, type ViewUpdate } from "@codemirror/view";

/** The preference that remembers whether white space is shown. */
export const WHITESPACE_KEY = "typenova.showWhitespace";

/** The mark after the last character of a line. It is drawn by an inline widget, so an empty line keeps its height. */
class LineEndMark extends WidgetType {
  eq(): boolean { return true; }
  ignoreEvent(): boolean { return true; }
  toDOM(): HTMLElement {
    const mark = document.createElement("span");
    mark.className = "cm-eol-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "¶";
    return mark;
  }
}

const lineEnd = Decoration.widget({ widget: new LineEndMark(), side: 1 });

/** One mark per line of the visible part of the document. */
function lineEndMarks(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let lastLineEnd = -1;
  for (const { from, to } of view.visibleRanges) {
    let position = from;
    while (position <= to) {
      const line = view.state.doc.lineAt(position);
      if (line.to > lastLineEnd) { builder.add(line.to, line.to, lineEnd); lastLineEnd = line.to; }
      position = line.to + 1;
    }
  }
  return builder.finish();
}

const lineEndPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = lineEndMarks(view); }
  update(update: ViewUpdate): void { if (update.docChanged || update.viewportChanged) this.decorations = lineEndMarks(update.view); }
}, { decorations: instance => instance.decorations });

/** Colours of the marks come from the theme (`--ui-muted`); the high-contrast theme draws them stronger. */
const whitespaceTheme = EditorView.baseTheme({
  ".cm-highlightSpace": { backgroundImage: "radial-gradient(circle at 50% 55%, var(--ui-muted, #8b98ad) 20%, transparent 5%)", opacity: "0.75" },
  ".cm-highlightTab": {
    backgroundImage: "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%2220%22 viewBox=%220 0 200 20%22%3E%3Cpath stroke=%22%238b98ad%22 stroke-width=%221%22 fill=%22none%22 d=%22M1 10H196L190 5M196 10L190 15%22/%3E%3C/svg%3E')",
    backgroundSize: "auto 100%", backgroundPosition: "right 90%", backgroundRepeat: "no-repeat", opacity: "0.75",
  },
});

/** The extension for the "show white space" setting: nothing when it is off. */
export function whitespaceExtension(enabled: boolean): Extension {
  return enabled ? [highlightWhitespace(), lineEndPlugin, whitespaceTheme] : [];
}
