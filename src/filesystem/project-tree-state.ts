/** Ephemeral explorer state, isolated from the DOM and filesystem adapter. */
export type TreeClipboard = {
  path: string;
  operation: "copy" | "cut";
  isDirectory: boolean;
};

export type ProjectTreeTarget = {
  path: string;
  isDirectory: boolean;
  isRoot: boolean;
};

export interface ProjectTreeState {
  clipboard: TreeClipboard | null;
  keyboardActive: boolean;
  lastTarget: ProjectTreeTarget | null;
  expandedFolders: Set<string>;
  dragDropInstalled: boolean;
  contextTarget: ProjectTreeTarget | null;
}

/** Create isolated state per application instance; no module-global mutable singleton. */
export function createProjectTreeState(): ProjectTreeState {
  return {
    clipboard: null,
    keyboardActive: false,
    lastTarget: null,
    expandedFolders: new Set<string>(),
    dragDropInstalled: false,
    contextTarget: null,
  };
}
