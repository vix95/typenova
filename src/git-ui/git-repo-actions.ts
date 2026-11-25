/** What is done with a repository as a whole, outside its history: make one in a folder, clone one from the web (as Fork does) and fetch the latest changes of the current branch. */
import { open } from "@tauri-apps/plugin-dialog";
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { basename } from "../filesystem/path-utils";
import { rootContaining } from "../filesystem/project-roots";
import { langText } from "../i18n/language";
import { addProjectFolderPath } from "../project/project-tree-view";
import { appAlert, appConfirm } from "../ui/dialogs";
import { showToast } from "../ui/toast";
import { gitClone, gitInit, gitPull, gitRepoRoot } from "./git-api";
import { cloneFolderName, isCloneUrl, pullSummary } from "./git-repo-model";
import { repositoryInUse } from "./git-sync-dialog";

const CLONE_PARENT_KEY = "typenova.git.cloneParent";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};

/** Puts a folder in the project tree when it is not in it yet, so that the repository that was just made or cloned is there to work with. */
async function showInTree(path: string): Promise<void> {
  if (!rootContaining(documentState.projectRoots, path)) await addProjectFolderPath(path);
}

function rememberedParent(): string {
  try { return localStorage.getItem(CLONE_PARENT_KEY) ?? ""; } catch { return ""; }
}

/** Makes a repository in a folder the person picks in the file explorer. Resolves true when one was made. */
export async function createRepository(): Promise<boolean> {
  const chosen = await open({ directory: true, multiple: false, title: langText("Wybierz folder dla nowego repozytorium Git", "Choose the folder for the new Git repository") });
  if (typeof chosen !== "string") return false;
  if (await gitRepoRoot(chosen).catch(() => null)) { showToast(langText("Ten folder jest już w repozytorium Git.", "This folder is already in a Git repository.")); return false; }
  const sure = await appConfirm(langText(`Utworzyć puste repozytorium Git w „${basename(chosen)}”?`, `Create an empty Git repository in “${basename(chosen)}”?`), { confirmLabel: langText("Utwórz", "Create") });
  if (!sure) return false;
  try { await gitInit(chosen); } catch (error) { await appAlert(`${langText("Nie udało się utworzyć repozytorium", "Could not create the repository")}: ${String(error)}`); return false; }
  showToast(langText(`Utworzono repozytorium Git w „${basename(chosen)}”.`, `Created a Git repository in “${basename(chosen)}”.`));
  await showInTree(chosen);
  document.dispatchEvent(new CustomEvent("typenova:git-changed"));
  return true;
}

