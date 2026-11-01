/** A small modal that asks for one name (for example of a new folder) and validates it before it closes. */
import { langText } from "../i18n/language";

export interface NameDialogOptions {
  title: string;
  label: string;
  /** Message for a name that cannot be used, or null/undefined when it is fine. May be asynchronous (for example a check on disk). */
  validate: (name: string) => string | null | undefined | Promise<string | null | undefined>;
  confirmLabel?: string;
  /** Text the field starts with; its part before the last dot is selected so a file extension survives typing. */
  initialValue?: string;
}

/** Resolves with the trimmed name, or null when the dialog is cancelled. */
export function askForName(options: NameDialogOptions): Promise<string | null> {
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.className = "name-dialog"; dialog.setAttribute("aria-labelledby", "nameDialogTitle");
    const content = document.createElement("div"); content.className = "dialog-content";
    const title = document.createElement("div"); title.className = "dialog-title"; title.id = "nameDialogTitle"; title.textContent = options.title;
    const label = document.createElement("label"); label.className = "name-dialog-field";
    const caption = document.createElement("span"); caption.textContent = options.label;
    const input = document.createElement("input"); input.type = "text"; input.className = "name-dialog-input"; input.spellcheck = false;
    label.append(caption, input);
    if (options.initialValue) input.value = options.initialValue;
    const error = document.createElement("div"); error.className = "name-dialog-error"; error.setAttribute("role", "alert"); error.hidden = true;
    const actions = document.createElement("div"); actions.className = "dialog-actions";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = langText("Anuluj", "Cancel");
    const confirm = document.createElement("button"); confirm.type = "button"; confirm.className = "primary"; confirm.textContent = options.confirmLabel ?? langText("Utwórz", "Create");
    actions.append(cancel, confirm);
    content.append(title, label, error, actions); dialog.append(content); document.body.append(dialog);

    let settled = false;
    const finish = (name: string | null) => { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(name); };
    const submit = async () => {
      const name = input.value.trim();
      const problem = await options.validate(name);
      if (problem) { error.textContent = problem; error.hidden = false; input.focus(); return; }
      finish(name);
    };
    cancel.addEventListener("click", () => finish(null));
    confirm.addEventListener("click", () => void submit());
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
    input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void submit(); } });
    input.addEventListener("input", () => { error.hidden = true; });
    dialog.showModal(); input.focus();
    if (options.initialValue) { const dot = options.initialValue.lastIndexOf("."); input.setSelectionRange(0, dot > 0 ? dot : options.initialValue.length); }
  });
}
