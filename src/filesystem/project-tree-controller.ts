/** Coordinates project-tree mutations while keeping the DOM and notifications outside this module. */
import {
  normalizedFsPath,
  parentPath,
  pathIsInside,
  remapPathPrefix,
  uniqueTreeDestination,
  copyTreeEntry,
  removeTreeEntry,
  type ProjectTreeFileSystem,
} from "./project-tree-operations.js";
import type { ProjectTreeState, TreeClipboard, ProjectTreeTarget } from "./project-tree-state.js";

export interface ProjectTreeControllerFileSystem extends ProjectTreeFileSystem {
  rename(source: string, destination: string): Promise<void>;
}

export interface ProjectTreeControllerOptions {
  state: ProjectTreeState;
  fs: ProjectTreeControllerFileSystem;
  getProjectRoot(): string | null;
  getCopyLabel(): string;
  getAlreadyExistsMessage(): string;
  getProjectRequiredMessage(): string;
  getOutsideProjectMessage(): string;
  getProjectRootMutationMessage(): string;
  getDescendantMoveMessage(): string;
  onPathMoved?(oldPath: string, newPath: string): void;
}

export type ProjectTreeOperationResult =
  | { status: "moved"; source: string; destination: string }
  | { status: "copied"; source: string; destination: string }
  | { status: "same-folder"; source: string; destinationFolder: string };

function isTargetWithin(target: ProjectTreeTarget | null, path: string, isDirectory: boolean): boolean {
  if (!target) return false;
  const candidate = normalizedFsPath(target.path);
  const normalized = normalizedFsPath(path);
  return candidate === normalized || (isDirectory && pathIsInside(path, target.path));
}

/** Per-project controller; filesystem access and UI effects are supplied by the application. */
export class ProjectTreeController {
  private readonly options: ProjectTreeControllerOptions;

  constructor(options: ProjectTreeControllerOptions) {
    this.options = options;
  }

  get state(): ProjectTreeState {
    return this.options.state;
  }

  setClipboard(path: string, operation: TreeClipboard["operation"], isDirectory: boolean): void {
    this.state.clipboard = { path, operation, isDirectory };
  }

  clearClipboard(): void {
    this.state.clipboard = null;
  }

  /** Reset transient selection state when the active project closes. */
  resetTransientState(): void {
    this.state.clipboard = null;
    this.state.keyboardActive = false;
    this.state.lastTarget = null;
    this.state.contextTarget = null;
    this.state.expandedFolders.clear();
  }

  /** Remap controller-owned paths after a successful move/rename. */
  remapStatePaths(oldPath: string, newPath: string): void {
    const map = (path: string) => remapPathPrefix(path, oldPath, newPath);
    const expanded = [...this.state.expandedFolders].map(map);
    this.state.expandedFolders.clear();
    for (const path of expanded) this.state.expandedFolders.add(path);

    if (this.state.clipboard) {
      this.state.clipboard = { ...this.state.clipboard, path: map(this.state.clipboard.path) };
    }
    if (this.state.contextTarget) {
      this.state.contextTarget = { ...this.state.contextTarget, path: map(this.state.contextTarget.path) };
    }
    if (this.state.lastTarget) {
      this.state.lastTarget = { ...this.state.lastTarget, path: map(this.state.lastTarget.path) };
    }
  }

  /**
   * Move/copy with collision-safe naming. The rename fallback copies before deleting the source;
   * if source removal fails after a completed copy, only that operation's destination is rolled back.
   * Recursive partial-directory cleanup is handled by copyTreeEntry.
   */
  async moveOrCopy(
    source: string,
    destinationFolder: string,
    operation: "copy" | "cut",
    isDirectory: boolean,
    forceDuplicate = false,
  ): Promise<ProjectTreeOperationResult> {
    const projectRoot = this.options.getProjectRoot();
    if (!projectRoot) throw new Error(this.options.getProjectRequiredMessage());
    if (!pathIsInside(projectRoot, source) || !pathIsInside(projectRoot, destinationFolder)) {
      throw new Error(this.options.getOutsideProjectMessage());
    }
    if (isDirectory && pathIsInside(source, destinationFolder)) {
      throw new Error(this.options.getDescendantMoveMessage());
    }

    if (operation === "cut" && normalizedFsPath(parentPath(source)) === normalizedFsPath(destinationFolder)) {
      return { status: "same-folder", source, destinationFolder };
    }

    const destination = await uniqueTreeDestination(
      destinationFolder,
      source.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) || source,
      isDirectory,
      this.options.fs,
      this.options.getCopyLabel(),
      forceDuplicate,
    );

