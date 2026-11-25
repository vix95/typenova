/** The right-click menus of the Git window: for a branch, a remote branch, a tag, a commit and a stash. */
import { langText } from "../i18n/language";
import { copyTextToClipboard } from "../preview/code-blocks";
import { appConfirm } from "../ui/dialogs";
import { ICONS } from "../ui/icons";
import { showToast } from "../ui/toast";
import { gitCheckoutCommit, gitCherryPick, gitRevert, gitStashAction, gitTagCreate, gitTagDelete } from "./git-api";
import { short, type Flows, type Perform } from "./git-flows";
import { showGitMenu, type MenuEntry } from "./git-menu";
import type { GitOps, OpsContext } from "./git-ops-ui";

export function createGitMenus(ctx: OpsContext, flows: Flows, perform: Perform): Pick<GitOps, "branchMenu" | "tagMenu" | "commitMenu" | "stashMenu"> {
  const { nameFor, newBranchFrom, merge, rebase, deleteLocal, deleteRemote, rename, switchTo, reset } = flows;
  const copy = (text: string, entry: string): MenuEntry => ({ label: entry, icon: ICONS.copy, run: async () => { showToast(await copyTextToClipboard(text) ? langText("Skopiowano.", "Copied.") : langText("Nie udało się skopiować.", "Could not copy.")); } });
  const at = (event: MouseEvent, entries: MenuEntry[]): void => { event.preventDefault(); event.stopPropagation(); showGitMenu(ctx.host(), event.clientX, event.clientY, entries); };

  return {
    branchMenu(event, name, remote) {
      const current = !remote && name === ctx.current();
      const entries: MenuEntry[] = [
        { label: langText("Przejdź na tę gałąź (checkout)", "Check out this branch"), icon: ICONS.check, disabled: current, run: () => void switchTo(name, remote) },
        { label: langText("Nowa gałąź stąd…", "New branch from here…"), icon: ICONS.branch, run: () => newBranchFrom(name, name) },
        "-",
        { label: langText(`Scal „${name}” z bieżącą`, `Merge “${name}” into the current branch`), icon: ICONS.merge, disabled: current, run: () => merge(name) },
        { label: langText(`Rebase bieżącej na „${name}”`, `Rebase the current branch onto “${name}”`), icon: ICONS.rebase, disabled: current, run: () => rebase(name) },
        "-",
      ];
      if (!remote) entries.push({ label: langText("Zmień nazwę…", "Rename…"), icon: ICONS.edit, run: () => rename(name) });
      entries.push(remote
        ? { label: langText("Usuń na serwerze…", "Delete on the server…"), icon: ICONS.trash, danger: true, run: () => deleteRemote(name) }
        : { label: langText("Usuń gałąź…", "Delete the branch…"), icon: ICONS.trash, danger: true, disabled: current, run: () => deleteLocal(name) });
      entries.push("-", copy(name, langText("Kopiuj nazwę", "Copy the name")));
      at(event, entries);
    },
    tagMenu(event, name) {
      at(event, [
        { label: langText("Nowa gałąź z tego tagu…", "New branch from this tag…"), icon: ICONS.branch, run: () => newBranchFrom(name, name) },
        { label: langText(`Scal „${name}” z bieżącą`, `Merge “${name}” into the current branch`), icon: ICONS.merge, run: () => merge(name) },
        "-",
        { label: langText("Usuń tag…", "Delete the tag…"), icon: ICONS.trash, danger: true, run: async () => { if (await appConfirm(langText(`Usunąć tag „${name}”?`, `Delete the tag “${name}”?`), { confirmLabel: langText("Usuń", "Delete") })) await perform(langText(`Usuwanie tagu „${name}”`, `Deleting tag “${name}”`), () => gitTagDelete(ctx.repo(), name)); } },
        "-", copy(name, langText("Kopiuj nazwę", "Copy the name")),
      ]);
    },
    commitMenu(event, commit) {
      const hash = commit.hash;
      at(event, [
        { label: langText("Przejdź na ten commit (checkout)", "Check out this commit"), icon: ICONS.check, run: () => void perform(langText(`Przechodzenie na ${short(hash)}`, `Checking out ${short(hash)}`), () => gitCheckoutCommit(ctx.repo(), hash)) },
        { label: langText("Nowa gałąź tutaj…", "New branch here…"), icon: ICONS.branch, run: () => newBranchFrom(hash, short(hash)) },
        { label: langText("Nowy tag tutaj…", "New tag here…"), icon: ICONS.tag, run: async () => {
          const name = await nameFor(langText("Nowy tag", "New tag"), langText(`Nazwa tagu (na ${short(hash)})`, `Tag name (on ${short(hash)})`));
          if (name) await perform(langText(`Tworzenie tagu „${name}”`, `Creating tag “${name}”`), () => gitTagCreate(ctx.repo(), name, hash, ""));
        } },
        "-",
        { label: langText("Cherry-pick na bieżącą gałąź", "Cherry-pick onto the current branch"), icon: ICONS.cherry, run: () => void perform(langText(`Cherry-pick ${short(hash)}`, `Cherry-picking ${short(hash)}`), () => gitCherryPick(ctx.repo(), hash)) },
        { label: langText("Cofnij ten commit (revert)", "Revert this commit"), icon: ICONS.revert, run: () => void perform(langText(`Revert ${short(hash)}`, `Reverting ${short(hash)}`), () => gitRevert(ctx.repo(), hash)) },
        "-",
        { label: langText("Reset do tego commita: soft", "Reset to this commit: soft"), icon: ICONS.restart, run: () => reset(hash, "soft") },
        { label: langText("Reset do tego commita: mixed", "Reset to this commit: mixed"), icon: ICONS.restart, run: () => reset(hash, "mixed") },
        { label: langText("Reset do tego commita: hard…", "Reset to this commit: hard…"), icon: ICONS.restart, danger: true, run: () => reset(hash, "hard") },
        "-", copy(hash, langText("Kopiuj hasz", "Copy the hash")),
      ]);
    },
    stashMenu(event, stash) {
      const name = `stash@{${stash.index}}`;
      at(event, [
        { label: langText("Zastosuj i zostaw (apply)", "Apply and keep"), icon: ICONS.stash, run: () => void perform(langText(`Stosowanie ${name}`, `Applying ${name}`), () => gitStashAction(ctx.repo(), stash.index, "apply")) },
        { label: langText("Zastosuj i usuń (pop)", "Apply and remove (pop)"), icon: ICONS.stash, run: () => void perform(langText(`Stosowanie ${name}`, `Applying ${name}`), () => gitStashAction(ctx.repo(), stash.index, "pop")) },
        "-",
        { label: langText("Usuń schowek…", "Drop the stash…"), icon: ICONS.trash, danger: true, run: async () => { if (await appConfirm(langText(`Usunąć ${name} bez stosowania? Schowanych zmian nie da się odzyskać.`, `Drop ${name} without applying it? The stashed changes cannot be recovered.`), { confirmLabel: langText("Usuń", "Drop") })) await perform(langText(`Usuwanie ${name}`, `Dropping ${name}`), () => gitStashAction(ctx.repo(), stash.index, "drop")); } },
      ]);
    },
  };
}
