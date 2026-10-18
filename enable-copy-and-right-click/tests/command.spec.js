import { test, expect } from "@playwright/test";

import { openHarness } from "./fake-chrome.js";


/*
 * The keyboard shortcut handler in background.js against fake APIs. A
 * browser lets a test neither press an extension's shortcut nor fire
 * commands.onCommand, so enable.spec.js only checks the registration.
 */


async function loadBackground(page, options) {
  await openHarness(page, options);

  await page.evaluate(() => import("/src/background.js"));
}


/*
 * Calls every onCommand listener, waits for them, then lets the queued
 * action finish. The fake APIs settle in microtasks, so one macrotask
 * is enough. Rejects if a listener throws.
 */
function fireCommand(page, command) {
  return page.evaluate(async (command) => {
    await Promise.all(window.fake.onCommand.list.map((listener) => listener(command)));

    await new Promise((resolve) => setTimeout(resolve));
  }, command);
}


function fake(page) {
  return page.evaluate(() => window.fake);
}


for (const [namespace, firefox] of [["chrome", false], ["browser", true]]) {
  test(`the shortcut enables the active tab, through ${namespace}`, async ({ page }) => {
    await loadBackground(page, { activeTabs: [{ id: 7 }], firefox });
    await fireCommand(page, "enable-copy-right-click");

    const { queries, scripts, badges, titles } = await fake(page);

    expect(queries).toEqual([{ active: true, currentWindow: true }]);
    expect(scripts).toEqual([{
      tabId: 7,
      allFrames: true,
      files: ["src/enable.js"]
    }]);
    expect(badges).toEqual([{ tabId: 7, text: "ON" }]);
    expect(titles).toEqual([{
      tabId: 7,
      title: "Enable Copy and Right Click: Active"
    }]);
  });
}


test("the shortcut enables a tab whose id is 0", async ({ page }) => {
  await loadBackground(page, { activeTabs: [{ id: 0 }] });
  await fireCommand(page, "enable-copy-right-click");

  expect((await fake(page)).badges).toEqual([{ tabId: 0, text: "ON" }]);
});


test("another command is ignored", async ({ page }) => {
  await loadBackground(page, { activeTabs: [{ id: 7 }] });
  await fireCommand(page, "some-other-command");

  const { queries, scripts, badges } = await fake(page);

  expect(queries).toEqual([]);
  expect(scripts).toEqual([]);
  expect(badges).toEqual([]);
});


test("the shortcut does nothing when there is no active tab", async ({ page }) => {
  await loadBackground(page, { activeTabs: [] });
  await fireCommand(page, "enable-copy-right-click");

  const { queries, scripts, badges } = await fake(page);

  expect(queries).toHaveLength(1);
  expect(scripts).toEqual([]);
  expect(badges).toEqual([]);
});


test("the shortcut does nothing for a tab without an id", async ({ page }) => {
  await loadBackground(page, { activeTabs: [{}] });
  await fireCommand(page, "enable-copy-right-click");

  const { scripts, badges } = await fake(page);

  expect(scripts).toEqual([]);
  expect(badges).toEqual([]);
});


test("the shortcut survives a tab query that fails", async ({ page }) => {
  const errors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  await loadBackground(page, { activeTabs: [{ id: 7 }], queryFails: true });
  await fireCommand(page, "enable-copy-right-click");

  expect((await fake(page)).scripts).toEqual([]);
  expect(errors.join("\n")).toContain("Keyboard command failed");
});


test("when a frame cannot be scripted, the shortcut enables the top frame", async ({ page }) => {
  const errors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  await loadBackground(page, { activeTabs: [{ id: 7 }], allFramesFails: true });
  await fireCommand(page, "enable-copy-right-click");

  const { scripts, badges, titles } = await fake(page);

  expect(scripts).toEqual([{ tabId: 7, files: ["src/enable.js"] }]);
  expect(badges).toEqual([{ tabId: 7, text: "ON" }]);
  expect(titles).toEqual([{
    tabId: 7,
    title: "Enable Copy and Right Click: Active"
  }]);
  expect(errors.join("\n")).toContain("Could not enable all frames in tab 7");
});


test("a shortcut that reaches no frame leaves the badge off", async ({ page }) => {
  const errors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  await loadBackground(page, { activeTabs: [{ id: 7 }], injectsNothing: true });
  await fireCommand(page, "enable-copy-right-click");

  const { scripts, badges, titles } = await fake(page);

  expect(scripts).toHaveLength(1);
  expect(badges).toEqual([]);
  expect(titles).toEqual([]);
  expect(errors.join("\n")).toContain("The script reached no frame in tab 7");
});


// Firefox for Android has no keyboard shortcuts.
test("without a commands API the background still loads", async ({ page }) => {
  await loadBackground(page, { firefox: true, noCommands: true });

  expect((await fake(page)).onClicked.list).toHaveLength(1);
});
