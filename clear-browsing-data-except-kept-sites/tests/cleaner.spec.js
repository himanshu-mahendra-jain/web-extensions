import { test, expect } from "@playwright/test";

import { openHarness } from "./fake-chrome.js";


/*
 * cleaner.js against fake browser data, for what a real profile cannot
 * set up: thousands of history entries with chosen visit times, and
 * Firefox's cookie stores, containers and first-party domains.
 */


const NOW = Date.now();


function cookie(name, domain, { path = "/", secure = false, storeId = "0", ...rest } = {}) {
  return { name, value: "1", domain, path, secure, storeId, ...rest };
}


test.describe("clearHistory", () => {
  test("finds unkept entries older than a full page of kept ones", async ({ page }) => {
    // 2500 kept visits in the last hour, hiding older visits from the first searches.
    const kept = Array.from({ length: 2500 }, (_, index) => ({
      url: `https://kept.test/page-${index}`,
      time: NOW - 1000 - index
    }));

    // Unkept visits from last week, plus a few among the kept ones.
    const unkept = [
      ...Array.from({ length: 300 }, (_, index) => ({
        url: `https://other.test/old-${index}`,
        time: NOW - 7 * 24 * 60 * 60 * 1000 - index
      })),
      ...[10, 1200, 2400].map((offset) => ({
        url: `https://other.test/recent-${offset}`,
        time: NOW - 1000 - offset - 0.5
      }))
    ];

    await openHarness(page, { history: [...kept, ...unkept] });

    const removed = await page.evaluate(async () => {
      const { clearHistory } = await import("/src/cleaner.js");
      return clearHistory(["kept.test"]);
    });

    expect(removed).toBe(303);

    const remaining = await page.evaluate(() => window.fake.remainingHistory());

    expect(remaining).toHaveLength(2500);
    expect(remaining.every((url) => url.startsWith("https://kept.test/"))).toBe(true);
  });


  test("20,000 entries against 200 kept sites are each looked at and removed once", async ({ page }) => {
    const sites = Array.from({ length: 200 }, (_, index) => `site-${index}.test`);

    // Every other visit is to a kept site or its subdomain, the rest to look-alikes.
    const history = Array.from({ length: 20000 }, (_, index) => {
      const site = sites[index % 200];
      const url = index % 2 === 0
        ? `https://${index % 4 === 0 ? "www." : ""}${site}/page-${index}`
        : `https://not${site}/page-${index}`;

      return { url, time: NOW - 1000 - index };
    });

    await openHarness(page, { history });

    const removed = await page.evaluate(async (keptSites) => {
      const { clearHistory } = await import("/src/cleaner.js");
      return clearHistory(keptSites);
    }, sites);

    const { searches, deletedUrls } = await page.evaluate(() => window.fake);

    expect(removed).toBe(10000);
    expect(deletedUrls).toHaveLength(10000);
    expect(new Set(deletedUrls).size).toBe(10000);
    expect(deletedUrls.every((url) => url.startsWith("https://notsite-"))).toBe(true);
    /*
     * Each search returns the kept entries above the next unkept ones again, about 150
     * searches here. The ranges split where the clock puts them, so the count moves a
     * little between runs; a paging change that searches far more shows here.
     */
    expect(searches).toBeLessThan(200);
    expect(await page.evaluate(() => window.fake.remainingHistory().length)).toBe(10000);
  });


  test("stops when nothing in history is left to remove", async ({ page }) => {
    await openHarness(page, {
      history: [{ url: "https://kept.test/", time: NOW - 1000 }]
    });

    const result = await page.evaluate(async () => {
      const { clearHistory } = await import("/src/cleaner.js");
      return { removed: await clearHistory(["kept.test"]), searches: window.fake.searches };
    });

    expect(result).toEqual({ removed: 0, searches: 1 });
  });
});


