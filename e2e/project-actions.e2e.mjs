// The icons of the Project heading in a narrow sidebar: the ones that do not fit are in a menu, and come back when there is room.
import test from "node:test";
import assert from "node:assert/strict";
import { exeExists, startApp, workspace, writeFiles } from "./harness.mjs";
import { ignorableProblem } from "./helpers.mjs";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";
const width = (app, px) => app.evaluate(`document.querySelector('.layout').style.setProperty('--outline-width', '${px}px')`);
const state = app => app.evaluate(`(() => {
  const bar = document.getElementById('openProject').parentElement, heading = bar.closest('.sidebar-section-heading'), more = document.getElementById('projectActionsMore'), menu = document.querySelector('.project-actions-menu[data-for=projectActionsMore]');
  const inBar = [...bar.querySelectorAll(':scope > button')].filter(b => b !== more).map(b => b.id);
  const inMenu = [...menu.querySelectorAll('button')].map(b => ({ id: b.id, label: b.dataset.menuLabel }));
  const cut = [...bar.querySelectorAll(':scope > button')].some(b => !b.hidden && b.getBoundingClientRect().right > heading.getBoundingClientRect().right + 1);
  return { moreHidden: more.hidden, expanded: more.getAttribute('aria-expanded'), menuHidden: menu.hidden, inBar, inMenu, cut, label: more.getAttribute('aria-label') };
})()`);

test("icons that do not fit move into a menu, which opens, closes and gives them back", { skip }, async () => {
  const app = await startApp({ projects: [writeFiles(workspace("actions"), { "a.md": "# A\n" })] });
  try {
    await app.ready();
    await app.waitFor(`document.getElementById('projectActionsMore') !== null`, { what: "the overflow button" });
    await width(app, 460);
    await app.sleep(500);
    let now = await state(app);
    assert.equal(now.moreHidden, false, "the rarely used icons are always in the menu");
    assert.equal(now.inBar.length, 7);
    assert.deepEqual(now.inBar.slice(2, 5), ["refreshProject", "expandAllFolders", "collapseAllFolders"], "expand and collapse are beside Refresh");
    assert.deepEqual(now.inMenu.map(item => item.id), ["openGitPanel", "openBookmarks", "openHighlights"]);

    await width(app, 190);
    await app.waitFor(`!document.getElementById('projectActionsMore').hidden`, { what: "the More button in a narrow sidebar" });
    now = await state(app);
    assert.equal(now.cut, false, "no icon is cut off");
    assert.ok(now.inMenu.length > 3 && now.inBar.length + now.inMenu.length === 10, "no icon is lost");
    assert.equal(now.inMenu.at(-1).id, "openHighlights", "the menu keeps the order of the icons");
    assert.ok(now.inMenu.every(item => item.label && item.label.length > 2), "every item in the menu has a name");
    assert.equal(now.menuHidden, true);

    await app.evaluate(`document.getElementById('projectActionsMore').click()`);
    now = await state(app);
    assert.deepEqual([now.menuHidden, now.expanded], [false, "true"]);
    const box = await app.evaluate(`(() => { const r = document.querySelector('.project-actions-menu[data-for=projectActionsMore]').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: innerWidth, h: innerHeight }; })()`);
    assert.ok(box.left >= 0 && box.right <= box.w && box.top >= 0 && box.bottom <= box.h, "the menu is inside the window");
    await app.key("Escape", "Escape", 27);
    await app.waitFor(`document.querySelector('.project-actions-menu[data-for=projectActionsMore]').hidden`, { what: "Escape to close the menu" });
    assert.equal(await app.evaluate(`document.activeElement.id`), "projectActionsMore", "the focus returns to the button");

    await width(app, 460);
    await app.waitFor(`document.querySelectorAll('#filesView .sidebar-heading-actions > button').length === 8`, { what: "the icons to come back" });
    now = await state(app);
    assert.deepEqual([now.inBar.length, now.inMenu.length], [7, 3]);

    // A button moved into the menu still works: Highlights switches the sidebar, and the menu closes.
    await width(app, 190);
    await app.waitFor(`!!document.querySelector('.project-actions-menu #openHighlights')`, { what: "Highlights in the menu" });
    await app.evaluate(`document.getElementById('projectActionsMore').click()`);
    await app.evaluate(`document.querySelector('.project-actions-menu #openHighlights').click()`);
    assert.equal((await state(app)).menuHidden, true, "choosing an item closes the menu");
    await app.waitFor(`document.getElementById('openProject').getBoundingClientRect().width === 0`, { what: "the sidebar to switch to the highlights" });
    assert.deepEqual(app.problems.filter(line => !ignorableProblem(line)), [], "nothing in the console");
  } finally { await app.stop({ force: true }); }
});
