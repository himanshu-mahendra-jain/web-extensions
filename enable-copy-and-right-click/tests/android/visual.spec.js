import path from "node:path";

import {
  test,
  expect
} from "../../../test-support/firefox-android.js";

import { getSiteOrigins } from "../../src/site-utils.js";


test.use({
  extensionPath: path.resolve(__dirname, "../..")
});


/*
 * Baseline screenshots of the automatic sites page in Firefox for
 * Android, from sites stored in the installed extension.
 */
async function openAutomaticSites(firefox, sites) {
  await firefox.inBackground(`
    await browser.storage.local.set({ automaticSites: ${JSON.stringify(sites)} });
  `);

  const options = await firefox.showExtensionTab("options/options.html");

  await expect.poll(() => options.evaluate(`
    return document.querySelectorAll("#site-list li").length;
  `)).toBe(sites.length);

  return options;
}


test("with no automatic sites", async ({ firefox }) => {
  const options = await openAutomaticSites(firefox, []);

  expect(await options.screenshot("main")).toMatchSnapshot("empty.png");
});


// news.example.org is stored, but its site access was never granted.
test("with automatic sites, one without site access", async ({ firefox }) => {
  await firefox.grantOrigins(getSiteOrigins("docs.example.com"));

  const options = await openAutomaticSites(firefox, ["docs.example.com", "news.example.org"]);

  await expect.poll(() => options.evaluate(`
    return document.getElementById("site-list").textContent;
  `)).toContain("news.example.org (permission removed)");

  expect(await options.screenshot("main")).toMatchSnapshot("sites.png");
});
