/** Saving over a file that somebody else changed: another editor, a pull, an agent. The document remembers what it last read from the file or wrote to it; if the file holds something else now, saving would destroy that, so the person is asked first (auto-save simply waits). */
import { loadTextFile } from "../filesystem/text-io";
import { langText } from "../i18n/language";
import { appConfirm } from "../ui/dialogs";

/** True when the file on disk no longer holds `knownText` (a file that cannot be read counts as unchanged: there is nothing to overwrite). */
export async function changedOnDisk(path: string, knownText: string): Promise<boolean> {
  try { return (await loadTextFile(path)).text !== knownText; } catch { return false; }
}

/** Asks whether to overwrite a file that changed on disk since the document was read. */
export function confirmOverwriteOfChangedFile(name: string): Promise<boolean> {
  return appConfirm(
    langText(`Plik „${name}” zmienił się na dysku od chwili, gdy go wczytano. Zapisanie nadpisze te zmiany tym, co masz w edytorze. Nadpisać?`, `“${name}” has changed on disk since it was read. Saving will overwrite those changes with what is in the editor. Overwrite?`),
    { confirmLabel: langText("Nadpisz", "Overwrite"), primaryAction: "cancel" },
  );
}