/** The window that clones a repository from its address into a folder. Resolves true when a repository was cloned. */
export function cloneRepository(): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = el("dialog", "name-dialog git-clone-dialog"); dialog.setAttribute("aria-labelledby", "gitCloneTitle");
    const content = el("div", "dialog-content");
    const title = el("div", "dialog-title", langText("Klonuj repozytorium", "Clone a repository")); title.id = "gitCloneTitle";
    const field = (label: string): [HTMLLabelElement, HTMLInputElement] => {
      const wrap = el("label", "name-dialog-field"); const input = el("input", "name-dialog-input"); input.type = "text"; input.spellcheck = false;
      wrap.append(el("span", "", label), input); return [wrap, input];
    };
    const [urlField, url] = field(langText("Adres repozytorium (URL)", "Repository URL")); url.placeholder = "https://github.com/user/repo.git";
    const [parentField, parent] = field(langText("Sklonuj do folderu", "Clone into the folder")); parent.value = rememberedParent(); parent.readOnly = true;
    const browse = el("button", "git-small-btn", langText("Wybierz…", "Browse…")); browse.type = "button";
    const parentRow = el("div", "git-clone-row"); parentRow.append(parentField, browse);
    const [nameField, name] = field(langText("Nazwa folderu", "Folder name"));
    const addRow = el("label", "check-row git-clone-add"); const add = el("input"); add.type = "checkbox"; add.checked = true;
    addRow.append(add, el("span", "", langText("Dodaj sklonowany folder do drzewa projektu", "Add the cloned folder to the project tree")));
    const error = el("div", "name-dialog-error"); error.hidden = true; error.setAttribute("role", "alert");
    const cancel = el("button", "", langText("Anuluj", "Cancel")); cancel.type = "button";
    const go = el("button", "primary", langText("Klonuj", "Clone")); go.type = "button"; go.disabled = true;
    const actions = el("div", "dialog-actions"); actions.append(cancel, go);
    content.append(title, urlField, parentRow, nameField, addRow, error, actions); dialog.append(content); document.body.append(dialog);

    let named = false, settled = false, busy = false;
    const ready = (): boolean => isCloneUrl(url.value) && !!parent.value && !!cloneFolderName(name.value);
    const sync = (): void => { go.disabled = busy || !ready(); };
    const finish = (cloned: boolean): void => { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(cloned); };
    url.addEventListener("input", () => { if (!named) name.value = cloneFolderName(url.value) ?? ""; sync(); });
    name.addEventListener("input", () => { named = true; sync(); });
    browse.addEventListener("click", async () => {
      const chosen = await open({ directory: true, multiple: false, title: langText("Wybierz folder, w którym powstanie klon", "Choose the folder the clone is made in") });
      if (typeof chosen === "string") { parent.value = chosen; sync(); }
    });
    cancel.addEventListener("click", () => { if (!busy) finish(false); });
    dialog.addEventListener("cancel", event => { event.preventDefault(); if (!busy) finish(false); });
    go.addEventListener("click", async () => {
      busy = true; go.disabled = cancel.disabled = url.disabled = name.disabled = browse.disabled = true; error.hidden = true;
      go.textContent = langText("Klonowanie…", "Cloning…");
      try {
        const path = await gitClone(url.value.trim(), parent.value, name.value.trim());
        try { localStorage.setItem(CLONE_PARENT_KEY, parent.value); } catch { /* the folder is just not remembered */ }
        settled = true; dialog.close(); dialog.remove();
        showToast(langText(`Sklonowano do ${path}.`, `Cloned into ${path}.`));
        if (add.checked) await showInTree(path);
        resolve(true);
      } catch (failure) {
        busy = false; cancel.disabled = url.disabled = name.disabled = browse.disabled = false; go.textContent = langText("Klonuj", "Clone");
        error.textContent = String(failure); error.hidden = false; sync();
      }
    });
    dialog.showModal(); url.focus(); sync();
  });
}

let pulling = false;

/** Fetches the latest changes of the current branch of the repository in use (never a merge commit: git stops with its own message when the branches have diverged). */
export async function pullChanges(inRepository?: string): Promise<void> {
  if (pulling) return;
  const repo = inRepository ?? await repositoryInUse().catch(() => null);
  if (!repo) { showToast(langText("Dokument ani otwarte foldery nie należą do repozytorium Git.", "The document and the open folders are not in a Git repository.")); return; }
  pulling = true;
  const button = $("gitPullButton");
  button.setAttribute("aria-busy", "true"); button.classList.add("is-busy");
  showToast(langText(`Pobieranie zmian do „${basename(repo)}”…`, `Pulling the latest changes into “${basename(repo)}”…`));
  try {
    const said = await gitPull(repo);
    showToast(pullSummary(said) === "current" ? langText("Repozytorium jest aktualne.", "The repository is up to date.") : langText(`Pobrano zmiany do „${basename(repo)}”.`, `Pulled the latest changes into “${basename(repo)}”.`));
    document.dispatchEvent(new CustomEvent("typenova:git-changed"));
  } catch (error) {
    await appAlert(`${langText("Nie udało się pobrać zmian", "Could not pull the changes")}:\n\n${String(error)}`);
  } finally { pulling = false; button.removeAttribute("aria-busy"); button.classList.remove("is-busy"); }
}

const PULL_LABEL = (): string => langText("Pobierz ostatnie zmiany do bieżącej gałęzi (pull)", "Pull the latest changes into the current branch");

/** Wires the buttons and the menu items; the labels follow the language. */
export function installGitRepoActions(): void {
  const button = $("gitPullButton");
  const label = (): void => { button.dataset.tooltip = PULL_LABEL(); button.setAttribute("aria-label", PULL_LABEL()); };
  label();
  document.addEventListener("typenova:language-changed", label);
  button.addEventListener("click", () => void pullChanges());
  $("menuGitPull").addEventListener("click", () => void pullChanges());
  $("menuGitInit").addEventListener("click", () => void createRepository());
  $("menuGitClone").addEventListener("click", () => void cloneRepository());
  $("menuGitPanel").addEventListener("click", () => $("openGitPanel").click());
  $("menuGitSync").addEventListener("click", () => $("gitSyncButton").click());
}
