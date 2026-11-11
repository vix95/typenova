import test from "node:test";
import assert from "node:assert/strict";

const load = name => import(`../.test-build/data/${name}.js`);
const BS = String.fromCharCode(92);

function parseInPieces(delimiter, text, pieces) {
  return load("delimited-stream").then(m => {
    const rows = [];
    const parser = m.createDelimitedParser(delimiter, row => rows.push(row));
    let at = 0;
    for (const size of pieces) { parser.feed(text.slice(at, at + size)); at += size; }
    parser.feed(text.slice(at));
    parser.end();
    return rows;
  });
}

test("the streaming parser reads quotes, doubled quotes, line breaks inside cells and every kind of line ending", async () => {
  const text = 'a,b,c\r\n1,"x, y","say ""hi"""\n2,"two\nlines",\r3,,\n';
  const expected = [["a", "b", "c"], ["1", "x, y", 'say "hi"'], ["2", "two\nlines", ""], ["3", "", ""]];
  assert.deepEqual(await parseInPieces(",", text, []), expected);
});

test("the streaming parser gives the same rows however the text is cut into pieces", async () => {
  const text = 'id;name;note\r\n1;"Zażółć; gęślą";ok\r\n2;"a ""b"" c";"x\r\ny"\r\n3;;\r\n4;last;row';
  const whole = await parseInPieces(";", text, []);
  assert.equal(whole.length, 5);
  for (let cut = 1; cut < text.length; cut++) assert.deepEqual(await parseInPieces(";", text, [cut]), whole, `cut at ${cut}`);
  for (const size of [1, 2, 3, 7]) assert.deepEqual(await parseInPieces(";", text, Array(text.length).fill(size)), whole, `pieces of ${size}`);
});

