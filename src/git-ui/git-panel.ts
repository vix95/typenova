/** The Git view of the left panel: the branch in use (with a chooser to switch or create one), what changed split into staged and not staged, stage and unstage for a file or all, the commit message with Commit, and Push. The same repository as the margin markers: the one the open document belongs to. */
import { $ } from "../app/dom";
import { setSidebarTab, showSidebar } from "../app/sidebar";
import { showFileTab } from "../documents/file-navigation";
import { button, el } from "../editor/bookmark-browser";
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { outlineState } from "../outline/outline";
import { refreshProjectTree } from "../project/project-tree-sync";
import { appAlert } from "../ui/dialogs";
import { ICONS } from "../ui/icons";
import { askForName } from "../ui/name-dialog";
import { showToast } from "../ui/toast";
import { gitCommitStaged, gitOverview, gitPush, gitStage, gitSwitch, gitUnstage, gitWorkState, type GitFileState, type GitOverview, type GitWorkState } from "./git-api";
import { reloadOpenDocumentsInside, unsavedDocumentsInside } from "./git-documents";
import { defaultCommitMessage } from "./git-sync-model";
import { repositoryInUse } from "./git-sync-dialog";

interface PanelState { repo: string | null; work: GitWorkState | null; overview: GitOverview | null; chooserOpen: boolean; filter: string; edited: boolean; busy: boolean }
const state: PanelState = { repo: null, work: null, overview: null, chooserOpen: false, filter: "", edited: false, busy: false };

const host = (): HTMLElement => $("gitViewHost");
const STATUS_TEXT: Record<string, [string, string]> = {
  A: ["Nowy", "Added"], M: ["Zmieniony", "Modified"], D: ["Usunięty", "Deleted"], R: ["Zmieniona nazwa", "Renamed"], C: ["Skopiowany", "Copied"], T: ["Zmieniony typ", "Type changed"], "?": ["Nowy, jeszcze nieśledzony", "New, not tracked yet"],
};
const statusText = (code: string): string => { const pair = STATUS_TEXT[code]; return pair ? langText(pair[0], pair[1]) : code; };

const stagedFiles = (): GitFileState[] => (state.work?.files ?? []).filter(file => file.index && !file.conflicted);
const changedFiles = (): GitFileState[] => (state.work?.files ?? []).filter(file => file.worktree || file.conflicted);

/** Runs an action on the repository: the buttons are off meanwhile, and a failure is shown with what git said. */
async function run(action: () => Promise<void>): Promise<void> {
  if (state.busy) return;
  state.busy = true; render();
  try { await action(); } catch (error) { void appAlert(String(error)); } finally { state.busy = false; }
  announceChange();
}
/** Something in the repository changed: every part of the interface that shows it reads it again. */
function announceChange(): void { document.dispatchEvent(new CustomEvent("typenova:git-changed")); }

export async function loadGitPanel(): Promise<void> {
  const repo = await repositoryInUse().catch(() => null);
  state.repo = repo;
  state.work = null; state.overview = null;
  if (repo) {
    try { [state.work, state.overview] = await Promise.all([gitWorkState(repo), gitOverview(repo)]); } catch (error) { void appAlert(String(error)); }
  }
  render();
}

function fileRow(file: GitFileState, staged: boolean): HTMLElement {
  const code = file.conflicted ? "!" : staged ? file.index : file.worktree;
  const row = el("li", `git-file git-file-${code === "?" ? "a" : code.toLowerCase()}`);
  const badge = el("span", "git-file-status", code);
  badge.title = file.conflicted ? langText("Konflikt", "Conflict") : statusText(code);
  const slash = file.path.lastIndexOf("/");
  const name = el("button", "git-file-name");
  name.type = "button";
  name.append(el("span", "git-file-base", file.path.slice(slash + 1)), el("span", "git-file-dir", slash > 0 ? file.path.slice(0, slash) : ""));
  name.dataset.tooltip = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
  if (code !== "D") name.addEventListener("click", () => { if (state.repo) void showFileTab(`${state.repo.replace(/[\\/]+$/, "")}/${file.path}`); }); else name.disabled = true;
  const action = button("git-file-action", staged ? "minus" : "plus", staged ? langText("Cofnij z zatwierdzenia (unstage)", "Unstage") : langText("Dodaj do zatwierdzenia (stage)", "Stage"), () => {
    if (state.repo) void run(async () => { await (staged ? gitUnstage(state.repo!, [file.path]) : gitStage(state.repo!, [file.path])); });
  });
  action.disabled = state.busy;
  row.append(badge, name, action);
  return row;
}

