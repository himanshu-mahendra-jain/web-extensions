import path from "node:path";

import {
  test,
  expect,
  routePages
} from "../../test-support/extension.js";


test.use({
  extensionPath: path.resolve(__dirname, "..")
});


const KEPT_SITES = ["kept.test", "mail.parent.test"];

const KEPT_HISTORY = [
  "http://kept.test/inbox",
  "http://www.kept.test/",
  "https://mail.parent.test/"
];

const UNKEPT_HISTORY = [
  "http://other.test/page",
  "http://notkept.test/",
  "http://drive.parent.test/"
];

const KEPT_COOKIES = [
  { name: "host-only", value: "1", url: "http://kept.test/" },
  { name: "domain-wide", value: "1", domain: ".kept.test", path: "/" },
  { name: "subdomain", value: "1", url: "http://www.kept.test/" },
  // Sent to the kept mail.parent.test, so it may hold its login.
  { name: "parent-domain", value: "1", domain: ".parent.test", path: "/" },
  { name: "secure", value: "1", url: "https://mail.parent.test/", secure: true }
];

const UNKEPT_COOKIES = [
  { name: "other-host", value: "1", url: "http://other.test/" },
  { name: "other-domain", value: "1", domain: ".other.test", path: "/" },
  { name: "other-secure-path", value: "1", url: "https://other.test/account", secure: true },
  { name: "look-alike", value: "1", url: "http://notkept.test/" },
  { name: "sibling", value: "1", url: "http://drive.parent.test/" }
];


function historyUrls(serviceWorker) {
  return serviceWorker.evaluate(async () => {
    return (await chrome.history.search({ text: "", startTime: 0, maxResults: 100 }))
      .map((item) => item.url)
      .sort();
  });
}


test.beforeEach(async ({ context, serviceWorker, extensionId }) => {
  /*
   * The settings page opened on install is in history too, and is
   * cleared like any site that is not kept. Wait for it so the
   * counts below do not depend on when it loaded.
   */
  await expect.poll(() => historyUrls(serviceWorker)).toContain(
    `chrome-extension://${extensionId}/options/options.html`
  );

  await serviceWorker.evaluate(async (urls) => {
    for (const url of urls) {
      await chrome.history.addUrl({ url });
    }
  }, [...KEPT_HISTORY, ...UNKEPT_HISTORY]);

  await context.addCookies([...KEPT_COOKIES, ...UNKEPT_COOKIES]);
});


async function cookieNames(context) {
  return (await context.cookies()).map((cookie) => cookie.name).sort();
}


function names(cookies) {
  return cookies.map((cookie) => cookie.name).sort();
}


test("Clear Now removes history and cookies of every site that is not kept", async ({ context, serviceWorker, openExtensionPage }) => {
  await serviceWorker.evaluate((keptSites) => {
    return chrome.storage.local.set({ keptSites });
  }, KEPT_SITES);

  const options = await openExtensionPage("options/options.html");

  await options.getByRole("button", { name: "Clear Now" }).click();

  await expect(options.locator("#last-clear")).toHaveText(
    /^Last cleared .+: 4 history entries and 5 cookies deleted, along with site data and cache\.$/
  );

  expect(await historyUrls(serviceWorker)).toEqual([...KEPT_HISTORY].sort());
  expect(await cookieNames(context)).toEqual(names(KEPT_COOKIES));

  expect(
    await serviceWorker.evaluate(async () => {
      return (await chrome.storage.local.get("lastClear")).lastClear;
    })
  ).toEqual({
    time: expect.any(Number),
    historyRemoved: 4,
    historySkipped: false,
    cookiesRemoved: 5,
    cookiesSkipped: false,
    siteDataCleared: true,
    siteDataSkipped: false,
    leftoversCleared: false,
    failed: false
  });
});


