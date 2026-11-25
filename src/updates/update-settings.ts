/** The setting "check for updates" (on by default). */
import { readPreferenceFlag, writePreferenceFlag } from "../settings/preferences";

const ENABLED_KEY = "typenova.checkUpdates";

export const updateCheckEnabled = (): boolean => readPreferenceFlag(ENABLED_KEY, true);
export const setUpdateCheckEnabled = (enabled: boolean): void => writePreferenceFlag(ENABLED_KEY, enabled);
