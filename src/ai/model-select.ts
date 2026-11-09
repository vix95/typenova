/** A model chooser: the same stored choice is offered in the settings, in the chat pane and in the "Ask Claude" window, and they follow each other. */
import { AI_MODELS } from "./ai-model";
import { readModel, saveModel } from "./ai-settings";
import { refreshCustomSelect } from "../ui/custom-select";

/** Fills a select with the models, shows the chosen one and keeps it in step with the stored choice. */
export function bindModelSelect(select: HTMLSelectElement): void {
  if (!select.options.length) for (const info of AI_MODELS) select.append(new Option(info.label, info.id));
  const show = () => { select.value = readModel(); refreshCustomSelect(select); };
  show();
  select.addEventListener("change", () => saveModel(select.value));
  document.addEventListener("typenova:ai-settings-changed", () => { if (select.isConnected && select.value !== readModel()) show(); });
}
