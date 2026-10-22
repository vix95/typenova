import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import taskLists from "markdown-it-task-lists";
import texmath from "markdown-it-texmath";
import katex from "katex";

/** Factory avoids sharing mutable parser instances across unrelated preview lifecycles. */
export function createMarkdownRenderer(): MarkdownIt {
  return new MarkdownIt({ html: false, linkify: false, typographer: true, breaks: false })
    .use(anchor, { permalink: false })
    .use(taskLists, { enabled: true, label: true })
    .use(texmath, { engine: katex, delimiters: "dollars", katexOptions: { throwOnError: false, strict: "ignore", trust: false } });
}
