/** The blocks of the Writer mode that take more than a line: a table is drawn as a table, a display formula (`$$ … $$`) as a formula. A block that is replaced by a widget cannot come from a view plugin, so these decorations are a state field; it looks at the top level of the Markdown syntax tree. The Markdown of a block is shown again as soon as the caret or the selection touches it. */
import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { mathBlock, touches } from "./writer-model";
import { MathWidget, TableWidget } from "./writer-widgets";

function build(state: EditorState): DecorationSet {
  const found: Range<Decoration>[] = [];
  const { doc, selection } = state;
  for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== "Table" && node.name !== "Paragraph") continue;
    const from = doc.lineAt(node.from).from, to = doc.lineAt(node.to).to;
    if (touches(selection.ranges, from, to)) continue;
    const text = doc.sliceString(from, to);
    if (node.name === "Table") { found.push(Decoration.replace({ widget: new TableWidget(text, doc.lineAt(to).number - doc.lineAt(from).number + 1), block: true }).range(from, to)); continue; }
    const latex = text.includes("$$") ? mathBlock(text) : null;
    if (latex) found.push(Decoration.replace({ widget: new MathWidget(latex, true, true), block: true }).range(from, to));
  }
  return Decoration.set(found, true);
}

/** The top-level tables and display formulas that are drawn as widgets now (the others, and the ones with the caret in them, show their Markdown). */
export const writerBlocks = StateField.define<DecorationSet>({
  create: build,
  update: (value, transaction) => (transaction.docChanged || transaction.selection || syntaxTree(transaction.state) !== syntaxTree(transaction.startState) ? build(transaction.state) : value),
  provide: field => EditorView.decorations.from(field),
});
