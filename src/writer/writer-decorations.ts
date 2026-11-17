/** The decorations of the Writer mode, built from the Markdown syntax tree for the part of the document that is on screen: elements are styled, and their syntax (`**`, `#`, `[](…)`, fences…) is hidden unless the caret or the selection touches the element. Everything hidden is inside one line, so a view plugin may provide it. */
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { documentState } from "../documents/document-state";
import { BulletWidget, CheckboxWidget, ImageWidget, LanguageWidget, MathWidget, RuleWidget } from "./writer-widgets";
import { inlineMath, isTaskDone, languageLabel, touches, type Span } from "./writer-model";
import { imageSource } from "./writer-paths";

export interface WriterDecorations { shown: DecorationSet; /** What the caret must jump over (the hidden syntax). */ atomic: DecorationSet }

const HIDDEN = Decoration.replace({});
const line = (name: string): Decoration => Decoration.line({ class: name });
const mark = (name: string): Decoration => Decoration.mark({ class: name });
const INLINE_CLASS: Record<string, string> = { StrongEmphasis: "cm-writer-strong", Emphasis: "cm-writer-em", Strikethrough: "cm-writer-strike", InlineCode: "cm-writer-code-inline" };
const INLINE_MARKS = new Set(["EmphasisMark", "CodeMark", "StrikethroughMark"]);

interface Context { state: EditorState; selection: readonly Span[]; shown: Range<Decoration>[]; atomic: Range<Decoration>[]; lines: Set<string> }

const lineTouched = (context: Context, from: number, to: number): boolean => touches(context.selection, context.state.doc.lineAt(from).from, context.state.doc.lineAt(to).to);

function hide(context: Context, from: number, to: number): void {
  if (to <= from) return;
  const range = HIDDEN.range(from, to);
  context.shown.push(range); context.atomic.push(range);
}

function replaceWith(context: Context, from: number, to: number, widget: WidgetType): void {
  const range = Decoration.replace({ widget }).range(from, to);
  context.shown.push(range); context.atomic.push(range);
}

/** A line decoration once per line and kind (a quote inside a list would otherwise be added twice). */
function lineClass(context: Context, at: number, name: string): void {
  const key = `${at}:${name}`;
  if (context.lines.has(key)) return;
  context.lines.add(key);
  context.shown.push(line(name).range(at));
}

/** The space after a block mark (`#`, `>`, `-`) goes with it. */
const withSpace = (state: EditorState, to: number): number => (state.sliceDoc(to, to + 1) === " " ? to + 1 : to);

function heading(context: Context, node: SyntaxNode, level: number): void {
  lineClass(context, context.state.doc.lineAt(node.from).from, `cm-writer-heading cm-writer-h${level}`);
}

function headerMark(context: Context, node: SyntaxNode): void {
  if (!node.parent?.name.startsWith("ATXHeading") || lineTouched(context, node.from, node.to)) return;
  hide(context, node.from, withSpace(context.state, node.to));
}

function inlineMarks(context: Context, node: SyntaxNode): void {
  const parent = node.parent;
  if (parent && INLINE_CLASS[parent.name] && !touches(context.selection, parent.from, parent.to)) hide(context, node.from, node.to);
}

function link(context: Context, node: SyntaxNode): void {
  const marks = node.getChildren("LinkMark");
  if (marks.length < 2 || !node.getChild("URL")) return;
  const label = { from: marks[0].to, to: marks[1].from };
  if (label.to > label.from) context.shown.push(mark("cm-writer-link").range(label.from, label.to));
  if (touches(context.selection, node.from, node.to)) { context.shown.push(mark("cm-writer-syntax").range(node.from, node.to)); return; }
  hide(context, marks[0].from, marks[0].to);
  hide(context, marks[1].from, node.to);
}

function image(context: Context, node: SyntaxNode): void {
  const url = node.getChild("URL");
  if (!url || touches(context.selection, node.from, node.to)) { context.shown.push(mark("cm-writer-syntax").range(node.from, node.to)); return; }
  const marks = node.getChildren("LinkMark");
  const alt = marks.length >= 2 ? context.state.sliceDoc(marks[0].to, marks[1].from) : "";
  const target = context.state.sliceDoc(url.from, url.to).trim().replace(/^<|>$/g, "");
  const source = imageSource(target, documentState.currentPath);
  if (source) replaceWith(context, node.from, node.to, new ImageWidget(source, alt));
}

