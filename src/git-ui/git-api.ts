/** Typed calls to the read-only Git commands of the Tauri backend. */
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
export const gitCommitDetail = (repo: string, hash: string) => invoke<GitCommitDetail>("git_commit_detail", { repo, hash });
export const gitFileDiff = (repo: string, hash: string, path: string, oldPath: string | null) => invoke<string>("git_file_diff", { repo, hash, path, oldPath });
