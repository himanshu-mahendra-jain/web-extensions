import path from "node:path";

import { test, expect } from "../../../test-support/firefox-desktop.js";


test.use({
  extensionPath: path.resolve(__dirname, "../..")
});


/*
 * The Firefox package in desktop Firefox. Desktop Firefox clears a
 * tab's badge and title when it loads a page, as Chrome and Edge do,
 * so the package leaves that to it and only listens to page loads in
 * Firefox for Android, which keeps them (tests/android/enable.spec.js).
 */

const BLOCKING_PAGE = `<!DOCTYPE html>
<p>Protected text</p>
<script>
  document.addEventListener("contextmenu", (event) => event.preventDefault());
</script>`;


test.beforeAll(({ firefox }) => {
  firefox.pages.route({
    "/protected": BLOCKING_PAGE,
    "/other": "<!DOCTYPE html><p>Another page</p>"
  });
});


function actionState(firefox, tabId) {
  return firefox.inBackground(`
    return {
      badge: await browser.action.getBadgeText({ tabId: ${tabId} }),
      title: await browser.action.getTitle({ tabId: ${tabId} })
    };
  `);
}


test("desktop Firefox clears a tab's badge, title and colour when it loads a page", async ({ firefox }) => {
  const { origin } = firefox.pages;
  const tabId = await firefox.load(`${origin}/other`);

  const state = () => firefox.inBackground(`
    return {
      badge: await browser.action.getBadgeText({ tabId: ${tabId} }),
      title: await browser.action.getTitle({ tabId: ${tabId} }),
      color: await browser.action.getBadgeBackgroundColor({ tabId: ${tabId} })
    };
  `);

  const initial = await state();

  await firefox.inBackground(`
    await browser.action.setBadgeText({ tabId: ${tabId}, text: "SET" });
    await browser.action.setTitle({ tabId: ${tabId}, title: "Set for this tab" });
    await browser.action.setBadgeBackgroundColor({ tabId: ${tabId}, color: "#00ff00" });
  `);

  expect(await state()).toEqual({ badge: "SET", title: "Set for this tab", color: [0, 255, 0, 255] });

  await firefox.load(`${origin}/protected`, tabId);

  expect(await state()).toEqual(initial);
});


test("a tab turned on shows ON until it loads another page", async ({ firefox }) => {
  const { origin } = firefox.pages;
  const tabId = await firefox.load(`${origin}/protected`);

  await firefox.clickAction();

  await expect.poll(() => actionState(firefox, tabId)).toEqual({
    badge: "ON",
    title: "Enable Copy and Right Click: Active"
  });

  await firefox.load(`${origin}/other`, tabId);

  expect(await actionState(firefox, tabId)).toEqual({
    badge: "",
    title: "Enable Copy and Right Click"
  });
});


test("page loads do not wake the background page", async ({ firefox }) => {
  expect(await firefox.wakingEvents()).toEqual({
    browserAction: ["onClicked"],
    commands: ["onCommand"],
    permissions: ["onAdded", "onRemoved"],
    runtime: ["onInstalled", "onStartup"],
    storage: ["onChanged"]
  });
});