function section(title: string, files: GitFileState[], staged: boolean): HTMLElement {
  const box = el("div", "git-section");
  const head = el("div", "git-section-head");
  head.append(el("span", "git-section-title", `${title} (${files.length})`));
  if (files.length) {
    const label = staged ? langText("Cofnij wszystko", "Unstage all") : langText("Dodaj wszystko", "Stage all");
    const all = button("git-section-action", staged ? "minus" : "plus", label, () => {
      if (state.repo) void run(async () => { const paths = files.map(file => file.path); await (staged ? gitUnstage(state.repo!, paths) : gitStage(state.repo!, paths)); });
    }, true);
    all.disabled = state.busy;
    head.append(all);
  }
  box.append(head);
  const list = el("ul", "git-file-list");
  for (const file of files) list.append(fileRow(file, staged));
  if (!files.length) list.append(el("li", "git-file-empty", staged ? langText("Nic nie jest dodane do zatwierdzenia.", "Nothing is staged.") : langText("Brak zmian.", "No changes.")));
  box.append(list);
  return box;
}

async function switchBranch(target: string, mode: "local" | "new" | "track"): Promise<void> {
  const repo = state.repo;
  if (!repo) return;
  const unsaved = unsavedDocumentsInside(repo);
  if (unsaved.length) {
    void appAlert(langText(`Zapisz albo zamknij najpierw niezapisane dokumenty tego repozytorium: ${unsaved.join(", ")}. Przełączenie gałęzi zmienia pliki na dysku.`, `Save or close the unsaved documents of this repository first: ${unsaved.join(", ")}. Switching branches changes the files on disk.`));
    return;
  }
  await run(async () => {
    const now = await gitSwitch(repo, target, mode);
    state.chooserOpen = false; state.filter = "";
    const reload = await reloadOpenDocumentsInside(repo);
    await refreshProjectTree();
    const extra = [reload.reloaded ? langText(`Otwarte dokumenty wczytano ponownie: ${reload.reloaded}.`, `Open documents read again: ${reload.reloaded}.`) : "", reload.missing.length ? langText(`Nie ma ich na tej gałęzi: ${reload.missing.join(", ")}.`, `Not on this branch: ${reload.missing.join(", ")}.`) : ""].filter(Boolean).join(" ");
    showToast(`${langText(`Gałąź: ${now}.`, `Branch: ${now}.`)} ${extra}`.trim());
  });
}

