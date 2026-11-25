/** "What's new": a large modal window with the last five versions, each with the day of its release and a few general words. It opens from the Help menu and closes with its button, the cross or Escape. */
import { invoke } from "@tauri-apps/api/core";
import { $ } from "./dom";
import { langText } from "../i18n/language";
import { APP_VERSION } from "./app-version";
import { formatNewsDate, recentNews, shouldShowAfterUpdate } from "./whats-new-data";

const SEEN_KEY = "typenova.whatsNewSeenVersion";
const AFTER_UPDATE_DELAY_MS = 1200;

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
  // The window opens with the focus on this button; a tooltip repeating its visible words would only cover the list.
  done.dataset.tooltipDisabled = "true";
  done.autofocus = true;
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
  void openAfterUpdate(dialog);
}

function rememberSeen(): void { try { localStorage.setItem(SEEN_KEY, APP_VERSION); } catch { /* storage unavailable: it may show again, nothing is lost */ } }

/** After an update the window opens by itself once, in the main window only, so that the person sees what changed. When another dialog is open at that moment (a question at the start) it waits for it to close; the version is remembered when the window is shown, so it never repeats and is never skipped. */
async function openAfterUpdate(dialog: HTMLDialogElement): Promise<void> {
  if (new URLSearchParams(location.search).has("detach")) return;
  let seen: string | null;
  try { seen = localStorage.getItem(SEEN_KEY); } catch { return; }
  // The settings of the page cannot tell an update from a fresh install (the start itself writes some), so the host is asked whether the program was used here before.
  const earlierSession = seen === null && await invoke<boolean>("earlier_session").catch(() => false);
  if (!shouldShowAfterUpdate(seen, APP_VERSION, earlierSession)) { rememberSeen(); return; }
  const tryOpen = (): void => {
    if (dialog.open) { rememberSeen(); return; }
    if (document.querySelector("dialog[open]")) { window.setTimeout(tryOpen, AFTER_UPDATE_DELAY_MS); return; }
    dialog.showModal();
    rememberSeen();
    dialog.querySelector<HTMLElement>(".whats-new-actions .primary")?.focus({ preventScroll: true });
  };
  window.setTimeout(tryOpen, AFTER_UPDATE_DELAY_MS);
}
