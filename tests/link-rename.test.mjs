import test from "node:test";
import assert from "node:assert/strict";

const rename = () => import("../.test-build/graph/link-rename.js");

const src = (path, text) => ({ path, name: path.split("/").pop(), text });
/** The text of a file after the plan, or null when the plan leaves it alone. */
const after = (m, plan, sources, path) => {
  const file = plan.files.find(item => item.path === path);
  return file ? m.applyEdits(sources.find(item => item.path === path).text, file.edits) : null;
};

test("a link by title follows the renamed heading, in its own file and in others", async () => {
  const m = await rename();
  const sources = [
    src("v/a.md", "# Notes\n\n## Optimization\n\ntext [[Optimisation]] here\n"),
    src("v/b.md", "# B\n\nSee [[Optimisation]] and [[Other]].\n"),
    src("v/c.md", "# C\n\n## Other\n"),
  ];
  const plan = m.planLinkRename(sources, { path: "v/a.md", line: 3, oldTitle: "Optimisation", newTitle: "Optimization" });
  assert.equal(plan.linkCount, 2);
  assert.equal(after(m, plan, sources, "v/a.md"), "# Notes\n\n## Optimization\n\ntext [[Optimization]] here\n");
  assert.equal(after(m, plan, sources, "v/b.md"), "# B\n\nSee [[Optimization]] and [[Other]].\n");
  assert.equal(after(m, plan, sources, "v/c.md"), null);
});

test("an alias stays, and the match ignores case", async () => {
  const m = await rename();
  const sources = [src("v/a.md", "## Fresh name\n\n[[optimisation|the schedule]] and [[ Optimisation ]]\n")];
  const plan = m.planLinkRename(sources, { path: "v/a.md", line: 1, oldTitle: "Optimisation", newTitle: "Fresh name" });
  assert.equal(after(m, plan, sources, "v/a.md"), "## Fresh name\n\n[[Fresh name|the schedule]] and [[ Fresh name ]]\n");
});

test("a link to a section of a file by an anchor is rewritten, a link to the file alone is not", async () => {
  const m = await rename();
  const sources = [
    src("v/a.md", "# A\n\n## Renamed\n"),
    src("v/b.md", "[[a.md#Old]] [[a#Old|x]] [[a.md]] [[notes/a.md#Old]]\n"),
  ];
  const plan = m.planLinkRename(sources, { path: "v/a.md", line: 3, oldTitle: "Old", newTitle: "Renamed" });
  assert.equal(after(m, plan, sources, "v/b.md"), "[[a.md#Renamed]] [[a#Renamed|x]] [[a.md]] [[notes/a.md#Renamed]]\n", "the graph also finds a file by its name when the folders of the path do not match");
});

test("a link in a code fence or in inline code is not a link and is left alone", async () => {
  const m = await rename();
  const sources = [src("v/a.md", "## New\n\n```md\n[[Old]]\n```\n\nSay `[[Old]]` in a link, or [[Old]].\n")];
  const plan = m.planLinkRename(sources, { path: "v/a.md", line: 1, oldTitle: "Old", newTitle: "New" });
  assert.equal(plan.linkCount, 1);
  assert.equal(after(m, plan, sources, "v/a.md"), "## New\n\n```md\n[[Old]]\n```\n\nSay `[[Old]]` in a link, or [[New]].\n");
});

test("a title that other sections share is not guessed for links from other files", async () => {
  const m = await rename();
  const sources = [
    src("v/a.md", "# A\n\n## Setup\n\nsee [[Old]] here\n"),
    src("v/b.md", "# B\n\n## Old\n"),
    src("v/c.md", "# C\n\nsee [[Old]]\n"),
  ];
  const plan = m.planLinkRename(sources, { path: "v/a.md", line: 3, oldTitle: "Old", newTitle: "Setup" });
  assert.equal(plan.linkCount, 1, "the link in the same file resolves to the renamed section");
  assert.equal(after(m, plan, sources, "v/a.md"), "# A\n\n## Setup\n\nsee [[Setup]] here\n");
  assert.equal(after(m, plan, sources, "v/c.md"), null, "this one might mean the other section");
  assert.equal(plan.ambiguous, 1, "counted, so that the user can be told it was left alone");
});

test("an ambiguous link from another file is counted and not rewritten", async () => {
  const m = await rename();
  const sources = [
    src("v/a.md", "# A\n\n## Setup\n"),
    src("v/b.md", "# B\n\n## Old\n"),
    src("v/c.md", "# C\n\nsee [[Old]]\n"),
  ];
  // The renamed section comes first in the project, so the graph would have drawn the link in c.md to it.
  const plan = m.planLinkRename(sources, { path: "v/a.md", line: 3, oldTitle: "Old", newTitle: "Setup" });
  assert.equal(plan.linkCount, 0);
  assert.equal(plan.ambiguous, 1);
});

