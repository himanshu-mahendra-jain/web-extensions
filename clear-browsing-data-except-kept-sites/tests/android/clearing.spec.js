import path from "node:path";

import {
  test,
  expect
} from "../../../test-support/firefox-android.js";


test.use({
  extensionPath: path.resolve(__dirname, "../..")
});


const KEPT_SITES = ["kept.test", "mail.parent.test"];

// The cookies of clearing.spec.js, set with cookies.set(), which needs a URL.
const KEPT_COOKIES = [
  { name: "host-only", value: "1", url: "http://kept.test/" },
  { name: "domain-wide", value: "1", url: "http://kept.test/", domain: "kept.test" },
  { name: "subdomain", value: "1", url: "http://www.kept.test/" },
  // Sent to the kept mail.parent.test, so it may hold its login.
  { name: "parent-domain", value: "1", url: "http://parent.test/", domain: "parent.test" },
  { name: "secure", value: "1", url: "https://mail.parent.test/", secure: true }
];

const UNKEPT_COOKIES = [
  { name: "other-host", value: "1", url: "http://other.test/" },
  { name: "other-domain", value: "1", url: "http://other.test/", domain: "other.test" },
  { name: "other-secure-path", value: "1", url: "https://other.test/account", path: "/account", secure: true },
  { name: "look-alike", value: "1", url: "http://notkept.test/" },
  { name: "sibling", value: "1", url: "http://drive.parent.test/" }
];


function names(cookies) {
  return cookies.map((cookie) => cookie.name).sort();
}


function cookieNames(firefox) {
  return firefox.inBackground(`
    return (await browser.cookies.getAll({})).map((cookie) => cookie.name).sort();
  `);
}


function stored(firefox, key) {
  return firefox.inBackground(`
    return (await browser.storage.local.get(${JSON.stringify(key)}))[${JSON.stringify(key)}] ?? null;
  `);
}


test.beforeEach(async ({ firefox }) => {
  await firefox.inBackground(`
    for (const cookie of ${JSON.stringify([...KEPT_COOKIES, ...UNKEPT_COOKIES])}) {
      await browser.cookies.set(cookie);
    }
  `);

  expect(await cookieNames(firefox)).toHaveLength(10);
});


function openOptions(firefox) {
  return firefox.openExtensionTab("options/options.html");
}


function text(tab, selector) {
  return tab.evaluate(`
    return document.querySelector(${JSON.stringify(selector)}).textContent.trim();
  `);
}


async function keepSite(options, value) {
  await options.evaluate(`
    document.getElementById("site-input").value = ${JSON.stringify(value)};
    document.getElementById("site-form").requestSubmit();
  `);

  await expect.poll(() => options.evaluate(`
    return document.getElementById("site-input").disabled;
  `)).toBe(false);
}


function listedSites(options) {
  return options.evaluate(`
    return [...document.querySelectorAll("#site-list li")].map((item) => item.textContent);
  `);
}


test("the background script runs without errors", async ({ firefox }) => {
  expect(await firefox.extensionErrors()).toEqual([]);
});


test("the toolbar button opens the settings page", async ({ firefox }) => {
  firefox.pages.route({ "http://start.test/": "<p>Start</p>" });

  const tab = await firefox.openTab("http://start.test/");

  await firefox.clickAction(tab);

  await expect.poll(async () => {
    return (await firefox.tabs()).map((open) => new URL(open.url).pathname);
  }).toContain("/options/options.html");
});


test("site access is granted at install, so no warning is shown", async ({ firefox }) => {
  const options = await openOptions(firefox);

  await expect.poll(() => options.evaluate(`
    return document.getElementById("access-warning").hidden;
  `)).toBe(true);
});


// Firefox can clear site data only of the sites it names.
test("Clear Leftovers is not offered", async ({ firefox }) => {
  const options = await openOptions(firefox);

  await expect.poll(() => options.evaluate(`
    return document.getElementById("leftovers").hidden;
  `)).toBe(true);
});


test("sites are kept as their domains, in order", async ({ firefox }) => {
  const options = await openOptions(firefox);

  await keepSite(options, "  https://www.Example.COM/inbox?x=1 ");

  expect(await text(options, "#message")).toBe("example.com kept.");

  await keepSite(options, "a.test");

  expect(await listedSites(options)).toEqual(["a.testRemove", "example.comRemove"]);
  expect(await stored(firefox, "keptSites")).toEqual(["a.test", "example.com"]);
});


