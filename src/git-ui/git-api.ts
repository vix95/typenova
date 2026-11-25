/** Typed calls to the Git commands of the Tauri backend: reading history, and the one writing action (commit and push of the pending changes). */
import { invoke } from "@tauri-apps/api/core";

export interface GitBranch { name: string; remote: boolean; current: boolean; hash: string; upstream: string | null; ahead: number; behind: number }
export interface GitTag { name: string; hash: string }
export interface GitOverview { head: string; detached: boolean; branches: GitBranch[]; tags: GitTag[]; dirty: number }
export interface GitCommit { hash: string; parents: string[]; author: string; email: string; date: string; refs: string[]; subject: string }
export interface GitFileChange { status: string; path: string; oldPath: string | null; added: number | null; deleted: number | null }
export interface GitCommitDetail { hash: string; parents: string[]; author: string; email: string; date: string; committer: string; body: string; files: GitFileChange[] }

export const gitRepoRoot = (path: string) => invoke<string | null>("git_repo_root", { path });
export const gitOverview = (repo: string) => invoke<GitOverview>("git_overview", { repo });
/** One page of the history of `rev`, or of every branch when `rev` is empty. */
export const gitLog = (repo: string, rev: string, skip: number, limit: number) => invoke<GitCommit[]>("git_log", { repo, rev, skip, limit });
/** Makes a repository (branch main) in an existing folder; resolves with the folder. */
export const gitInit = (path: string) => invoke<string>("git_init", { path });
/** Clones `url` into the new folder `name` of `parent`; resolves with the path of the clone. */
export const gitClone = (url: string, parent: string, name: string) => invoke<string>("git_clone", { url, parent, name });
/** Fetches the latest changes of the current branch and fast-forwards to them; resolves with what git said. */
export const gitPull = (repo: string) => invoke<string>("git_pull", { repo });
export const gitCommitDetail = (repo: string, hash: string) => invoke<GitCommitDetail>("git_commit_detail", { repo, hash });
export const gitFileDiff = (repo: string, hash: string, path: string, oldPath: string | null) => invoke<string>("git_file_diff", { repo, hash, path, oldPath });

export interface GitPendingChange { status: string; path: string }
export interface GitSyncPlan { branch: string | null; upstream: string | null; remote: string | null; changes: GitPendingChange[]; total: number; blocked: string | null }
export interface GitSyncResult { commit: string | null; pushed: boolean; target: string | null; pushError: string | null }
/** What a commit and push would take: the changed files of the repository, the branch and where it goes. */
export const gitSyncPlan = (repo: string) => invoke<GitSyncPlan>("git_sync_plan", { repo });
/** Stages everything, commits with the message and pushes. */
export const gitCommitPush = (repo: string, message: string) => invoke<GitSyncResult>("git_commit_push", { repo, message });

// ---- Working with the repository (the Git view and the margin markers)
export interface GitFileState { path: string; oldPath: string | null; /** Status in the index: A, M, D, R, C, T or empty. */ index: string; /** Status in the working tree: M, D, T, ? (new) or empty. */ worktree: string; conflicted: boolean }
export interface GitWorkState { branch: string | null; upstream: string | null; ahead: number; behind: number; hasCommits: boolean; remote: string | null; files: GitFileState[]; total: number; blocked: string | null }
export interface GitPushResult { pushed: boolean; target: string | null; error: string | null }
/** `tracked`: text is the committed text; `new`: not committed yet (every line is an addition); `none`: ignored, binary or too big (no markers). */
export interface GitHeadText { kind: "tracked" | "new" | "none"; text: string }

export const gitWorkState = (repo: string) => invoke<GitWorkState>("git_work_state", { repo });
export const gitStage = (repo: string, paths: string[]) => invoke<void>("git_stage", { repo, paths });
export const gitUnstage = (repo: string, paths: string[]) => invoke<void>("git_unstage", { repo, paths });
export const gitCommitStaged = (repo: string, message: string) => invoke<{ commit: string }>("git_commit_staged", { repo, message });
export const gitPush = (repo: string) => invoke<GitPushResult>("git_push", { repo });
/** `local` switches to a branch, `new` creates one from the current commit, `track` creates a local branch that tracks a remote one (`origin/feature`). Resolves with the branch now in use. */
export const gitSwitch = (repo: string, target: string, mode: "local" | "new" | "track") => invoke<string>("git_switch", { repo, target, mode });
export const gitHeadText = (repo: string, path: string) => invoke<GitHeadText>("git_head_text", { repo, path });
