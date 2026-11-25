import test from "node:test";
import assert from "node:assert/strict";
import { cloneFolderName, isCloneUrl, pullSummary } from "../.test-build/git-ui/git-repo-model.js";

test("only web and ssh addresses are taken for a repository to clone", () => {
  for (const good of ["https://github.com/vix95/typenova.git", " http://host/x.git ", "ssh://git@host/x.git", "git://host/x.git", "git@github.com:vix95/typenova.git"]) assert.equal(isCloneUrl(good), true, good);
  for (const bad of ["", "   ", "-oProxyCommand=x", "file:///C:/repo", "C:\\repo", "/home/me/repo", "ext::sh -c x", "https://host/a b.git", "plain text"]) assert.equal(isCloneUrl(bad), false, bad);
});

test("the folder of a clone is named after the address", () => {
  assert.equal(cloneFolderName("https://github.com/vix95/typenova.git"), "typenova");
  assert.equal(cloneFolderName("https://github.com/vix95/typenova/"), "typenova");
  assert.equal(cloneFolderName("git@github.com:vix95/my-repo.git"), "my-repo");
  assert.equal(cloneFolderName("https://host/a b?c.git"), "a b-c");
  assert.equal(cloneFolderName("https://host/"), "host");
  assert.equal(cloneFolderName(""), null);
});

test("a pull that brought nothing is told apart", () => {
  assert.equal(pullSummary("Already up to date."), "current");
  assert.equal(pullSummary("Updating 1a2b..3c4d\nFast-forward\n a.md | 2 +-"), "updated");
});
