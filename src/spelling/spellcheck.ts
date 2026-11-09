/** Spell checking in the editor: misspelled words are underlined. Words are sent to the spell checker of the program (see `spell-client.ts`), once each. */
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { StateEffect, StateField, Transaction, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { documentState } from "../documents/document-state";
import { checkWords, spellBackendAvailable } from "./spell-client";
import { checkKey, findWords, isProseDocument, rangesOutside, unknownWords, type SpellWord } from "./spell-model";
import { isUserWord, spellEnabled, spellLanguages, SPELL_CHANGED_EVENT } from "./spell-settings";

export interface Misspelling { from: number; to: number; word: string }

export const setMisspellings = StateEffect.define<readonly Misspelling[]>();

export const spellField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setMisspellings)) continue;
      const length = transaction.state.doc.length;
      const marks = effect.value.filter(item => item.to > item.from && item.to <= length).map(item => Decoration.mark({ class: "cm-misspelled", spellWord: item.word }).range(item.from, item.to));
      return Decoration.set(marks, true);
    }
    return transaction.docChanged ? value.map(transaction.changes) : value;
  },
  provide: field => EditorView.decorations.from(field),
});

/** The misspelled words of the open document that were found so far, in order. */
export function misspelledRanges(state: EditorState): Misspelling[] {
  const found: Misspelling[] = [];
  state.field(spellField).between(0, state.doc.length, (from, to, value) => {
    const word = (value.spec as { spellWord?: string }).spellWord;
    if (word && to > from) found.push({ from, to, word });
  });
  return found;
}

/** The misspelled word at a position (its edges count). */
export function misspelledAt(state: EditorState, position: number): Misspelling | null {
  return misspelledRanges(state).find(item => item.from <= position && position <= item.to) ?? null;
}

/** Parts of a Markdown document that are not prose; their words are not checked. */
const NOT_PROSE_NODES = new Set([
  "FencedCode", "CodeBlock", "InlineCode", "HTMLBlock", "HTMLTag", "CommentBlock", "Comment", "ProcessingInstructionBlock", "ProcessingInstruction",
  "URL", "Autolink", "LinkReference", "Entity",
]);

/** A YAML block at the very start of a document (between two `---` lines). */
function frontMatterRange(state: EditorState): { from: number; to: number } | null {
  const doc = state.doc;
  if (doc.lines < 3 || doc.line(1).text.trim() !== "---") return null;
  for (let number = 2; number <= Math.min(doc.lines, 200); number++) {
    const text = doc.line(number).text.trim();
    if (text === "---" || text === "...") return { from: 0, to: doc.line(number).to };
  }
  return null;
}

function ignoredRanges(state: EditorState, upTo: number): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  const tree = ensureSyntaxTree(state, upTo, 120) ?? syntaxTree(state);
  tree.iterate({
    from: 0, to: upTo,
    enter: node => { if (NOT_PROSE_NODES.has(node.name)) { ranges.push({ from: node.from, to: node.to }); return false; } return undefined; },
  });
  const front = frontMatterRange(state);
  if (front) ranges.push(front);
  return ranges;
}

/** A document up to this size is checked whole (so that "next error" works everywhere); a larger one only around what is on screen. */
const WHOLE_DOCUMENT_LIMIT = 300000;
const MARGIN = 3000;

function scopes(view: EditorView): { from: number; to: number }[] {
  const length = view.state.doc.length;
  if (length <= WHOLE_DOCUMENT_LIMIT) return [{ from: 0, to: length }];
  return view.visibleRanges.map(range => ({ from: Math.max(0, range.from - MARGIN), to: Math.min(length, range.to + MARGIN) }));
}

function collectWords(view: EditorView): SpellWord[] {
  const state = view.state;
  const areas = scopes(view);
  const ignored = ignoredRanges(state, Math.max(0, ...areas.map(area => area.to)));
  const words: SpellWord[] = [];
  for (const area of areas) {
    for (const part of rangesOutside(area.from, area.to, ignored)) words.push(...findWords(state.sliceDoc(part.from, part.to), part.from));
  }
  return words;
}

/** What the spell checker said about each word so far (exact spelling of the word as the key); dropped when the languages change. */
const verdicts = new Map<string, boolean>();
let verdictLanguages = "";

/** After typing, the word being typed is left alone until the typing pauses. */
const TYPING_PAUSE_MS = 1200;

class SpellChecker {
  private timer = 0;
  private token = 0;
  private lastEdit = 0;
  private destroyed = false;

  constructor(private readonly view: EditorView) {
    document.addEventListener(SPELL_CHANGED_EVENT, this.onSettings);
    this.schedule(200);
  }

  private onSettings = (): void => { this.schedule(0); };

  update(update: ViewUpdate): void {
    if (update.docChanged) this.lastEdit = Date.now();
    if (update.docChanged) this.schedule(400);
    else if (update.viewportChanged && this.view.state.doc.length > WHOLE_DOCUMENT_LIMIT) this.schedule(200);
  }

  destroy(): void {
    this.destroyed = true;
    this.token++;
    window.clearTimeout(this.timer);
    document.removeEventListener(SPELL_CHANGED_EVENT, this.onSettings);
  }

  private schedule(delay: number): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { void this.run(); }, delay);
  }

  private show(marks: readonly Misspelling[]): void {
    if (this.destroyed) return;
    this.view.dispatch({ effects: setMisspellings.of(marks), annotations: Transaction.addToHistory.of(false) });
  }

  private async run(): Promise<void> {
    const token = ++this.token;
    const view = this.view;
    const state = view.state;
    if (!spellEnabled() || !spellBackendAvailable() || !isProseDocument(documentState.currentPath)) {
      if (state.field(spellField).size) this.show([]);
      return;
    }
    const languages = spellLanguages();
    if (verdictLanguages !== languages.join(",")) { verdicts.clear(); verdictLanguages = languages.join(","); }
    const head = state.selection.main.head;
    const typing = Date.now() - this.lastEdit < TYPING_PAUSE_MS && state.selection.main.empty;
    const candidates = collectWords(view).filter(word => !(typing && head > word.from && head <= word.to));
    const unknown = unknownWords(candidates, verdicts);
    if (unknown.length) {
      const results = await checkWords(unknown, languages);
      if (!results || this.destroyed || token !== this.token) return;
      unknown.forEach((word, index) => verdicts.set(word, results[index] ?? true));
    }
    // If the document changed while the answer was on its way, a newer run is already scheduled.
    if (this.destroyed || token !== this.token || view.state.doc !== state.doc) return;
    this.show(candidates.filter(word => verdicts.get(checkKey(word.word)) === false && !isUserWord(word.word)).map(({ from, to, word }) => ({ from, to, word })));
    if (typing) this.schedule(TYPING_PAUSE_MS + 100);
  }
}

export const spellExtension = [spellField, ViewPlugin.fromClass(SpellChecker)];