function quote(context: Context, node: SyntaxNode, from: number, to: number): void {
  const doc = context.state.doc;
  for (let number = doc.lineAt(Math.max(node.from, from)).number; number <= doc.lineAt(Math.min(node.to, to)).number; number++) lineClass(context, doc.line(number).from, "cm-writer-quote");
}

function quoteMark(context: Context, node: SyntaxNode): void {
  if (!lineTouched(context, node.from, node.to)) hide(context, node.from, withSpace(context.state, node.to));
}

function listMark(context: Context, node: SyntaxNode): void {
  const item = node.parent, list = item?.parent;
  if (!item || !list || lineTouched(context, node.from, node.to)) return;
  if (item.getChild("Task")) { hide(context, node.from, withSpace(context.state, node.to)); return; }
  if (list.name === "BulletList") replaceWith(context, node.from, node.to, new BulletWidget());
}

function taskMarker(context: Context, node: SyntaxNode): void {
  const text = context.state.sliceDoc(node.from, node.to);
  const done = isTaskDone(text);
  if (done) lineClass(context, context.state.doc.lineAt(node.from).from, "cm-writer-task-done");
  if (!touches(context.selection, node.from, node.to)) replaceWith(context, node.from, node.to, new CheckboxWidget(done));
}

function fencedCode(context: Context, node: SyntaxNode, from: number, to: number): void {
  const doc = context.state.doc;
  const first = doc.lineAt(node.from), last = doc.lineAt(node.to);
  const open = touches(context.selection, node.from, node.to);
  // The closing fence may sit behind the marks of a quote (`> ```).
  const closed = last.number > first.number && /^[\s>]*(?:```|~~~)/.test(last.text);
  const info = node.getChild("CodeInfo");
  const label = info ? languageLabel(context.state.sliceDoc(info.from, info.to)) : "";
  for (let number = Math.max(first.number, doc.lineAt(from).number); number <= Math.min(last.number, doc.lineAt(to).number); number++) {
    const at = doc.line(number);
    const fence = number === first.number || (closed && number === last.number);
    const edge = number === first.number ? " cm-writer-code-first" : number === last.number && closed ? " cm-writer-code-last" : "";
    const bare = !open && number === first.number && !label ? " cm-writer-no-label" : "";
    lineClass(context, at.from, `cm-writer-code${edge}${open || !fence ? "" : " cm-writer-fence-hidden"}${bare}`);
    // The code of a block inside a quote: the marks of the quote are not code.
    const marks = !open && !fence ? /^(?:\s*>)+ ?/.exec(at.text) : null;
    if (marks) hide(context, at.from, at.from + marks[0].length);
  }
  if (open) return;
  if (first.to > first.from) replaceWith(context, first.from, first.to, new LanguageWidget(label));
  if (closed && last.to > last.from) hide(context, last.from, last.to);
}

/** A block of code made by indentation (no fences): its lines are one block, like a fenced one. */
function indentedCode(context: Context, node: SyntaxNode, from: number, to: number): void {
  const doc = context.state.doc;
  const first = doc.lineAt(node.from), last = doc.lineAt(node.to);
  for (let number = Math.max(first.number, doc.lineAt(from).number); number <= Math.min(last.number, doc.lineAt(to).number); number++) {
    lineClass(context, doc.line(number).from, `cm-writer-code${number === first.number ? " cm-writer-code-first" : ""}${number === last.number ? " cm-writer-code-last" : ""}`);
  }
}

function rule(context: Context, node: SyntaxNode): void {
  if (!lineTouched(context, node.from, node.to)) replaceWith(context, node.from, node.to, new RuleWidget());
}

function table(context: Context, node: SyntaxNode, from: number, to: number): void {
  // A top-level table is drawn as a table (writer-blocks.ts); its lines are styled as text only while its Markdown is shown, and for tables inside a list or a quote.
  if (node.parent?.name === "Document" && !lineTouched(context, node.from, node.to)) return;
  const doc = context.state.doc;
  const first = doc.lineAt(node.from).number;
  for (let number = Math.max(first, doc.lineAt(from).number); number <= Math.min(doc.lineAt(node.to).number, doc.lineAt(to).number); number++) {
    lineClass(context, doc.line(number).from, number === first ? "cm-writer-table-row cm-writer-table-head" : number === first + 1 ? "cm-writer-table-row cm-writer-table-delim" : "cm-writer-table-row");
  }
}

/** An empty line between blocks is a short gap, not a whole text line (a loose list or two paragraphs would be spread out otherwise); inside a code block, and on the line of the caret, it keeps its height. */
function blankLines(context: Context, from: number, to: number): void {
  const { doc } = context.state;
  const tree = syntaxTree(context.state);
  for (let number = doc.lineAt(from).number; number <= doc.lineAt(to).number; number++) {
    const row = doc.line(number);
    if (row.text.trim() !== "" || lineTouched(context, row.from, row.to)) continue;
    let inCode = false;
    for (let node: SyntaxNode | null = tree.resolveInner(row.from, 1); node && !inCode; node = node.parent) inCode = node.name === "FencedCode" || node.name === "CodeBlock";
    if (!inCode) lineClass(context, row.from, "cm-writer-blank");
  }
}

const NOT_MATH = new Set(["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock", "URL", "Table", "Image"]);

/** `$x$` and `$$x$$` inside the lines of a range become formulas (the TeX again while the caret is in one); not in code, a table or an address. A display formula that is a paragraph of its own is a block (writer-blocks.ts). */
function formulas(context: Context, from: number, to: number): void {
  const { doc } = context.state;
  const tree = syntaxTree(context.state);
  for (let number = doc.lineAt(from).number; number <= doc.lineAt(to).number; number++) {
    const row = doc.line(number);
    if (!row.text.includes("$")) continue;
    for (const item of inlineMath(row.text)) {
      const start = row.from + item.from, end = row.from + item.to;
      let skip = false;
      for (let node: SyntaxNode | null = tree.resolveInner(start, 1); node && !skip; node = node.parent) skip = NOT_MATH.has(node.name);
      if (skip) continue;
      if (touches(context.selection, start, end)) context.shown.push(mark("cm-writer-syntax").range(start, end));
      else replaceWith(context, start, end, new MathWidget(item.latex, false, false));
    }
  }
}

/** Decorations for the given ranges of the document (the visible ones), for the selection the state has. */
export function buildWriterDecorations(state: EditorState, ranges: readonly Span[]): WriterDecorations {
  const context: Context = { state, selection: state.selection.ranges, shown: [], atomic: [], lines: new Set() };
  const tree = syntaxTree(state);
  for (const { from, to } of ranges) {
    blankLines(context, from, to);
    formulas(context, from, to);
    tree.iterate({
      from, to,
      enter(ref) {
        const name = ref.name, node = ref.node;
        if (name.startsWith("ATXHeading")) heading(context, node, Number(name.slice(10)));
        else if (name === "SetextHeading1" || name === "SetextHeading2") heading(context, node, Number(name.slice(14)));
        else if (name === "HeaderMark") headerMark(context, node);
        else if (INLINE_CLASS[name]) context.shown.push(mark(INLINE_CLASS[name]).range(ref.from, ref.to));
        else if (INLINE_MARKS.has(name)) inlineMarks(context, node);
        else if (name === "Link") link(context, node);
        else if (name === "Image") { image(context, node); return false; }
        else if (name === "Blockquote") quote(context, node, from, to);
        else if (name === "QuoteMark") quoteMark(context, node);
        else if (name === "ListMark") listMark(context, node);
        else if (name === "TaskMarker") taskMarker(context, node);
        else if (name === "FencedCode") { fencedCode(context, node, from, to); return false; }
        else if (name === "CodeBlock") { indentedCode(context, node, from, to); return false; }
        else if (name === "HorizontalRule") { rule(context, node); return false; }
        else if (name === "Table") table(context, node, from, to);
        return undefined;
      },
    });
  }
  return { shown: Decoration.set(context.shown, true), atomic: Decoration.set(context.atomic, true) };
}
