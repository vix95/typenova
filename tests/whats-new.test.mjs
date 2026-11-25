import test from "node:test";
import assert from "node:assert/strict";
import { NEWS_LIMIT, recentNews } from "../.test-build/app/whats-new-data.js";

test("the news show the last five versions, the newest first", () => {
  const news = recentNews();
  assert.ok(news.length > 0 && news.length <= NEWS_LIMIT);
  const numbers = news.map(entry => entry.version.split(".").map(Number));
  for (let index = 1; index < numbers.length; index++) {
    const [a, b] = [numbers[index - 1], numbers[index]];
    const newer = a.findIndex((value, at) => value !== b[at]);
    assert.ok(newer >= 0 && a[newer] > b[newer], "each version is older than the one before it");
  }
});

test("a longer list is cut to five, and versions are compared as numbers", () => {
  const entries = ["0.5.9", "0.5.10", "0.5.2", "0.5.11", "0.5.1", "0.5.12", "0.4.99"].map(version => ({ version, pl: version, en: version }));
  assert.deepEqual(recentNews(entries).map(entry => entry.version), ["0.5.12", "0.5.11", "0.5.10", "0.5.9", "0.5.2"]);
});

test("every entry is short and general, in both languages", () => {
  for (const entry of recentNews()) {
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
    for (const text of [entry.pl, entry.en]) {
      assert.ok(text.length > 10 && text.length <= 90, `${entry.version}: "${text}" is ${text.length} characters`);
      assert.ok(!/[`{}()\\/]/.test(text), `${entry.version}: no code or paths in "${text}"`);
    }
  }
});
