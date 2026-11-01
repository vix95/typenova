/** The application version, read from package.json so the About dialog never shows a stale number. */
import { version } from "../../package.json";

export const APP_VERSION: string = version;

export function initAppVersion(): void {
  const field = document.getElementById("appVersion");
  if (field) field.textContent = APP_VERSION;
}