test("clearing on startup is off by default and turns on after a warning", async ({ firefox }) => {
  const options = await openOptions(firefox);

  expect(await options.evaluate(`
    return [
      document.getElementById("clear-on-startup").checked,
      document.getElementById("clearing-off").hidden,
      // Firefox for Android clears no history, so the notice does not name it.
      document.getElementById("clearing-off-text").textContent
    ];
  `)).toEqual([
    false,
    false,
    "Nothing is deleted yet. Add the sites you want to stay signed in to, then turn clearing on. From then on, each time the browser starts, the cookies and site data of every other site are deleted."
  ]);

  await options.evaluate(`document.getElementById("turn-on").click();`);

  await expect.poll(() => options.evaluate(`
    return document.getElementById("confirm-dialog").open;
  `)).toBe(true);

  // The warning does not name history either.
  expect(await text(options, "#confirm-warning")).toMatch(
    /^You have not selected any sites to keep\. Each time the browser starts, all cookies and site data will be deleted, and you will be signed out of every site\.Deleted cookies and site data cannot be recovered\.$/
  );
  expect(await stored(firefox, "clearOnStartup")).toBeNull();

  await options.evaluate(`document.getElementById("confirm-action").click();`);

  await expect.poll(() => stored(firefox, "clearOnStartup")).toBe(true);

  expect(await options.evaluate(`
    return [
      document.getElementById("confirm-dialog").open,
      document.getElementById("clearing-off").hidden
    ];
  `)).toEqual([false, true]);
});


test("with no kept sites, Clear Now warns first and does nothing when canceled", async ({ firefox }) => {
  const options = await openOptions(firefox);

  await options.evaluate(`document.getElementById("clear-now").click();`);

  await expect.poll(() => options.evaluate(`
    return document.getElementById("confirm-dialog").open;
  `)).toBe(true);

  // Firefox for Android clears no history, so the warning does not name it.
  expect(await text(options, "#confirm-warning")).toBe(
    "You have not selected any sites to keep, so the cookies and site data of every site will be deleted now, and you will be signed out of every site." +
    "Deleted cookies and site data cannot be recovered."
  );

  await options.evaluate(`document.querySelector("#confirm-dialog button[value=cancel]").click();`);

  await expect.poll(() => text(options, "#last-clear")).toBe("Nothing has been cleared yet.");
  expect(await cookieNames(firefox)).toHaveLength(10);
});


// Firefox for Android has no history API, so history is skipped.
test("Clear Now removes the cookies of every site that is not kept", async ({ firefox }) => {
  await firefox.inBackground(`
    await browser.storage.local.set({ keptSites: ${JSON.stringify(KEPT_SITES)} });
  `);

  const options = await openOptions(firefox);

  await options.evaluate(`document.getElementById("clear-now").click();`);

  await expect.poll(() => stored(firefox, "lastClear")).not.toBeNull();

  expect(await cookieNames(firefox)).toEqual(names(KEPT_COOKIES));
  expect(await stored(firefox, "lastClear")).toMatchObject({
    failed: false,
    historySkipped: true,
    siteDataCleared: true
  });

  await expect.poll(() => text(options, "#last-clear")).toMatch(
    /^Last cleared .+: \d+ cookies? deleted, along with site data and cache\. History was skipped because this browser does not let extensions clear it\.$/
  );
});


test("a partitioned cookie of a kept site is kept only under a kept site", async ({ firefox }) => {
  const partitioned = () => firefox.inBackground(`
    return (await browser.cookies.getAll({ partitionKey: {} }))
      .filter((cookie) => cookie.partitionKey)
      .map((cookie) => cookie.name)
      .sort();
  `);

  // As a video from the kept youtube.test sets when embedded in each site.
  await firefox.inBackground(`
    for (const [name, topLevelSite] of [["under-kept", "https://kept.test"], ["under-other", "https://other.test"]]) {
      await browser.cookies.set({
        url: "https://youtube.test/",
        name,
        value: "1",
        secure: true,
        partitionKey: { topLevelSite }
      });
    }

    await browser.storage.local.set({ keptSites: ["kept.test", "youtube.test"] });
  `);

  expect(await partitioned()).toEqual(["under-kept", "under-other"]);

  const options = await openOptions(firefox);

  await options.evaluate(`document.getElementById("clear-now").click();`);

  await expect.poll(() => stored(firefox, "lastClear")).not.toBeNull();

  expect(await partitioned()).toEqual(["under-kept"]);
});


test("Export hands the browser the kept sites as a text file", async ({ firefox }) => {
  await firefox.inBackground(`
    await browser.storage.local.set({ keptSites: ["a.test", "b.test"] });
  `);

  const options = await openOptions(firefox);

  /*
   * Firefox for Android asks where to save the file, and the
   * device's Download folder is the user's own, so the link is
   * caught before the browser sees it.
   */
  await options.evaluate(`
    HTMLAnchorElement.prototype.click = function () {
      window.exported = fetch(this.href)
        .then((response) => response.text())
        .then((text) => ({ name: this.download, text }));
    };

    document.getElementById("export-sites").click();
  `);

  await expect.poll(() => options.evaluate("return window.exported;")).toEqual({
    name: "kept-sites.txt",
    text: "a.test\nb.test\n"
  });
});


