import { test, expect } from "@playwright/test";

import { openHarness } from "./fake-chrome.js";


/*
 * The keyboard shortcut handler in background.js against fake APIs. A
 * browser lets a test neither press an extension's shortcut nor fire
 * commands.onCommand, so playback.spec.js only checks the registration.
 */


async function loadBackground(page, options) {
  await openHarness(page, options);

  await page.evaluate(() => import("/src/background.js"));
}


/*
 * Calls every onCommand listener, waits for them, then lets the queued
 * speed change finish. The fake APIs settle in microtasks, so one
 * macrotask is enough. Rejects if a listener throws.
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
  test(`the shortcut changes the speed of the active tab, through ${namespace}`, async ({ page }) => {
    await loadBackground(page, { activeTabs: [{ id: 7 }], playbackRate: 1, firefox });
    await fireCommand(page, "change-playback-speed");

    const { queries, scripts, badges, titles } = await fake(page);

    expect(queries).toEqual([{ active: true, currentWindow: true }]);
    expect(scripts.map(({ tabId, func }) => [tabId, func])).toEqual([
      [7, "getMediaState"],
      [7, "applyPlaybackSpeed"]
    ]);
    expect(scripts[1].args).toEqual([
      1.2,
      { shown: "1.2x", spoken: "Playback speed 1.2 times", lang: "en-US", dir: "ltr" }
    ]);
    expect(badges).toEqual([{ tabId: 7, text: "1.2" }]);
    expect(titles).toEqual([
      { tabId: 7, title: "Playback speed: 1.2x - Change Video Playback Speed" }
    ]);
  });
}


test.describe("in German", () => {
  test.use({ locale: "de-DE" });


  test("the indicator and the tooltip write the speed as the language does", async ({ page }) => {
    await loadBackground(page, { activeTabs: [{ id: 7 }], playbackRate: 1 });
    await fireCommand(page, "change-playback-speed");

    const { scripts, badges, titles } = await fake(page);

    expect(scripts[1].args[1]).toMatchObject({ shown: "1,2x", spoken: "Playback speed 1,2 times", lang: "de-DE" });
    expect(titles[0].title).toBe("Playback speed: 1,2x - Change Video Playback Speed");
    // The badge has room for digits only, as every language reads them.
    expect(badges).toEqual([{ tabId: 7, text: "1.2" }]);
  });
});


test("the shortcut continues from the speed the tab has", async ({ page }) => {
  await loadBackground(page, { activeTabs: [{ id: 3 }], playbackRate: 2 });
  await fireCommand(page, "change-playback-speed");

  // 2x is the last speed, so it cycles back to 1x.
  expect((await fake(page)).badges).toEqual([{ tabId: 3, text: "1" }]);
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
  await fireCommand(page, "change-playback-speed");

  const { queries, scripts, badges } = await fake(page);

  expect(queries).toHaveLength(1);
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
  await fireCommand(page, "change-playback-speed");

  expect((await fake(page)).scripts).toEqual([]);
  expect(errors.join("\n")).toContain("Unable to process playback speed command");
});


// Firefox for Android has no keyboard shortcuts.
test("without a commands API the background still loads", async ({ page }) => {
  await loadBackground(page, { firefox: true, noCommands: true });

  expect((await fake(page)).onClicked.list).toHaveLength(1);
});