test.describe("clearCookies in Chromium", () => {
  test("reads every store, keeps kept sites and removes the rest by URL and partition", async ({ page }) => {
    const partitionKey = { topLevelSite: "https://top.test" };

    await openHarness(page, {
      cookieStores: [{ id: "0" }, { id: "1" }],
      cookies: [
        cookie("kept", "kept.test"),
        cookie("parent", ".parent.test"),
        cookie("plain", ".other.test"),
        cookie("secure", "shop.test", { path: "/account", secure: true, storeId: "1" }),
        cookie("partitioned", "widget.test", { secure: true, partitionKey }),
        // A kept site embedded in a site that is not kept.
        cookie("embedded", ".kept.test", { secure: true, partitionKey }),
        cookie("embedded-in-kept", ".kept.test", {
          secure: true,
          partitionKey: { topLevelSite: "https://www.kept.test" }
        }),
        // Partitioned under the site of the kept mail.parent.test.
        cookie("embedded-in-parent", ".kept.test", {
          secure: true,
          partitionKey: { topLevelSite: "https://parent.test" }
        })
      ]
    });

    const result = await page.evaluate(async () => {
      const { clearCookies } = await import("/src/cleaner.js");

      return {
        removed: await clearCookies(["kept.test", "mail.parent.test"]),
        queries: window.fake.cookieQueries,
        removedCookies: window.fake.removedCookies
      };
    });

    expect(result.removed).toBe(4);

    expect(result.queries).toEqual([
      { storeId: "0", partitionKey: {} },
      { storeId: "1", partitionKey: {} }
    ]);

    expect(result.removedCookies).toEqual([
      { url: "http://other.test/", name: "plain", storeId: "0" },
      { url: "https://widget.test/", name: "partitioned", storeId: "0", partitionKey },
      { url: "https://kept.test/", name: "embedded", storeId: "0", partitionKey },
      { url: "https://shop.test/account", name: "secure", storeId: "1" }
    ]);
  });


  test("a cookie that cannot be removed is not counted and the rest still go", async ({ page }) => {
    await openHarness(page, {
      cookies: [cookie("stuck", ".other.test"), cookie("loose", ".other.test")],
      unremovableCookies: ["stuck"]
    });

    const result = await page.evaluate(async () => {
      const { clearCookies } = await import("/src/cleaner.js");

      return {
        removed: await clearCookies([]),
        names: window.fake.removedCookies.map((details) => details.name)
      };
    });

    expect(result).toEqual({ removed: 1, names: ["loose"] });
  });
});


test.describe("clearCookies in Firefox", () => {
  test("clears the default store, open stores and every container, by first-party domain", async ({ page }) => {
    await openHarness(page, {
      firefox: true,
      // Only stores with an open tab are listed; the default one is not.
      cookieStores: [{ id: "firefox-private" }],
      containers: [{ cookieStoreId: "firefox-container-1" }],
      cookies: [
        cookie("default", ".other.test", { storeId: "firefox-default", firstPartyDomain: "" }),
        cookie("private", ".other.test", { storeId: "firefox-private", firstPartyDomain: "other.test" }),
        cookie("container", ".other.test", { storeId: "firefox-container-1", firstPartyDomain: "" }),
        cookie("kept", ".kept.test", { storeId: "firefox-container-1", firstPartyDomain: "" })
      ]
    });

    const result = await page.evaluate(async () => {
      const { clearCookies } = await import("/src/cleaner.js");

      return {
        removed: await clearCookies(["kept.test"]),
        queries: window.fake.cookieQueries,
        removedCookies: window.fake.removedCookies
      };
    });

    expect(result.removed).toBe(3);

    expect(result.queries).toEqual(
      ["firefox-default", "firefox-private", "firefox-container-1"].map((storeId) => ({
        storeId,
        partitionKey: {},
        firstPartyDomain: null
      }))
    );

    expect(result.removedCookies).toEqual([
      { url: "http://other.test/", name: "default", storeId: "firefox-default", firstPartyDomain: "" },
      { url: "http://other.test/", name: "private", storeId: "firefox-private", firstPartyDomain: "other.test" },
      { url: "http://other.test/", name: "container", storeId: "firefox-container-1", firstPartyDomain: "" }
    ]);
  });


  test("with containers turned off the default store is still cleared", async ({ page }) => {
    await openHarness(page, {
      firefox: true,
      cookieStores: [],
      containers: "off",
      cookies: [cookie("default", ".other.test", { storeId: "firefox-default", firstPartyDomain: "" })]
    });

    const removed = await page.evaluate(async () => {
      const { clearCookies } = await import("/src/cleaner.js");
      return clearCookies([]);
    });

    expect(removed).toBe(1);
  });
});


