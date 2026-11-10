/** Transient toast notification. */
const toastElement = (): HTMLElement => {
  let toast = document.getElementById("appToast");
  if (!toast) { toast = document.createElement("div"); toast.id = "appToast"; toast.className = "app-toast"; document.body.append(toast); }
  return toast;
};

let hideTimer = 0;
function show(toast: HTMLElement, ms: number): void {
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
