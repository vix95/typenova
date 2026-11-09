/** The assistant options window (provider, API key or address, model). It is opened from the settings, from the chat pane and from the "Ask" window. */
import { $ } from "../app/dom";

export function openAiOptions(): void {
  const dialog = $("aiOptionsDialog") as HTMLDialogElement;
  if (!dialog.open) dialog.showModal();
  // Focus starts on the provider that is on, from where the arrow keys move between providers.
  dialog.querySelector<HTMLElement>('.ai-provider-card[aria-checked="true"]')?.focus();
}
