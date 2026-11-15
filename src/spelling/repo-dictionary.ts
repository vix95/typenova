/** The dictionary of a Git repository (`.typenova/dictionary.txt`): the words in it count as known words for the documents of that repository, the personal dictionary can be exported to it, and, when the person wants it, a word added to the personal dictionary is added to it too. The personal dictionary stays in this program either way; outside a repository nothing is written anywhere else. */
import { invoke } from "@tauri-apps/api/core";
import { documentState } from "../documents/document-state";
import { parentPath } from "../filesystem/project-tree-operations";
import { gitRepoRoot } from "../git-ui/git-api";
import { repositoryInUse } from "../git-ui/git-sync-dialog";
import { mergeDictionaries, parseRepoDictionary, serializeRepoDictionary, wordsNotIn } from "./repo-dictionary-model";
import { personalWords, repositoryDictionaryAuto, setRepositoryWords, SPELL_WORD_ADDED_EVENT } from "./spell-settings";

/** The repository the dictionary belongs to: the one of the document in use, else of the first project folder. Null outside a repository. */
export const dictionaryRepository = (): Promise<string | null> => repositoryInUse().catch(() => null);

const readFile = (repo: string): Promise<string | null> => invoke<string | null>("repo_dictionary_read", { repo });

export interface RepositoryDictionary { repo: string; words: string[] }

/** What the repository's dictionary holds now (empty when it has none yet). */
export async function readRepositoryDictionary(repo: string): Promise<RepositoryDictionary> {
  return { repo, words: parseRepoDictionary(await readFile(repo).catch(() => null)) };
}

export interface ExportResult { repo: string; path: string | null; total: number; added: number }

/** Adds the words of the personal dictionary (or of `only`) to the repository's dictionary file; the file is written only when something is new. */
export async function exportToRepository(repo: string, only?: readonly string[]): Promise<ExportResult> {
  const text = await readFile(repo);
  const existing = parseRepoDictionary(text);
  const incoming = only ?? personalWords();
  const added = wordsNotIn(existing, incoming).length;
  if (text !== null && added === 0) return { repo, path: null, total: existing.length, added: 0 };
  const merged = mergeDictionaries(existing, incoming);
  const path = await invoke<string>("repo_dictionary_write", { repo, text: serializeRepoDictionary(merged) });
  document.dispatchEvent(new CustomEvent("typenova:git-changed"));
  void refreshRepositoryWords();
  return { repo, path, total: merged.length, added };
}

const roots = new Map<string, Promise<string | null>>();
const rootOf = (dir: string): Promise<string | null> => { if (!roots.has(dir)) roots.set(dir, gitRepoRoot(dir).catch(() => null)); return roots.get(dir)!; };

/** Reads the dictionaries of the repositories that the open documents belong to and makes their words known words. */
export async function refreshRepositoryWords(): Promise<void> {
  const dirs = new Set(documentState.tabs.filter(tab => tab.path).map(tab => parentPath(tab.path!)));
  const repos = new Set((await Promise.all([...dirs].map(rootOf))).filter((repo): repo is string => !!repo));
  const lists = await Promise.all([...repos].map(repo => readRepositoryDictionary(repo)));
  setRepositoryWords(lists.flatMap(list => list.words));
}

export function installRepositoryDictionary(): void {
  let timer = 0;
  const later = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void refreshRepositoryWords(); }, 300); };
  for (const event of ["typenova:document-shown", "typenova:git-changed", "typenova:file-saved"]) document.addEventListener(event, later);
  window.addEventListener("focus", later);
  // A word added to the personal dictionary follows into the repository when the person asked for that.
  document.addEventListener(SPELL_WORD_ADDED_EVENT, event => {
    if (!repositoryDictionaryAuto()) return;
    const word = (event as CustomEvent<string>).detail;
    void dictionaryRepository().then(repo => (repo ? exportToRepository(repo, [word]) : null)).catch(() => undefined);
  });
  later();
}
