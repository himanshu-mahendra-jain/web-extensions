import path from "node:path";

import {
  test,
  expect
} from "../../../test-support/firefox-android.js";

import { SITE_ORIGINS } from "../../src/site-utils.js";


test.use({
  extensionPath: path.resolve(__dirname, "../..")
});


/*
 * Baseline screenshots of the settings page in Firefox for Android,
 * from settings stored in the installed extension. The last clear is
 * shown in the device's own language and time zone.
 */
const SETTINGS = {
  keptSites: ["github.com", "mail.example.com", "localhost"],
  clearOnStartup: true,
  lastClear: {
    time: Date.UTC(2026, 0, 15, 9, 30),
    historyRemoved: 0,
    historySkipped: true,
    cookiesRemoved: 42,
    cookiesSkipped: false,
    siteDataCleared: true,
    siteDataSkipped: false,
    failed: false
  }
};


async function openSettings(firefox) {
  await firefox.inBackground(`
    await browser.storage.local.set(${JSON.stringify(SETTINGS)});
  `);

  const options = await firefox.showExtensionTab("options/options.html");

  await expect.poll(() => options.evaluate(`
    return document.querySelectorAll("#site-list li").length;
  `)).toBe(3);

  return options;
}


test("with kept sites and the last clear", async ({ firefox }) => {
  const options = await openSettings(firefox);

  expect(await options.screenshot("main")).toMatchSnapshot("kept-sites.png");
});


test("with site access off", async ({ firefox }) => {
  await firefox.inBackground(`
    await browser.permissions.remove({ origins: ${JSON.stringify(SITE_ORIGINS)} });
  `);

  try {
    const options = await openSettings(firefox);

    await expect.poll(() => options.evaluate(`
      return document.getElementById("access-warning").hidden;
    `)).toBe(false);

    // Firefox for Android clears no history, so the warning does not promise it.
    expect(await options.evaluate(`
      return document.getElementById("access-text").textContent;
    `)).toBe("Without access to websites, the extension cannot delete cookies. Site data is still cleared.");

    expect(await options.screenshot("main")).toMatchSnapshot("site-access-off.png");
  } finally {
    // The reset between tests restores only what a test granted.
    await firefox.grantOrigins(SITE_ORIGINS);
  }
});
