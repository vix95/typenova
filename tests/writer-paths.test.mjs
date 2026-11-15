import test from "node:test";
import assert from "node:assert/strict";

const paths = () => import("../.test-build/writer/writer-paths.js");

test("web and data images are used as they are", async () => {
  const { imageSource } = await paths();
  assert.deepEqual(imageSource("https://example.com/a.png", null), { kind: "url", url: "https://example.com/a.png" });
  assert.deepEqual(imageSource("<data:image/png;base64,AAAA>", null), { kind: "url", url: "data:image/png;base64,AAAA" });
});

test("a relative image is found next to the document, with . and .. resolved", async () => {
  const { imageSource } = await paths();
  assert.deepEqual(imageSource("pic.png", "C:\\notes\\a.md"), { kind: "file", path: "C:/notes/pic.png" });
  assert.deepEqual(imageSource("./img/pic%201.png?x=1", "C:\\notes\\a.md"), { kind: "file", path: "C:/notes/img/pic 1.png" });
  assert.deepEqual(imageSource("../assets/p.png", "/home/me/notes/a.md"), { kind: "file", path: "/home/me/assets/p.png" });
  assert.deepEqual(imageSource("../../../x.png", "C:\\a\\b.md"), { kind: "file", path: "C:/x.png" }, "never above the drive");
});

test("an absolute path stays, a relative one needs a saved document", async () => {
  const { imageSource } = await paths();
  assert.deepEqual(imageSource("D:\\pics\\a.png", "C:\\n\\a.md"), { kind: "file", path: "D:/pics/a.png" });
  assert.deepEqual(imageSource("file:///C:/pics/a.png", null), { kind: "file", path: "C:/pics/a.png" });
  assert.equal(imageSource("pic.png", null), null);
  assert.equal(imageSource("", "C:\\n\\a.md"), null);
});
