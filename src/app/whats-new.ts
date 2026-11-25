/** "What's new": a small panel that stays beside the work (it is not a modal window) and lists the last five versions in a few general words. It opens from the Help menu and closes with its own button or Escape. */
import { $ } from "./dom";
import { langText } from "../i18n/language";
import { ICONS } from "../ui/icons";
import { recentNews } from "./whats-new-data";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};

function draw(panel: HTMLElement): void {
  const title = el("h2", "whats-new-title", langText("Nowości", "What's new"));
  const close = el("button", "whats-new-close"); close.type = "button"; close.innerHTML = ICONS.close;
  const label = langText("Zamknij nowości", "Close what's new");
  close.dataset.tooltip = label; close.setAttribute("aria-label", label);
  close.addEventListener("click", () => { panel.hidden = true; });
  const head = el("div", "whats-new-head"); head.append(title, close);
  const list = el("ol", "whats-new-list");
  for (const entry of recentNews()) {
    const item = el("li", "whats-new-item");
    item.append(el("span", "whats-new-version", entry.version), el("span", "whats-new-text", langText(entry.pl, entry.en)));
    list.append(item);
  }
  panel.setAttribute("aria-label", langText("Nowości", "What's new"));
  panel.replaceChildren(head, list);
}

/** Puts the panel in the page and opens it from the menu item "Nowości". */
export function installWhatsNew(): void {
  const panel = el("aside", "whats-new"); panel.id = "whatsNew"; panel.hidden = true; panel.setAttribute("role", "complementary");
  document.body.append(panel);
  draw(panel);
  $("menuWhatsNew").addEventListener("click", () => { panel.hidden = !panel.hidden; if (!panel.hidden) panel.querySelector<HTMLElement>("button")?.focus({ preventScroll: true }); });
  panel.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); panel.hidden = true; } });
  document.addEventListener("typenova:language-changed", () => draw(panel));
}
