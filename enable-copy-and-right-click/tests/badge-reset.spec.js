import { test, expect } from "@playwright/test";

import { openHarness } from "./fake-chrome.js";


/*
 * A tab turned on shows as off again once it loads another page. Firefox
 * for Android keeps the badge and title, so the Firefox package resets
 * them there; Chrome, Edge and desktop Firefox clear both by themselves,
 * which enable.spec.js and firefox/badge.spec.js check, so nothing
 * listens to page loads there.
 */

const FIREFOX_ANDROID = "Mozilla/5.0 (Android 14; Mobile; rv:153.0) Gecko/153.0 Firefox/153.0";


async function loadBackground(page, options) {
  await openHarness(page, options);

  await page.evaluate(() => import("/src/background.js"));
}


// Fires listeners with args, then lets what they started finish.
function fire(page, event, ...args) {
  return page.evaluate(async ({ event, args }) => {
    for (const listener of window.fake[event].list) {
      listener(...args);
    }

    // The fake APIs settle in microtasks, so one macrotask is enough.
    await new Promise((resolve) => setTimeout(resolve));
  }, { event, args });
}


function calls(page) {
  return page.evaluate(() => ({ badges: window.fake.badges, titles: window.fake.titles }));
}


test.describe("in Firefox for Android", () => {
  test.use({ userAgent: FIREFOX_ANDROID });


  test("a tab turned on is reset once when it loads a page", async ({ page }) => {
    await loadBackground(page, { firefox: true });

    await fire(page, "onClicked", { id: 7 });
    await fire(page, "onUpdated", 7, { status: "loading" });
    await fire(page, "onUpdated", 7, { status: "complete" });
    await fire(page, "onUpdated", 7, { status: "loading" });

    expect(await calls(page)).toEqual({
      badges: [{ tabId: 7, text: "ON" }, { tabId: 7, text: "" }],
      titles: [
        { tabId: 7, title: "Enable Copy and Right Click: Active" },
        { tabId: 7, title: "Enable Copy and Right Click" }
      ]
    });
  });


  test("a tab never turned on loads pages without a call", async ({ page }) => {
    await loadBackground(page, { firefox: true });

    await fire(page, "onClicked", { id: 7 });
    await fire(page, "onUpdated", 8, { status: "loading" });

    expect(await calls(page)).toEqual({
      badges: [{ tabId: 7, text: "ON" }],
      titles: [{ tabId: 7, title: "Enable Copy and Right Click: Active" }]
    });
  });
});


test("in desktop Firefox, page loads are not listened to and nothing is kept", async ({ page }) => {
  await loadBackground(page, { firefox: true });

  await fire(page, "onClicked", { id: 7 });

  expect(await page.evaluate(() => window.fake.onUpdated.list.length)).toBe(0);
  expect(await page.evaluate(() => window.fake.session)).toEqual({});
});


test("in Chrome and Edge, page loads are not listened to", async ({ page }) => {
  await loadBackground(page);

  expect(await page.evaluate(() => window.fake.onUpdated.list.length)).toBe(0);
});
