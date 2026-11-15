/** What the chat takes from the project for one message: the passages that match a question, or the whole of a folder for a task on it. Reads the notes on this computer only; what is sent to the model is decided here and shown to the person with the message. */
import { documentState } from "../documents/document-state";
import { parentPath } from "../filesystem/project-tree-operations";
import { basename } from "../filesystem/path-utils";
import { displayPath, loadCorpus, type Corpus } from "./project-reader";
import { searchIndex } from "./project-search";
import { FOLDER_BUDGET_CHARS, PROJECT_BUDGET_CHARS, fitSources, toSources, type Source } from "./project-prompt";

/** The best passages for one question. */
const QUESTION_PASSAGES = 12;

export interface ProjectTurn {
  /** The passages that go to the model, numbered for citing. */
  sources: Source[];
  /** The notes the assistant may propose edits to (an edit names its file). */
  known: { file: string; path: string }[];
  /** How many notes were searched. */
  fileCount: number;
  tooLarge: boolean;
  clipped: boolean;
  dropped: number;
  /** The folder a folder task works on. */
  folder?: string;
}

const emptyTurn = (corpus: Corpus): ProjectTurn => ({ sources: [], known: corpus.files, fileCount: corpus.files.length, tooLarge: corpus.tooLarge, clipped: false, dropped: 0 });

/** The passages of the project that answer `question` (searched with words, on this computer). */
export async function questionTurn(question: string): Promise<ProjectTurn> {
  const corpus = await loadCorpus();
  if (corpus.tooLarge) return emptyTurn(corpus);
  const hits = searchIndex(corpus.index, question, QUESTION_PASSAGES, documentState.currentPath ?? undefined);
  const fitted = fitSources(toSources(hits.map(hit => hit.chunk), displayPath), PROJECT_BUDGET_CHARS);
  return { ...emptyTurn(corpus), sources: fitted.sources, clipped: fitted.clipped, dropped: fitted.dropped };
}

/** The folder a task works on when none is named: the folder of the note in use, else the first project folder. */
export function defaultFolder(): string | null {
  return documentState.currentPath ? parentPath(documentState.currentPath) : documentState.projectRoots[0] ?? null;
}

export const folderLabel = (folder: string): string => basename(folder) || folder;

/** All the notes inside a folder, in the order of the project, as passages (shortened equally when they do not fit). */
export async function folderTurn(folder: string): Promise<ProjectTurn> {
  const corpus = await loadCorpus(folder);
  if (corpus.tooLarge) return { ...emptyTurn(corpus), folder };
  const fitted = fitSources(toSources(corpus.chunks, displayPath), FOLDER_BUDGET_CHARS);
  return { ...emptyTurn(corpus), sources: fitted.sources, clipped: fitted.clipped, dropped: fitted.dropped, folder };
}
