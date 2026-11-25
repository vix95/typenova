/** Updates of the program: at the start (when the setting is on) and from the Help menu it asks GitHub whether a newer release exists, tells the person, and after a confirmation downloads it, checks its signature, installs it and starts the program again. */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { langText } from "../i18n/language";
import { appAlert, appConfirm } from "../ui/dialogs";
import { showToast } from "../ui/toast";
import { checkIsDue, downloadPercent, releaseNote } from "./update-model";
import { lastUpdateCheck, rememberUpdateCheck, setUpdateCheckEnabled, updateCheckEnabled } from "./update-settings";

interface UpdateInfo { version: string; current: string; notes: string }

const START_DELAY_MS = 6000;
let busy = false;

/** Downloads and installs the update that was found; the program ends when the installer starts, so this returns only on a failure. */
async function install(info: UpdateInfo): Promise<void> {
  const status = $("statusText");
  const stop = await listen<{ downloaded: number; total: number | null }>("update-progress", event => {
    const percent = downloadPercent(event.payload.downloaded, event.payload.total);
    status.textContent = langText(`Pobieranie aktualizacji ${info.version}…${percent === null ? "" : ` ${percent}%`}`, `Downloading update ${info.version}…${percent === null ? "" : ` ${percent}%`}`);
  });
  status.textContent = langText(`Pobieranie aktualizacji ${info.version}…`, `Downloading update ${info.version}…`);
  try { await invoke("update_install"); } finally { stop(); }
}

/** Tells the person about the new version and goes on only when they agree and nothing unsaved would be lost. */
async function offer(info: UpdateInfo): Promise<void> {
  const note = releaseNote(info.notes);
  const intro = langText(`Dostępna jest nowa wersja TypeNova ${info.version} (masz ${info.current}).`, `A new version of TypeNova is available: ${info.version} (you have ${info.current}).`);
  const outro = langText("Program zamknie się, zaktualizuje i uruchomi ponownie. Ustawienia zostaną zachowane.", "The program will close, update and start again. Your settings are kept.");
  const agreed = await appConfirm([intro, note, outro].filter(Boolean).join("\n\n"), { confirmLabel: langText("Aktualizuj", "Update") });
  if (!agreed) return;
  if (documentState.tabs.some(tab => tab.dirty)) {
    await appAlert(langText("Masz niezapisane zmiany. Zapisz je i wybierz Pomoc → Sprawdź aktualizacje, żeby ich nie stracić.", "You have unsaved changes. Save them and choose Help → Check for updates, so that they are not lost."));
    return;
  }
  try { await install(info); } catch (error) {
    $("statusText").textContent = "";
    await appAlert(langText(`Nie udało się zaktualizować programu: ${error}`, `The program could not be updated: ${error}`));
  }
}

/** One check. At the start it is silent when nothing is found or the network fails; from the menu it always answers. */
async function checkNow(manual: boolean): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    rememberUpdateCheck(Date.now());
    const info = await invoke<UpdateInfo | null>("update_check");
    if (info) await offer(info);
    else if (manual) showToast(langText("Masz najnowszą wersję TypeNova.", "TypeNova is up to date."));
  } catch (error) {
    if (manual) await appAlert(langText(`Nie udało się sprawdzić aktualizacji: ${error}`, `Could not check for updates: ${error}`));
  } finally { busy = false; }
}

/** Wires the menu item, the setting and the check at the start. */
export function installUpdater(): void {
  $("menuCheckUpdates").addEventListener("click", () => { void checkNow(true); });
  $("updateCheckNow").addEventListener("click", () => { void checkNow(true); });
  const toggle = $<HTMLInputElement>("updateCheckToggle");
  toggle.checked = updateCheckEnabled();
  toggle.addEventListener("change", () => {
    setUpdateCheckEnabled(toggle.checked);
    $("statusText").textContent = toggle.checked
      ? langText("TypeNova będzie przy starcie sprawdzać, czy jest nowa wersja.", "TypeNova will check for a new version at the start.")
      : langText("TypeNova nie będzie sprawdzać aktualizacji. Możesz to zrobić ręcznie w menu Pomoc.", "TypeNova will not check for updates. You can do it by hand in the Help menu.");
  });
  const extraWindow = new URLSearchParams(location.search).has("detach");
  if (!extraWindow && updateCheckEnabled() && checkIsDue(lastUpdateCheck(), Date.now())) window.setTimeout(() => { if (updateCheckEnabled()) void checkNow(false); }, START_DELAY_MS);
}
