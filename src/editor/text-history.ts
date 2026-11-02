/** Undo and redo for a text that is changed both by typing and by code (templates, builders, clicks in a preview). */

export interface TextHistory {
  /** Remembers a new value; consecutive typing within `mergeMs` becomes one step. */
  record(value: string, typing: boolean, at?: number): void;
  undo(): string | null;
  redo(): string | null;
  canUndo(): boolean;
  canRedo(): boolean;
}

export function createTextHistory(initial: string, limit = 300, mergeMs = 700): TextHistory {
  const steps: string[] = [initial];
  let index = 0, lastAt = 0, lastTyping = false;
  return {
    record(value, typing, at = Date.now()) {
      if (value === steps[index]) return;
      steps.length = index + 1; // a new change drops what could have been redone
      if (typing && lastTyping && index > 0 && at - lastAt < mergeMs) steps[index] = value;
      else { steps.push(value); index++; }
      if (steps.length > limit) { steps.shift(); index--; }
      lastAt = at; lastTyping = typing;
    },
    undo() { if (index === 0) return null; index--; lastTyping = false; return steps[index]; },
    redo() { if (index >= steps.length - 1) return null; index++; lastTyping = false; return steps[index]; },
    canUndo: () => index > 0,
    canRedo: () => index < steps.length - 1,
  };
}
