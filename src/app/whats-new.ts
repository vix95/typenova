/** "What's new": a large modal window with the last five versions, each with the day of its release and a few general words. It opens from the Help menu and closes with its button, the cross or Escape. */
import { $ } from "./dom";
import { langText } from "../i18n/language";
import { formatNewsDate, recentNews } from "./whats-new-data";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};

const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';

function header(dialog: HTMLDialogElement): HTMLElement {
  const title = el("div", "dialog-title", langText("Nowości", "What's new")); title.id = "whatsNewTitle";
  const subtitle = el("p", "settings-subtitle", langText("Co zmieniło się w ostatnich wersjach TypeNova.", "What changed in the latest versions of TypeNova.")); subtitle.id = "whatsNewDescription";
  const copy = el("div", "settings-heading-copy"); copy.append(title, subtitle);
  const dismiss = el("button", "settings-dismiss"); dismiss.type = "button"; dismiss.innerHTML = CLOSE_ICON;
  const label = langText("Zamknij nowości", "Close what's new");
  dismiss.dataset.tooltip = label; dismiss.setAttribute("aria-label", label);
  dismiss.addEventListener("click", () => dialog.close());
  const head = el("header", "settings-header"); head.append(copy, dismiss);
  return head;
}

function list(language: string): HTMLElement {
  const area = el("div", "whats-new-scroll"); const items = el("ol", "whats-new-list");
  recentNews().forEach((entry, index) => {
    const meta = el("div", "whats-new-meta");
    meta.append(el("span", "whats-new-version", entry.version));
    const date = el("time", "whats-new-date", formatNewsDate(entry.date, language)); date.dateTime = entry.date;
    meta.append(date);
    if (index === 0) meta.append(el("span", "whats-new-latest", langText("Najnowsza", "Latest")));
    const item = el("li", "whats-new-item");
    item.append(meta, el("p", "whats-new-text", langText(entry.pl, entry.en)));
    items.append(item);
  });
  area.append(items);
  return area;
}

function draw(dialog: HTMLDialogElement): void {
  const language = document.documentElement.lang || "en";
  const done = el("button", "primary", langText("Gotowe", "Done")); done.type = "button";
  done.addEventListener("click", () => dialog.close());
  const footer = el("footer", "whats-new-actions"); footer.append(done);
  const content = el("div", "dialog-content whats-new-content"); content.append(header(dialog), list(language), footer);
  dialog.replaceChildren(content);
}

/** Puts the window in the page and opens it from the menu item "Nowości". */
export function installWhatsNew(): void {
  const dialog = el("dialog"); dialog.id = "whatsNewDialog";
  dialog.setAttribute("aria-labelledby", "whatsNewTitle"); dialog.setAttribute("aria-describedby", "whatsNewDescription");
  document.body.append(dialog);
  draw(dialog);
  $("menuWhatsNew").addEventListener("click", () => {
    $("menuWhatsNew").closest("details")?.removeAttribute("open");
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>(".whats-new-actions .primary")?.focus({ preventScroll: true });
  });
  document.addEventListener("typenova:language-changed", () => draw(dialog));
}
