/** Promise-based prompt/confirm/alert dialogs and accessible labelling of native dialogs. */
import { $ } from "../app/dom";
import { langText } from "../i18n/language";

type AppPromptOptions = {
  confirmLabel?: string;
  primaryAction?: "confirm" | "cancel";
};
function appPrompt(message: string, confirmation = true, options: AppPromptOptions = {}): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = $("appPromptDialog") as HTMLDialogElement;
    const title = $("appPromptTitle") as HTMLElement;
    const body = $("appPromptMessage") as HTMLElement;
    const cancel = $("appPromptCancel") as HTMLButtonElement;
    const confirmButton = $("appPromptConfirm") as HTMLButtonElement;
    if (dialog.open) dialog.close("cancel");
    title.textContent = confirmation ? langText("TypeNova · potwierdzenie", "TypeNova · confirmation") : langText("TypeNova · komunikat", "TypeNova · message");
    body.textContent = message;
    cancel.hidden = !confirmation;
    cancel.textContent = langText("Anuluj", "Cancel");
    confirmButton.textContent = options.confirmLabel ?? (confirmation ? langText("Potwierdź", "Confirm") : "OK");
    confirmButton.value = "confirm";
    // Destructive actions must not be the visually emphasized/default-looking choice.
    const cancelIsPrimary = confirmation && options.primaryAction === "cancel";
    cancel.classList.toggle("primary", cancelIsPrimary);
    confirmButton.classList.toggle("primary", !cancelIsPrimary);
    const onClose = () => resolve(!confirmation || dialog.returnValue === "confirm");
    dialog.addEventListener("close", onClose, { once: true });
    dialog.showModal();
  });
}
export function appConfirm(message: string, options: AppPromptOptions = {}) { return appPrompt(message, true, options); }
export async function appAlert(message: string) { await appPrompt(message, false); }

export function initDialogLabels(): void {
  // The startup overlay is dismissed after the first successful preview or the guarded fallback.

  // Native modal dialogs handle focus containment, Escape dismissal and focus restoration.
  // Associate visible titles with their dialog for accessible names.
  document.querySelectorAll<HTMLDialogElement>("dialog").forEach(dialog => {
    const title = dialog.querySelector<HTMLElement>(".dialog-title");
    if (title) { if (!title.id) title.id = `${dialog.id || "typenova"}-title`; dialog.setAttribute("aria-labelledby", title.id); }
  });
}
