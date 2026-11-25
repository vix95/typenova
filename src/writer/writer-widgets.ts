/** The few widgets of the Writer mode: a bullet, a checkbox, a rule, a language label and an image. Each stands in for Markdown syntax that is hidden while the caret is elsewhere; clicking one puts the caret into its element, which shows the syntax again. */
import { EditorView, WidgetType } from "@codemirror/view";
import katex from "katex";
import { decorateCodeBlocks, localImageUrl } from "../preview/code-blocks";
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
/** What KaTeX made of a formula: a formula that scrolls out of view and back is not typeset again. */
const typeset = new Map<string, string>();

function typesetFormula(latex: string, display: boolean): string {
  const key = `${display ? "d" : "i"}\u0000${latex}`;
  const known = typeset.get(key);
  if (known !== undefined) return known;
  let html: string;
  try { html = katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: "ignore", trust: false }); } catch { html = ""; }
  if (typeset.size > 1500) typeset.clear();
  typeset.set(key, html);
  return html;
}

export class MathWidget extends WidgetType {
  constructor(private readonly latex: string, private readonly display: boolean, private readonly block: boolean) { super(); }
  eq(other: WidgetType): boolean { return other instanceof MathWidget && other.latex === this.latex && other.display === this.display && other.block === this.block; }
  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement(this.block ? "div" : "span");
    host.className = this.block ? "cm-writer-math-block" : "cm-writer-math";
    const html = typesetFormula(this.latex, this.display);
    if (html) host.innerHTML = html; else host.textContent = this.latex;
    host.addEventListener("mousedown", event => { event.preventDefault(); caretInto(view, host); });
    return host;
  }
  get estimatedHeight(): number { return this.block ? 56 : -1; }
  ignoreEvent(): boolean { return false; }
}


/** A click on a button or a link of a rendered block works as it is; a click anywhere else in it puts the caret in the block, which shows its Markdown. */
function enterOnClick(view: EditorView, host: HTMLElement): void {
  host.addEventListener("mousedown", event => {
    if ((event.target as Element | null)?.closest("button, a")) return;
    event.preventDefault();
    caretInto(view, host);
  });
}

/** What highlight.js made of a piece of code, so that a block drawn again (scrolled back into view) shows its colours at once. */
const highlighted = new Map<string, string>();
let highlighter: Promise<typeof import("highlight.js/lib/common")> | null = null;
let highlightLoaded: typeof import("highlight.js/lib/common").default | null = null;

/** Loads what the blocks of a document need (the highlighter, the Markdown renderer of the tables) while the window is idle, so that the first block does not wait for them. */
export function prepareWriterBlocks(): void {
  const run = (): void => {
    void (highlighter ??= import("highlight.js/lib/common")).then(module => { highlightLoaded = module.default; });
    void import("./table-widget");
  };
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 1500 }); else window.setTimeout(run, 300);
}
/** Code longer than this is shown without colours (highlighting it would stall the window). */
const MAX_HIGHLIGHTED_CHARS = 200_000;

async function highlightInto(code: HTMLElement, source: string, language: string): Promise<void> {
  if (!language || source.length > MAX_HIGHLIGHTED_CHARS) return;
  const key = `${language}\u0000${source}`;
  const known = highlighted.get(key);
  if (known !== undefined) { code.innerHTML = known; return; }
  const hljs = highlightLoaded ?? (highlightLoaded = (await (highlighter ??= import("highlight.js/lib/common"))).default);
  if (!hljs.getLanguage(language)) return;
  try {
    const html = hljs.highlight(source, { language, ignoreIllegals: true }).value;
    if (highlighted.size > 300) highlighted.clear();
    highlighted.set(key, html);
    code.innerHTML = html;
  } catch { /* the plain text stays */ }
}

/** A fenced code block drawn as the preview draws it: highlight.js colours, the language and the copy button above the code. The Markdown is shown when the caret is in the block. */
export class CodeBlockWidget extends WidgetType {
  constructor(private readonly source: string, private readonly language: string, private readonly rows: number) { super(); }
  eq(other: WidgetType): boolean { return other instanceof CodeBlockWidget && other.source === this.source && other.language === this.language; }
  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement("div");
    host.className = "markdown-body cm-writer-code-widget";
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    const language = this.language.replace(/[^a-z0-9_+#.-]/gi, "");
    code.className = `hljs${language ? ` language-${language}` : ""}`;
    code.textContent = this.source || " ";
    pre.append(code); host.append(pre);
    decorateCodeBlocks(host);
    void highlightInto(code, this.source, language.toLowerCase());
    enterOnClick(view, host);
    return host;
  }
  get estimatedHeight(): number { return this.rows * 22 + 34; }
  ignoreEvent(): boolean { return false; }
}

let diagramCount = 0;
const drawings = new Map<string, string>();

/** A diagram block (Mermaid) drawn as an image, as in the preview; a ```chart block is computed by the same code the preview uses. */
export class DiagramWidget extends WidgetType {
  constructor(private readonly source: string, private readonly language: string, private readonly rows: number) { super(); }
  eq(other: WidgetType): boolean { return other instanceof DiagramWidget && other.source === this.source && other.language === this.language; }
  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement("div");
    host.className = "markdown-body cm-writer-diagram";
    enterOnClick(view, host);
    if (this.language === "chart") {
      const pre = document.createElement("pre"); const code = document.createElement("code");
      code.className = "language-chart"; code.textContent = this.source; pre.append(code); host.append(pre);
      window.setTimeout(() => { void import("../data/chart-embed").then(module => module.renderChartBlock(pre)); }, 0);
    } else void this.draw(host);
    return host;
  }
  private async draw(host: HTMLElement): Promise<void> {
    const key = `${document.documentElement.dataset.theme ?? ""}\u0000${this.source}`;
    const known = drawings.get(key);
    if (known !== undefined) { host.innerHTML = known; return; }
    host.textContent = "…";
    try {
      const { renderMermaidSvg } = await import("../preview/mermaid");
      const svg = await renderMermaidSvg(this.source, `writer-diagram-${++diagramCount}`);
      const html = `<div class="mermaid-container">${svg}</div>`;
      if (drawings.size > 50) drawings.clear();
      drawings.set(key, html);
      host.innerHTML = html;
    } catch (error) {
      const pre = document.createElement("pre"); pre.className = "mermaid-source"; pre.title = String(error);
      const code = document.createElement("code"); code.textContent = this.source; pre.append(code);
      host.replaceChildren(pre);
    }
  }
  get estimatedHeight(): number { return Math.max(120, this.rows * 24); }
  ignoreEvent(): boolean { return false; }
}
