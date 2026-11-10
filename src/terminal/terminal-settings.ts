/** The Terminal section of the settings: default shell, font size, saving in the project, and the user's own shells. */
import { $ } from "../app/dom";
import { langText } from "../i18n/language";
import { ICONS } from "../ui/icons";
import { refreshCustomSelect } from "../ui/custom-select";
import { showToast } from "../ui/toast";
import { joinArguments, parseCustomProfiles, splitArguments } from "./terminal-model";
import { customShells, defaultShellId, onTerminalsChanged, saveCustomShells, saveTerminalsInProject, setDefaultShell, setSaveTerminalsInProject, setTerminalFontSize, shellProfiles, terminalFontSize } from "./terminal-store";

let shownShells = "";

/** The shells in the "default shell" list: filled when the system's shells are known or the user's own change. */
function fillDefaultShell(): void {
  const select = $<HTMLSelectElement>("terminalDefaultShell");
  const profiles = shellProfiles();
  const signature = `${profiles.map(profile => `${profile.id}:${profile.label}`).join("|")}#${defaultShellId()}`;
  if (signature === shownShells) return;
  shownShells = signature;
  select.replaceChildren(...profiles.map(profile => { const option = document.createElement("option"); option.value = profile.id; option.textContent = profile.label; return option; }));
  select.value = defaultShellId() ?? "";
  refreshCustomSelect(select);
}

function renderCustomList(): void {
  const list = $("terminalCustomList");
  list.replaceChildren(...customShells().map(profile => {
    const row = document.createElement("div");
    row.className = "terminal-custom-row";
    const name = document.createElement("span"); name.className = "terminal-custom-name"; name.textContent = profile.label;
    const path = document.createElement("span"); path.className = "terminal-custom-path"; path.textContent = `${profile.path}${profile.args.length ? ` ${joinArguments(profile.args)}` : ""}`; path.title = path.textContent;
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "terminal-custom-remove";
    remove.insertAdjacentHTML("afterbegin", ICONS.trash);
    const label = langText(`Usuń powłokę „${profile.label}”`, `Remove the shell “${profile.label}”`);
    remove.dataset.tooltip = label; remove.setAttribute("aria-label", label);
    remove.addEventListener("click", () => { saveCustomShells(customShells().filter(other => other.id !== profile.id)); });
    row.append(name, path, remove);
    return row;
  }));
}

function addCustomShell(): void {
  const name = $<HTMLInputElement>("terminalCustomName"), path = $<HTMLInputElement>("terminalCustomPath"), args = $<HTMLInputElement>("terminalCustomArgs");
  const id = `custom-${Date.now().toString(36)}`;
  const [profile] = parseCustomProfiles(JSON.stringify([{ id, label: name.value, path: path.value, args: splitArguments(args.value) }]));
  if (!profile || !name.value.trim()) {
    showToast(langText("Podaj nazwę i pełną ścieżkę programu (np. C:/Tools/nu.exe lub /usr/bin/fish).", "Give a name and the full path of the program (e.g. C:/Tools/nu.exe or /usr/bin/fish)."));
    (name.value.trim() ? path : name).focus();
    return;
  }
  saveCustomShells([...customShells(), profile]);
  name.value = ""; path.value = ""; args.value = "";
}

function applyPlaceholders(): void {
  $<HTMLInputElement>("terminalCustomName").placeholder = langText("Nazwa", "Name");
  $<HTMLInputElement>("terminalCustomPath").placeholder = langText("Pełna ścieżka programu", "Full path of the program");
  $<HTMLInputElement>("terminalCustomArgs").placeholder = langText("Argumenty (opcjonalnie)", "Arguments (optional)");
  for (const [id, text] of [["terminalCustomName", langText("Nazwa nowej powłoki", "Name of the new shell")], ["terminalCustomPath", langText("Pełna ścieżka programu", "Full path of the program")], ["terminalCustomArgs", langText("Argumenty programu", "Arguments of the program")]]) $(id).setAttribute("aria-label", text);
}

export function setupTerminalSettings(): void {
  const dialog = $<HTMLDialogElement>("terminalSettingsDialog");
  $("terminalOpenSettings").addEventListener("click", () => dialog.showModal());
  $("terminalSettingsClose").addEventListener("click", () => dialog.close());
  const font = $<HTMLSelectElement>("terminalFontSize");
  font.value = String(terminalFontSize());
  if (font.value !== String(terminalFontSize())) { const option = document.createElement("option"); option.value = String(terminalFontSize()); option.textContent = option.value; font.append(option); font.value = option.value; }
  font.addEventListener("change", () => setTerminalFontSize(Number(font.value)));
  $<HTMLSelectElement>("terminalDefaultShell").addEventListener("change", event => setDefaultShell((event.target as HTMLSelectElement).value));
  const save = $<HTMLInputElement>("terminalSaveToggle");
  save.checked = saveTerminalsInProject();
  save.addEventListener("change", () => {
    setSaveTerminalsInProject(save.checked);
    $("statusText").textContent = save.checked
      ? langText("Terminale będą zapisywane w pliku typenova.config.json w folderze projektu.", "Terminals will be saved in the typenova.config.json file in the project folder.")
      : langText("Terminale zostają tylko w programie. Istniejące pliki typenova.config.json nie są zmieniane.", "Terminals stay only in the program. Existing typenova.config.json files are not changed.");
  });
  $("terminalCustomAdd").addEventListener("click", addCustomShell);
  for (const id of ["terminalCustomName", "terminalCustomPath", "terminalCustomArgs"]) $(id).addEventListener("keydown", event => { if ((event as KeyboardEvent).key === "Enter") { event.preventDefault(); addCustomShell(); } });
  applyPlaceholders();
  document.addEventListener("typenova:language-changed", () => { applyPlaceholders(); renderCustomList(); });
  onTerminalsChanged(() => { fillDefaultShell(); renderCustomList(); });
  fillDefaultShell();
  renderCustomList();
}
