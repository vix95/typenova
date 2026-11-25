/** The actions of the Git window beyond reading history: fetch, push, stash, and continuing or aborting an operation that stopped; the menus are in `git-menus.ts` and the multi-step actions in `git-flows.ts`. Each action runs, then the window reads the repository again. An action that stops on a conflict is told as such, and the window offers to continue or abort it. */
import { langText } from "../i18n/language";
import { appAlert, appConfirm } from "../ui/dialogs";
import { askForName } from "../ui/name-dialog";
import { showToast } from "../ui/toast";
import { gitFetch, gitOperation, gitPush, gitStashPush, type GitCommit, type GitOpResult, type GitStash } from "./git-api";
import { createFlows } from "./git-flows";
import { createGitMenus } from "./git-menus";

export interface OpsContext {
  repo: () => string;
  /** The branch in use (null when HEAD is detached). */
  current: () => string | null;
  /** Reads the repository again and draws the window. */
  reload: () => Promise<void>;
  /** The window the menus are drawn in. */
  host: () => HTMLElement;
}

export interface GitOps {
  fetch(): Promise<void>;
  push(): Promise<void>;
  stash(): Promise<void>;
  continueOperation(): Promise<void>;
  abortOperation(): Promise<void>;
  branchMenu(event: MouseEvent, name: string, remote: boolean): void;
  tagMenu(event: MouseEvent, name: string): void;
  commitMenu(event: MouseEvent, commit: GitCommit): void;
  stashMenu(event: MouseEvent, stash: GitStash): void;
  /** Double click on a branch: switch to it. */
  open(name: string, remote: boolean): Promise<void>;
}

/** The first line of what git said, for a message. */
const firstLine = (text: string): string => text.split("\n").find(line => line.trim()) ?? "";

export function createGitOps(ctx: OpsContext): GitOps {
  let busy = false;

  /** Runs one action: tells what it did (or why it stopped), then the window reads the repository again. */
  const perform = async (label: string, call: () => Promise<GitOpResult>): Promise<boolean> => {
    if (busy) { showToast(langText("Poprzednia operacja jeszcze trwa.", "The previous operation is still running.")); return false; }
    busy = true;
    showToast(`${label}…`);
    try {
      const result = await call();
      document.dispatchEvent(new CustomEvent("typenova:git-changed"));
      await ctx.reload();
      if (result.ok) { showToast(firstLine(result.message) || langText("Gotowe.", "Done.")); return true; }
      const hint = result.inProgress ? `${langText("Operacja zatrzymała się (konflikty). Rozwiąż je w panelu zmian i kontynuuj albo przerwij operację.", "The operation stopped (conflicts). Resolve them in the changes panel and continue, or abort the operation.")}\n\n` : "";
      await appAlert(`${label}\n\n${hint}${result.message}`);
      return false;
    } catch (error) {
      await appAlert(`${label}\n\n${String(error)}`);
      await ctx.reload().catch(() => undefined);
      return false;
    } finally { busy = false; }
  };

  const flows = createFlows(ctx, perform);
  const menus = createGitMenus(ctx, flows, perform);

  return {
    ...menus,
    fetch: async () => { await perform(langText("Pobieranie wszystkich gałęzi i zmian (fetch)", "Fetching all branches and changes"), () => gitFetch(ctx.repo())); },
    push: async () => {
      if (busy) return;
      busy = true;
      showToast(langText("Wysyłanie zmian…", "Pushing…"));
      try {
        const pushed = await gitPush(ctx.repo());
        document.dispatchEvent(new CustomEvent("typenova:git-changed"));
        await ctx.reload();
        if (pushed.pushed) showToast(langText(`Wysłano do ${pushed.target}.`, `Pushed to ${pushed.target}.`));
        else await appAlert(`${langText("Nie wysłano", "Not pushed")}:\n\n${pushed.error ?? ""}`);
      } catch (error) { await appAlert(`${langText("Nie wysłano", "Not pushed")}:\n\n${String(error)}`); }
      finally { busy = false; }
    },
    stash: async () => {
      const message = await askForName({ title: langText("Schowaj zmiany (stash)", "Stash the changes"), label: langText("Opis (nieobowiązkowy)", "Message (optional)"), confirmLabel: langText("Schowaj", "Stash"), validate: () => null });
      if (message !== null) await perform(langText("Chowanie zmian", "Stashing the changes"), () => gitStashPush(ctx.repo(), message, true));
    },
    continueOperation: async () => { await perform(langText("Kontynuowanie operacji", "Continuing the operation"), () => gitOperation(ctx.repo(), "continue")); },
    abortOperation: async () => {
      if (await appConfirm(langText("Przerwać trwającą operację? Repozytorium wróci do stanu sprzed niej.", "Abort the operation in progress? The repository goes back to how it was before it."), { confirmLabel: langText("Przerwij", "Abort") })) await perform(langText("Przerywanie operacji", "Aborting the operation"), () => gitOperation(ctx.repo(), "abort"));
    },
    open: async (name, remote) => { if (name !== ctx.current()) await flows.switchTo(name, remote); },

  };
}
