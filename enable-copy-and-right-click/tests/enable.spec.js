import path from "node:path";

import {
  test,
  expect,
  recordLiveRegions,
  routePages
} from "../../test-support/extension.js";


test.use({
  extensionPath: path.resolve(__dirname, ".."),
  actionInjects: true
});


// A page that blocks copying, selection and right click in the usual ways.
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


test.beforeEach(async ({ context }) => {
  await routePages(context, {
    "http://restricted.test/": `<body>${RESTRICTED_BODY}<iframe src="/frame"></iframe></body>`,
    "http://restricted.test/frame": `<body>${RESTRICTED_BODY}</body>`
  });
});


// Event types the page still cancels when they fire on the text.
function blockedEvents(frame) {
  return frame.evaluate((types) => {
    const text = document.getElementById("text");

    return types.filter((type) => {
      return !text.dispatchEvent(
        new Event(type, { bubbles: true, cancelable: true })
      );
    });
  }, BLOCKED_EVENTS);
}


// The page's tab ID. The URL is only visible while activeTab is granted.
async function tabIdOf(serviceWorker, page) {
  const [tab] = await serviceWorker.evaluate((url) => {
    return chrome.tabs.query({ url });
  }, page.url());

  return tab.id;
}


function actionState(serviceWorker, tabId) {
  return serviceWorker.evaluate(async (id) => {
    return {
      badge: await chrome.action.getBadgeText({ tabId: id }),
      title: await chrome.action.getTitle({ tabId: id })
    };
  }, tabId);
}


async function enable(page, clickAction) {
  await clickAction(page);

  await expect(page.locator("html")).toHaveAttribute(
    "data-enable-copy-right-click",
    ""
  );
}


test("the restricted page blocks copying until the toolbar button is clicked", async ({ page, clickAction }) => {
  await page.goto("http://restricted.test/");

  expect(await blockedEvents(page.mainFrame())).toEqual(BLOCKED_EVENTS);

  await enable(page, clickAction);

  expect(await blockedEvents(page.mainFrame())).toEqual([]);
});


test("text can be selected with the mouse again", async ({ page, clickAction }) => {
  await page.goto("http://restricted.test/");

  const selectedText = async () => {
    await page.locator("#text").click({ clickCount: 3 });

    return page.evaluate(() => window.getSelection().toString().trim());
  };

  expect(await selectedText()).toBe("");

  await enable(page, clickAction);

  await expect(page.locator("#text")).toHaveCSS("user-select", "auto");
  expect(await selectedText()).toBe("Protected text");
});


test("inline handlers on the page are removed", async ({ page, clickAction }) => {
  await page.goto("http://restricted.test/");

  await enable(page, clickAction);

  await expect(page.locator("body")).not.toHaveAttribute("oncontextmenu");
  await expect(page.locator("body")).not.toHaveAttribute("oncopy");
});


test("frames on the page are enabled too", async ({ page, clickAction }) => {
  await page.goto("http://restricted.test/");

  await enable(page, clickAction);

  const frame = page.frame({ url: "http://restricted.test/frame" });

  await expect(frame.locator("html")).toHaveAttribute(
    "data-enable-copy-right-click",
    ""
  );

  expect(await blockedEvents(frame)).toEqual([]);
});


test("the top frame announces the change once and the badge shows ON", async ({ page, clickAction, serviceWorker }) => {
  await recordLiveRegions(page);
  await page.goto("http://restricted.test/");

  await enable(page, clickAction);

  const announcement = page.getByRole("status");

  await expect(announcement).toHaveText("Copy and right click enabled.");
  // The text is set after the region is in the page.
  expect(await page.evaluate(() => window.insertedLiveRegions)).toEqual([""]);
  await expect(
    page.frameLocator("iframe").getByRole("status")
  ).toHaveCount(0);

  const tabId = await tabIdOf(serviceWorker, page);

  expect(await actionState(serviceWorker, tabId)).toEqual({
    badge: "ON",
    title: "Enable Copy and Right Click: Active"
  });

  // A second click leaves the already enabled page as it is.
  await clickAction(page);
  await expect.poll(() => page.locator("#enable-copy-right-click-style").count()).toBe(1);

  // The announcement removes itself after 1.5 seconds.
  await expect(announcement).toHaveCount(0);
});


test("reloading the page resets the badge and the page's own rules", async ({ page, clickAction, serviceWorker }) => {
  await page.goto("http://restricted.test/");

  await enable(page, clickAction);

  const tabId = await tabIdOf(serviceWorker, page);

  expect((await actionState(serviceWorker, tabId)).badge).toBe("ON");

  await page.reload();

  expect(await blockedEvents(page.mainFrame())).toEqual(BLOCKED_EVENTS);

  await expect.poll(() => actionState(serviceWorker, tabId)).toEqual({
    badge: "",
    title: "Enable Copy and Right Click"
  });
});


test("the keyboard shortcut is registered as Alt+C", async ({ serviceWorker }) => {
  expect(await serviceWorker.evaluate(() => chrome.commands.getAll()))
    .toContainEqual({
      name: "enable-copy-right-click",
      description: "Enable copy and right click on the current page",
      shortcut: "Alt+C"
    });
});