test("a file without a final line break still gives its last row, and an empty file gives none", async () => {
  assert.deepEqual(await parseInPieces(",", "a,b\nc,d", []), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(await parseInPieces(",", "", []), []);
  assert.deepEqual(await parseInPieces(",", "a,b\n", []), [["a", "b"]]);
  assert.deepEqual(await parseInPieces(",", 'a,""', []), [["a", ""]]);
});

test("the delimiter is found from the first lines, plain text has none", async () => {
  const m = await load("delimited-stream");
  assert.equal(m.detectDelimiter("a,b,c\n1,2,3\n4,5,6\n", "csv"), ",");
  assert.equal(m.detectDelimiter("a;b;c\n1,5;2,5;3\n", "csv"), ";");
  assert.equal(m.detectDelimiter("a\tb\n1\t2\n", "txt"), "\t");
  assert.equal(m.detectDelimiter("a|b|c\n1|2|3\n", "txt"), "|");
  assert.equal(m.detectDelimiter("a\tb\n1\t2\n", "tsv"), "\t");
  assert.equal(m.detectDelimiter("just some words\nand more words\n", "txt"), m.NO_DELIMITER);
  assert.equal(m.detectDelimiter("", "csv"), m.NO_DELIMITER);
});

test("numbers and dates are read in the usual notations and nothing else is mistaken for them", async () => {
  const m = await load("value-parse");
  assert.equal(m.parseNumber("12"), 12);
  assert.equal(m.parseNumber("-3.5"), -3.5);
  assert.equal(m.parseNumber("3,5"), 3.5);
  assert.equal(m.parseNumber("1,234.50"), 1234.5);
  assert.equal(m.parseNumber("1.234,50"), 1234.5);
  assert.equal(m.parseNumber("1 234,5"), 1234.5);
  assert.equal(m.parseNumber("1e3"), 1000);
  for (const bad of ["", "abc", "12abc", "1-2", "2024-03-15", "15.03.2024", "--1", "1,2,3"]) assert.ok(Number.isNaN(m.parseNumber(bad)), `"${bad}" is not a number`);
  assert.equal(m.dayToIso(m.parseDay("2024-03-15")), "2024-03-15");
  assert.equal(m.dayToIso(m.parseDay("15.03.2024")), "2024-03-15");
  assert.equal(m.dayToIso(m.parseDay("2024-03-15 08:30:00")), "2024-03-15");
  assert.equal(m.dayToIso(m.parseDay("2024/3/5")), "2024-03-05");
  assert.ok(Number.isNaN(m.parseDay("2024-02-30")), "a day that does not exist");
  assert.ok(Number.isNaN(m.parseDay("12345678")));
  assert.equal(m.parseBoolean("Tak"), true);
  assert.equal(m.parseBoolean("false"), false);
  assert.equal(m.parseBoolean("1"), null);
});

const rowsOf = (...lines) => lines.map(line => line.split(","));

async function profileOf(rows) {
  const m = await load("data-profile");
  const profiler = m.createProfiler();
  for (const row of rows) profiler.addRow(row);
  return profiler.result();
}

test("the profile finds types, missing cells, statistics and the header", async () => {
  const rows = [["id", "country", "amount", "day", "paid"]];
  const countries = ["PL", "PL", "DE", "CZ"];
  for (let i = 1; i <= 100; i++) rows.push([String(i), countries[i % 4], i === 7 ? "" : String(i * 2), `2024-0${1 + (i % 3)}-1${i % 9}`, i % 2 ? "tak" : "nie"]);
  const profile = await profileOf(rows);
  assert.equal(profile.rows, 100);
  assert.equal(profile.hasHeader, true);
  const [id, country, amount, day, paid] = profile.columns;
  assert.equal(id.type, "number"); assert.equal(id.number.min, 1); assert.equal(id.number.max, 100); assert.equal(id.number.median, 50.5);
  assert.equal(country.type, "category"); assert.equal(country.distinct, 3); assert.deepEqual(country.top[0], { value: "PL", count: 50 });
  assert.equal(amount.type, "number"); assert.equal(amount.missing, 1); assert.equal(amount.count, 99);
  assert.equal(amount.number.histogram.counts.reduce((a, b) => a + b, 0), 99, "every value is in a bin");
  assert.equal(day.type, "date"); assert.equal(day.date.min, "2024-01-10"); assert.equal(day.date.unit, "day");
  assert.equal(paid.type, "boolean");
  assert.equal(profile.preview.length, 101);
});

test("a file without a header gets numbered columns, ragged rows are counted, empty lines are ignored", async () => {
  const profile = await profileOf([["1", "2"], ["3", "4"], [""], ["5"], ["6", "7", "8"]]);
  assert.equal(profile.hasHeader, false);
  assert.equal(profile.rows, 4);
  assert.equal(profile.ragged, 2);
  assert.equal(profile.columns[0].name, "column 1");
});

test("repeated and empty header names are made unique", async () => {
  const m = await load("data-profile");
  assert.deepEqual(m.columnNames(["a", "a", "", "a"]), ["a", "a (2)", "column 3", "a (3)"]);
});

test("a column with many different values is text, not a category, and a statistic over a huge column uses a sample", async () => {
  const rows = [["name", "value"]];
  for (let i = 0; i < 30_000; i++) rows.push([`person-${i}`, String(i)]);
  const profile = await profileOf(rows);
  assert.equal(profile.columns[0].type, "text");
  assert.equal(profile.columns[0].distinctExact, false, "the table of distinct values is capped");
  const value = profile.columns[1];
  assert.equal(value.number.min, 0); assert.equal(value.number.max, 29_999); assert.equal(value.number.mean, 14_999.5);
  assert.equal(value.number.sampled, true);
  assert.ok(Math.abs(value.number.median - 14_999.5) < 1500, "the median of the sample is close");
});

test("the profile of a quarter of mixed values counts the mismatches of a number column", async () => {
  const rows = [["n"]];
  for (let i = 0; i < 200; i++) rows.push([i === 3 ? "n/a" : String(i)]);
  const profile = await profileOf(rows);
  assert.equal(profile.columns[0].type, "number");
  assert.equal(profile.columns[0].mismatched, 1);
});

test("chart specs are read from the text of a block and refuse paths that leave the project", async () => {
  const m = await load("chart-spec");
  const ok = m.parseChartSpec("file: data/orders.csv\ntype: bar   # the kind\nx: country\ny: amount\nagg: sum\ntop: 5\ntitle: Revenue");
  assert.ok(ok.ok);
  assert.deepEqual({ ...ok.spec }, { file: "data/orders.csv", type: "bar", x: "country", y: "amount", agg: "sum", top: 5, bins: 24, step: "auto", title: "Revenue" });
  assert.equal(m.parseChartSpec("file: a.csv\nx: #3").spec.x, "#3", "a # that touches a word is not a comment");
  assert.equal(m.parseChartSpec("file: a.csv\nx: c").spec.agg, "count");
  assert.equal(m.parseChartSpec("file: a.csv\nx: c\ny: v").spec.agg, "sum");
  for (const bad of ["x: a", "file: a.csv", "file: https://x.io/a.csv\nx: a", "file: a.csv\nx: a\ntype: pie", "file: a.csv\nx: a\ntype: scatter", "file: a.csv\nx: a\nagg: sum", "nonsense"]) assert.equal(m.parseChartSpec(bad).ok, false, bad);
  const spec = ok.spec;
  assert.deepEqual(m.parseChartSpec(m.specToBlock(spec).replace(/```chart\n|\n```\n/g, "")).spec, spec, "a block written by the viewer reads back the same");
  assert.equal(m.findColumn(["id", "Country"], "country"), 1);
  assert.equal(m.findColumn(["id", "Country"], "#1"), 0);
  assert.equal(m.findColumn(["id"], "#4"), -1);
});

async function chartOf(specText, rows) {
  const spec = (await load("chart-spec")).parseChartSpec(specText);
  assert.ok(spec.ok, spec.error);
  const job = (await load("chart-job")).createChartJob(spec.spec);
  for (const row of rows) job.addRow(row);
  return { data: job.result(), error: job.error };
}

test("a bar chart sums per category, sorts, keeps the top and folds the rest into one bar", async () => {
  const rows = [["country", "amount"], ["PL", "10"], ["DE", "5"], ["PL", "20"], ["CZ", "1"], ["FR", "2"], ["DE", "x"], ["", "4"]];
  const { data } = await chartOf("file: a.csv\nx: country\ny: amount\nagg: sum\ntop: 2", rows);
  assert.deepEqual(data.points, [{ label: "PL", value: 30 }, { label: "DE", value: 5 }, { label: "…", value: 3 }]);
  assert.equal(data.other, true); assert.equal(data.hidden, 2); assert.equal(data.skipped, 2);
  const mean = (await chartOf("file: a.csv\nx: country\ny: amount\nagg: mean", rows)).data;
  assert.equal(mean.points[0].label, "PL"); assert.equal(mean.points[0].value, 15);
  const count = (await chartOf("file: a.csv\nx: country", rows)).data;
  assert.equal(count.points[0].value, 2);
});

test("a line chart groups dates by day, month or year and sorts them", async () => {
  const rows = [["day", "v"]];
  for (let month = 1; month <= 12; month++) for (const day of [1, 15]) rows.push([`2024-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, "2"]);
  const auto = (await chartOf("file: a.csv\ntype: line\nx: day\ny: v", rows)).data;
  assert.equal(auto.step, "month"); assert.equal(auto.points.length, 12); assert.equal(auto.points[0].label, "2024-01"); assert.equal(auto.points[0].value, 4);
  const year = (await chartOf("file: a.csv\ntype: line\nx: day\ny: v\nby: year", rows)).data;
  assert.deepEqual(year.points, [{ label: "2024", value: 48 }]);
  const days = (await chartOf("file: a.csv\ntype: line\nx: day\nby: day", rows)).data;
  assert.equal(days.points.length, 24);
});

test("a line chart over numbers keeps a readable number of points", async () => {
  const rows = [["t", "v"]];
  for (let i = 0; i < 5000; i++) rows.push([String(i), "1"]);
  const { data } = await chartOf("file: a.csv\ntype: line\nx: t\ny: v\nagg: sum", rows);
  assert.ok(data.points.length <= 240);
  assert.equal(data.points.reduce((sum, point) => sum + point.value, 0), 5000, "merging groups loses nothing");
});

test("histogram and scatter charts use exact range and a sample", async () => {
  const rows = [["h", "w"]];
  for (let i = 0; i < 1000; i++) rows.push([String(i), String(i * 2)]);
  const histogram = (await chartOf("file: a.csv\ntype: histogram\nx: h\nbins: 10", rows)).data;
  assert.equal(histogram.histogram.counts.length, 10); assert.equal(histogram.histogram.from, 0); assert.equal(histogram.histogram.to, 999);
  assert.equal(histogram.histogram.counts.reduce((a, b) => a + b, 0), 1000);
  const scatter = (await chartOf("file: a.csv\ntype: scatter\nx: h\ny: w", rows)).data;
  assert.equal(scatter.scatter.length, 1000); assert.equal(scatter.sampled, false);
});

test("a chart that names a column that does not exist reports it", async () => {
  const { error } = await chartOf("file: a.csv\nx: nope", [["a", "b"], ["1", "2"]]);
  assert.match(error, /no column/);
});

test("chart svg escapes text, adapts to the kind and says when there is nothing to draw", async () => {
  const svg = await load("chart-svg");
  const texts = { empty: "Nothing to draw", describe: data => `chart ${data.kind}` };
  const data = { kind: "bar", title: "", xLabel: "x", yLabel: "y", points: [{ label: '<img src=x onerror="a">', value: 3 }, { label: "b", value: -2 }], rows: 2, skipped: 0, capped: false, hidden: 0, other: false, sampled: false };
  const out = svg.renderChartSvg(data, texts);
  assert.ok(out.startsWith("<svg"));
  assert.ok(!out.includes("<img"), "labels are escaped");
  assert.ok(out.includes("&lt;img"));
  assert.match(out, /role="img"/);
  assert.match(svg.renderChartSvg({ ...data, points: [] }, texts), /Nothing to draw/);
  const line = svg.renderChartSvg({ ...data, kind: "line", points: [{ label: "a", value: 1 }, { label: "b", value: 3 }] }, texts);
  assert.match(line, /dv-line/);
  assert.equal(svg.compact(1234567), "1.2M"); assert.equal(svg.compact(12), "12"); assert.equal(svg.compact(-15000), "-15k");
  assert.deepEqual(svg.niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
});

test("the data job decodes bytes cut anywhere, finds the delimiter and the encoding and refuses binary files", async () => {
  const m = await load("data-job");
  const text = "imię;miasto;kwota\nZażółć;Łódź;1,5\nGęślą;Kraków;2,5\n";
  const bytes = new TextEncoder().encode(text);
  for (const size of [1, 3, 5, 1000]) {
    const job = m.createDataJob({ kind: "profile" }, "csv");
    for (let at = 0; at < bytes.length; at += size) assert.ok(job.push(bytes.subarray(at, at + size)));
    const result = job.finish();
    assert.equal(result.delimiter, ";", `size ${size}`);
    assert.equal(result.profile.rows, 2);
    assert.equal(result.profile.columns[0].name, "imię");
    assert.equal(result.profile.columns[2].number.mean, 2);
  }
  const legacy = Uint8Array.from([...new TextEncoder().encode("a;b\n")], c => c).slice();
  const win1250 = new Uint8Array([...legacy, 0xb3, 0xf3, 0x64, 0x9f, 0x3b, 0x31, 0x0a]);
  const decoded = m.createDataJob({ kind: "profile" }, "csv");
  decoded.push(win1250);
  const result = decoded.finish();
  assert.equal(result.encoding, "windows-1250");
  assert.equal(result.profile.preview[1][0], "łódź");
  const binary = m.createDataJob({ kind: "profile" }, "csv");
  binary.push(new Uint8Array([0, 1, 2, 3, 0, 0]));
  assert.deepEqual(binary.finish(), { kind: "error", reason: "binary" });
  const withBom = m.createDataJob({ kind: "profile" }, "csv");
  withBom.push(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("a,b\n1,2\n")]));
  assert.equal(withBom.finish().profile.columns[0].name, "a", "the byte order mark is not part of the first name");
});

test("a plain text file becomes one column of lines", async () => {
  const m = await load("data-job");
  const job = m.createDataJob({ kind: "profile" }, "txt");
  job.push(new TextEncoder().encode("first line\nsecond line\nthird line\n"));
  const result = job.finish();
  assert.equal(result.profile.columns.length, 1);
  assert.equal(result.profile.rows, 3, "every line is data: plain text has no header row");
  assert.equal(result.profile.hasHeader, false);
});

test("a file named in a note is resolved beside the note and may not climb above the drive", async () => {
  const m = await load("chart-spec");
  assert.equal(m.resolveBesideNote("D:" + BS + "proj" + BS + "notes" + BS + "a.md", "data/x.csv"), "D:/proj/notes/data/x.csv");
  assert.equal(m.resolveBesideNote("D:/proj/notes/a.md", "../data/x.csv"), "D:/proj/data/x.csv");
  assert.equal(m.resolveBesideNote("/home/u/n/a.md", "./x.csv"), "/home/u/n/x.csv");
  assert.equal(m.resolveBesideNote("D:/a.md", "../../x.csv"), null);
  assert.equal(m.resolveBesideNote("D:/proj/a.md", "D:" + BS + "proj" + BS + "data" + BS + "x.csv"), "D:/proj/data/x.csv", "an absolute path stays as it is");
  assert.equal(m.parseChartSpec("file: D:/proj/data/x.csv\nx: a").ok, true, "an absolute path is read; the project folder is checked when the chart is drawn");
  assert.equal(m.parseChartSpec("file: ../data/x.csv\nx: a").ok, true, "the path may leave the note's folder; the viewer checks the project");
});

test("the first chart suggested for a file fits its columns", async () => {
  const profile = await import("../.test-build/data/data-profile.js");
  const suggest = (await load("chart-suggest")).suggestSpec;
  const of = rows => { const p = profile.createProfiler(); for (const row of rows) p.addRow(row); return p.result(); };
  const sales = [["day", "country", "amount"]];
  for (let i = 0; i < 40; i++) sales.push([`2024-01-${String(1 + (i % 28)).padStart(2, "0")}`, ["PL", "DE"][i % 2], String((i * 37) % 11)]);
  assert.deepEqual(suggest(of(sales), "s.csv"), { file: "s.csv", top: 12, bins: 24, step: "auto", type: "line", x: "day", y: "amount", agg: "sum" });
  const noDates = sales.map(row => [row[1], row[2]]);
  assert.equal(suggest(of(noDates), "s.csv").type, "bar");
  const numbersOnly = [["v"]]; for (let i = 0; i < 30; i++) numbersOnly.push([String((i * 13) % 7)]);
  assert.equal(suggest(of(numbersOnly), "s.csv").type, "histogram");
  assert.equal(suggest(of([]), "s.csv"), null);
});

test("the wizard offers the kinds the data fits and a complete first choice for each", async () => {
  const profile = await import("../.test-build/data/data-profile.js");
  const w = await load("chart-wizard-model");
  const of = rows => { const p = profile.createProfiler(); for (const row of rows) p.addRow(row); return p.result(); };
  const sales = [["id", "day", "country", "amount", "qty"]];
  for (let i = 1; i <= 60; i++) sales.push([String(i), `2024-0${1 + (i % 9)}-1${i % 9}`, ["PL", "DE", "CZ"][i % 3], String((i * 37) % 101 + 1), String(i % 5 + 1)]);
  const p = of(sales);
  const fits = Object.fromEntries(w.kindFits(p).map(f => [f.kind, f.fit]));
  assert.deepEqual(fits, { bar: "good", line: "good", histogram: "good", scatter: "good" });
  assert.deepEqual(w.measures(p).map(c => c.name), ["amount", "qty", "id"], "row numbers come last as a measure");
  assert.equal(w.columnsFor(p, "bar", "x")[0].name, "country");
  assert.equal(w.columnsFor(p, "line", "x")[0].name, "day");
  const bar = w.defaultSpec(p, "bar", "s.csv");
  assert.deepEqual([bar.x, bar.y, bar.agg], ["country", "amount", "sum"]);
  assert.deepEqual([w.defaultSpec(p, "histogram", "s.csv").x, w.defaultSpec(p, "scatter", "s.csv").y], ["amount", "qty"]);
  const words = of([["name", "city"], ["a", "x"], ["b", "y"], ["c", "x"]]);
  const wordFits = Object.fromEntries(w.kindFits(words).map(f => [f.kind, f]));
  assert.equal(wordFits.histogram.fit, "missing"); assert.equal(wordFits.histogram.need, "number");
  assert.equal(wordFits.scatter.need, "two-numbers");
  assert.equal(w.defaultSpec(words, "histogram", "w.csv"), null);
  assert.equal(w.defaultSpec(words, "bar", "w.csv").agg, "count", "without a measure a bar chart counts rows");
  const dropped = w.withChoice({ ...bar }, { agg: "count" }, p);
  assert.equal(dropped.agg, "count");
  assert.equal(w.withChoice({ ...bar, y: undefined, agg: "count" }, { agg: "mean" }, p).y, "amount", "choosing an aggregate that needs a measure picks one");
  assert.deepEqual(w.sentenceOf(bar), { kind: "aggregate", agg: "sum", x: "country", y: "amount", over: false });
  assert.deepEqual(w.sentenceOf({ ...bar, agg: "count" }), { kind: "rows", x: "country" });
  assert.deepEqual(w.sentenceOf(w.defaultSpec(p, "scatter", "s.csv")), { kind: "pair", x: "amount", y: "qty" });
});

test("the overview job gives the profile and a fixed set of charts in one pass", async () => {
  const m = await load("data-job");
  const lines = ["day;country;channel;amount;qty"];
  for (let i = 0; i < 3000; i++) lines.push([`2024-0${1 + (i % 9)}-1${i % 9}`, ["PL", "DE", "CZ"][i % 3], ["web", "app"][i % 2], String((i * 37) % 101 + 1), String(i % 5 + 1)].join(";"));
  const bytes = new TextEncoder().encode(lines.join("\n") + "\n");
  const job = m.createDataJob({ kind: "overview" }, "csv");
  for (let at = 0; at < bytes.length; at += 4096) job.push(bytes.subarray(at, at + 4096));
  const result = job.finish();
  assert.equal(result.kind, "overview");
  assert.equal(result.profile.rows, 3000);
  assert.deepEqual(result.charts.map(c => [c.spec.x, c.spec.type]), [["day", "line"], ["country", "bar"], ["channel", "bar"], ["amount", "histogram"], ["qty", "histogram"]], "one chart for every column, by its type and under its real name");
  assert.equal(result.charts[1].data.rows, 3000, "every row took part, not only the first rows used to choose the charts");
  assert.ok(result.charts.every(c => c.spec.agg === "count"));
  const words = m.createDataJob({ kind: "overview" }, "txt");
  words.push(new TextEncoder().encode("one line\nanother line\n"));
  assert.deepEqual(words.finish().charts, [], "plain text has no charts");
});
