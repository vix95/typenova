/** One terminal: an xterm.js screen joined to a shell running in a pseudo terminal. */
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { langText } from "../i18n/language";
import { bytesOfBase64, killTerminal, resizeTerminal, spawnTerminal, writeTerminal, type TerminalEvent } from "./terminal-backend";
import { terminalTheme } from "./terminal-theme";

export interface SessionHooks {
  /** The shell started or ended. */
  onStatus: (status: "running" | "exited" | "failed", code: number | null) => void;
  /** The user typed something into it. */
  onInput: () => void;
  /** Enter was pressed in a terminal whose shell had ended. */
  onRestartRequest: () => void;
}

export interface StartOptions { shell: string; args: string[]; cwd: string | null; startup: string }

const FONT_FAMILY = 'Consolas, "Cascadia Mono", "Cascadia Code", "SF Mono", Menlo, "DejaVu Sans Mono", monospace';

/** Pending paste of text read from the clipboard (xterm turns it into a bracketed paste when the shell asks for that). */
function pasteFromClipboard(term: Terminal): void {
  void navigator.clipboard?.readText().then(text => { if (text) term.paste(text); }).catch(() => undefined);
}

export class TerminalSession {
  readonly element = document.createElement("div");
  private readonly term: Terminal;
  private readonly fit = new FitAddon();
  private opened = false;
  private alive = false;
  private disposed = false;
  private observer: ResizeObserver | null = null;
  private resizeFrame = 0;
  /** Counts starts, so that the output of an earlier shell is never written into a later one. */
  private run = 0;
  lastOutputAt = 0;

  constructor(readonly id: string, fontSize: number, private readonly hooks: SessionHooks) {
    this.element.className = "terminal-host";
    this.term = new Terminal({
      fontFamily: FONT_FAMILY, fontSize, cursorBlink: true, scrollback: 5000, theme: terminalTheme(),
      allowProposedApi: false, macOptionIsMeta: true, windowsPty: navigator.userAgent.includes("Windows") ? { backend: "conpty" } : undefined,
    });
    this.term.loadAddon(this.fit);
    this.term.attachCustomKeyEventHandler(event => this.handleKey(event));
    this.term.onData(data => this.handleInput(data));
    this.term.onResize(({ cols, rows }) => { if (this.alive) void resizeTerminal(this.id, cols, rows).catch(() => undefined); });
  }

  get isAlive(): boolean { return this.alive; }
  get cols(): number { return this.term.cols; }
  get rows(): number { return this.term.rows; }

  /** Keys the terminal must not turn into input: copy and paste, and the shortcuts of the program for its panel. */
  private handleKey(event: KeyboardEvent): boolean {
    if (event.type !== "keydown") return true;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && (event.key === "`" || event.code === "Backquote")) return false;
    const key = event.key.toLowerCase();
    if (mod && key === "c" && (event.shiftKey || this.term.hasSelection())) {
      event.preventDefault();
      void navigator.clipboard?.writeText(this.term.getSelection()).catch(() => undefined);
      if (!event.shiftKey) this.term.clearSelection();
      return false;
    }
    if (mod && key === "v") { event.preventDefault(); pasteFromClipboard(this.term); return false; }
    return true;
  }

  private handleInput(data: string): void {
    this.hooks.onInput();
    if (!this.alive) { if (data === "\r") this.hooks.onRestartRequest(); return; }
    void writeTerminal(this.id, data).catch(() => undefined);
  }

  /** Puts the screen into the page (once it is visible, so that it can measure itself). */
  mount(parent: HTMLElement): void {
    if (this.element.parentElement !== parent) parent.append(this.element);
    if (!this.opened) {
      this.term.open(this.element);
      this.opened = true;
      this.observer = new ResizeObserver(() => this.scheduleFit());
      this.observer.observe(this.element);
    }
    this.scheduleFit();
  }

  private scheduleFit(): void {
    if (this.resizeFrame) return;
    this.resizeFrame = requestAnimationFrame(() => { this.resizeFrame = 0; this.fitNow(); });
  }

  /** Fits the screen to its box (nothing happens while the box is hidden). */
  fitNow(): void {
    if (!this.opened || this.element.offsetWidth < 20 || this.element.offsetHeight < 20) return;
    try { this.fit.fit(); } catch { /* not measurable yet */ }
  }

  focus(): void { this.term.focus(); }
  get hasSelection(): boolean { return this.term.hasSelection(); }
  copySelection(): void { void navigator.clipboard?.writeText(this.term.getSelection()).catch(() => undefined); }
  pasteClipboard(): void { pasteFromClipboard(this.term); }
  selectAll(): void { this.term.selectAll(); }
  show(visible: boolean): void { this.element.hidden = !visible; if (visible) { this.scheduleFit(); } }
  setFontSize(size: number): void { this.term.options.fontSize = size; this.scheduleFit(); }
  refreshTheme(): void { this.term.options.theme = terminalTheme(); }
  clear(): void { this.term.clear(); }

  private note(text: string): void { this.term.write(`\r\n\x1b[2m${text}\x1b[0m\r\n`); }

  /** Starts the shell. The screen must be mounted (it tells the shell its size). */
  async start(options: StartOptions): Promise<void> {
    if (this.alive) return;
    this.fitNow();
    const run = ++this.run;
    this.alive = true;
    try {
      await spawnTerminal({ id: this.id, shell: options.shell, args: options.args, cwd: options.cwd, cols: this.term.cols, rows: this.term.rows }, event => { if (run === this.run) this.handleEvent(event); });
    } catch (error) {
      this.alive = false;
      this.note(`${langText("Nie można uruchomić powłoki", "Could not start the shell")}: ${String(error)}`);
      this.hooks.onStatus("failed", null);
      return;
    }
    this.hooks.onStatus("running", null);
    // Typed in at once: the shell reads it when it is ready.
    if (options.startup.trim()) window.setTimeout(() => { if (run === this.run && this.alive) void writeTerminal(this.id, `${options.startup.trim().replace(/\n/g, "\r")}\r`).catch(() => undefined); }, 200);
  }

  private handleEvent(event: TerminalEvent): void {
    if (event.kind === "data") { this.lastOutputAt = Date.now(); this.term.write(bytesOfBase64(event.data)); return; }
    this.alive = false;
    this.note(event.code === null || event.code === 0
      ? langText("Proces zakończony. Naciśnij Enter, aby uruchomić powłokę ponownie.", "The process ended. Press Enter to start the shell again.")
      : langText(`Proces zakończony z kodem ${event.code}. Naciśnij Enter, aby uruchomić powłokę ponownie.`, `The process ended with code ${event.code}. Press Enter to start the shell again.`));
    this.hooks.onStatus("exited", event.code);
  }

  /** Ends the shell (the screen stays, with what it shows). */
  async stop(): Promise<void> {
    this.run++;
    if (!this.alive) return;
    this.alive = false;
    await killTerminal(this.id).catch(() => undefined);
    // The end of the shell is not reported after this (its exit belongs to the run that was just left), so it is told here.
    if (!this.disposed) { this.note(langText("Proces zatrzymany. Naciśnij Enter, aby uruchomić powłokę ponownie.", "The process was stopped. Press Enter to start the shell again.")); this.hooks.onStatus("exited", null); }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.stop();
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.observer?.disconnect();
    this.term.dispose();
    this.element.remove();
  }
}
