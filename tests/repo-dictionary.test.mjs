import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../.test-build/spelling/repo-dictionary-model.js");

test("the file is read word by word, with comments, blanks and rubbish left out", async () => {
  const { parseRepoDictionary } = await model();
  const text = "# comment\r\nAnna\r\n\r\n  TypeNova  \nanna\nnot a word\n123\nKowalski's\n#Another\nżółć\n";
  assert.deepEqual(parseRepoDictionary(text), ["Anna", "TypeNova", "Kowalski's", "żółć"]);
  assert.deepEqual(parseRepoDictionary(""), []);
  assert.deepEqual(parseRepoDictionary(null), []);
});

test("the file is written sorted, one word per line, with a comment on top and a final newline", async () => {
  const { serializeRepoDictionary, parseRepoDictionary } = await model();
  const text = serializeRepoDictionary(["zebra", "Anna", "Ćma", "TypeNova"]);
  assert.ok(text.startsWith("# TypeNova dictionary"));
  assert.ok(text.endsWith("\n") && !text.endsWith("\n\n"));
  assert.deepEqual(text.split("\n").slice(1, -1), ["Anna", "Ćma", "TypeNova", "zebra"]);
  assert.deepEqual(parseRepoDictionary(text), ["Anna", "Ćma", "TypeNova", "zebra"], "what is written is read back");
  assert.equal(serializeRepoDictionary([]).split("\n").length, 2, "an empty dictionary is only the comment");
});

test("two dictionaries are merged once per word, ignoring case", async () => {
  const { mergeDictionaries, wordsNotIn } = await model();
  assert.deepEqual(mergeDictionaries(["Anna", "kot"], ["ANNA", "Pies", "x y"]), ["Anna", "kot", "Pies"]);
  assert.deepEqual(wordsNotIn(["Anna", "kot"], ["anna", "Pies", "Kot", "Mysz"]), ["Pies", "Mysz"]);
  assert.deepEqual(wordsNotIn([], []), []);
});