test("Clear Now clears the site data of every site that is not kept", async ({ context, serviceWorker, openExtensionPage }) => {
  const urls = ["http://kept.test/", "http://old.kept.test/", "http://other.test/page"];

  await routePages(context, Object.fromEntries(urls.map((url) => [url, "<p>Site</p>"])));

  const tab = await context.newPage();

  for (const url of urls) {
    await tab.goto(url);
    await tab.evaluate(() => {
      localStorage.setItem("saved", "1");

      return new Promise((resolve, reject) => {
        const request = indexedDB.open("saved-db");

        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    });
  }

  await tab.goto("about:blank");

  // A kept subdomain whose history has expired is still kept.
  await serviceWorker.evaluate(() => chrome.history.deleteUrl({ url: "http://old.kept.test/" }));

  await serviceWorker.evaluate((keptSites) => {
    return chrome.storage.local.set({ keptSites });
  }, KEPT_SITES);

  const options = await openExtensionPage("options/options.html");

  await options.getByRole("button", { name: "Clear Now" }).click();
  await expect(options.locator("#last-clear")).toContainText("along with site data and cache");

  const saved = {};

  for (const url of urls) {
    await tab.goto(url);

    saved[url] = await tab.evaluate(async () => [
      localStorage.getItem("saved"),
      (await indexedDB.databases()).map((database) => database.name)
    ]);
  }

  expect(saved).toEqual({
    "http://kept.test/": ["1", ["saved-db"]],
    "http://old.kept.test/": ["1", ["saved-db"]],
    "http://other.test/page": [null, []]
  });
});


test("Clear Leftovers clears the site data of sites that nothing names any more", async ({ context, serviceWorker, openExtensionPage }) => {
  const urls = ["http://kept.test/", "http://old.kept.test/", "http://gone.test/"];

  await routePages(context, Object.fromEntries(urls.map((url) => [url, "<p>Site</p>"])));

  const tab = await context.newPage();

  for (const url of urls) {
    await tab.goto(url);
    await tab.evaluate(() => localStorage.setItem("saved", "1"));
  }

  await tab.goto("about:blank");

  // As after an earlier clear: gone.test is in no history, cookie or tab.
  await serviceWorker.evaluate(async () => {
    await chrome.history.deleteUrl({ url: "http://old.kept.test/" });
    await chrome.history.deleteUrl({ url: "http://gone.test/" });
  });

  await serviceWorker.evaluate((keptSites) => {
    return chrome.storage.local.set({ keptSites });
  }, KEPT_SITES);

  const options = await openExtensionPage("options/options.html");

  await options.getByRole("button", { name: "Clear Leftovers" }).click();
  await options.getByRole("dialog").getByRole("button", { name: "Clear Leftovers" }).click();

  await expect(options.locator("#leftovers-status")).toHaveText("Leftover site data cleared.");
  await expect(options.locator("#last-clear")).toContainText("along with the site data and cache of every site not kept");

  const saved = {};

  for (const url of urls) {
    await tab.goto(url);

    saved[url] = await tab.evaluate(() => localStorage.getItem("saved"));
  }

  // The warning says a kept subdomain that nothing names loses its data.
  expect(saved).toEqual({
    "http://kept.test/": "1",
    "http://old.kept.test/": null,
    "http://gone.test/": null
  });
});


test("a partitioned cookie of a kept site is kept only under a kept site", async ({ serviceWorker, openExtensionPage }) => {
  const partitioned = () => serviceWorker.evaluate(async () => {
    return (await chrome.cookies.getAll({ partitionKey: {} }))
      .filter((cookie) => cookie.partitionKey)
      .map((cookie) => cookie.name)
      .sort();
  });

  // As a video from the kept youtube.test sets when embedded in each site.
  await serviceWorker.evaluate(async () => {
    for (const [name, topLevelSite] of [["under-kept", "https://kept.test"], ["under-other", "https://other.test"]]) {
      await chrome.cookies.set({
        url: "https://youtube.test/",
        name,
        value: "1",
        secure: true,
        sameSite: "no_restriction",
        partitionKey: { topLevelSite }
      });
    }

    await chrome.storage.local.set({ keptSites: ["kept.test", "youtube.test"] });
  });

  expect(await partitioned()).toEqual(["under-kept", "under-other"]);

  const options = await openExtensionPage("options/options.html");

  await options.getByRole("button", { name: "Clear Now" }).click();
  await expect(options.locator("#last-clear")).toContainText("Last cleared");

  expect(await partitioned()).toEqual(["under-kept"]);
});


test.describe("with no kept sites", () => {
  test("Clear Now asks first and does nothing when declined", async ({ context, serviceWorker, openExtensionPage }) => {
    const options = await openExtensionPage("options/options.html");

    const warning = options.getByRole("dialog", { name: "Clear everything now?" });

    await options.getByRole("button", { name: "Clear Now" }).click();

    await expect(warning.locator("p")).toHaveText([
      "You have not selected any sites to keep, so the history, cookies and site data of every site will be deleted now, and you will be signed out of every site.",
      "Deleted history, cookies and site data cannot be recovered."
    ]);

    await warning.getByRole("button", { name: "Cancel" }).click();

    await expect(warning).toBeHidden();
    await expect(options.locator("#last-clear")).toHaveText("Nothing has been cleared yet.");
    expect(await historyUrls(serviceWorker)).toHaveLength(7);
    expect(await cookieNames(context)).toHaveLength(10);
  });


  test("Clear Now clears everything when confirmed", async ({ context, serviceWorker, openExtensionPage }) => {
    const options = await openExtensionPage("options/options.html");

    await options.getByRole("button", { name: "Clear Now" }).click();
    await options.getByRole("dialog").getByRole("button", { name: "Clear Everything" }).click();

    await expect(options.locator("#last-clear")).toHaveText(
      /^Last cleared .+: 7 history entries and 10 cookies deleted, along with site data and cache\.$/
    );
    expect(await historyUrls(serviceWorker)).toEqual([]);
    expect(await cookieNames(context)).toEqual([]);
  });
});


test("installing opens the settings page and the toolbar button reopens it", async ({ context, page, extensionId, triggerAction }) => {
  const optionsUrl = `chrome-extension://${extensionId}/options/options.html`;
  const isOptions = (candidate) => candidate.url() === optionsUrl;

  await expect.poll(() => context.pages().some(isOptions)).toBe(true);

  // An open settings page would only be focused, so close it first.
  for (const options of context.pages().filter(isOptions)) {
    await options.close();
  }

  await routePages(context, { "http://start.test/": "<p>Start</p>" });
  await page.goto("http://start.test/");

  const opened = context.waitForEvent("page", isOptions);

  await triggerAction(page);

  await opened;
});
