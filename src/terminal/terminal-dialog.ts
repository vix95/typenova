/** The window in which a terminal gets its name, shell, folder and startup command (a new one or an existing one). */
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { button, el } from "../editor/bookmark-browser";
import { appConfirm } from "../ui/dialogs";
import { themeSelect } from "../ui/custom-select";
import { documentState } from "../documents/document-state";
import { cleanRelativeFolder, MAX_STARTUP_LENGTH, MAX_TERMINAL_NAME } from "./terminal-model";
import { createTerminal, defaultShellId, defaultTerminalRoot, restartTerminal, shellProfiles, trustCommands, updateTerminal, type TerminalTab } from "./terminal-store";

let open: HTMLDialogElement | null = null;

function field(label: string, control: HTMLElement, hint = ""): HTMLLabelElement {
  const wrapper = el("label", "bookmark-field");
  wrapper.append(el("span", "", label), control);
  if (hint) wrapper.append(el("span", "terminal-field-hint", hint));
  return wrapper;
}

function textInput(value: string, placeholder: string, max: number): HTMLInputElement {
  const input = el("input", "bookmark-input");
  input.type = "text"; input.value = value; input.placeholder = placeholder; input.maxLength = max; input.spellcheck = false; input.autocomplete = "off";
  return input;
}

function shellSelect(current: string): HTMLSelectElement {
  const select = el("select", "bookmark-input terminal-select");
  const fallback = defaultShellId();
  for (const profile of shellProfiles()) {
    const option = el("option", "", `${profile.label}${profile.id === fallback ? langText(" (domyślna)", " (default)") : ""}`);
    option.value = profile.id;
    select.append(option);
  }
  select.value = shellProfiles().some(profile => profile.id === current) ? current : fallback ?? select.options[0]?.value ?? "";
  return select;
}

function projectSelect(current: string | null): HTMLSelectElement {
  const select = el("select", "bookmark-input terminal-select");
  const none = el("option", "", langText("Bez projektu (folder domowy, bez zapisu)", "No project (home folder, not saved)"));
  none.value = "";
  select.append(none);
  for (const root of documentState.projectRoots) { const option = el("option", "", basename(root)); option.value = root; option.title = root; select.append(option); }
  select.value = current && documentState.projectRoots.includes(current) ? current : "";
  return select;
}

/** Opens the window. With a terminal it edits that one; without, it makes a new one. */
export function openTerminalDialog(existing?: TerminalTab): void {
  open?.close();
  const dialog = el("dialog", "bookmark-dialog terminal-dialog");
  const content = el("div", "dialog-content bookmark-content");
  const title = el("div", "dialog-title", existing ? langText("Właściwości terminala", "Terminal properties") : langText("Nowy terminal", "New terminal")); title.id = "terminalDialogTitle";
  dialog.setAttribute("aria-labelledby", title.id);

  const name = textInput(existing?.setup.name ?? "", langText("Nazwa (domyślnie nazwa powłoki)", "Name (the shell's name by default)"), MAX_TERMINAL_NAME);
  const shell = shellSelect(existing?.setup.shell ?? "");
  const project = projectSelect(existing ? existing.root : defaultTerminalRoot());
  const folder = textInput(existing?.setup.cwd ?? "", langText("Podfolder projektu (puste = folder projektu)", "Folder in the project (empty = the project folder)"), 260);
  const startup = el("textarea", "bookmark-note terminal-startup");
  startup.value = existing?.setup.startup ?? ""; startup.rows = 3; startup.maxLength = MAX_STARTUP_LENGTH; startup.spellcheck = false;
  startup.placeholder = langText("Polecenie wpisywane po uruchomieniu powłoki, np. npm run dev (opcjonalnie)", "A command typed when the shell starts, e.g. npm run dev (optional)");

  const problem = el("div", "terminal-dialog-problem");
  problem.setAttribute("role", "alert");
  const syncFolderState = () => { folder.disabled = project.value === ""; };
  project.addEventListener("change", syncFolderState);
  syncFolderState();

  const save = async () => {
    const relative = cleanRelativeFolder(folder.value);
    if (relative === null) { problem.textContent = langText("Podfolder musi leżeć wewnątrz projektu (bez „..” i bez ścieżki bezwzględnej).", "The folder must be inside the project (no “..”, no absolute path)."); folder.focus(); return; }
    const root = project.value || null;
    const command = startup.value.replace(/\r\n?/g, "\n");
    // A command the user writes here is theirs: it is trusted for this project without asking again.
    if (root && command.trim()) trustCommands(root, [command]);
    if (!existing) {
      createTerminal({ name: name.value, shell: shell.value, root, cwd: root ? relative : "", startup: command });
      dialog.close();
      return;
    }
    const changesStart = existing.setup.shell !== shell.value || existing.root !== root || existing.setup.cwd !== (root ? relative : "");
    updateTerminal(existing, { name: name.value || existing.setup.name, shell: shell.value, cwd: root ? relative : "", startup: command }, root);
    existing.startupAllowed = true;
    dialog.close();
    if (changesStart && existing.session.isAlive) {
      const again = await appConfirm(langText("Zmiana powłoki lub folderu działa po ponownym uruchomieniu terminala. Uruchomić go teraz? Działający proces zostanie przerwany.", "A new shell or folder takes effect when the terminal restarts. Restart it now? The running process will be stopped."), { confirmLabel: langText("Uruchom ponownie", "Restart"), primaryAction: "cancel" });
      if (again) void restartTerminal(existing);
    }
  };

  const actions = el("div", "dialog-actions bookmark-actions");
  actions.append(el("span", "bookmark-actions-gap"), button("", "close", langText("Anuluj", "Cancel"), () => dialog.close(), true), button("bookmark-confirm", "check", existing ? langText("Zapisz", "Save") : langText("Utwórz", "Create"), () => { void save(); }, true));
  for (const input of [name, folder]) input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void save(); } });
  startup.addEventListener("keydown", event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); } });

  content.append(title, field(langText("Nazwa", "Name"), name), field(langText("Powłoka", "Shell"), shell), field(langText("Projekt", "Project"), project), field(langText("Podfolder", "Folder"), folder),
    field(langText("Polecenie startowe", "Startup command"), startup, langText("Zapisane w projekcie. Uruchamia się tylko po Twojej zgodzie: inny użytkownik projektu zostanie o nią zapytany.", "Saved in the project. It runs only with approval: anyone else who opens the project is asked first.")), problem, actions);
  dialog.append(content);
  dialog.addEventListener("close", () => { if (open === dialog) open = null; dialog.remove(); });
  open = dialog;
  document.body.append(dialog);
  themeSelect(shell); themeSelect(project);
  dialog.showModal();
  name.focus();
}
