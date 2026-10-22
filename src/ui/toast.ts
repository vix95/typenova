/** Transient toast notification. */
export function showToast(message: string) { let toast = document.getElementById("appToast"); if (!toast) { toast = document.createElement("div"); toast.id = "appToast"; toast.className = "app-toast"; document.body.append(toast); } toast.textContent = message; toast.classList.add("visible"); window.setTimeout(() => toast?.classList.remove("visible"), 6000); }
