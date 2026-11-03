/** The branch and tag list of the Git panel: choosing one shows its history. */
import { langText } from "../i18n/language";
import type { GitBranch, GitOverview } from "./git-api";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};

function badges(branch: GitBranch): HTMLElement[] {
  const result: HTMLElement[] = [];
  if (branch.ahead) result.push(el("span", "git-badge ahead", `↑${branch.ahead}`));
  if (branch.behind) result.push(el("span", "git-badge behind", `↓${branch.behind}`));
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
        if (icon) button.append(el("span", "git-branch-icon", icon));
        const name = el("span", "git-branch-name", label); name.title = label;
        button.append(name, ...extra);
        button.addEventListener("click", () => onChoose(target));
        return button;
      };
      const section = (label: string, items: HTMLElement[]) => { if (items.length) element.append(el("div", "git-section", label), ...items); };
      element.replaceChildren(entry(langText("Wszystkie gałęzie", "All branches"), "", [], false, "◈"));
      section(langText("Gałęzie lokalne", "Local branches"), overview.branches.filter(branch => !branch.remote).map(branch => entry(branch.name, branch.name, badges(branch), branch.current, branch.current ? "●" : "")));
      section(langText("Zdalne", "Remote"), overview.branches.filter(branch => branch.remote).map(branch => entry(branch.name, branch.name)));
      section(langText("Tagi", "Tags"), overview.tags.map(tag => entry(tag.name, tag.name, [], false, "⚑")));
    },
  };
}
