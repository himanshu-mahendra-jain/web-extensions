import { test, expect } from "@playwright/test";

import { openHarness } from "./fake-chrome.js";


/*
 * background.js against fake APIs. A real browser cannot be restarted
 * with the extension still installed: --load-extension installs it
 * afresh on every launch, so runtime.onStartup never fires there.
 */


const NOW = Date.now();

const DATA = {
  storage: { keptSites: ["kept.test"], clearOnStartup: true },
  history: [
    { url: "https://kept.test/", time: NOW - 3000 },
    { url: "https://other.test/a", time: NOW - 2000 },
    { url: "https://other.test/b", time: NOW - 1000 }
  ]
};


async function loadBackground(page, options = DATA) {
  await openHarness(page, options);

  await page.evaluate(() => import("/src/background.js"));
}


/*
 * Calls every listener of a fake event, then lets the work they
 * started finish. The fake APIs settle in microtasks, so one
 * macrotask is enough for a whole clear.
 */
function fire(page, event, ...args) {
  return page.evaluate(async ({ event, args }) => {
    for (const listener of window.fake[event].list) {
      listener(...args);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }, { event, args });
}


function fake(page) {
  return page.evaluate(() => window.fake);
}


test.describe("browser startup", () => {
  test("clears everything not kept", async ({ page }) => {
    await loadBackground(page);
    await fire(page, "onStartup");

    const { storage } = await fake(page);

    expect(storage.lastClear).toMatchObject({ historyRemoved: 2, failed: false });
    expect(await page.evaluate(() => window.fake.remainingHistory())).toEqual(["https://kept.test/"]);
  });


  for (const [name, clearOnStartup] of [
    ["was never turned on", undefined],
    ["is turned off", false]
  ]) {
    test(`does nothing when clearing on startup ${name}`, async ({ page }) => {
      await loadBackground(page, {
        ...DATA,
        storage: { ...DATA.storage, clearOnStartup }
      });
      await fire(page, "onStartup");

      const { storage, searches, deletedUrls } = await fake(page);

      expect(storage.lastClear).toBeUndefined();
      expect(searches).toBe(0);
      expect(deletedUrls).toEqual([]);
    });
  }


  test("a failed clear is reported and recorded", async ({ page }) => {
    await loadBackground(page, { ...DATA, historyFails: true });

    const logged = page.waitForEvent("console", (message) => message.type() === "error");

    await fire(page, "onStartup");

    expect((await logged).text()).toContain("[Clear Browsing Data] Startup clear failed:");
    expect((await fake(page)).storage.lastClear).toMatchObject({ failed: true });
  });
});


test.describe("installing", () => {
  test("a new install opens the settings page", async ({ page }) => {
    await loadBackground(page);
    await fire(page, "onInstalled", { reason: "install" });

    expect((await fake(page)).optionsPagesOpened).toBe(1);
  });


  for (const reason of ["update", "chrome_update", "shared_module_update"]) {
    test(`${reason} does not open it`, async ({ page }) => {
      await loadBackground(page);
      await fire(page, "onInstalled", { reason });

      expect((await fake(page)).optionsPagesOpened).toBe(0);
    });
  }


  test("installing does not clear anything", async ({ page }) => {
    await loadBackground(page);
    await fire(page, "onInstalled", { reason: "install" });

    expect((await fake(page)).searches).toBe(0);
  });
});


test("the toolbar button opens the settings page", async ({ page }) => {
  await loadBackground(page);
  await fire(page, "onClicked", { id: 1 });
  await fire(page, "onClicked", { id: 2 });

  expect((await fake(page)).optionsPagesOpened).toBe(2);
});


test.describe("clear-now messages", () => {
  test("reply with the result of the clear", async ({ page }) => {
    await loadBackground(page);

    const reply = await page.evaluate(() => window.fake.message({ type: "clear-now" }));

    expect(reply).toEqual({
      ok: true,
      result: {
        time: expect.any(Number),
        historyRemoved: 2,
        historySkipped: false,
        cookiesRemoved: 0,
        cookiesSkipped: false,
        siteDataCleared: true,
        siteDataSkipped: false,
        leftoversCleared: false,
        failed: false
      }
    });
  });


  test("clear-leftovers clears the site data of every site but the kept ones", async ({ page }) => {
    await loadBackground(page);

    const reply = await page.evaluate(() => window.fake.message({ type: "clear-leftovers" }));

    expect(reply).toMatchObject({
      ok: true,
      result: { historyRemoved: 2, siteDataCleared: true, leftoversCleared: true }
    });
    expect((await fake(page)).siteDataCalls).toEqual([{
      method: "remove",
      options: { excludeOrigins: ["https://kept.test", "http://kept.test"] },
      dataTypes: expect.objectContaining({ localStorage: true })
    }]);
  });


  test("sent together, clear one after the other", async ({ page }) => {
    await loadBackground(page);

    const replies = await page.evaluate(() => {
      return Promise.all([
        window.fake.message({ type: "clear-now" }),
        window.fake.message({ type: "clear-now" })
      ]);
    });

    expect(replies.map((reply) => reply.result.historyRemoved)).toEqual([2, 0]);

    // The second clear searches only after the first has recorded its result.
    const { log } = await fake(page);
    const firstDone = log.indexOf("set lastClear");

    expect(log.slice(0, firstDone)).not.toContain("set lastClear");
    expect(log.slice(firstDone + 1)).toEqual(["search", "set lastClear"]);
  });


  test("do not overlap a startup clear", async ({ page }) => {
    await loadBackground(page);

    const removedNow = await page.evaluate(async () => {
      for (const listener of window.fake.onStartup.list) {
        listener();
      }

      return (await window.fake.message({ type: "clear-now" })).result.historyRemoved;
    });

    // The startup clear records its result after the clear-now's.
    await expect.poll(async () => {
      return (await fake(page)).log.filter((entry) => entry === "set lastClear").length;
    }).toBe(2);

    const { log, storage } = await fake(page);
    const firstDone = log.indexOf("set lastClear");

    // Startup reads its setting first, so the clear-now is queued ahead of it.
    expect(removedNow).toBe(2);
    expect(storage.lastClear.historyRemoved).toBe(0);
    expect(log.slice(firstDone + 1)).toEqual(["search", "set lastClear"]);
  });


  test("a failed clear replies not ok and the next clear still runs", async ({ page }) => {
    await loadBackground(page, { ...DATA, historyFails: true });

    const logged = page.waitForEvent("console", (message) => message.type() === "error");

    const replies = await page.evaluate(async () => {
      const failed = await window.fake.message({ type: "clear-now" });

      window.fake.historyFails = false;

      return [failed, await window.fake.message({ type: "clear-now" })];
    });

    expect(replies[0]).toEqual({ ok: false });
    expect(replies[1]).toMatchObject({ ok: true, result: { historyRemoved: 2 } });
    expect((await logged).text()).toContain("[Clear Browsing Data] Clear now failed:");
  });


  test("other messages are left for other listeners", async ({ page }) => {
    await loadBackground(page);

    const answers = await page.evaluate(() => {
      const [listener] = window.fake.onMessage.list;
      const sendResponse = () => {
        throw new Error("No reply was expected.");
      };

      return [{ type: "other" }, "clear-now", null, undefined].map((message) => {
        return listener(message, {}, sendResponse);
      });
    });

    expect(answers).toEqual([false, false, false, false]);

    // Clears run one at a time, so one queued by those messages would end first.
    await page.evaluate(() => window.fake.message({ type: "clear-now" }));

    expect((await fake(page)).searches).toBe(1);
  });
});
