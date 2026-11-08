/** The pure rules of the audio/video player: clock text, playback speeds, what a key does (no DOM). */

/** 75 seconds -> "1:15", 3700 seconds -> "1:01:40"; unknown or negative lengths show as 0:00. */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export const PLAYBACK_SPEEDS: readonly number[] = [1, 1.25, 1.5, 2, 0.5, 0.75];

/** The speed after `current` in the cycle (1x when `current` is not one of the speeds). */
export function nextSpeed(current: number): number {
  const index = PLAYBACK_SPEEDS.indexOf(current);
  return index < 0 ? PLAYBACK_SPEEDS[0] : PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length];
}

export type PlayerKeyAction = "toggle" | "forward" | "back" | "mute" | "fullscreen" | null;

/** What a key does in the player; `focusOn` is the tag of the focused element (buttons keep Space, sliders keep every key). */
export function playerKeyAction(key: string, focusOn: string, isVideo: boolean): PlayerKeyAction {
  if (focusOn === "INPUT") return null;
  if (key === " ") return focusOn === "BUTTON" ? null : "toggle";
  if (key === "ArrowRight") return "forward";
  if (key === "ArrowLeft") return "back";
  const lower = key.toLowerCase();
  if (lower === "m") return "mute";
  if (lower === "f" && isVideo) return "fullscreen";
  return null;
}

export const SKIP_SECONDS = 5;

/** The position after skipping `delta` seconds, kept inside the file (an unknown length counts as 0). */
export function skipTo(current: number, delta: number, duration: number): number {
  const end = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return Math.min(end, Math.max(0, current + delta));
}
