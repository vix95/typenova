/** The terminal's contact with the Rust side: listing shells, starting one in a pseudo terminal, writing to it, resizing it, ending it. */
import { Channel, invoke } from "@tauri-apps/api/core";
import type { ShellProfile } from "./terminal-model";

export type TerminalEvent = { kind: "data"; data: string } | { kind: "exit"; code: number | null };
export interface ShellList { shells: ShellProfile[]; defaultId: string | null }

export const listShells = (): Promise<ShellList> => invoke<ShellList>("terminal_shells");

export interface SpawnOptions { id: string; shell: string; args: string[]; cwd: string | null; cols: number; rows: number }

/** Starts a shell; `onEvent` gets its output (base64) and its exit. */
export function spawnTerminal(options: SpawnOptions, onEvent: (event: TerminalEvent) => void): Promise<number> {
  const channel = new Channel<TerminalEvent>();
  channel.onmessage = onEvent;
  return invoke<number>("terminal_spawn", { ...options, onEvent: channel });
}

export const writeTerminal = (id: string, data: string): Promise<void> => invoke("terminal_write", { id, data });
export const resizeTerminal = (id: string, cols: number, rows: number): Promise<void> => invoke("terminal_resize", { id, cols, rows });
export const killTerminal = (id: string): Promise<void> => invoke("terminal_kill", { id });

/** Bytes of a base64 text, as the terminal wants them (output is a byte stream: a character may be split between two chunks). */
export function bytesOfBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
