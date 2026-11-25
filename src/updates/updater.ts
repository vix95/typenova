/** Updates of the program: at the start (when the setting is on) and from the Help menu it asks GitHub whether a newer release exists, tells the person, and after a confirmation downloads it, checks its signature, installs it and starts the program again. While it works the icon of "Check now" turns and a bar runs (endless while it checks, filling while it downloads). */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { langText } from "../i18n/language";
import { appAlert, appConfirm } from "../ui/dialogs";
import { showActionToast, showToast } from "../ui/toast";
import { RECHECK_MS, downloadPercent, releaseNote } from "./update-model";
import { setUpdateCheckEnabled, updateCheckEnabled } from "./update-settings";

interface UpdateInfo { version: string; current: string; notes: string }
type Phase = "idle" | "checking" | "downloading";

const START_DELAY_MS = 6000;
/** How long the notice of a new version stays at the corner of the window. */
const NOTICE_MS = 45000;
/** A manual check that finishes at once is still shown for this long, so that the person sees that something was done. */
const MIN_VISIBLE_MS = 700;
const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
let busy = false;
let offering = false;

/** The bars: one at the top of the window (for the checks made at the start and from the menu) and one in the settings, under the button. */
function bars(): HTMLElement[] { return [...document.querySelectorAll<HTMLElement>(".update-bar")]; }

/** Shows what the update is doing: the turning icon and disabled buttons, the bars (`percent` null = endless) and the line of the status bar. */
function showPhase(phase: Phase, percent: number | null = null, version = ""): void {
  const working = phase !== "idle";
  const button = $<HTMLButtonElement>("updateCheckNow");
  button.classList.toggle("is-checking", working);
  button.disabled = working; button.setAttribute("aria-busy", String(working));
  $<HTMLButtonElement>("menuCheckUpdates").disabled = working;
  const label = phase === "downloading" ? langText(`Pobieranie aktualizacji ${version}`, `Downloading update ${version}`) : langText("Sprawdzanie aktualizacji", "Checking for updates");
  for (const bar of bars()) {
    bar.hidden = !working;
    bar.dataset.state = percent === null ? "indeterminate" : "determinate";
    bar.style.setProperty("--progress", `${percent ?? 0}%`);
    bar.setAttribute("aria-label", label);
    if (percent === null) bar.removeAttribute("aria-valuenow"); else bar.setAttribute("aria-valuenow", String(percent));
  }
  if (working) $("statusText").textContent = `${label}…${percent === null ? "" : ` ${percent}%`}`;
}

function createBar(extraClass = ""): HTMLElement {
  const bar = document.createElement("div");
  bar.className = `update-bar ${extraClass}`.trim(); bar.hidden = true;
  bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", "100");
  return bar;
}

/** Downloads and installs the update that was found; the program ends when the installer starts, so this returns only on a failure. */
async function install(info: UpdateInfo): Promise<void> {
  const stop = await listen<{ downloaded: number; total: number | null }>("update-progress", event => {
    showPhase("downloading", downloadPercent(event.payload.downloaded, event.payload.total), info.version);
  });
  showPhase("downloading", null, info.version);
  try { await invoke("update_install"); } finally { stop(); showPhase("idle"); }
}

/** Tells the person about the new version and goes on only when they agree and nothing unsaved would be lost. */
async function offer(info: UpdateInfo): Promise<void> {
  if (offering) return;
  offering = true;
  try { await askAndInstall(info); } finally { offering = false; }
}

async function askAndInstall(info: UpdateInfo): Promise<void> {
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

/** A check that nobody asked for found a new version: a notice at the corner of the window (it does not interrupt the work) whose button opens the confirmation. */
function announce(info: UpdateInfo): void {
  $("statusText").textContent = langText(`Dostępna nowa wersja TypeNova ${info.version}.`, `A new version of TypeNova is available: ${info.version}.`);
  showActionToast(langText(`Dostępna nowa wersja TypeNova ${info.version}.`, `A new version of TypeNova is available: ${info.version}.`), langText("Aktualizuj", "Update"), () => { void offer(info); }, NOTICE_MS);
}

/** One check. At the start it is silent when nothing is found or the network fails; from the menu it always answers. */
async function checkNow(manual: boolean): Promise<void> {
  if (busy) return;
  busy = true;
  showPhase("checking");
  try {
    const [info] = await Promise.all([invoke<UpdateInfo | null>("update_check"), manual ? sleep(MIN_VISIBLE_MS) : Promise.resolve()]);
    showPhase("idle");
    if (info) { if (manual) await offer(info); else announce(info); }
    else if (manual) showToast(langText("Masz najnowszą wersję TypeNova.", "TypeNova is up to date."));
  } catch (error) {
    showPhase("idle");
    if (manual) await appAlert(langText(`Nie udało się sprawdzić aktualizacji: ${error}`, `Could not check for updates: ${error}`));
  } finally { busy = false; showPhase("idle"); }
}

/** Wires the menu item, the setting, the bars and the check at the start. */
export function installUpdater(): void {
  document.body.append(createBar("update-bar-top"));
  $("updateCheckBarSlot").append(createBar());
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
  if (!extraWindow && updateCheckEnabled()) window.setTimeout(() => { if (updateCheckEnabled()) void checkNow(false); }, START_DELAY_MS);
  if (!extraWindow) window.setInterval(() => { if (updateCheckEnabled()) void checkNow(false); }, RECHECK_MS);
}