test.describe("site data", () => {
  const SITES = ["kept.test", "localhost", "mail.parent.test"];

  const SEEN = {
    storage: { keptSites: SITES },
    history: [
      { url: "https://mail.kept.test:8443/inbox", time: NOW - 4000 },
      { url: "http://localhost:3000/app", time: NOW - 3000 },
      { url: "https://www.other.test/page", time: NOW - 2000 },
      { url: "http://other.test:8080/dev", time: NOW - 1500 },
      { url: "file:///home/notes.html", time: NOW - 1000 }
    ],
    tabs: [
      { url: "https://tab.kept.test/" },
      { url: "https://news.test/" },
      // Not kept, though its subdomain mail.parent.test is.
      { url: "http://parent.test/" },
      { url: "about:blank" },
      {}
    ]
  };

  // The cookies of SEEN, in the default cookie store of each browser.
  function seenCookies(storeId) {
    return [
      cookie("sub", ".a.kept.test", { storeId }),
      // Kept for mail.parent.test, so it does not mark parent.test for clearing.
      cookie("parent", ".parent.test", { storeId }),
      cookie("tracker", ".tracker.test", { storeId })
    ];
  }


  async function clear(page, options) {
    return page.evaluate(async (options) => {
      const { clearUnkeptData } = await import("/src/cleaner.js");

      const result = await clearUnkeptData(options);

      window.leftoversCleared = result.leftoversCleared;

      return window.fake.siteDataCalls.map((call) => {
        return {
          ...call,
          options: Object.fromEntries(
            Object.entries(call.options).map(([key, value]) => [key, [...value].sort()])
          )
        };
      });
    }, options);
  }


  const CHROMIUM_TYPES = {
    cache: true,
    cacheStorage: true,
    indexedDB: true,
    localStorage: true,
    serviceWorkers: true
  };


  test("Chromium clears the origins it found that are not kept, with their ports", async ({ page }) => {
    await openHarness(page, { ...SEEN, cookies: seenCookies("0") });

    expect(await clear(page)).toEqual([{
      method: "remove",
      options: {
        // Cookies name no scheme or port, so both schemes go.
        origins: [
          "http://other.test:8080",
          "http://parent.test",
          "http://tracker.test",
          "https://news.test",
          "https://tracker.test",
          "https://www.other.test"
        ]
      },
      dataTypes: CHROMIUM_TYPES
    }]);
  });


  test("Chromium leftovers clear every site except the kept sites and the kept origins found", async ({ page }) => {
    await openHarness(page, { ...SEEN, cookies: seenCookies("0") });

    expect(await clear(page, { leftovers: true })).toEqual([{
      method: "remove",
      options: {
        excludeOrigins: [
          // From the kept cookie, and kept history and tabs.
          "http://a.kept.test",
          "http://kept.test",
          "http://localhost",
          "http://localhost:3000",
          "http://mail.parent.test",
          "https://a.kept.test",
          "https://kept.test",
          "https://localhost",
          "https://mail.kept.test:8443",
          "https://mail.parent.test",
          "https://tab.kept.test"
        ]
      },
      dataTypes: CHROMIUM_TYPES
    }]);
    expect(await page.evaluate(() => window.leftoversCleared)).toBe(true);
  });


  test("Chromium leftovers with no kept sites clear every site", async ({ page }) => {
    await openHarness(page, { history: [{ url: "https://other.test/", time: NOW - 1000 }] });

    expect(await clear(page, { leftovers: true })).toEqual([{
      method: "remove",
      options: {},
      dataTypes: CHROMIUM_TYPES
    }]);
  });


  test("the site a cookie is partitioned under is found too", async ({ page }) => {
    await openHarness(page, {
      storage: { keptSites: ["kept.test"] },
      cookies: [
        cookie("embedded", ".kept.test", { secure: true, partitionKey: { topLevelSite: "https://top.test" } })
      ]
    });

    expect(await clear(page)).toEqual([{
      method: "remove",
      options: { origins: ["https://top.test"] },
      dataTypes: CHROMIUM_TYPES
    }]);
  });


  test("Chromium with nothing found that is not kept clears no site data", async ({ page }) => {
    await openHarness(page, {
      storage: { keptSites: ["kept.test"] },
      history: [{ url: "https://mail.kept.test/", time: NOW - 1000 }],
      tabs: [{ url: "https://docs.kept.test/" }]
    });

    expect(await clear(page)).toEqual([]);
  });


  test("Firefox clears the hosts it saw that are not kept, then the whole cache", async ({ page }) => {
    await openHarness(page, {
      ...SEEN,
      firefox: true,
      cookieStores: [{ id: "firefox-default" }],
      cookies: seenCookies("firefox-default")
    });

    expect(await clear(page)).toEqual([
      {
        method: "remove",
        options: { hostnames: ["news.test", "other.test", "parent.test", "tracker.test", "www.other.test"] },
        dataTypes: { indexedDB: true, localStorage: true }
      },
      {
        method: "remove",
        // Firefox would clear the service workers of mail.parent.test with parent.test.
        options: { hostnames: ["news.test", "other.test", "tracker.test", "www.other.test"] },
        dataTypes: { serviceWorkers: true }
      },
      { method: "removeCache", options: {} }
    ]);
  });


  test("Firefox clears only the sites it found, even when asked for leftovers", async ({ page }) => {
    await openHarness(page, {
      firefox: true,
      storage: { keptSites: ["kept.test"] },
      history: [{ url: "https://other.test/", time: NOW - 1000 }]
    });

    expect(await clear(page, { leftovers: true })).toEqual([
      { method: "remove", options: { hostnames: ["other.test"] }, dataTypes: { indexedDB: true, localStorage: true } },
      { method: "remove", options: { hostnames: ["other.test"] }, dataTypes: { serviceWorkers: true } },
      { method: "removeCache", options: {} }
    ]);
    expect(await page.evaluate(() => window.leftoversCleared)).toBe(false);
  });


  test("Firefox with nothing unkept seen clears only the cache", async ({ page }) => {
    await openHarness(page, {
      firefox: true,
      storage: { keptSites: ["kept.test"] },
      history: [{ url: "https://kept.test/", time: NOW - 1000 }]
    });

    expect(await clear(page)).toEqual([{ method: "removeCache", options: {} }]);
  });
});


