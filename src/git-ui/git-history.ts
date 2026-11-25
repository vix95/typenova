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
import { installGitGutter } from "./git-gutter";
import { installGitPanel } from "./git-panel";
import { cloneRepository, createRepository, installGitRepoActions, pullChanges } from "./git-repo-actions";
import { installGitSync } from "./git-sync-dialog";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};

/** The Git repositories behind the open project folders (and behind the current document), without duplicates. */
async function findRepositories(): Promise<string[]> {
  const candidates = [...documentState.projectRoots];
  if (documentState.currentPath) candidates.push(parentPath(documentState.currentPath));
  // Every run of `git` costs about 150 ms to start, so the folders are asked about at once.
  const roots = await Promise.all(candidates.map(candidate => gitRepoRoot(candidate).catch(() => null)));
  const found = new Map<string, string>();
  for (const root of roots) if (root && !found.has(normalizedFsPath(root))) found.set(normalizedFsPath(root), root);
  return [...found.values()];
}

function describeHead(overview: GitOverview, repo: string): string {
  const head = overview.detached ? langText("odłączony HEAD", "detached HEAD") : overview.head || langText("brak commitów", "no commits");
  const dirty = overview.dirty ? ` · ${overview.dirty} ${langText("niezatwierdzonych zmian", "uncommitted changes")}` : "";
  return `${basename(repo)} · ${head}${dirty}`;
}

/** The buttons that make a repository, clone one and fetch the latest changes. After one was made or cloned the window opens again, for what the project holds now. */
function repositoryButtons(dialog: HTMLDialogElement, pull: (() => Promise<void>) | null): HTMLButtonElement[] {
  const button = (label: string, run: () => Promise<boolean | void>, reopen: boolean): HTMLButtonElement => {
    const node = el("button", "git-small-btn", label); node.type = "button";
    node.addEventListener("click", async () => { const done = await run(); if (reopen && done) { dialog.close(); void openGitHistory(); } });
    return node;
  };
  const buttons = [button(langText("Utwórz repozytorium…", "Create a repository…"), createRepository, true), button(langText("Klonuj…", "Clone…"), cloneRepository, true)];
  if (pull) buttons.push(button(langText("Pobierz zmiany", "Pull"), pull, false));
  return buttons;
}

/** The window for a project that holds no repository yet: the way to make one or to clone one. */
function openWithoutRepository(): void {
  const dialog = el("dialog", "git-dialog git-dialog-empty"); dialog.setAttribute("aria-labelledby", "gitTitle");
  const title = el("div", "dialog-title", langText("Historia Git", "Git history")); title.id = "gitTitle";
  const note = el("p", "git-empty-note", langText("W otwartych folderach projektu nie ma repozytorium Git. Utwórz je w wybranym folderze albo sklonuj z internetu.", "There is no Git repository in the open project folders. Create one in a folder you choose, or clone one from the web."));
  const toolbar = el("div", "git-toolbar"); toolbar.append(...repositoryButtons(dialog, null));
  const close = el("button", "", langText("Zamknij", "Close")); close.type = "button";
  const actions = el("div", "dialog-actions"); actions.append(close);
  const content = el("div", "dialog-content git-content"); content.append(title, note, toolbar, actions);
  dialog.append(content); document.body.append(dialog);
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal(); close.focus();
}

/** Opens the dialog for the repository behind the open project (a choice when there are several). */
export async function openGitHistory(): Promise<void> {
  const repos = await findRepositories().catch(() => [] as string[]);
  if (!repos.length) { openWithoutRepository(); return; }

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
  const toolbar = el("div", "git-toolbar");
  toolbar.append(repoSelect, status, ...repositoryButtons(dialog, async () => { await pullChanges(repo); await load(); }), refresh);
  const columns = el("div", "git-columns"); columns.append(branches.element, list.element, detail.element);
  const close = el("button", "", langText("Zamknij", "Close")); close.type = "button";
  const actions = el("div", "dialog-actions"); actions.append(close);
  const content = el("div", "dialog-content git-content"); content.append(title, toolbar, columns, actions);
  dialog.append(content); document.body.append(dialog);
  dialog.querySelectorAll("select").forEach(themeSelect);

  const load = async () => {
    // The overview and the log are read at the same time: neither waits for the other (the commit list needs the names of the remote branches only to draw its rows).
    const reading = gitOverview(repo);
    const remoteNames = reading.then(found => new Set(found.branches.filter(branch => branch.remote).map(branch => branch.name)) as ReadonlySet<string>);
    const listing = list.reset(repo, rev, remoteNames);
    try {
      overview = await reading;
      status.textContent = describeHead(overview, repo);
      branches.render(overview, rev);
    } catch (error) { status.textContent = String(error); }
    await listing;
  };
  repoSelect.addEventListener("change", () => { repo = repoSelect.value; rev = ""; void load(); });
  refresh.addEventListener("click", () => void load());
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { releaseCustomSelects(dialog); dialog.remove(); });
  dialog.showModal(); list.element.focus();
  await load();
}

export function initGitHistory(): void {
  $("menuGitHistory").addEventListener("click", () => void openGitHistory());
  $("sidebarGitTab").addEventListener("click", () => void openGitHistory());
  installGitSync();
  installGitRepoActions();
  installGitPanel();
  installGitGutter();
}
