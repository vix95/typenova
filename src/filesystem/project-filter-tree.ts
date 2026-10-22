import { normalizedFsPath } from "./project-tree-operations.js";

export type ProjectFilterTreeNode = {
  kind: "folder" | "file";
  name: string;
  /** Relative folder path, or absolute file path for file leaves. */
  path: string;
  children: ProjectFilterTreeNode[];
  /** Absolute Markdown paths represented by this node and its descendants. */
  filePaths: string[];
};

export interface ProjectFilterFile {
  path: string;
  name: string;
}

function relativeProjectPath(path: string, projectRoot: string): string {
  const normalizedPath = path.replace(/\\/g, "/");
  const rootWithSlashes = projectRoot.replace(/\\/g, "/");
  const normalizedRoot = rootWithSlashes.replace(/\/+$/, "");
  if (rootWithSlashes.startsWith("/") && !normalizedRoot) {
    return normalizedPath.startsWith("/") ? normalizedPath.slice(1) : normalizedPath;
  }
  if (!normalizedRoot) return normalizedPath;

  const identityPath = normalizedFsPath(normalizedPath);
  const identityRoot = normalizedFsPath(normalizedRoot);
  const prefix = identityRoot.endsWith("/") ? identityRoot : `${identityRoot}/`;
  if (identityPath === identityRoot) return "";
  if (!identityPath.startsWith(prefix)) return normalizedPath;
  return normalizedPath.slice(normalizedRoot.length + 1);
}

/** Build a deterministic folder/file tree for the graph's Markdown file filter. */
export function buildProjectFilterTree(
  files: readonly ProjectFilterFile[],
  projectRoot: string,
  rootName: string,
  locale = "en",
): ProjectFilterTreeNode {
  const root: ProjectFilterTreeNode = {
    kind: "folder",
    name: rootName,
    path: "",
    children: [],
    filePaths: [],
  };
  const folders = new Map<string, ProjectFilterTreeNode>([["", root]]);
  const windowsProject = /^[a-zA-Z]:[\\/]/.test(projectRoot) || projectRoot.startsWith("\\\\") || projectRoot.startsWith("//");

  for (const file of files) {
    const relative = relativeProjectPath(file.path, projectRoot);
    const parts = relative.split("/").filter(Boolean);
    if (!parts.length) continue;

    let parent = root;
    const accumulated: string[] = [];
    for (const directoryName of parts.slice(0, -1)) {
      accumulated.push(directoryName);
      const relativeDirectory = accumulated.join("/");
      // Use platform-aware path identity: POSIX directories may differ by case.
      const key = windowsProject ? relativeDirectory.toLocaleLowerCase("en-US") : relativeDirectory;
      let folder = folders.get(key);
      if (!folder) {
        folder = {
          kind: "folder",
          name: directoryName,
          path: relativeDirectory,
          children: [],
          filePaths: [],
        };
        folders.set(key, folder);
        parent.children.push(folder);
      }
      parent = folder;
      parent.filePaths.push(file.path);
    }

    parent.children.push({
      kind: "file",
      name: file.name,
      path: file.path,
      children: [],
      filePaths: [file.path],
    });
    root.filePaths.push(file.path);
  }

  const sort = (node: ProjectFilterTreeNode): void => {
    node.children.sort((a, b) =>
      Number(a.kind === "file") - Number(b.kind === "file") ||
      a.name.localeCompare(b.name, locale),
    );
    for (const child of node.children) sort(child);
  };
  sort(root);
  return root;
}
