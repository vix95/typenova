/** Transient toast notification. */
const toastElement = (): HTMLElement => {
  let toast = document.getElementById("appToast");
  if (!toast) { toast = document.createElement("div"); toast.id = "appToast"; toast.className = "app-toast"; toast.popover = "manual"; document.body.append(toast); }
  return toast;
};

let hideTimer = 0;

/** A modal dialog is in the browser's top layer, above everything that is not: a toast that appeared while one is open would be hidden behind it. The toast is a popover, and showing it again puts it on top of what is there now. */
function raiseToTop(toast: HTMLElement): void {
  if (toast.matches(":popover-open")) toast.hidePopover();
  toast.showPopover();
}

function show(toast: HTMLElement, ms: number): void {
  raiseToTop(toast);
  toast.classList.add("visible");
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => { toast.classList.remove("visible"); toast.classList.remove("has-action"); }, ms);
}

export function showToast(message: string) {
  const toast = toastElement();
  toast.classList.remove("has-action");
  toast.textContent = message;
  show(toast, 6000);
}

/** A toast with one button (for example "Undo"); it stays longer so that the button can be reached, and it is clickable. */
export function showActionToast(message: string, actionLabel: string, onAction: () => void, ms = 14000): void {
  const toast = toastElement();
  const text = document.createElement("span");
  text.textContent = message;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "app-toast-action";
  button.textContent = actionLabel;
  button.addEventListener("click", () => { toast.classList.remove("visible", "has-action"); window.clearTimeout(hideTimer); onAction(); });
  toast.replaceChildren(text, button);
  toast.classList.add("has-action");
  show(toast, ms);
}
