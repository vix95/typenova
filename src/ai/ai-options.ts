/** The "Claude options" window (API key and model). It is opened from the settings, from the chat pane and from the "Ask Claude" window. */
import { $ } from "../app/dom";

export function openAiOptions(): void {
  const dialog = $("aiOptionsDialog") as HTMLDialogElement;
  if (!dialog.open) dialog.showModal();
  ($("aiApiKeyInput") as HTMLInputElement).focus();
}
