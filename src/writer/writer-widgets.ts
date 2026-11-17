/** The few widgets of the Writer mode: a bullet, a checkbox, a rule, a language label and an image. Each stands in for Markdown syntax that is hidden while the caret is elsewhere; clicking one puts the caret into its element, which shows the syntax again. */
import { EditorView, WidgetType } from "@codemirror/view";
import katex from "katex";
import type MarkdownIt from "markdown-it";
import { createMarkdownRenderer } from "../preview/markdown-renderer";
import { localImageUrl } from "../preview/code-blocks";
import { BULLET, toggledTask } from "./writer-model";
import type { ImageSource } from "./writer-paths";

export function caretInto(view: EditorView, element: HTMLElement): void {
  view.dispatch({ selection: { anchor: view.posAtDOM(element) } });
  view.focus();
}

export class BulletWidget extends WidgetType {
  eq(other: WidgetType): boolean { return other instanceof BulletWidget; }
  toDOM(): HTMLElement { const mark = document.createElement("span"); mark.className = "cm-writer-bullet"; mark.textContent = BULLET; mark.setAttribute("aria-hidden", "true"); return mark; }
}

export class CheckboxWidget extends WidgetType {
  constructor(private readonly done: boolean) { super(); }
  eq(other: WidgetType): boolean { return other instanceof CheckboxWidget && other.done === this.done; }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox"; box.checked = this.done; box.className = "cm-writer-checkbox"; box.tabIndex = -1;
    box.addEventListener("mousedown", event => {
      event.preventDefault();
      const from = view.posAtDOM(box);
      const next = toggledTask(view.state.sliceDoc(from, from + 3));
      if (next) view.dispatch({ changes: { from, to: from + 3, insert: next }, userEvent: "input.task" });
    });
    return box;
  }
}

export class RuleWidget extends WidgetType {
  eq(other: WidgetType): boolean { return other instanceof RuleWidget; }
  toDOM(view: EditorView): HTMLElement { const rule = document.createElement("span"); rule.className = "cm-writer-rule"; rule.addEventListener("mousedown", event => { event.preventDefault(); caretInto(view, rule); }); return rule; }
}

/** The language of a rendered code block, shown small on the right where its opening fence was. */
export class LanguageWidget extends WidgetType {
  constructor(private readonly label: string) { super(); }
  eq(other: WidgetType): boolean { return other instanceof LanguageWidget && other.label === this.label; }
  toDOM(): HTMLElement { const tag = document.createElement("span"); tag.className = "cm-writer-language"; tag.textContent = this.label; return tag; }
}

export class ImageWidget extends WidgetType {
  constructor(private readonly source: ImageSource, private readonly alt: string) { super(); }
  private get key(): string { return this.source.kind === "url" ? this.source.url : this.source.path; }
  eq(other: WidgetType): boolean { return other instanceof ImageWidget && other.key === this.key && other.alt === this.alt; }
  toDOM(view: EditorView): HTMLElement {
    const frame = document.createElement("span");
    frame.className = "cm-writer-image";
    const image = document.createElement("img");
    image.alt = this.alt; image.decoding = "async"; image.draggable = false;
    // An image that cannot be loaded shows its description, so the place of the syntax is never empty.
    image.addEventListener("error", () => { frame.classList.add("cm-writer-image-missing"); frame.textContent = this.alt || this.key; });
    frame.append(image);
    // A file on this computer is first allowed to the asset protocol (one file, checked by the host), the way the preview does it.
    if (this.source.kind === "url") image.src = this.source.url; else void localImageUrl(this.source.path).then(url => { image.src = url; });
    frame.addEventListener("mousedown", event => { event.preventDefault(); caretInto(view, frame); });
    return frame;
  }
  // The height is measured again when the picture arrives.
  get estimatedHeight(): number { return 120; }
}

/** A formula drawn by KaTeX (as the preview does): `display` is a block of its own, otherwise it sits in the line. A click puts the caret in the formula, which shows its TeX again. */
export class MathWidget extends WidgetType {
  constructor(private readonly latex: string, private readonly display: boolean, private readonly block: boolean) { super(); }
  eq(other: WidgetType): boolean { return other instanceof MathWidget && other.latex === this.latex && other.display === this.display && other.block === this.block; }
  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement(this.block ? "div" : "span");
    host.className = this.block ? "cm-writer-math-block" : "cm-writer-math";
    try { host.innerHTML = katex.renderToString(this.latex, { displayMode: this.display, throwOnError: false, strict: "ignore", trust: false }); } catch { host.textContent = this.latex; }
    host.addEventListener("mousedown", event => { event.preventDefault(); caretInto(view, host); });
    return host;
  }
  get estimatedHeight(): number { return this.block ? 56 : -1; }
  ignoreEvent(): boolean { return false; }
}

let renderer: MarkdownIt | null = null;

/** A table drawn as a real table, by the same Markdown renderer as the preview (so the cells have their formatting, and raw HTML is never let through). A click puts the caret in the table, which shows its Markdown again. */
export class TableWidget extends WidgetType {
  constructor(private readonly source: string, private readonly rows: number) { super(); }
  eq(other: WidgetType): boolean { return other instanceof TableWidget && other.source === this.source; }
  toDOM(view: EditorView): HTMLElement {
    renderer ??= createMarkdownRenderer();
    const host = document.createElement("div");
    host.className = "cm-writer-table";
    host.innerHTML = renderer.render(this.source);
    host.addEventListener("click", event => { if ((event.target as Element | null)?.closest("a")) event.preventDefault(); });
    host.addEventListener("mousedown", event => { event.preventDefault(); caretInto(view, host); });
    return host;
  }
  get estimatedHeight(): number { return this.rows * 30; }
  ignoreEvent(): boolean { return false; }
}
