/** Git history dialog: branches and tags on the left, the commit list with its graph in the middle, the chosen commit on the right (read only). */
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { basename } from "../filesystem/path-utils";
import { normalizedFsPath, parentPath } from "../filesystem/project-tree-operations";
import { langText } from "../i18n/language";
import { releaseCustomSelects, themeSelect } from "../ui/custom-select";
import { showToast } from "../ui/toast";
import { gitOverview, gitRepoRoot, type GitOverview } from "./git-api";
import { createBranchPanel } from "./git-branches";
import { createCommitList } from "./git-commit-list";
import { createDetailPanel } from "./git-detail";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};

/** The Git repositories behind the open project folders (and behind the current document), without duplicates. */
async function findRepositories(): Promise<string[]> {
  const candidates = [...documentState.projectRoots];
  if (documentState.currentPath) candidates.push(parentPath(documentState.currentPath));
  const found = new Map<string, string>();
  for (const candidate of candidates) {
    const root = await gitRepoRoot(candidate).catch(() => null);
    if (root && !found.has(normalizedFsPath(root))) found.set(normalizedFsPath(root), root);
  }
  return [...found.values()];
}

function describeHead(overview: GitOverview, repo: string): string {
  const head = overview.detached ? langText("odłączony HEAD", "detached HEAD") : overview.head || langText("brak commitów", "no commits");
  const dirty = overview.dirty ? ` · ${overview.dirty} ${langText("niezatwierdzonych zmian", "uncommitted changes")}` : "";
  return `${basename(repo)} · ${head}${dirty}`;
}

/** Opens the dialog for the repository behind the open project (a choice when there are several). */
export async function openGitHistory(): Promise<void> {
  const repos = await findRepositories().catch(() => [] as string[]);
  if (!repos.length) { showToast(langText("W otwartych folderach projektu nie ma repozytorium Git.", "There is no Git repository in the open project folders.")); return; }

  let repo = repos[0], rev = "", overview: GitOverview | null = null;
  const detail = createDetailPanel({ repo: () => repo, openCommit: hash => void list.jumpTo(hash).then(found => { if (!found) showToast(langText("Tego commita nie ma na bieżącej liście (inna gałąź).", "That commit is not in the current list (another branch).")); }) });
  const list = createCommitList(hash => void detail.show(hash));
  const branches = createBranchPanel(target => { rev = target; if (overview) branches.render(overview, rev); void list.reset(repo, rev, remotes()); });
  const remotes = () => new Set((overview?.branches ?? []).filter(branch => branch.remote).map(branch => branch.name));

  const dialog = el("dialog", "git-dialog"); dialog.setAttribute("aria-labelledby", "gitTitle");
  const title = el("div", "dialog-title", langText("Historia Git", "Git history")); title.id = "gitTitle";
  const repoSelect = el("select", "git-repo-select"); repoSelect.setAttribute("aria-label", langText("Repozytorium", "Repository"));
  repos.forEach(path => { const option = el("option", "", basename(path)); option.value = path; repoSelect.append(option); });
  repoSelect.hidden = repos.length < 2;
  const status = el("div", "git-status-line");
  const refresh = el("button", "git-small-btn", langText("Odśwież", "Refresh")); refresh.type = "button";
  const toolbar = el("div", "git-toolbar"); toolbar.append(repoSelect, status, refresh);
  const columns = el("div", "git-columns"); columns.append(branches.element, list.element, detail.element);
  const close = el("button", "", langText("Zamknij", "Close")); close.type = "button";
  const actions = el("div", "dialog-actions"); actions.append(close);
  const content = el("div", "dialog-content git-content"); content.append(title, toolbar, columns, actions);
  dialog.append(content); document.body.append(dialog);
  dialog.querySelectorAll("select").forEach(themeSelect);

  const load = async () => {
    try {
      overview = await gitOverview(repo);
      status.textContent = describeHead(overview, repo);
      branches.render(overview, rev);
    } catch (error) { status.textContent = String(error); }
    await list.reset(repo, rev, remotes());
  };
  repoSelect.addEventListener("change", () => { repo = repoSelect.value; rev = ""; void load(); });
  refresh.addEventListener("click", () => void load());
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { releaseCustomSelects(dialog); dialog.remove(); });
  dialog.showModal(); list.element.focus();
  await load();
}

export function initGitHistory(): void {
  $("menuGit").addEventListener("click", () => void openGitHistory());
  $("openGitHistory").addEventListener("click", () => void openGitHistory());
}
