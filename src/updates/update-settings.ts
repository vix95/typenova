/** The setting "check for updates" (on by default) and the time of the last check. */
import { readPreferenceFlag, writePreferenceFlag } from "../settings/preferences";

const ENABLED_KEY = "typenova.checkUpdates";
const LAST_KEY = "typenova.lastUpdateCheck";

export const updateCheckEnabled = (): boolean => readPreferenceFlag(ENABLED_KEY, true);
export const setUpdateCheckEnabled = (enabled: boolean): void => writePreferenceFlag(ENABLED_KEY, enabled);

export function lastUpdateCheck(): number | null {
  try { const value = Number(localStorage.getItem(LAST_KEY)); return Number.isFinite(value) && value > 0 ? value : null; } catch { return null; }
}
export function rememberUpdateCheck(now: number): void {
  try { localStorage.setItem(LAST_KEY, String(now)); } catch { /* the check is then simply done again at the next start */ }
}
