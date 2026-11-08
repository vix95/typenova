/** The branch and tag list of the Git panel: choosing one shows its history. */
import { ICONS } from "../ui/icons";
import { langText } from "../i18n/language";
import type { GitBranch, GitOverview } from "./git-api";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};

function badges(branch: GitBranch): HTMLElement[] {
  const result: HTMLElement[] = [];
  const badge = (kind: string, icon: string, count: number, label: string) => { const node = el("span", `git-badge ${kind}`); node.innerHTML = `${icon}<span>${count}</span>`; node.title = label; return node; };
  if (branch.ahead) result.push(badge("ahead", ICONS.arrowUp, branch.ahead, langText(`${branch.ahead} commitów do wysłania`, `${branch.ahead} commits to push`)));
  if (branch.behind) result.push(badge("behind", ICONS.arrowDown, branch.behind, langText(`${branch.behind} commitów do pobrania`, `${branch.behind} commits to pull`)));
  return result;
}

export interface BranchPanel {
  element: HTMLElement;
  render(overview: GitOverview, selected: string): void;
}

/** `onChoose` receives the branch, tag or hash to show, or an empty string for every branch. */
export function createBranchPanel(onChoose: (rev: string) => void): BranchPanel {
  const element = el("div", "git-branches");
  return {
    element,
    render(overview, selected) {
      const entry = (label: string, target: string, extra: HTMLElement[] = [], current = false, icon = "") => {
        const button = el("button", "git-branch"); button.type = "button"; button.setAttribute("aria-pressed", String(selected === target));
        button.classList.toggle("selected", selected === target); button.classList.toggle("current", current);
        if (icon) { const holder = el("span", "git-branch-icon"); holder.innerHTML = icon; button.append(holder); }
        const name = el("span", "git-branch-name", label); name.title = label;
        button.append(name, ...extra);
        button.addEventListener("click", () => onChoose(target));
        return button;
      };
      const section = (label: string, items: HTMLElement[]) => { if (items.length) element.append(el("div", "git-section", label), ...items); };
      element.replaceChildren(entry(langText("Wszystkie gałęzie", "All branches"), "", [], false, ICONS.layers));
      section(langText("Gałęzie lokalne", "Local branches"), overview.branches.filter(branch => !branch.remote).map(branch => entry(branch.name, branch.name, badges(branch), branch.current, branch.current ? ICONS.currentBranch : "")));
      section(langText("Zdalne", "Remote"), overview.branches.filter(branch => branch.remote).map(branch => entry(branch.name, branch.name)));
      section(langText("Tagi", "Tags"), overview.tags.map(tag => entry(tag.name, tag.name, [], false, ICONS.tag)));
    },
  };
}