async function newBranch(): Promise<void> {
  const name = await askForName({
    title: langText("Nowa gałąź", "New branch"), label: langText("Nazwa gałęzi (powstaje z bieżącego commita)", "Branch name (created from the current commit)"), confirmLabel: langText("Utwórz i przełącz", "Create and switch"),
    validate: value => (!value ? langText("Podaj nazwę.", "Enter a name.") : /[\s~^:?*[\\]|\.\.|^-|\/$|\.lock$/.test(value) ? langText("Ta nazwa nie jest dozwolona w Git.", "Git does not allow this name.") : null),
  });
  if (name) await switchBranch(name, "new");
}

function chooser(): HTMLElement {
  const box = el("div", "git-chooser");
  const filter = el("input", "git-chooser-filter"); filter.type = "search"; filter.value = state.filter;
  filter.placeholder = langText("Szukaj gałęzi…", "Find a branch…"); filter.setAttribute("aria-label", filter.placeholder);
  const list = el("ul", "git-chooser-list");
  const branches = state.overview?.branches ?? [];
  const local = new Set(branches.filter(branch => !branch.remote).map(branch => branch.name));
  const wanted = state.filter.trim().toLocaleLowerCase();
  const items = branches.filter(branch => !(branch.remote && (branch.name.endsWith("/HEAD") || local.has(branch.name.slice(branch.name.indexOf("/") + 1))))).filter(branch => !wanted || branch.name.toLocaleLowerCase().includes(wanted));
  for (const branch of items) {
    const item = el("li", "git-chooser-item");
    const choose = el("button", "git-chooser-choice"); choose.type = "button"; choose.disabled = branch.current || state.busy;
    if (branch.current) choose.insertAdjacentHTML("afterbegin", ICONS.check); else choose.insertAdjacentHTML("afterbegin", branch.remote ? ICONS.arrowDown : ICONS.currentBranch);
    choose.append(el("span", "git-chooser-name", branch.name));
    if (branch.remote) choose.append(el("span", "git-chooser-note", langText("zdalna", "remote")));
    choose.addEventListener("click", () => { void switchBranch(branch.name, branch.remote ? "track" : "local"); });
    item.append(choose); list.append(item);
  }
  if (!items.length) list.append(el("li", "git-file-empty", langText("Nie ma takiej gałęzi.", "No such branch.")));
  filter.addEventListener("input", () => { state.filter = filter.value; render(); (host().querySelector(".git-chooser-filter") as HTMLInputElement | null)?.focus(); });
  const create = button("git-section-action", "plus", langText("Nowa gałąź…", "New branch…"), () => { void newBranch(); }, true);
  create.disabled = state.busy;
  box.append(filter, list, create);
  return box;
}

function branchBar(work: GitWorkState): HTMLElement {
  const bar = el("div", "git-branch-bar");
  const toggle = el("button", "git-branch-button"); toggle.type = "button";
  toggle.setAttribute("aria-expanded", String(state.chooserOpen));
  toggle.insertAdjacentHTML("afterbegin", ICONS.currentBranch);
  toggle.append(el("span", "git-branch-name", work.branch ?? langText("odłączony HEAD", "detached HEAD")), (() => { const caret = el("span", "git-branch-caret"); caret.innerHTML = state.chooserOpen ? ICONS.chevronUp : ICONS.chevronDown; return caret; })());
  const label = langText("Przełącz gałąź albo utwórz nową", "Switch branch or create one");
  toggle.dataset.tooltip = label; toggle.setAttribute("aria-label", `${label}: ${work.branch ?? ""}`);
  toggle.addEventListener("click", () => { state.chooserOpen = !state.chooserOpen; render(); });
  bar.append(toggle);
  if (work.upstream) bar.append(el("span", "git-sync-counts", `${work.upstream} · ↑${work.ahead} ↓${work.behind}`));
  return bar;
}

function commitBox(work: GitWorkState): HTMLElement {
  const box = el("div", "git-commit");
  const previous = host().querySelector<HTMLTextAreaElement>(".git-commit-message");
  const message = el("textarea", "git-commit-message"); message.rows = 3;
  message.placeholder = langText("Opis zmiany (commit)", "Commit message"); message.setAttribute("aria-label", message.placeholder);
  const staged = stagedFiles();
  if (!state.edited) message.value = defaultCommitMessage(staged.map(file => ({ status: ["A", "D", "R"].includes(file.index) ? file.index : file.index === "C" ? "A" : "M", path: file.path })));
  else message.value = previous?.value ?? "";
  const commit = button("ai-flat-button primary-flat", "check", langText("Zatwierdź", "Commit"), () => {
    if (state.repo) void run(async () => { const result = await gitCommitStaged(state.repo!, message.value); state.edited = false; showToast(langText(`Zatwierdzono ${result.commit}.`, `Committed ${result.commit}.`)); });
  }, true);
  const readyToCommit = (): boolean => !work.blocked && staged.length > 0 && message.value.trim().length > 0 && !state.busy;
  commit.disabled = !readyToCommit();
  message.addEventListener("input", () => { state.edited = true; commit.disabled = !readyToCommit(); });
  const firstPush = !work.upstream && !!work.remote && work.hasCommits;
  const push = button("ai-flat-button", "arrowUp", work.upstream ? langText(`Wypchnij${work.ahead ? ` (${work.ahead})` : ""}`, `Push${work.ahead ? ` (${work.ahead})` : ""}`) : langText("Opublikuj gałąź", "Publish branch"), () => {
    if (state.repo) void run(async () => {
      const result = await gitPush(state.repo!);
      if (result.pushed) showToast(langText(`Wypchnięto do ${result.target}.`, `Pushed to ${result.target}.`)); else void appAlert(`${langText("Nie wypchnięto:", "Not pushed:")}\n\n${result.error ?? ""}`);
    });
  }, true);
  push.disabled = state.busy || !(work.upstream ? work.ahead > 0 : firstPush);
  const row = el("div", "git-commit-actions"); row.append(commit, push);
  box.append(message, row);
  return box;
}

function blockedText(reason: string): string {
  return reason === "detached HEAD" ? langText("HEAD jest odłączony: nie ma gałęzi, więc commit jest wyłączony. Przełącz się na gałąź.", "HEAD is detached: there is no branch, so committing is off. Switch to a branch.")
    : langText(`W repozytorium trwa operacja (${reason}) albo są konflikty. Dokończ ją, żeby zatwierdzać.`, `An operation is in progress in the repository (${reason}) or there are conflicts. Finish it to commit.`);
}

function render(): void {
  const root = host();
  if (!state.repo || !state.work) {
    root.replaceChildren(el("p", "git-empty", state.repo ? langText("Nie można odczytać repozytorium.", "The repository could not be read.") : langText("Dokument ani otwarte foldery nie należą do repozytorium Git.", "The document and the open folders are not in a Git repository.")));
    return;
  }
  const work = state.work;
  const parts: HTMLElement[] = [el("div", "git-repo-name", basename(state.repo)), branchBar(work)];
  if (state.chooserOpen) parts.push(chooser());
  if (work.blocked) parts.push(el("p", "git-warning", blockedText(work.blocked)));
  parts.push(commitBox(work), section(langText("Do zatwierdzenia", "Staged changes"), stagedFiles(), true), section(langText("Zmiany", "Changes"), changedFiles(), false));
  if (work.total > work.files.length) parts.push(el("p", "git-empty", langText(`… i ${work.total - work.files.length} więcej zmian`, `… and ${work.total - work.files.length} more changes`)));
  root.replaceChildren(...parts);
}

/** Opens the left panel (if it is collapsed) and switches it to the Git view. */
export function showGitPanel(): void {
  if (!outlineState.outlineVisible) showSidebar();
  setSidebarTab("git");
  void loadGitPanel();
}

const visible = (): boolean => !$("gitView").hidden;

export function installGitPanel(): void {
  const label = (id: string, text: string) => { const control = $(id); control.dataset.tooltip = text; control.setAttribute("aria-label", text); };
  const labels = () => { label("gitViewBack", langText("Wróć do plików", "Back to files")); label("gitViewRefresh", langText("Odśwież", "Refresh")); label("openGitPanel", langText("Git: zmiany, stage, commit i gałęzie", "Git: changes, stage, commit and branches")); if (visible()) render(); };
  labels();
  document.addEventListener("typenova:language-changed", labels);
  $("gitViewBack").addEventListener("click", () => setSidebarTab("files"));
  $("gitViewRefresh").addEventListener("click", () => void loadGitPanel());
  $("openGitPanel").addEventListener("click", showGitPanel);
  let timer = 0;
  const later = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { if (visible()) void loadGitPanel(); }, 300); };
  document.addEventListener("typenova:git-changed", later);
  document.addEventListener("typenova:file-saved", later);
  window.addEventListener("focus", later);
}
