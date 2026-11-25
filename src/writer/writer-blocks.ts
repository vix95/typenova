/** The blocks of the Writer mode that take more than a line: a table is drawn as a table whose cells are edited in place, a display formula (`$$ … $$`) as a formula, a fenced code block as the preview draws code (a Mermaid or chart block as its diagram). A block that is replaced by a widget cannot come from a view plugin, so these decorations are a state field; it looks at the top level of the Markdown syntax tree. The Markdown of a block is shown again as soon as the caret or the selection touches it. */
import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { languageLabel, mathBlock, touches } from "./writer-model";
import { EditableTableWidget } from "./table-widget";
import { CodeBlockWidget, DiagramWidget, MathWidget } from "./writer-widgets";

const DIAGRAMS = new Set(["mermaid", "chart"]);

/** The widget for a top-level fenced code block: a diagram for Mermaid and chart blocks, the highlighted code for any other. */
function fenced(state: EditorState, from: number, to: number, infoText: string): Decoration {
  const { doc } = state;
  const first = doc.lineAt(from).number, last = doc.lineAt(to).number;
  const closed = last > first && /^\s*(?:```|~~~)/.test(doc.line(last).text);
  const lines: string[] = [];
  for (let number = first + 1; number <= (closed ? last - 1 : last); number++) lines.push(doc.line(number).text);
  const language = languageLabel(infoText).toLowerCase();
  const source = lines.join("\n");
  return Decoration.replace({ widget: DIAGRAMS.has(language) ? new DiagramWidget(source, language, lines.length) : new CodeBlockWidget(source, language, lines.length), block: true });
}

function build(state: EditorState): DecorationSet {
  const found: Range<Decoration>[] = [];
  const { doc, selection } = state;
  for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== "Table" && node.name !== "Paragraph" && node.name !== "FencedCode") continue;
    const from = doc.lineAt(node.from).from, to = doc.lineAt(node.to).to;
    if (touches(selection.ranges, from, to)) continue;
    if (node.name === "FencedCode") {
      const info = node.getChild("CodeInfo");
      found.push(fenced(state, from, to, info ? doc.sliceString(info.from, info.to) : "").range(from, to));
      continue;
    }
    const text = doc.sliceString(from, to);
    if (node.name === "Table") { found.push(Decoration.replace({ widget: new EditableTableWidget(text), block: true }).range(from, to)); continue; }
    const latex = text.includes("$$") ? mathBlock(text) : null;
    if (latex) found.push(Decoration.replace({ widget: new MathWidget(latex, true, true), block: true }).range(from, to));
  }
  return Decoration.set(found, true);
}

/** The top-level tables, display formulas, code blocks and diagrams that are drawn as widgets now (the others, and the ones with the caret in them, show their Markdown). */
export const writerBlocks = StateField.define<DecorationSet>({
  create: build,
  update: (value, transaction) => (transaction.docChanged || transaction.selection || syntaxTree(transaction.state) !== syntaxTree(transaction.startState) ? build(transaction.state) : value),
  provide: field => EditorView.decorations.from(field),
});
