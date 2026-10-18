import path from "node:path";

import {
  test,
  expect
} from "../../../test-support/firefox-android.js";


test.use({
  extensionPath: path.resolve(__dirname, "../..")
});


const EXAMPLE_ORIGINS = [
  "http://example.test/*",
  "https://example.test/*",
  "http://*.example.test/*",
  "https://*.example.test/*"
];


test.beforeEach(async ({ firefox }) => {
  const page = "<p id=\"text\">Text</p>";

  firefox.pages.route({
    "http://example.test/": page,
    "http://www.sub.example.test/": page,
    "http://other.test/": page
  });
});


function storeSites(firefox, sites) {
  return firefox.inBackground(`
    await browser.storage.local.set({ automaticSites: ${JSON.stringify(sites)} });
  `);
}


function storedSites(firefox) {
  return firefox.inBackground(`
    return (await browser.storage.local.get("automaticSites")).automaticSites ?? null;
  `);
}


function listedSites(options) {
  return options.evaluate(`
    return [...document.querySelectorAll("#site-list li")]
      .map((item) => item.textContent);
  `);
}


function message(options) {
  return options.evaluate(`return document.getElementById("message").textContent;`);
}


async function isEnabled(firefox, url) {
  const tab = await firefox.openTab(url);

  return tab.evaluate(`
    return document.documentElement.hasAttribute("data-enable-copy-right-click");
  `);
}


test("the options page starts with an empty list", async ({ firefox }) => {
  const options = await firefox.openExtensionTab("options/options.html");

  expect(await options.evaluate(`
    return {
      empty: document.getElementById("empty-state").hidden,
      list: document.getElementById("site-list").hidden
    };
  `)).toEqual({ empty: false, list: true });
});


test("a stored site is listed, marked until its permission is granted", async ({ firefox }) => {
  await storeSites(firefox, ["example.test"]);

  const before = await firefox.openExtensionTab("options/options.html");

  await expect.poll(() => listedSites(before)).toEqual([
    "example.test (permission removed)Remove"
  ]);

  await firefox.grantOrigins(EXAMPLE_ORIGINS);

  // The page lists the sites once, when it opens.
  const after = await firefox.openExtensionTab("options/options.html");

  await expect.poll(() => listedSites(after)).toEqual(["example.testRemove"]);
});


/*
 * Firefox lets permissions.request() run only from a real tap, which
 * the test cannot make. The test grants the site as accepting the
 * prompt does, and the page's request resolves as the prompt would.
 */
test("a site added on the options page is stored and listed", async ({ firefox }) => {
  const options = await firefox.openExtensionTab("options/options.html");

  await firefox.grantOrigins(EXAMPLE_ORIGINS);

  await options.evaluate(`
    chrome.permissions.request = async () => true;

    document.getElementById("site-input").value = "https://www.Example.test/page";
    document.getElementById("site-form").requestSubmit();
  `);

  await expect.poll(() => message(options)).not.toBe("");

  expect(await message(options)).toBe("example.test added.");
  expect(await listedSites(options)).toEqual(["example.testRemove"]);
  expect(await storedSites(firefox)).toEqual(["example.test"]);
});


test("a site with granted access is enabled on every visit, subdomains included", async ({ firefox }) => {
  await firefox.grantOrigins(EXAMPLE_ORIGINS);
  await storeSites(firefox, ["example.test"]);

  await expect.poll(() => firefox.inBackground(`
    return (await browser.scripting.getRegisteredContentScripts())
      .flatMap((script) => script.matches);
  `), { timeout: 5000 }).toHaveLength(EXAMPLE_ORIGINS.length);

  expect(await isEnabled(firefox, "http://example.test/")).toBe(true);
  expect(await isEnabled(firefox, "http://www.sub.example.test/")).toBe(true);
  expect(await isEnabled(firefox, "http://other.test/")).toBe(false);
});
