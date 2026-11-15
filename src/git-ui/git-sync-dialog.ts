/** "Commit and push": one button that takes everything changed in the Git repository of the document in use (new, modified, deleted files), shows it with a proposed message, commits it and pushes the branch. */
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { saveDocument } from "../documents/file-actions";
import { basename } from "../filesystem/path-utils";
import { normalizedFsPath, parentPath } from "../filesystem/project-tree-operations";
import { langText } from "../i18n/language";
import { appAlert } from "../ui/dialogs";
import { ICONS } from "../ui/icons";
import { showToast } from "../ui/toast";
import { gitCommitPush, gitRepoRoot, gitSyncPlan, type GitSyncPlan, type GitSyncResult } from "./git-api";
import { defaultCommitMessage } from "./git-sync-model";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};
const STATUS_ICONS: Record<string, string> = { A: ICONS.fileAdded, M: ICONS.fileModified, D: ICONS.fileDeleted, R: ICONS.fileRenamed };

/** The repository the document in use belongs to; without a saved document, the repository of the first open project folder that has one. */
export async function repositoryInUse(): Promise<string | null> {
  const candidates = documentState.currentPath ? [parentPath(documentState.currentPath)] : [];
  candidates.push(...documentState.projectRoots);
  for (const candidate of candidates) {
    const root = await gitRepoRoot(candidate).catch(() => null);
    if (root) return root;
  }
  return null;
}

const insideRepo = (repo: string, path: string): boolean => normalizedFsPath(path).startsWith(`${normalizedFsPath(repo).replace(/\/+$/, "")}/`);

/** Names of the open documents of the repository that have changes not saved to disk: they are not part of what is committed. */
function unsavedIn(repo: string): string[] {
  return documentState.tabs.filter(tab => tab.dirty && tab.path && insideRepo(repo, tab.path)).map(tab => tab.label);
}

function blockedText(reason: string): string {
  return reason === "detached HEAD"
    ? langText("HEAD jest odłączony (nie ma gałęzi): nic nie zostanie zatwierdzone.", "HEAD is detached (no branch): nothing will be committed.")
    : langText(`W repozytorium trwa operacja (${reason}) albo są konflikty. Dokończ ją najpierw: nic nie zostanie zatwierdzone.`, `An operation is in progress in the repository (${reason}) or there are conflicts. Finish it first: nothing will be committed.`);
}

function targetText(plan: GitSyncPlan): string {
  if (plan.upstream) return `${plan.branch} → ${plan.upstream}`;
  if (plan.remote) return `${plan.branch} → ${plan.remote}/${plan.branch} ${langText("(nowa gałąź zdalna)", "(new remote branch)")}`;
  return `${plan.branch} · ${langText("brak zdalnego repozytorium: tylko commit lokalny", "no remote: a local commit only")}`;
}

function changeList(plan: GitSyncPlan): HTMLElement {
  const list = el("ul", "git-sync-files");
  for (const change of plan.changes) {
    const row = el("li", `git-sync-file git-sync-${change.status.toLowerCase()}`);
    row.insertAdjacentHTML("afterbegin", STATUS_ICONS[change.status] ?? ICONS.fileModified);
    row.append(el("span", "git-sync-path", change.path));
    list.append(row);
  }
  if (plan.total > plan.changes.length) list.append(el("li", "git-sync-more", langText(`… i ${plan.total - plan.changes.length} więcej`, `… and ${plan.total - plan.changes.length} more`)));
  return list;
}

function announce(result: GitSyncResult): void {
  if (result.pushed) {
    showToast(result.commit
      ? langText(`Zatwierdzono ${result.commit} i wypchnięto do ${result.target}.`, `Committed ${result.commit} and pushed to ${result.target}.`)
      : langText(`Nic do zatwierdzenia. Wypchnięto do ${result.target}.`, `Nothing to commit. Pushed to ${result.target}.`));
    return;
  }
  const done = result.commit ? langText(`Zatwierdzono lokalnie (${result.commit}), ale nie wypchnięto:`, `Committed locally (${result.commit}) but not pushed:`) : langText("Nie wypchnięto:", "Not pushed:");
  void appAlert(`${done}\n\n${result.pushError ?? ""}`);
}