test("a new title that a link cannot hold blocks the update, and a change of case alone needs none", async () => {
  const m = await rename();
  const sources = [src("v/a.md", "## C#\n\n[[Old]]\n")];
  const blocked = m.planLinkRename(sources, { path: "v/a.md", line: 1, oldTitle: "Old", newTitle: "C#" });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.files.length, 0);
  assert.equal(blocked.linkCount, 1, "it still says how many links could not be updated");
  assert.equal(m.headingTitleOfLine("### Title {#id}"), "Title");
  assert.equal(m.headingTitleOfLine("not a heading"), null);
  assert.equal(m.canBeLinkTitle("Pipes | and [brackets]"), false);
  assert.equal(m.canBeLinkTitle("Plain title"), true);
  const upper = [src("v/a.md", "## OPTIMISATION\n\n[[Optimisation]]\n")];
  const plan = m.planLinkRename(upper, { path: "v/a.md", line: 1, oldTitle: "Optimisation", newTitle: "OPTIMISATION" });
  assert.deepEqual([plan.files.length, plan.blocked], [0, false]);
});

test("edits are positions in the text, also with Windows line endings", async () => {
  const m = await rename();
  const sources = [src("v/a.md", "## New\r\n\r\ntext [[Old]]\r\nmore [[Old]]\r\n")];
  const plan = m.planLinkRename(sources, { path: "v/a.md", line: 1, oldTitle: "Old", newTitle: "New" });
  assert.equal(plan.linkCount, 2);
  assert.equal(after(m, plan, sources, "v/a.md"), "## New\r\n\r\ntext [[New]]\r\nmore [[New]]\r\n");
});

test("nothing happens when the heading is not where the request says", async () => {
  const m = await rename();
  const sources = [src("v/a.md", "text\n[[Old]]\n")];
  assert.equal(m.planLinkRename(sources, { path: "v/a.md", line: 1, oldTitle: "Old", newTitle: "New" }).files.length, 0);
});

test("a link leads to its section: by title, by file and anchor, preferring its own file; nothing for a missing one", async () => {
  const m = await rename();
  const sources = [
    src("v/a.md", "# A\n\n## Shared\n"),
    src("v/b.md", "# B\n\n## Shared\n\n### Deep\n"),
  ];
  assert.deepEqual(m.resolveLinkTarget(sources, "v/b.md", "Shared"), { path: "v/b.md", line: 3, title: "Shared" });
  assert.deepEqual(m.resolveLinkTarget(sources, "v/b.md", "deep|the label"), { path: "v/b.md", line: 5, title: "Deep" });
  assert.deepEqual(m.resolveLinkTarget(sources, "v/b.md", "a.md#Shared"), { path: "v/a.md", line: 3, title: "Shared" });
  assert.equal(m.resolveLinkTarget(sources, "v/b.md", "Missing"), null);
});

test("markdown-it renders [[links]] as followable anchors, but not embeds or code", async () => {
  const { default: MarkdownIt } = await import("markdown-it");
  const { wikiLinks } = await import("../.test-build/preview/wiki-link-plugin.js");
  const md = new MarkdownIt().use(wikiLinks);
  const html = md.render("See [[Freshness checks]] and [[a.md#Part|the part]], not ![[pic.png]] or `[[code]]`.");
  assert.match(html, /<a class="wikilink"[^>]*data-wiki-link="Freshness checks">Freshness checks<\/a>/);
  assert.ok(html.includes('data-wiki-link="a.md#Part|the part" data-tooltip="a.md">the part</a>'));
  assert.equal((html.match(/class="wikilink"/g) || []).length, 2);
  assert.ok(html.includes("[[code]]"));
});

test("a link names its file by name when that is unique, else by a path from the document", async () => {
  const m = await rename();
  const all = ["d:/v/a.md", "d:/v/adv/emb.md", "d:/v/other/emb.md"];
  assert.equal(m.linkPathFor("d:/v/a.md", "d:/v/a.md", all), "a.md");
  assert.equal(m.linkPathFor("d:/v/a.md", "d:/v/adv/emb.md", all), "adv/emb.md");
  assert.equal(m.linkPathFor("d:/v/adv/x.md", "d:/v/other/emb.md", all), "../other/emb.md");
  assert.ok(m.linkNamesFile("d:/v/a.md", "d:/v/adv/emb.md", all, "adv/emb"));
  assert.ok(m.linkNamesFile("d:/v/a.md", "d:/v/a.md", all, "A"));
  assert.ok(!m.linkNamesFile("d:/v/a.md", "d:/v/a.md", all, "b.md"));
  assert.deepEqual(m.sectionTitles("# One\n```\n# not\n```\n## Two {#x}\n"), [{ title: "One", line: 1 }, { title: "Two", line: 5 }]);
});

