/** The multi-step actions of the Git window (each asks for what it needs, then runs through `perform`): new branch, merge, rebase, delete, rename, switch and reset. */
import { langText } from "../i18n/language";
import { appConfirm } from "../ui/dialogs";
import { askForName } from "../ui/name-dialog";
import { showToast } from "../ui/toast";
import { gitBranchCreate, gitBranchDelete, gitBranchRename, gitMerge, gitRebase, gitRemoteBranchDelete, gitReset, gitSwitch, type GitOpResult } from "./git-api";
import type { OpsContext } from "./git-ops-ui";

export const ok = (message = ""): GitOpResult => ({ ok: true, message, inProgress: null });
export const short = (hash: string): string => hash.slice(0, 7);
/** Runs one action and tells what it did; false when it stopped. */
export type Perform = (label: string, call: () => Promise<GitOpResult>) => Promise<boolean>;

export function createFlows(ctx: OpsContext, perform: Perform) {
  const nameFor = (title: string, label: string, initialValue = ""): Promise<string | null> => askForName({
    title, label, initialValue, confirmLabel: langText("Utwórz", "Create"),
    validate: name => (name ? (/[\s~^:?*[\\]|\.\.|^[-.]|\/$|\.lock$/.test(name) ? langText("Ta nazwa nie jest dozwolona w Git.", "Git does not allow this name.") : null) : langText("Wpisz nazwę.", "Enter a name.")),
  });

  const newBranchFrom = async (start: string, label: string): Promise<void> => {
    const name = await nameFor(langText("Nowa gałąź", "New branch"), langText(`Nazwa gałęzi (od ${label})`, `Branch name (from ${label})`));
    if (name) await perform(langText(`Tworzenie gałęzi „${name}”`, `Creating branch “${name}”`), () => gitBranchCreate(ctx.repo(), name, start, true));
  };

  const merge = async (rev: string): Promise<void> => {
    const into = ctx.current();
    if (!into) { showToast(langText("Scalanie wymaga gałęzi (HEAD jest odłączony).", "Merging needs a branch (HEAD is detached).")); return; }
    if (await appConfirm(langText(`Scalić „${rev}” z „${into}”?`, `Merge “${rev}” into “${into}”?`), { confirmLabel: langText("Scal", "Merge") })) await perform(langText(`Scalanie „${rev}”`, `Merging “${rev}”`), () => gitMerge(ctx.repo(), rev));
  };

  const rebase = async (onto: string): Promise<void> => {
    const branch = ctx.current();
    if (!branch) { showToast(langText("Rebase wymaga gałęzi (HEAD jest odłączony).", "Rebase needs a branch (HEAD is detached).")); return; }
    const sure = await appConfirm(langText(`Zrobić rebase „${branch}” na „${onto}”? Commity gałęzi zostaną odtworzone na nowo (zmienią się ich hasze).`, `Rebase “${branch}” onto “${onto}”? The commits of the branch are made again (their hashes change).`), { confirmLabel: langText("Rebase", "Rebase") });
    if (sure) await perform(langText(`Rebase na „${onto}”`, `Rebasing onto “${onto}”`), () => gitRebase(ctx.repo(), onto));
  };

  const deleteLocal = async (name: string): Promise<void> => {
    if (!await appConfirm(langText(`Usunąć gałąź „${name}”?`, `Delete the branch “${name}”?`), { confirmLabel: langText("Usuń", "Delete") })) return;
    const done = await perform(langText(`Usuwanie gałęzi „${name}”`, `Deleting branch “${name}”`), async () => {
      const first = await gitBranchDelete(ctx.repo(), name, false);
      if (first.ok || !/not fully merged/i.test(first.message)) return first;
      const force = await appConfirm(langText(`Gałąź „${name}” ma commity, których nie ma nigdzie indziej. Usunąć mimo to? Tych commitów nie da się łatwo odzyskać.`, `The branch “${name}” has commits that are nowhere else. Delete it anyway? They cannot be recovered easily.`), { confirmLabel: langText("Usuń mimo to", "Delete anyway") });
      return force ? gitBranchDelete(ctx.repo(), name, true) : ok(langText("Gałąź zostawiona.", "The branch was kept."));
    });
    void done;
  };

  const deleteRemote = async (full: string): Promise<void> => {
    const slash = full.indexOf("/");
    const remote = full.slice(0, slash), name = full.slice(slash + 1);
    if (slash < 1 || !name) return;
    if (await appConfirm(langText(`Usunąć gałąź „${name}” na serwerze „${remote}”? Zniknie dla wszystkich, którzy z niej korzystają.`, `Delete the branch “${name}” on “${remote}”? It disappears for everyone who uses it.`), { confirmLabel: langText("Usuń na serwerze", "Delete on the server") })) {
      await perform(langText(`Usuwanie „${full}” na serwerze`, `Deleting “${full}” on the server`), () => gitRemoteBranchDelete(ctx.repo(), remote, name));
    }
  };

  const rename = async (name: string): Promise<void> => {
    const next = await nameFor(langText("Zmień nazwę gałęzi", "Rename the branch"), langText("Nowa nazwa", "New name"), name);
    if (next && next !== name) await perform(langText(`Zmiana nazwy na „${next}”`, `Renaming to “${next}”`), () => gitBranchRename(ctx.repo(), name, next));
  };

  const switchTo = (name: string, remote: boolean): Promise<boolean> => perform(langText(`Przechodzenie na „${name}”`, `Switching to “${name}”`), async () => {
    await gitSwitch(ctx.repo(), name, remote ? "track" : "local");
    return ok();
  });

  const reset = async (hash: string, mode: "soft" | "mixed" | "hard"): Promise<void> => {
    const branch = ctx.current() ?? langText("bieżący commit", "the current commit");
    const text = mode === "hard"
      ? langText(`Przestawić „${branch}” na ${short(hash)} i ODRZUCIĆ wszystkie niezatwierdzone zmiany plików? Tego nie da się cofnąć.`, `Move “${branch}” to ${short(hash)} and DISCARD all uncommitted changes to files? This cannot be undone.`)
      : langText(`Przestawić „${branch}” na ${short(hash)}? ${mode === "soft" ? "Zmiany z późniejszych commitów zostają w poczekalni." : "Zmiany z późniejszych commitów zostają w plikach, poza poczekalnią."}`, `Move “${branch}” to ${short(hash)}? ${mode === "soft" ? "The changes of the later commits stay staged." : "The changes of the later commits stay in the files, unstaged."}`);
    if (await appConfirm(text, { confirmLabel: langText("Przestaw", "Reset") })) await perform(langText(`Reset (${mode}) do ${short(hash)}`, `Reset (${mode}) to ${short(hash)}`), () => gitReset(ctx.repo(), hash, mode));
  };


  return { nameFor, newBranchFrom, merge, rebase, deleteLocal, deleteRemote, rename, switchTo, reset };
}

export type Flows = ReturnType<typeof createFlows>;