    if (operation === "cut" && !forceDuplicate) {
      try {
        await this.options.fs.rename(source, destination);
      } catch (renameError) {
        let destinationCreated = false;
        try {
          await copyTreeEntry(source, destination, isDirectory, this.options.fs, this.options.getAlreadyExistsMessage());
          destinationCreated = true;
          await removeTreeEntry(source, isDirectory, this.options.fs);
        } catch (fallbackError) {
          // Never remove a path we did not successfully create: another process may have
          // occupied the chosen destination between the existence check and the rename.
          try {
            if (destinationCreated && await this.options.fs.exists(destination)) {
              await removeTreeEntry(destination, isDirectory, this.options.fs);
            }
          } catch {
            // Preserve the operation failure; a rollback error should not hide its cause.
          }
          // Keep the original rename error available as context without replacing the more
          // actionable copy/remove error that explains why the fallback failed.
          if (fallbackError instanceof Error && renameError instanceof Error) {
            (fallbackError as Error & { cause?: unknown }).cause ??= renameError;
          }
          throw fallbackError;
        }
      }
      this.remapStatePaths(source, destination);
      this.options.onPathMoved?.(source, destination);
      if (this.state.clipboard?.operation === "cut" && normalizedFsPath(this.state.clipboard.path) === normalizedFsPath(destination)) {
        this.state.clipboard = null;
      }
      this.state.expandedFolders.add(destinationFolder);
      return { status: "moved", source, destination };
    }

    await copyTreeEntry(source, destination, isDirectory, this.options.fs, this.options.getAlreadyExistsMessage());
    this.state.expandedFolders.add(destinationFolder);
    return { status: "copied", source, destination };
  }

  /** Delete an entry first, then clear transient references only when deletion succeeds. */
  async remove(path: string, isDirectory: boolean): Promise<void> {
    const projectRoot = this.options.getProjectRoot();
    if (!projectRoot) throw new Error(this.options.getProjectRequiredMessage());
    if (normalizedFsPath(path) === normalizedFsPath(projectRoot)) {
      throw new Error(this.options.getProjectRootMutationMessage());
    }
    if (!pathIsInside(projectRoot, path)) throw new Error(this.options.getOutsideProjectMessage());
    await removeTreeEntry(path, isDirectory, this.options.fs);
    this.forgetRemovedPath(path, isDirectory);
  }

  /** Clear transient references to an entry after the filesystem deletion succeeds. */
  forgetRemovedPath(path: string, isDirectory: boolean): void {
    if (isTargetWithin(this.state.clipboard ? { path: this.state.clipboard.path, isDirectory: this.state.clipboard.isDirectory, isRoot: false } : null, path, isDirectory)) {
      this.state.clipboard = null;
    }
    if (isTargetWithin(this.state.contextTarget, path, isDirectory)) this.state.contextTarget = null;
    if (isTargetWithin(this.state.lastTarget, path, isDirectory)) this.state.lastTarget = null;
    for (const folder of [...this.state.expandedFolders]) {
      if (isTargetWithin({ path: folder, isDirectory: true, isRoot: false }, path, isDirectory)) {
        this.state.expandedFolders.delete(folder);
      }
    }
  }
}

export function createProjectTreeController(options: ProjectTreeControllerOptions): ProjectTreeController {
  return new ProjectTreeController(options);
}