test("a rename can write the links in full, naming the file and the header", async () => {
  const m = await rename();
  const sources = [src("v/a.md", "# A\n\n## Renamed\n"), src("v/b.md", "[[Old]] [[Old|label]] [[a.md#Old]]\n")];
  const plan = m.planLinkRename(sources, { path: "v/a.md", line: 3, oldTitle: "Old", newTitle: "Renamed" }, { qualify: true });
  assert.equal(after(m, plan, sources, "v/b.md"), "[[a.md#Renamed]] [[a.md#Renamed|label]] [[a.md#Renamed]]\n");
});

test("links that name only a title are written in full, unless several sections share the title", async () => {
  const m = await rename();
  const sources = [
    src("v/a.md", "# A\n\n## Own\n\n[[Own]] [[Shared]] [[Nowhere]] [[b.md#Shared]]\n"),
    src("v/b.md", "# B\n\n## Shared\n\nsee [[Own|alias]]\n"),
    src("v/c.md", "# C\n\n## Shared\n"),
  ];
  const plan = m.planQualifyLinks(sources);
  assert.equal(after(m, plan, sources, "v/a.md"), "# A\n\n## Own\n\n[[a.md#Own]] [[Shared]] [[Nowhere]] [[b.md#Shared]]\n");
  assert.equal(after(m, plan, sources, "v/b.md"), "# B\n\n## Shared\n\nsee [[a.md#Own|alias]]\n");
  assert.equal(plan.ambiguous, 1, "the shared title is counted and left");
});

test("the index tells which files a rename concerns, and a plan from outlines equals a plan from full texts", async () => {
  const m = await rename();
  const p = await import("../.test-build/graph/project-index-model.js");
  const texts = [
    src("v/a.md", "# A\n\n## Old\n\n[[Old]]\n"),
    src("v/b.md", "# B\n\nsee [[a.md#Old]] and `[[Old]]`\n"),
    src("v/c.md", "# C\n\n## Old\n\nplain\n"),
    src("v/d.md", "# D\n\n[[Other]]\n"),
  ];
  const index = texts.map(t => p.indexFile(t.path, t.name, "1:1", t.text));
  assert.deepEqual(m.linkKeysOf("[[a.md#Old]] `[[code]]` [[ Plain | x ]]\n```\n[[fenced]]\n```\n").sort(), ["a.md", "a.md#old".slice(0, 0) || "a", "old", "plain"].filter(Boolean).sort());
  assert.deepEqual(p.filesLinkingTo(index, "Old").map(f => f.path), ["v/a.md", "v/b.md"]);
  assert.deepEqual(p.filesWithSection(index, "old").map(f => f.path), ["v/a.md", "v/c.md"]);
  const request = { path: "v/a.md", line: 3, oldTitle: "Old", newTitle: "New" };
  const full = m.planLinkRename([{ ...texts[0], text: texts[0].text.replace("## Old", "## New") }, ...texts.slice(1)], request);
  const known = new Map(p.filesLinkingTo(index, "Old").map(f => [f.path, texts.find(t => t.path === f.path)]));
  known.set("v/a.md", { ...texts[0], text: texts[0].text.replace("## Old", "## New") });
  const light = m.planLinkRename(p.sourcesFromIndex(index, known), request);
  assert.deepEqual(light, full);
  assert.equal(p.titleOfLink("dir/a.md#Old Title|x"), "old title");
});

test("a preview link shows the section, and names its file in a tooltip", async () => {
  const { default: MarkdownIt } = await import("markdown-it");
  const { wikiLinks } = await import("../.test-build/preview/wiki-link-plugin.js");
  const html = new MarkdownIt().use(wikiLinks).render("[[01-Data.md#Data Pipelines]] and [[Plain]] and [[a.md#X|label]]");
  assert.ok(html.includes('data-tooltip="01-Data.md">Data Pipelines</a>'));
  assert.ok(html.includes('data-wiki-link="Plain">Plain</a>') && !html.includes('data-wiki-link="Plain" data-tooltip'));
  assert.ok(html.includes('data-tooltip="a.md">label</a>'));
});