test.describe("clearUnkeptData", () => {
  test("uses the stored keep list and records the result", async ({ page }) => {
    await openHarness(page, {
      storage: { keptSites: ["kept.test", "not a site"] },
      history: [
        { url: "https://kept.test/", time: NOW - 2000 },
        { url: "https://other.test/", time: NOW - 1000 }
      ],
      cookies: [cookie("kept", "kept.test"), cookie("other", "other.test")]
    });

    const result = await page.evaluate(async () => {
      const { clearUnkeptData } = await import("/src/cleaner.js");

      return {
        returned: await clearUnkeptData(),
        stored: window.fake.storage.lastClear
      };
    });

    const expected = {
      time: expect.any(Number),
      historyRemoved: 1,
      historySkipped: false,
      cookiesRemoved: 1,
      cookiesSkipped: false,
      siteDataCleared: true,
      siteDataSkipped: false,
      leftoversCleared: false,
      failed: false
    };

    expect(result.returned).toEqual(expected);
    expect(result.stored).toEqual(expected);
  });


  test("without site access, history is cleared and cookies are skipped", async ({ page }) => {
    await openHarness(page, {
      siteAccess: false,
      history: [{ url: "https://other.test/", time: NOW - 1000 }],
      cookies: [cookie("other", "other.test")]
    });

    const result = await page.evaluate(async () => {
      const { clearUnkeptData } = await import("/src/cleaner.js");

      return {
        returned: await clearUnkeptData(),
        queries: window.fake.cookieQueries.length
      };
    });

    expect(result.returned).toMatchObject({
      historyRemoved: 1,
      cookiesRemoved: 0,
      cookiesSkipped: true,
      siteDataCleared: true,
      siteDataSkipped: false,
      failed: false
    });
    expect(result.queries).toBe(0);
  });


  test("without a history API, as in Firefox for Android, cookies and site data are still cleared", async ({ page }) => {
    await openHarness(page, {
      firefox: true,
      noHistory: true,
      cookieStores: [{ id: "firefox-default" }],
      cookies: [
        cookie("kept", "kept.test", { storeId: "firefox-default" }),
        cookie("other", "other.test", { storeId: "firefox-default" })
      ],
      storage: { keptSites: ["kept.test"] }
    });

    const result = await page.evaluate(async () => {
      const { clearUnkeptData } = await import("/src/cleaner.js");

      return {
        returned: await clearUnkeptData(),
        removed: window.fake.removedCookies.map((details) => details.name),
        hostnames: window.fake.siteDataCalls[0].options.hostnames
      };
    });

    expect(result.returned).toMatchObject({
      historyRemoved: 0,
      historySkipped: true,
      cookiesRemoved: 1,
      cookiesSkipped: false,
      siteDataCleared: true,
      siteDataSkipped: false,
      failed: false
    });
    expect(result.removed).toEqual(["other"]);
    // Without history, the sites to clear come from cookies and tabs.
    expect(result.hostnames).toEqual(["other.test"]);
  });


  test("without the browsingData permission, site data is skipped", async ({ page }) => {
    await openHarness(page, {
      noSiteData: true,
      history: [{ url: "https://other.test/", time: NOW - 1000 }]
    });

    const result = await page.evaluate(async () => {
      const { clearUnkeptData } = await import("/src/cleaner.js");
      return clearUnkeptData();
    });

    expect(result).toMatchObject({
      historyRemoved: 1,
      siteDataCleared: false,
      siteDataSkipped: true,
      failed: false
    });
  });


  test("a site data clear that fails is recorded as failed", async ({ page }) => {
    await openHarness(page, {
      siteDataFails: true,
      history: [{ url: "https://other.test/", time: NOW - 1000 }]
    });

    const result = await page.evaluate(async () => {
      const { clearUnkeptData } = await import("/src/cleaner.js");

      const error = await clearUnkeptData().then(() => null, (reason) => reason.message);

      return { error, stored: window.fake.storage.lastClear };
    });

    expect(result.error).toBe("Site data is unavailable.");
    expect(result.stored).toMatchObject({ failed: true, siteDataCleared: false });
  });


  test("a clear that fails is recorded as failed", async ({ page }) => {
    await openHarness(page, { historyFails: true });

    const result = await page.evaluate(async () => {
      const { clearUnkeptData } = await import("/src/cleaner.js");

      const error = await clearUnkeptData().then(() => null, (reason) => reason.message);

      return { error, stored: window.fake.storage.lastClear };
    });

    expect(result.error).toBe("History is unavailable.");
    expect(result.stored).toMatchObject({ failed: true });
  });
});
