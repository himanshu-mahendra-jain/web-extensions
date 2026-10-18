import path from "node:path";

import {
  test,
  expect
} from "../../../test-support/firefox-android.js";


test.use({
  extensionPath: path.resolve(__dirname, "../..")
});


// A page that blocks copying, selection and right click, as in enable.spec.js.
const RESTRICTED_BODY = `
<style>
  body { user-select: none; -webkit-user-select: none; }
</style>
<p id="text">Protected text</p>
<script>
  document.body.setAttribute("oncontextmenu", "return false");
  document.body.setAttribute("oncopy", "return false");
  document.onpaste = () => false;

  for (const type of ["contextmenu", "copy", "cut", "selectstart"]) {
    document.addEventListener(type, (event) => event.preventDefault());
  }

  document.getElementById("text")
    .addEventListener("dragstart", (event) => event.preventDefault());
</script>`;


const BLOCKED_EVENTS = [
  "contextmenu",
  "copy",
  "cut",
  "paste",
  "selectstart",
  "dragstart"
];


test.beforeEach(async ({ firefox }) => {
  firefox.pages.route({
    "http://restricted.test/": `<body>${RESTRICTED_BODY}<iframe src="/frame"></iframe></body>`,
    "http://restricted.test/frame": `<body>${RESTRICTED_BODY}</body>`
  });
});


// Event types the page still cancels when they fire on the text.
function blockedEvents(tab, frame = "window") {
  return tab.evaluate(`
    const text = ${frame}.document.getElementById("text");

    return ${JSON.stringify(BLOCKED_EVENTS)}.filter((type) => {
      return !text.dispatchEvent(
        new ${frame}.Event(type, { bubbles: true, cancelable: true })
      );
    });
  `);
}


function isEnabled(tab, frame = "window") {
  return tab.evaluate(`
    return ${frame}.document.documentElement.hasAttribute("data-enable-copy-right-click");
  `);
}


async function enable(firefox, tab) {
  await firefox.clickAction(tab);

  await expect.poll(() => isEnabled(tab)).toBe(true);
}


function actionState(firefox, tab) {
  return firefox.inBackground(`
    return {
      badge: await browser.action.getBadgeText({ tabId: ${tab.id} }),
      title: await browser.action.getTitle({ tabId: ${tab.id} })
    };
  `);
}


// Firefox for Android has no chrome.commands, which background.js skips.
test("the background script runs without errors", async ({ firefox }) => {
  expect(await firefox.extensionErrors()).toEqual([]);
});


test("the restricted page blocks copying until the toolbar button is clicked", async ({ firefox }) => {
  const tab = await firefox.openTab("http://restricted.test/");

  expect(await blockedEvents(tab)).toEqual(BLOCKED_EVENTS);

  await enable(firefox, tab);

  expect(await blockedEvents(tab)).toEqual([]);
});


test("text can be selected again", async ({ firefox }) => {
  const tab = await firefox.openTab("http://restricted.test/");

  // The page turns selection off on <body>; its children inherit that.
  const selection = () => tab.evaluate(`
    const text = document.getElementById("text");
    getSelection().selectAllChildren(text);
    return {
      userSelect: getComputedStyle(document.body).userSelect,
      selected: getSelection().toString().trim()
    };
  `);

  expect(await selection()).toEqual({ userSelect: "none", selected: "" });

  await enable(firefox, tab);

  expect(await selection()).toEqual({ userSelect: "auto", selected: "Protected text" });
});


test("inline handlers on the page are removed", async ({ firefox }) => {
  const tab = await firefox.openTab("http://restricted.test/");

  await enable(firefox, tab);

  expect(await tab.evaluate(`
    return ["oncontextmenu", "oncopy"].filter((name) => document.body.hasAttribute(name));
  `)).toEqual([]);
});


test("frames on the page are enabled too", async ({ firefox }) => {
  const tab = await firefox.openTab("http://restricted.test/");

  await enable(firefox, tab);

  await expect.poll(() => isEnabled(tab, "frames[0]")).toBe(true);

  expect(await blockedEvents(tab, "frames[0]")).toEqual([]);
});


test("the top frame announces the change once and the badge shows ON", async ({ firefox }) => {
  const tab = await firefox.openTab("http://restricted.test/");

  const announcements = () => tab.evaluate(`
    return [window, frames[0]].map((view) => {
      return [...view.document.querySelectorAll("[role=status]")]
        .map((element) => element.textContent);
    });
  `);

  await enable(firefox, tab);

  await expect.poll(announcements).toEqual([["Copy and right click enabled."], []]);

  expect(await actionState(firefox, tab)).toEqual({
    badge: "ON",
    title: "Enable Copy and Right Click: Active"
  });

  // A second click leaves the already enabled page as it is.
  await firefox.clickAction(tab);

  await expect.poll(() => tab.evaluate(`
    return document.querySelectorAll("#enable-copy-right-click-style").length;
  `)).toBe(1);

  // The announcement removes itself after 1.5 seconds.
  await expect.poll(announcements).toEqual([[], []]);
});


test("reloading the page restores the page's own rules", async ({ firefox }) => {
  const tab = await firefox.openTab("http://restricted.test/");

  await enable(firefox, tab);

  // The page can go away before the evaluation returns.
  await tab.evaluate("location.reload();").catch(() => {});

  await expect.poll(() => {
    return blockedEvents(tab).catch(() => null);
  }).toEqual(BLOCKED_EVENTS);
});


test("reloading the page resets the badge", async ({ firefox }) => {
  const tab = await firefox.openTab("http://restricted.test/");

  await enable(firefox, tab);

  expect((await actionState(firefox, tab)).badge).toBe("ON");

  // The page can go away before the evaluation returns.
  await tab.evaluate("location.reload();").catch(() => {});

  await expect.poll(() => {
    return blockedEvents(tab).catch(() => null);
  }).toEqual(BLOCKED_EVENTS);

  await expect.poll(() => actionState(firefox, tab)).toEqual({
    badge: "",
    title: "Enable Copy and Right Click"
  });
});


/*
 * Firefox for Android has no extension keyboard shortcuts, so the
 * background must start without browser.commands; the toolbar tests
 * above show it does.
 */
test("there is no keyboard shortcut API", async ({ firefox }) => {
  expect(await firefox.inBackground("return typeof browser.commands;"))
    .toBe("undefined");
});
