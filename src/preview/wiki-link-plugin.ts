/** markdown-it plugin: `[[Section]]`, `[[Section|label]]` and `[[file#Section]]` become links that the app follows (`app/wiki-link-navigation.ts`). `![[image]]` embeds are left to the image handling. */
import type MarkdownIt from "markdown-it";

/** What a link shows: its alias, else the section it names (the file is left out of the text; see `wikiLinkFile`), else what is written. */
export function wikiLinkLabel(inner: string): string {
  const bar = inner.indexOf("|");
  if (bar >= 0) return inner.slice(bar + 1).trim() || inner.trim();
  const hash = inner.indexOf("#");
  return (hash >= 0 ? inner.slice(hash + 1) : inner).trim() || inner.trim();
}

/** The file a link names (shown when the pointer rests on the link), or "" when it names none. */
export function wikiLinkFile(inner: string): string {
  const target = inner.split("|")[0];
  const hash = target.indexOf("#");
  return hash > 0 ? target.slice(0, hash).trim() : "";
}

export function wikiLinks(md: MarkdownIt): void {
  md.inline.ruler.before("link", "wiki_link", (state, silent) => {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x5b || src.charCodeAt(start + 1) !== 0x5b || (start > 0 && src.charCodeAt(start - 1) === 0x21)) return false;
    const end = src.indexOf("]]", start + 2);
    if (end < 0) return false;
    const inner = src.slice(start + 2, end);
    if (!inner.trim() || /[[\]\n]/.test(inner) || inner.trim().startsWith("|")) return false;
    if (!silent) {
      const token = state.push("wiki_link", "", 0);
      token.content = inner;
    }
    state.pos = end + 2;
    return true;
  });
  md.renderer.rules.wiki_link = (tokens, index) => {
    const inner = tokens[index].content;
    const file = wikiLinkFile(inner);
    const tooltip = file ? ` data-tooltip="${md.utils.escapeHtml(file)}"` : "";
    return `<a class="wikilink" role="link" tabindex="0" data-wiki-link="${md.utils.escapeHtml(inner)}"${tooltip}>${md.utils.escapeHtml(wikiLinkLabel(inner))}</a>`;
  };
}
