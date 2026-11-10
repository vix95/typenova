/** The terminal's colours: taken from the theme of the program (so every theme has a matching terminal), with an ANSI palette for dark and for light backgrounds. */
import type { ITheme } from "@xterm/xterm";

const DARK_ANSI = ["#1e2430", "#f2777a", "#8fd18a", "#e6c46a", "#6ea8ff", "#c792ea", "#5fd3d3", "#c9d1e0", "#5b667a", "#ff8f92", "#a6e3a1", "#f2d68a", "#8fbcff", "#dba8f5", "#82e6e6", "#f4f7ff"];
const LIGHT_ANSI = ["#1e2430", "#c2323f", "#2c7a3f", "#946200", "#1f5fc4", "#8b3fb8", "#0e7c86", "#5d6b82", "#6b778c", "#d44b58", "#3a9250", "#a87400", "#3b78e0", "#a459cf", "#1a98a3", "#2b384e"];
const NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white", "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"] as const;

let probe: CanvasRenderingContext2D | null = null;

/** A CSS colour (a variable's value, `color-mix`, a name…) as `rgb()` numbers, by asking the browser. */
export function resolveColor(value: string, fallback: [number, number, number] = [16, 19, 27]): [number, number, number] {
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return fallback;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

const hex = ([r, g, b]: [number, number, number]): string => `#${[r, g, b].map(part => part.toString(16).padStart(2, "0")).join("")}`;
/** Relative luminance, 0 (black) to 1 (white). */
export const luminance = ([r, g, b]: [number, number, number]): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** The xterm theme for the theme the program shows now. */
export function terminalTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback;
  const background = resolveColor(token("--ui-editor-bg", token("--ui-bg", "#10131b")));
  const foreground = resolveColor(token("--ui-text", "#f1f5ff"));
  const accent = resolveColor(token("--ui-accent", "#82aaff"));
  const light = luminance(background) > 0.5;
  const selection = resolveColor(token("--ui-selection", "#304a73"));
  const theme: ITheme = {
    background: hex(background),
    foreground: hex(foreground),
    cursor: hex(accent),
    cursorAccent: hex(background),
    selectionBackground: hex(selection),
    selectionInactiveBackground: hex(selection),
  };
  const palette = light ? LIGHT_ANSI : DARK_ANSI;
  NAMES.forEach((name, index) => { theme[name] = palette[index]; });
  return theme;
}
