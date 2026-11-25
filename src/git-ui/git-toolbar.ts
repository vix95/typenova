/** The buttons of the Git window that work on the repository as a whole (fetch, pull, push, stash), with the number of commits to pull and to push, and the strip that says an operation stopped and offers to continue or abort it. */
import { langText } from "../i18n/language";
import { ICONS } from "../ui/icons";
import type { GitOverview } from "./git-api";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};

export interface OpsToolbar { element: HTMLElement; update(overview: GitOverview | null): void }

/** A button with an icon, its name, and a number (the commits it would move) when there are some. */
function iconButton(icon: string, label: string, tooltip: string): { button: HTMLButtonElement; count: HTMLElement } {
  const button = el("button", "git-small-btn git-icon-btn"); button.type = "button";
  const count = el("span", "git-count"); count.hidden = true;
  button.innerHTML = icon;
  button.append(el("span", "", label), count);
  button.dataset.tooltip = tooltip; button.setAttribute("aria-label", tooltip);
  return { button, count };
}

export function createOpsToolbar(handlers: { fetch(): Promise<void>; pull(): Promise<void>; push(): Promise<void>; stash(): Promise<void> }): OpsToolbar {
  const element = el("div", "git-ops");
  const fetch = iconButton(ICONS.fetch, langText("Fetch", "Fetch"), langText("Pobierz wszystkie gałęzie i zmiany ze wszystkich zdalnych repozytoriów (fetch), usuwając gałęzie, których już nie ma", "Fetch all branches and changes from every remote, removing the branches that are gone"));
  const pull = iconButton(ICONS.pull, langText("Pull", "Pull"), langText("Pobierz zmiany do bieżącej gałęzi (pull, bez merge commita)", "Pull the changes into the current branch (no merge commit)"));
  const push = iconButton(ICONS.push, langText("Push", "Push"), langText("Wyślij bieżącą gałąź na serwer (push)", "Push the current branch to the server"));
  const stash = iconButton(ICONS.stash, langText("Stash", "Stash"), langText("Schowaj niezatwierdzone zmiany (stash)", "Stash the uncommitted changes"));
  fetch.button.addEventListener("click", () => void handlers.fetch());
  pull.button.addEventListener("click", () => void handlers.pull());
  push.button.addEventListener("click", () => void handlers.push());
  stash.button.addEventListener("click", () => void handlers.stash());
  element.append(fetch.button, pull.button, push.button, stash.button);
  const show = (target: { count: HTMLElement }, number: number, title: string): void => { target.count.hidden = !number; target.count.textContent = String(number); target.count.title = title; };
  return {
    element,
    update(overview) {
      const current = overview?.branches.find(branch => branch.current && !branch.remote);
      show(pull, current?.behind ?? 0, langText("commitów do pobrania", "commits to pull"));
      show(push, current?.ahead ?? 0, langText("commitów do wysłania", "commits to push"));
      push.button.disabled = !current; pull.button.disabled = !current; stash.button.disabled = !overview?.dirty;
    },
  };
}

/** The strip under the buttons while a merge, rebase, cherry-pick or revert waits: what it is, and how to go on. */
export function createOperationBanner(onContinue: () => void, onAbort: () => void): { element: HTMLElement; update(operation: string | null): void } {
  const element = el("div", "git-banner"); element.hidden = true; element.setAttribute("role", "status");
  const text = el("span", "git-banner-text");
  const go = el("button", "git-small-btn git-icon-btn"); go.type = "button"; go.innerHTML = ICONS.check; go.append(el("span", "", langText("Kontynuuj", "Continue")));
  const abort = el("button", "git-small-btn git-icon-btn"); abort.type = "button"; abort.innerHTML = ICONS.close; abort.append(el("span", "", langText("Przerwij", "Abort")));
  go.addEventListener("click", onContinue); abort.addEventListener("click", onAbort);
  element.append(text, go, abort);
  const names: Record<string, [string, string]> = {
    merge: ["Trwa scalanie (merge)", "A merge is in progress"], rebase: ["Trwa rebase", "A rebase is in progress"],
    "cherry-pick": ["Trwa cherry-pick", "A cherry-pick is in progress"], revert: ["Trwa revert", "A revert is in progress"],
  };
  return {
    element,
    update(operation) {
      element.hidden = !operation;
      if (!operation) return;
      const [pl, en] = names[operation] ?? [`Trwa operacja: ${operation}`, `An operation is in progress: ${operation}`];
      text.textContent = `${langText(pl, en)} — ${langText("rozwiąż konflikty w panelu zmian, potem kontynuuj, albo przerwij.", "resolve the conflicts in the changes panel, then continue, or abort.")}`;
    },
  };
}
