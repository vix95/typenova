/** Running a code block (bash, PowerShell, cmd…) from a note in a terminal: in the one used last when it fits the script, else in one made for it. */
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";
import { writeTerminal } from "./terminal-backend";
import { commandText, languageFamily, pickProfile, pickShellFor, shellFamily, type ShellFamily } from "./terminal-model";
import { showTerminalPanel } from "./terminal-panel";
import { activateTerminal, createTerminal, defaultShellId, loadShells, recentTerminals, shellProfiles, tabById, terminalState, type TerminalTab } from "./terminal-store";

const START_WAIT_MS = 8000, PROMPT_WAIT_MS = 600;

/** Whether the shell of a terminal reads this kind of script. A shell of the user's own (unknown family) is trusted to. */
function fits(tab: TerminalTab, family: ShellFamily): boolean {
  const profile = pickProfile(shellProfiles(), tab.setup.shell, defaultShellId());
  const own = profile ? shellFamily(profile.id) : null;
  return own === null || own === family;
}

/** Waits until the shell of a terminal runs (it starts when its screen is shown). False when it failed to start or took too long. */
async function waitUntilRunning(tab: TerminalTab): Promise<boolean> {
  const deadline = Date.now() + START_WAIT_MS;
  while (Date.now() < deadline) {
    const current = tabById(tab.setup.id);
    if (!current || current.status === "failed") return false;
    if (current.status === "running") return true;
    await new Promise(resolve => window.setTimeout(resolve, 50));
  }
  return false;
}

/** The terminal to use: the one used last whose shell fits the script, else a new one with a shell that fits (or the default shell when this computer has none, with a note). */
function terminalFor(family: ShellFamily | null): { tab: TerminalTab | null; created: boolean; note: string } {
  const existing = recentTerminals().find(tab => !family || fits(tab, family));
  if (existing) return { tab: existing, created: false, note: "" };
  const profile = family ? pickShellFor(family, shellProfiles()) : null;
  const tab = createTerminal(profile ? { shell: profile.id } : {});
  const note = family && !profile ? langText("Na tym komputerze nie ma powłoki pasującej do tego skryptu — uruchomiono go w domyślnym terminalu.", "This computer has no shell that suits this script — it was run in the default terminal.") : "";
  return { tab, created: true, note };
}

/** Types the code of a block into a terminal and runs it. Called when the user clicks "Run" on a block, which shows the code. */
export async function runInTerminal(code: string, language: string): Promise<void> {
  const text = commandText(code);
  if (!text) return;
  if (!terminalState.detected.length) await loadShells();
  const { tab, created, note } = terminalFor(languageFamily(language));
  if (!tab) return;
  const wasRunning = tab.status === "running";
  activateTerminal(tab.setup.id);
  showTerminalPanel(true, { focus: false });
  if (!await waitUntilRunning(tab)) { showToast(langText("Terminal nie wystartował, więc nie uruchomiono skryptu.", "The terminal did not start, so the script was not run.")); return; }
  // A shell that has just started needs a moment before it reads its first line.
  if (!wasRunning) await new Promise(resolve => window.setTimeout(resolve, PROMPT_WAIT_MS));
  try { await writeTerminal(tab.setup.id, `${text}\r`); }
  catch { showToast(langText("Terminal nie przyjął tekstu (nie odpowiada). Uruchom go ponownie.", "The terminal did not take the text (it is not responding). Restart it.")); return; }
  tab.session.focus();
  showToast(note || (created
    ? langText(`Uruchomiono w nowym terminalu „${tab.setup.name}”.`, `Run in a new terminal “${tab.setup.name}”.`)
    : langText(`Uruchomiono w terminalu „${tab.setup.name}”.`, `Run in the terminal “${tab.setup.name}”.`)));
}
