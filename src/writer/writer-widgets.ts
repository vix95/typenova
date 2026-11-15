/** The few widgets of the Writer mode: a bullet, a checkbox, a rule, a language label and an image. Each stands in for Markdown syntax that is hidden while the caret is elsewhere; clicking one puts the caret into its element, which shows the syntax again. */
import { EditorView, WidgetType } from "@codemirror/view";
import { localImageUrl } from "../preview/code-blocks";
import { BULLET, toggledTask } from "./writer-model";
import type { ImageSource } from "./writer-paths";

function caretInto(view: EditorView, element: HTMLElement): void {
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
