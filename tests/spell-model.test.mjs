import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../.test-build/spelling/spell-model.js");
const words = (m, text) => m.findWords(text).map(w => w.word);

test("the words of a text are found with their positions", async () => {
  const m = await model();
  assert.deepEqual(m.findWords("Ala ma kota, a kot ma Alę."), [
    { word: "Ala", from: 0, to: 3 }, { word: "ma", from: 4, to: 6 }, { word: "kota", from: 7, to: 11 }, { word: "kot", from: 15, to: 18 }, { word: "ma", from: 19, to: 21 }, { word: "Alę", from: 22, to: 25 },
  ].filter(w => w.word !== "a"));
  assert.deepEqual(m.findWords("błąd tu", 100).map(w => [w.word, w.from, w.to]), [["błąd", 100, 104], ["tu", 105, 107]], "a base offset moves the positions");
  assert.deepEqual(words(m, "don't, don’t, well-known and well-"), ["don't", "don’t", "well-known", "and", "well"], "apostrophes and hyphens inside a word stay in it");
});

test("words that are not worth checking are left out", async () => {
  const m = await model();
  assert.deepEqual(words(m, "NASA używa HTML i API w iPhone oraz TypeNova"), ["używa", "oraz"], "acronyms and camelCase names are skipped, single letters too");
  assert.deepEqual(words(m, "wersja2 v1 abc123 plik_nazwa 3d ok"), ["ok"], "words mixed with digits or underscores are skipped");
  assert.deepEqual(words(m, "x".repeat(60) + " dobry"), ["dobry"], "very long words are skipped");
});

test("addresses, code and markup are not spell checked", async () => {
  const m = await model();
  const text = "Zobacz https://przyklad.pl/stronaa i www.testt.com oraz mail jan.kowalski@firmaa.pl lub `kodzik zmiennaa` oraz [opis](https://x.pl/blad) <span class=\"klasaa\">tekst</span> &nbsp; $formulaa + \\frac$ C:\\folder\\plikk.txt ./src/modul.ts :smile:";
  assert.deepEqual(words(m, text), ["Zobacz", "i", "oraz", "mail", "lub", "oraz", "opis", "tekst"].filter(w => w !== "i"));
  const masked = m.maskNonProse("a `b c` d");
  assert.equal(masked, "a       d", "blanked out with spaces, positions stay");
  assert.equal(masked.length, "a `b c` d".length);
});

test("ranges outside the ignored parts are worked out", async () => {
  const m = await model();
  assert.deepEqual(m.rangesOutside(0, 20, [{ from: 5, to: 8 }, { from: 15, to: 30 }]), [{ from: 0, to: 5 }, { from: 8, to: 15 }]);
  assert.deepEqual(m.rangesOutside(0, 10, []), [{ from: 0, to: 10 }]);
  assert.deepEqual(m.rangesOutside(2, 6, [{ from: 0, to: 10 }]), []);
  assert.deepEqual(m.rangesOutside(0, 10, [{ from: 4, to: 6 }, { from: 5, to: 8 }]), [{ from: 0, to: 4 }, { from: 8, to: 10 }], "overlapping ranges are merged");
});

test("languages are read defensively and default to both", async () => {
  const m = await model();
  assert.deepEqual(m.parseLanguages("en"), ["en"]);
  assert.deepEqual(m.parseLanguages("en,pl"), ["pl", "en"]);
  assert.deepEqual(m.parseLanguages("de, fr"), ["pl", "en"]);
  assert.deepEqual(m.parseLanguages(null), ["pl", "en"]);
  assert.equal(m.serializeLanguages(["pl", "en"]), "pl,en");
});

test("the personal word list keeps clean, unique words", async () => {
  const m = await model();
  assert.equal(m.cleanUserWord("  Typenova "), "Typenova");
  assert.equal(m.cleanUserWord("dwa słowa"), null);
  assert.equal(m.cleanUserWord("abc123"), null);
  assert.equal(m.cleanUserWord("don’t"), "don't");
  let list = m.addToWordList([], "Zebra");
  list = m.addToWordList(list, "alfa");
  list = m.addToWordList(list, "ZEBRA");
  assert.deepEqual(list, ["alfa", "Zebra"], "sorted, and a word already there in another case is not added again");
  assert.deepEqual(m.removeFromWordList(list, "zebra"), ["alfa"]);
  assert.deepEqual(m.parseWordList(JSON.stringify(["a1", "Dobre", "dobre", 5, null, "ok słowo", "inne"])), ["Dobre", "inne"]);
  assert.deepEqual(m.parseWordList("not json"), []);
});

test("only words not yet known are asked about, once each", async () => {
  const m = await model();
  const found = m.findWords("kot Kot pies kot");
  const known = new Map([[m.checkKey("pies"), true]]);
  assert.deepEqual(m.unknownWords(found, known), ["kot", "Kot"], "case counts, because a name is not a common word");
});

test("prose documents are told from code", async () => {
  const m = await model();
  for (const path of [null, "C:\\notes\\a.md", "/p/readme.MD", "/p/notes.txt", "/p/doc.rst", "/p/LICENSE"]) assert.equal(m.isProseDocument(path), true, String(path));
  for (const path of ["/p/app.ts", "C:\\x\\main.py", "/p/data.json", "/p/style.css"]) assert.equal(m.isProseDocument(path), false, path);
});