test("Import replaces the kept sites after a warning", async ({ firefox }) => {
  await firefox.inBackground(`
    await browser.storage.local.set({ keptSites: ["a.test", "b.test"] });
  `);

  const options = await openOptions(firefox);

  await options.evaluate(`
    const files = new DataTransfer();

    files.items.add(new File(["b.test\\nc.test\\n"], "sites.txt", { type: "text/plain" }));

    const input = document.getElementById("import-file");

    input.files = files.files;
    input.dispatchEvent(new Event("change"));
  `);

  await expect.poll(() => options.evaluate(`
    return document.getElementById("confirm-dialog").open;
  `)).toBe(true);

  // Firefox for Android clears no history, so the warning does not name it.
  expect(await text(options, "#confirm-warning")).toBe(
    "The 2 sites you keep now will be replaced with the 2 sites in sites.txt." +
    "1 site will no longer be kept, and its cookies and site data will be deleted at the next clear."
  );

  await options.evaluate(`document.getElementById("confirm-action").click();`);

  await expect.poll(() => stored(firefox, "keptSites")).toEqual(["b.test", "c.test"]);
  await expect.poll(() => text(options, "#transfer-status")).toBe("2 sites imported from sites.txt.");
});


test("Clear Now clears the site data of sites that are not kept", async ({ firefox }) => {
  const urls = ["http://kept.test/", "http://other.test/"];

  firefox.pages.route(Object.fromEntries(
    urls.flatMap((url) => [[url, "<p>Site</p>"], [`${url}check`, "<p>Check</p>"]])
  ));

  // A second tab on a URL that is already open does not load, so this reads another page of the site.
  async function saved(url) {
    const tab = await firefox.openTab(`${url}check`);

    return tab.evaluate(`
      return [
        localStorage.getItem("saved"),
        (await indexedDB.databases()).map((database) => database.name)
      ];
    `);
  }

  for (const url of urls) {
    const tab = await firefox.openTab(url);

    await tab.evaluate(`
      localStorage.setItem("saved", "1");

      await new Promise((resolve, reject) => {
        const request = indexedDB.open("saved-db");

        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    `);
  }

  await firefox.inBackground(`
    await browser.storage.local.set({ keptSites: ${JSON.stringify(KEPT_SITES)} });
  `);

  const options = await openOptions(firefox);

  await options.evaluate(`document.getElementById("clear-now").click();`);

  await expect.poll(() => text(options, "#last-clear")).toContain("along with site data and cache");

  // Without history, other.test is found through its cookies and open tab.
  expect(await saved("http://other.test/")).toEqual([null, []]);
  expect(await saved("http://kept.test/")).toEqual(["1", ["saved-db"]]);
});


/*
 * Firefox clears the service workers of a host's subdomains with
 * it, so a site with a kept subdomain is left out of that clear.
 */
test("a kept subdomain keeps its site data when its parent site is cleared", async ({ firefox }) => {
  const urls = ["http://mail.parent.test/", "http://parent.test/"];

  firefox.pages.route(Object.fromEntries(urls.flatMap((url) => [
    [url, "<p>Site</p>"],
    [`${url}before`, "<p>Before</p>"],
    [`${url}after`, "<p>After</p>"],
    [`${url}worker.js`, { headers: { "content-type": "text/javascript" }, body: "" }]
  ])));

  // Removes what an earlier run left, as no reset between tests clears site data.
  function forgetParentTest() {
    return firefox.inParent(`
      await new Promise((resolve) => Services.clearData.deleteDataFromSite(
        "parent.test", {}, true, Ci.nsIClearDataService.CLEAR_ALL, resolve
      ));
    `);
  }

  await forgetParentTest();

  // Service workers need a secure context, which these http:// test pages are not.
  await firefox.inParent("Services.prefs.setBoolPref('dom.serviceWorkers.testing.enabled', true);");

  // Each read opens another page of the site, as a second tab on an open URL does not load.
  async function saved(url, page = "after") {
    const tab = await firefox.openTab(`${url}${page}`);

    return tab.evaluate(`
      return [
        localStorage.getItem("saved"),
        (await indexedDB.databases()).map((database) => database.name),
        (await navigator.serviceWorker.getRegistrations()).length
      ];
    `);
  }

  try {
    for (const url of urls) {
      const tab = await firefox.openTab(url);

      await tab.evaluate(`
        localStorage.setItem("saved", "1");

        await new Promise((resolve, reject) => {
          const request = indexedDB.open("saved-db");

          request.onsuccess = () => {
            request.result.close();
            resolve();
          };
          request.onerror = () => reject(request.error);
        });

        await navigator.serviceWorker.register("worker.js");
      `);
    }

    expect(await saved("http://mail.parent.test/", "before")).toEqual(["1", ["saved-db"], 1]);

    await firefox.inBackground(`
      await browser.storage.local.set({ keptSites: ${JSON.stringify(KEPT_SITES)} });
    `);

    const options = await openOptions(firefox);

    await options.evaluate(`document.getElementById("clear-now").click();`);

    await expect.poll(() => text(options, "#last-clear")).toContain("along with site data and cache");

    expect(await saved("http://mail.parent.test/")).toEqual(["1", ["saved-db"], 1]);
    // parent.test is found through its open tab, and is not kept.
    expect(await saved("http://parent.test/")).toEqual([null, [], 1]);
  } finally {
    await firefox.inParent(`
      Services.prefs.clearUserPref("dom.serviceWorkers.testing.enabled");
    `);

    await forgetParentTest();
  }
});