/** Opens the dialog for the repository in use: what will be committed, the message, and the target of the push. */
export async function openGitSync(): Promise<void> {
  const repo = await repositoryInUse().catch(() => null);
  if (!repo) { showToast(langText("Dokument ani otwarte foldery nie należą do repozytorium Git.", "The document and the open folders are not in a Git repository.")); return; }
  // What the person typed in the document in use is part of what they want committed: it is written to its file first.
  if (documentState.dirty && documentState.currentPath && insideRepo(repo, documentState.currentPath)) await saveDocument();
  let plan: GitSyncPlan;
  try { plan = await gitSyncPlan(repo); } catch (error) { void appAlert(String(error)); return; }

  const dialog = el("dialog", "git-sync-dialog"); dialog.setAttribute("aria-labelledby", "gitSyncTitle");
  const title = el("div", "dialog-title", langText("Zatwierdź i wypchnij", "Commit and push")); title.id = "gitSyncTitle";
  const where = el("div", "git-sync-target", `${basename(repo)} · ${plan.branch ? targetText(plan) : langText("odłączony HEAD", "detached HEAD")}`);
  const notes = el("div", "git-sync-notes");
  const warn = (text: string) => notes.append(el("p", "git-sync-warning", text));
  if (plan.blocked) warn(blockedText(plan.blocked));
  else if (!plan.total) warn(langText("Brak zmian do zatwierdzenia.", "There are no changes to commit."));
  const unsaved = unsavedIn(repo);
  if (unsaved.length) warn(langText(`Niezapisane dokumenty nie trafią do commita: ${unsaved.join(", ")}.`, `Unsaved documents are not part of the commit: ${unsaved.join(", ")}.`));
  const label = el("label", "", langText("Opis zmiany (commit)", "Commit message")); label.htmlFor = "gitSyncMessage";
  const message = el("textarea"); message.id = "gitSyncMessage"; message.rows = 3; message.value = defaultCommitMessage(plan.changes);
  const error = el("p", "git-sync-error"); error.hidden = true; error.setAttribute("role", "alert");
  const cancel = el("button", "", langText("Anuluj", "Cancel")); cancel.type = "button";
  const go = el("button", "primary", langText("Zatwierdź i wypchnij", "Commit and push")); go.type = "button";
  const actions = el("div", "dialog-actions"); actions.append(cancel, go);
  const content = el("div", "dialog-content git-sync-content");
  content.append(title, where, notes, ...(plan.total ? [changeList(plan), label, message] : []), error, actions);
  dialog.append(content); document.body.append(dialog);

  const ready = () => !plan.blocked && plan.total > 0 && message.value.trim().length > 0;
  const sync = () => { go.disabled = !ready(); };
  message.addEventListener("input", sync); sync();
  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  // Closing the window while the push runs would hide its outcome: the dialog stays until it ends.
  dialog.addEventListener("cancel", event => { if (go.dataset.busy) event.preventDefault(); });
  go.addEventListener("click", async () => {
    go.dataset.busy = "1"; go.disabled = cancel.disabled = message.disabled = true; error.hidden = true;
    go.textContent = langText("Wysyłanie…", "Pushing…");
    try { const result = await gitCommitPush(repo, message.value); dialog.close(); announce(result); }
    catch (failure) {
      delete go.dataset.busy; cancel.disabled = message.disabled = false; go.textContent = langText("Zatwierdź i wypchnij", "Commit and push"); sync();
      error.textContent = String(failure); error.hidden = false;
    }
  });
  dialog.showModal(); (plan.total && !plan.blocked ? message : cancel).focus();
}

function labelButton(button: HTMLElement): void {
  const text = langText("Zatwierdź i wypchnij zmiany repozytorium (commit + push)", "Commit and push the changes of the repository");
  button.dataset.tooltip = text; button.setAttribute("aria-label", text);
}

/** Wires the button of the project panel; the labels follow the language. */
export function installGitSync(): void {
  const button = $("gitSyncButton");
  labelButton(button);
  document.addEventListener("typenova:language-changed", () => labelButton(button));
  button.addEventListener("click", () => void openGitSync());
}
