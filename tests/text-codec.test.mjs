import test from "node:test";
import assert from "node:assert/strict";

const bytesOf = (...values) => Uint8Array.from(values);

test("text files are decoded in the encoding they have and written back the same way", async () => {
  const c = await import("../.test-build/filesystem/text-codec.js");
  const polish = "Zażółć gęślą jaźń, ŻÓŁĆ";
  // UTF-8, with and without a byte order mark
  const utf8 = new TextEncoder().encode(polish);
  assert.deepEqual([c.decodeBytes(utf8).text, c.decodeBytes(utf8).encoding, c.decodeBytes(utf8).bom], [polish, "utf-8", false]);
  const withBom = c.encodeText(polish, { encoding: "utf-8", bom: true, lineEnding: "lf" });
  assert.deepEqual([...withBom.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const decodedBom = c.decodeBytes(withBom);
  assert.deepEqual([decodedBom.text, decodedBom.bom], [polish, true]);
  // Windows-1250 and ISO-8859-2 round trip, and are told apart for Polish text
  for (const encoding of ["windows-1250", "iso-8859-2"]) {
    const bytes = c.encodeText(polish, { encoding, bom: false, lineEnding: "lf" });
    assert.notDeepEqual([...bytes], [...utf8]);
    assert.equal(c.decodeBytes(bytes, encoding).text, polish);
    assert.equal(c.decodeBytes(bytes).encoding, encoding);
    assert.equal(c.decodeBytes(bytes).text, polish);
  }
  assert.equal(c.decodeBytes(bytesOf(0xb9, 0x9c, 0x9f)).encoding, "windows-1250");
  // UTF-16 with a mark
  for (const encoding of ["utf-16le", "utf-16be"]) {
    const bytes = c.encodeText("zażółć", { encoding, bom: true, lineEnding: "lf" });
    const decoded = c.decodeBytes(bytes);
    assert.deepEqual([decoded.text, decoded.encoding, decoded.bom], ["zażółć", encoding, true]);
  }
  // characters that do not exist in the target encoding
  assert.equal(c.countUnmappable("zażółć", "windows-1250"), 0);
  assert.equal(c.countUnmappable("zażółć 😀 Ж", "windows-1250"), 2);
  assert.equal(c.countUnmappable("Ж", "windows-1251"), 0);
  assert.equal([...c.encodeText("a😀", { encoding: "windows-1250", bom: false, lineEnding: "lf" })].pop(), 0x3f);
});

test("line endings are detected, normalised for editing and restored on saving", async () => {
  const c = await import("../.test-build/filesystem/text-codec.js");
  const windows = new TextEncoder().encode("one\r\ntwo\r\nthree");
  const decoded = c.decodeBytes(windows);
  assert.deepEqual([decoded.text, decoded.lineEnding, decoded.mixedLineEndings], ["one\ntwo\nthree", "crlf", false]);
  assert.equal(new TextDecoder().decode(c.encodeText(decoded.text, decoded)), "one\r\ntwo\r\nthree");
  assert.equal(c.decodeBytes(new TextEncoder().encode("a\nb\n")).lineEnding, "lf");
  assert.equal(c.decodeBytes(new TextEncoder().encode("a\rb\r")).lineEnding, "cr");
  const mixed = c.decodeBytes(new TextEncoder().encode("a\r\nb\nc\r\nd"));
  assert.deepEqual([mixed.lineEnding, mixed.mixedLineEndings, mixed.text], ["crlf", true, "a\nb\nc\nd"]);
  assert.equal(new TextDecoder().decode(c.encodeText("x\ny", { encoding: "utf-8", bom: false, lineEnding: "cr" })), "x\ry");
});

test("binary content is told from text", async () => {
  const c = await import("../.test-build/filesystem/text-codec.js");
  assert.equal(c.looksBinary(bytesOf(0x50, 0x4b, 0x03, 0x04, 0x00, 0x00)), true);
  assert.equal(c.looksBinary(new TextEncoder().encode("plain text\twith tabs\r\nand lines")), false);
  assert.equal(c.looksBinary(c.encodeText("utf16", { encoding: "utf-16le", bom: true, lineEnding: "lf" })), false);
  assert.equal(c.looksBinary(new Uint8Array(0)), false);
  assert.equal(c.looksBinary(Uint8Array.from({ length: 100 }, (_, i) => i % 7)), true);
  assert.equal(c.formatLabel({ encoding: "utf-8", bom: true, lineEnding: "lf" }), "UTF-8 BOM");
  assert.equal(c.formatLabel({ encoding: "windows-1250", bom: false, lineEnding: "lf" }), "Windows-1250");
});
