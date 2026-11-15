/** The Writer mode as the person meets it: one button (and Ctrl+/) that switches the editor between Markdown source and the rendered, directly editable text, remembered between runs. The document is the same text either way, so nothing is converted and the editor's own history, search and saving keep working. */
import { openUrl } from "@tauri-apps/plugin-opener";
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { showFileTab } from "../documents/file-navigation";
import { dispatchToAllViews, view } from "../editor/editor-view";
import { langText } from "../i18n/language";
import { readPreferenceFlag, writePreferenceFlag } from "../settings/preferences";
import { showToast } from "../ui/toast";
import { setLinkOpener, setWriterToggleHandler, writerCompartment, writerExtensions } from "./writer-extension";

const KEY = "typenova.writer";
let enabled = readPreferenceFlag(KEY, false);

function labels(): void {
  const button = $("toggleWriter");
  const text = enabled ? langText("Pisarz: włączony. Wróć do źródła Markdown (Ctrl+/)", "Writer: on. Back to the Markdown source (Ctrl+/)") : langText("Pisarz: edytuj tekst w postaci wyrenderowanej, jak w Typora (Ctrl+/)", "Writer: edit the rendered text, as in Typora (Ctrl+/)");
  button.dataset.tooltip = text; button.setAttribute("aria-label", text);
  button.setAttribute("aria-pressed", String(enabled));
  button.classList.toggle("selected", enabled); button.classList.toggle("primary", enabled);
}

export function setWriterMode(on: boolean): void {
  enabled = on;
  writePreferenceFlag(KEY, on);
  document.body.classList.toggle("writer-mode", on);
  const effect = writerCompartment.reconfigure(writerExtensions(on));
  // Documents that are not shown get the switch in their saved state; the ones on screen through the editor.
  for (const tab of documentState.tabs) tab.state = tab.state.update({ effects: effect }).state;
  dispatchToAllViews({ effects: effect });
  labels();
  requestAnimationFrame(() => view.requestMeasure());
}

export const toggleWriterMode = (): void => setWriterMode(!enabled);

/** A Ctrl+click on a link: a web address opens in the browser, a path opens the note (relative to the document), an anchor is not followed here. */
async function followLink(target: Parameters<Parameters<typeof setLinkOpener>[0]>[0]): Promise<void> {
  if (target.kind === "external") { await openUrl(target.url).catch(() => showToast(langText("Nie można otworzyć linku.", "The link could not be opened."))); return; }
  if (target.kind !== "file") return;
  const absolute = /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(target.path);
  const base = documentState.currentPath?.replace(/[\\/][^\\/]*$/, "");
  if (!absolute && !base) { showToast(langText("Zapisz dokument, żeby otwierać linki do plików.", "Save the document to open links to files.")); return; }
  const result = await showFileTab(absolute ? target.path : `${base}/${target.path.replace(/^\.\//, "")}`);
  if (result !== "shown") showToast(langText("Nie można otworzyć tego pliku.", "That file could not be opened."));
}

export function installWriterMode(): void {
  setLinkOpener(target => { void followLink(target); });
  setWriterToggleHandler(toggleWriterMode);
  $("toggleWriter").addEventListener("click", toggleWriterMode);
  document.addEventListener("typenova:language-changed", labels);
  document.body.classList.toggle("writer-mode", enabled);
  labels();
}
