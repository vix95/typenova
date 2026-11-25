import test from "node:test";
import assert from "node:assert/strict";
import { NEWS_LIMIT, formatNewsDate, recentNews } from "../.test-build/app/whats-new-data.js";

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
  const entries = ["0.5.9", "0.5.10", "0.5.2", "0.5.11", "0.5.1", "0.5.12", "0.4.99"].map(version => ({ version, date: "2026-11-25", pl: version, en: version }));
  assert.deepEqual(recentNews(entries).map(entry => entry.version), ["0.5.12", "0.5.11", "0.5.10", "0.5.9", "0.5.2"]);
});

test("every entry is short and general, in both languages, and has a real day", () => {
  for (const entry of recentNews()) {
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.notEqual(formatNewsDate(entry.date, "en"), entry.date, `${entry.version}: the date is a real day`);
    for (const text of [entry.pl, entry.en]) {
      assert.ok(text.length > 10 && text.length <= 90, `${entry.version}: "${text}" is ${text.length} characters`);
      assert.ok(!/[`{}()\\/]/.test(text), `${entry.version}: no code or paths in "${text}"`);
    }
  }
});

test("a release day is written out in the language, on the day it names", () => {
  assert.equal(formatNewsDate("2026-11-25", "en"), "25 Nov 2026");
  assert.equal(formatNewsDate("2026-11-25", "pl"), "25 listopada 2026");
  assert.equal(formatNewsDate("2026-01-01", "pl-PL"), "1 stycznia 2026");
  assert.equal(formatNewsDate("2026-02-30", "en"), "2026-02-30", "a day that does not exist is left as it is");
  assert.equal(formatNewsDate("yesterday", "en"), "yesterday");
});

test("the dates of the news do not go back as the versions go up", () => {
  const news = recentNews();
  for (let index = 1; index < news.length; index++) assert.ok(news[index - 1].date >= news[index].date, `${news[index - 1].version} is not older than ${news[index].version}`);
});

test("the news open by themselves only after a version change, not on a fresh install", async () => {
  const { shouldShowAfterUpdate } = await import("../.test-build/app/whats-new-data.js");
  assert.equal(shouldShowAfterUpdate("0.5.167", "0.5.168", true), true);
  assert.equal(shouldShowAfterUpdate("0.5.168", "0.5.168", true), false);
  assert.equal(shouldShowAfterUpdate(null, "0.5.168", true), true, "an update from a version that did not remember");
  assert.equal(shouldShowAfterUpdate(null, "0.5.168", false), false, "a fresh install");
});
