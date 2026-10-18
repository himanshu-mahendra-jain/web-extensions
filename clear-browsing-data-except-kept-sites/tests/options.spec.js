import path from "node:path";

import { test as base, expect } from "../../test-support/extension.js";


/*
 * The settings page in the installed extension, against real storage.
 * storedData is written before the page opens; sitePermissions, when
 * set, replaces chrome.permissions in the page, since site access
 * granted at install cannot be taken away without a prompt.
 */
const test = base.extend({
  extensionPath: path.resolve(__dirname, ".."),

  storedData: [{}, { option: true }],
  sitePermissions: [null, { option: true }],

  optionsPage: async ({ context, serviceWorker, extensionId, storedData, sitePermissions }, use) => {
    const url = `chrome-extension://${extensionId}/options/options.html`;

    // Installing opens the page in whichever tab is free; let it finish first.
    await expect.poll(() => context.pages().some((page) => page.url() === url)).toBe(true);

    await serviceWorker.evaluate((data) => chrome.storage.local.set(data), storedData);

    const page = await context.newPage();

    if (sitePermissions) {
      await page.addInitScript(fakeSitePermissions, sitePermissions);
    }

    await page.goto(url);

    await use(page);
  }
});


function fakeSitePermissions({ granted, grant }) {
  if (!globalThis.chrome?.permissions) {
    return;
  }

  const state = { granted, grant, requests: 0 };

  window.fakePermissions = state;

  Object.assign(chrome.permissions, {
    contains: async () => state.granted,

    request: async () => {
      state.requests++;
      state.granted ||= state.grant;
      return state.grant;
    }
  });
}


function stored(serviceWorker, key) {
  return serviceWorker.evaluate(async (key) => {
    return (await chrome.storage.local.get(key))[key];
  }, key);
}


async function keepSite(page, value) {
  await page.getByLabel("Website domain").fill(value);
  await page.getByRole("button", { name: "Keep", exact: true }).click();
}


function siteList(page) {
  return page.getByRole("list", { name: "Kept sites" }).getByRole("listitem");
}


/*
 * Holds the clear message until the test settles it, so the page can
 * be checked while the clear is running.
 */
async function holdClear(page) {
  await page.addInitScript(() => {
    if (!globalThis.chrome?.runtime) {
      return;
    }

    chrome.runtime.sendMessage = (message) => {
      window.sentMessage = message;

      return new Promise((resolve, reject) => {
        window.settleClear = { resolve, reject };
      });
    };
  });

  await page.reload();
}


// The time as the page formats it, in the browser's locale.
function formatted(page, time) {
  return page.evaluate((time) => {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(time));
  }, time);
}


test.describe("kept sites", () => {
  test("start empty", async ({ optionsPage }) => {
    await expect(optionsPage.getByText(
      "No sites are kept yet, so a clear deletes the history, cookies and site data of every site."
    )).toBeVisible();
    await expect(optionsPage.getByRole("list", { name: "Kept sites" })).toBeHidden();
  });


  test("a site is kept as its domain", async ({ optionsPage, serviceWorker }) => {
    await keepSite(optionsPage, "  https://www.Example.COM/inbox?x=1 ");

    await expect(optionsPage.locator("#message")).toHaveText("example.com kept.");
    await expect(optionsPage.locator("#message")).toHaveClass(/success/);
    await expect(siteList(optionsPage)).toHaveText(["example.comRemove"]);
    await expect(optionsPage.getByText("No sites are kept yet")).toBeHidden();

    const field = optionsPage.getByLabel("Website domain");

    await expect(field).toHaveValue("");
    await expect(field).toBeFocused();

    expect(await stored(serviceWorker, "keptSites")).toEqual(["example.com"]);
  });


  test("sites are listed and stored in order", async ({ optionsPage, serviceWorker }) => {
    for (const site of ["b.test", "http://localhost:3000/", "a.test", "10.0.0.1"]) {
      await keepSite(optionsPage, site);
      await expect(optionsPage.getByLabel("Website domain")).toHaveValue("");
    }

    const sites = ["10.0.0.1", "a.test", "b.test", "localhost"];

    await expect(siteList(optionsPage)).toHaveText(sites.map((site) => `${site}Remove`));
    expect(await stored(serviceWorker, "keptSites")).toEqual(sites);
  });


  test("a site kept already is not added again", async ({ optionsPage, serviceWorker }) => {
    await keepSite(optionsPage, "a.test");
    await keepSite(optionsPage, "https://a.test/other");

    await expect(optionsPage.locator("#message")).toHaveText("a.test is already kept.");
    await expect(optionsPage.locator("#message")).not.toHaveClass(/success|error/);
    await expect(siteList(optionsPage)).toHaveCount(1);
    expect(await stored(serviceWorker, "keptSites")).toEqual(["a.test"]);
  });


  test("an invalid site is refused until the field is edited", async ({ optionsPage, serviceWorker }) => {
    const field = optionsPage.getByLabel("Website domain");

    await keepSite(optionsPage, "intranet");

    await expect(optionsPage.locator("#message")).toHaveText(
      "Enter a valid domain, such as example.com."
    );
    await expect(optionsPage.locator("#message")).toHaveClass(/error/);
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toBeFocused();
    expect(await stored(serviceWorker, "keptSites")).toBeUndefined();

    await field.press("End");
    await field.pressSequentially(".test");

    await expect(field).not.toHaveAttribute("aria-invalid");
    await expect(optionsPage.locator("#message")).toHaveText("");
  });


  test("several sites separated by commas are kept at once", async ({ optionsPage, serviceWorker }) => {
    await keepSite(optionsPage, "b.test, https://a.test/inbox, c.test");

    await expect(optionsPage.locator("#message")).toHaveText("3 sites kept.");
    await expect(optionsPage.locator("#message")).toHaveClass(/success/);
    await expect(siteList(optionsPage)).toHaveText(["a.testRemove", "b.testRemove", "c.testRemove"]);
    await expect(optionsPage.getByLabel("Website domains")).toHaveValue("");
    expect(await stored(serviceWorker, "keptSites")).toEqual(["a.test", "b.test", "c.test"]);
  });


  test("entries that are not valid stay in the field, and the rest are kept", async ({ optionsPage, serviceWorker }) => {
    const field = optionsPage.getByLabel("Website domains");

    await keepSite(optionsPage, "a.test");
    await keepSite(optionsPage, "a.test, intranet, b.test, c.test, exa mple.com");

    await expect(optionsPage.locator("#message")).toHaveText(
      "2 sites kept. a.test is already kept. These are not valid domains: intranet, exa mple.com."
    );
    await expect(optionsPage.locator("#message")).toHaveClass(/error/);
    await expect(field).toHaveValue("intranet, exa mple.com");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    expect(await stored(serviceWorker, "keptSites")).toEqual(["a.test", "b.test", "c.test"]);

    await keepSite(optionsPage, "a.test, b.test, d.test, x");

    await expect(optionsPage.locator("#message")).toHaveText(
      "d.test kept. 2 sites are already kept. x is not a valid domain."
    );
  });


  test("several entries that are all invalid are listed", async ({ optionsPage, serviceWorker }) => {
    await keepSite(optionsPage, "intranet, nope");

    await expect(optionsPage.locator("#message")).toHaveText("These are not valid domains: intranet, nope.");
    await expect(optionsPage.getByLabel("Website domains")).toHaveValue("intranet, nope");
    expect(await stored(serviceWorker, "keptSites")).toBeUndefined();
  });


  test.describe("with sites kept", () => {
    test.use({ storedData: { keptSites: ["a.test", "b.test", "c.test"] } });


    test("removing one says when it is cleared", async ({ optionsPage, serviceWorker }) => {
      await optionsPage.getByRole("button", { name: "Remove b.test" }).click();

      await expect(optionsPage.locator("#message")).toHaveText(
        "b.test removed. Its history, cookies and site data will be deleted at the next clear."
      );
      await expect(siteList(optionsPage)).toHaveText(["a.testRemove", "c.testRemove"]);
      expect(await stored(serviceWorker, "keptSites")).toEqual(["a.test", "c.test"]);
    });


    test("removing every site shows the empty state", async ({ optionsPage }) => {
      for (const site of ["a.test", "b.test", "c.test"]) {
        await optionsPage.getByRole("button", { name: `Remove ${site}` }).click();
        await expect(optionsPage.getByRole("button", { name: `Remove ${site}` })).toHaveCount(0);
      }

      await expect(optionsPage.getByText("No sites are kept yet")).toBeVisible();
    });


    test("removing a site moves focus to the next Remove button", async ({ optionsPage }) => {
      await optionsPage.getByRole("button", { name: "Remove b.test" }).click();

      await expect(optionsPage.getByRole("button", { name: "Remove c.test" })).toBeFocused();
    });


    test("removing the last site in the list moves focus to the one before it", async ({ optionsPage }) => {
      await optionsPage.getByRole("button", { name: "Remove c.test" }).click();

      await expect(optionsPage.getByRole("button", { name: "Remove b.test" })).toBeFocused();
    });


    test("a change made elsewhere is shown", async ({ optionsPage, serviceWorker }) => {
      await expect(siteList(optionsPage)).toHaveCount(3);

      await serviceWorker.evaluate(() => chrome.storage.local.set({ keptSites: ["z.test"] }));

      await expect(siteList(optionsPage)).toHaveText(["z.testRemove"]);
    });
  });


  test.describe("with one site kept", () => {
    test.use({ storedData: { keptSites: ["a.test"] } });


    test("removing it moves focus to the domain field", async ({ optionsPage }) => {
      await optionsPage.getByRole("button", { name: "Remove a.test" }).click();

      await expect(optionsPage.getByLabel("Website domain")).toBeFocused();
    });
  });


  test.describe("with stored sites that are not valid", () => {
    test.use({ storedData: { keptSites: ["b.test", "not a site", 42, "a.test", "b.test"] } });


    test("only the valid ones are listed, once", async ({ optionsPage }) => {
      await expect(siteList(optionsPage)).toHaveText(["a.testRemove", "b.testRemove"]);
    });
  });
});


test.describe("clearing on startup", () => {
  const WARNINGS = {
    kept: [
      "Each time the browser starts, history, cookies and site data will be deleted for every site except the ones you selected to keep. You will be signed out of all other sites.",
      "Deleted history, cookies and site data cannot be recovered."
    ],
    none: [
      "You have not selected any sites to keep. Each time the browser starts, all history, cookies and site data will be deleted, and you will be signed out of every site.",
      "Deleted history, cookies and site data cannot be recovered."
    ]
  };


  function startupCheckbox(page) {
    return page.getByLabel("Clear automatically when the browser starts");
  }


  function notice(page) {
    return page.getByRole("region", { name: "Clearing is off" });
  }


  function warning(page) {
    return page.getByRole("dialog", { name: "Turn on clearing?" });
  }


  const TURN_ON_WAYS = [
    ["the notice", (page) => notice(page).getByRole("button", { name: "Turn On Clearing" }).click()],
    ["the checkbox", (page) => startupCheckbox(page).click()]
  ];


  async function expectOff(page, serviceWorker) {
    await expect(warning(page)).toBeHidden();
    await expect(startupCheckbox(page)).not.toBeChecked();
    await expect(notice(page)).toBeVisible();
    expect(await stored(serviceWorker, "clearOnStartup")).toBeUndefined();
  }


  test.describe("with kept sites", () => {
    test.use({ storedData: { keptSites: ["kept.test"] } });


    test("is off by default, with a notice", async ({ optionsPage, serviceWorker }) => {
      await expect(notice(optionsPage)).toBeVisible();
      await expect(notice(optionsPage).locator("p")).toHaveText("Nothing is deleted yet. Add the sites you want to stay signed in to, then turn clearing on. From then on, each time the browser starts, the history, cookies and site data of every other site are deleted.");
      await expectOff(optionsPage, serviceWorker);
    });


    for (const [name, turnOn] of TURN_ON_WAYS) {
      test(`${name} warns what is deleted, then turns it on`, async ({ optionsPage, serviceWorker }) => {
        await turnOn(optionsPage);

        await expect(warning(optionsPage)).toBeVisible();
        await expect(warning(optionsPage).locator("p")).toHaveText(WARNINGS.kept);
        // The safe choice is the one a stray Enter picks.
        await expect(warning(optionsPage).getByRole("button", { name: "Cancel" })).toBeFocused();
        expect(await stored(serviceWorker, "clearOnStartup")).toBeUndefined();

        await warning(optionsPage).getByRole("button", { name: "Turn On Clearing" }).click();

        await expect.poll(() => stored(serviceWorker, "clearOnStartup")).toBe(true);
        await expect(warning(optionsPage)).toBeHidden();
        await expect(notice(optionsPage)).toBeHidden();
        await expect(startupCheckbox(optionsPage)).toBeChecked();

        await optionsPage.reload();
        await expect(startupCheckbox(optionsPage)).toBeChecked();
        await expect(notice(optionsPage)).toBeHidden();
      });
    }


    test("a warning shown again before the last one's close event still asks", async ({ optionsPage, serviceWorker }) => {
      await notice(optionsPage).getByRole("button", { name: "Turn On Clearing" }).click();
      await expect(warning(optionsPage)).toBeVisible();

      // Closed and shown again in one task, so the close event is still queued.
      await optionsPage.evaluate(() => {
        document.getElementById("confirm-dialog").close();
        document.getElementById("turn-on").click();
      });

      await expect(warning(optionsPage)).toBeVisible();
      await warning(optionsPage).getByRole("button", { name: "Turn On Clearing" }).click();

      await expect.poll(() => stored(serviceWorker, "clearOnStartup")).toBe(true);
      await expect(startupCheckbox(optionsPage)).toBeChecked();
    });


    test("turning it off does not warn", async ({ optionsPage, serviceWorker }) => {
      await serviceWorker.evaluate(() => chrome.storage.local.set({ clearOnStartup: true }));
      await expect(startupCheckbox(optionsPage)).toBeChecked();

      await startupCheckbox(optionsPage).uncheck();

      await expect.poll(() => stored(serviceWorker, "clearOnStartup")).toBe(false);
      await expect(warning(optionsPage)).toBeHidden();
      await expect(notice(optionsPage)).toBeVisible();
    });
  });


  test.describe("with no kept sites", () => {
    for (const [name, turnOn] of TURN_ON_WAYS) {
      test(`${name} warns that everything is deleted, and Cancel keeps it off`, async ({ optionsPage, serviceWorker }) => {
        await turnOn(optionsPage);

        await expect(warning(optionsPage).locator("p")).toHaveText(WARNINGS.none);

        await warning(optionsPage).getByRole("button", { name: "Cancel" }).click();

        await expectOff(optionsPage, serviceWorker);
      });
    }


    test("Escape keeps it off", async ({ optionsPage, serviceWorker }) => {
      await TURN_ON_WAYS[0][1](optionsPage);
      await expect(warning(optionsPage)).toBeVisible();

      await optionsPage.keyboard.press("Escape");

      await expectOff(optionsPage, serviceWorker);
    });


    test("confirming turns it on", async ({ optionsPage, serviceWorker }) => {
      await TURN_ON_WAYS[1][1](optionsPage);
      await warning(optionsPage).getByRole("button", { name: "Turn On Clearing" }).click();

      await expect.poll(() => stored(serviceWorker, "clearOnStartup")).toBe(true);
      await expect(startupCheckbox(optionsPage)).toBeChecked();
    });
  });


  test("follows a change made elsewhere", async ({ optionsPage, serviceWorker }) => {
    await expect(startupCheckbox(optionsPage)).not.toBeChecked();

    await serviceWorker.evaluate(() => chrome.storage.local.set({ clearOnStartup: true }));

    await expect(startupCheckbox(optionsPage)).toBeChecked();
    await expect(notice(optionsPage)).toBeHidden();

    await serviceWorker.evaluate(() => chrome.storage.local.set({ clearOnStartup: false }));

    await expect(startupCheckbox(optionsPage)).not.toBeChecked();
    await expect(notice(optionsPage)).toBeVisible();
  });
});


test.describe("import and export", () => {
  function file(name, text) {
    return { name, mimeType: "text/plain", buffer: Buffer.from(text) };
  }


  function status(page) {
    return page.locator("#transfer-status");
  }


  function warning(page) {
    return page.getByRole("dialog", { name: "Replace kept sites?" });
  }


  test("Export is off while no sites are kept", async ({ optionsPage }) => {
    await expect(optionsPage.getByRole("button", { name: "Export" })).toBeDisabled();
  });


  test("Import picks a file and keeps its sites", async ({ optionsPage, serviceWorker }) => {
    const chooser = optionsPage.waitForEvent("filechooser");

    await optionsPage.getByRole("button", { name: "Import" }).click();
    await (await chooser).setFiles(file("sites.txt", "x.test\r\nhttps://www.y.test/inbox\nbad entry, z.test\n"));

    await expect(status(optionsPage)).toHaveText(
      "3 sites imported from sites.txt. bad entry is not a valid domain."
    );
    await expect(status(optionsPage)).toHaveClass(/error/);
    await expect(siteList(optionsPage)).toHaveText(["x.testRemove", "y.testRemove", "z.testRemove"]);
    expect(await stored(serviceWorker, "keptSites")).toEqual(["x.test", "y.test", "z.test"]);
  });


  test.describe("with sites kept", () => {
    test.use({ storedData: { keptSites: ["b.test", "a.test"] } });


    test("Export saves them as a text file, one per line", async ({ optionsPage }) => {
      const download = optionsPage.waitForEvent("download");

      await optionsPage.getByRole("button", { name: "Export" }).click();

      const saved = await download;
      const stream = await saved.createReadStream();
      const chunks = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(saved.suggestedFilename()).toBe("kept-sites.txt");
      expect(Buffer.concat(chunks).toString()).toBe("a.test\nb.test\n");
    });


    test("a file that keeps every site replaces them without a warning", async ({ optionsPage, serviceWorker }) => {
      await optionsPage.locator("#import-file").setInputFiles(file("more.txt", "a.test, b.test, c.test"));

      await expect(status(optionsPage)).toHaveText("3 sites imported from more.txt.");
      await expect(status(optionsPage)).toHaveClass(/success/);
      await expect(warning(optionsPage)).toBeHidden();
      expect(await stored(serviceWorker, "keptSites")).toEqual(["a.test", "b.test", "c.test"]);
    });


    test("a file that leaves sites out warns first, and Cancel changes nothing", async ({ optionsPage, serviceWorker }) => {
      await optionsPage.locator("#import-file").setInputFiles(file("other.txt", "c.test"));

      await expect(warning(optionsPage).locator("p")).toHaveText([
        "The 2 sites you keep now will be replaced with the 1 site in other.txt.",
        "2 sites will no longer be kept, and their history, cookies and site data will be deleted at the next clear."
      ]);

      await warning(optionsPage).getByRole("button", { name: "Cancel" }).click();

      await expect(warning(optionsPage)).toBeHidden();
      await expect(status(optionsPage)).toHaveText("");
      await expect(siteList(optionsPage)).toHaveText(["a.testRemove", "b.testRemove"]);
      expect(await stored(serviceWorker, "keptSites")).toEqual(["b.test", "a.test"]);
    });


    test("confirming the warning replaces them", async ({ optionsPage, serviceWorker }) => {
      await optionsPage.locator("#import-file").setInputFiles(file("other.txt", "c.test\na.test"));

      await expect(warning(optionsPage).locator("p").last()).toHaveText(
        "1 site will no longer be kept, and its history, cookies and site data will be deleted at the next clear."
      );

      await warning(optionsPage).getByRole("button", { name: "Replace Kept Sites" }).click();

      await expect(status(optionsPage)).toHaveText("2 sites imported from other.txt.");
      await expect(siteList(optionsPage)).toHaveText(["a.testRemove", "c.testRemove"]);
      expect(await stored(serviceWorker, "keptSites")).toEqual(["a.test", "c.test"]);
    });


    test("a file over 1 MB is refused without reading it", async ({ optionsPage, serviceWorker }) => {
      // Exactly 1 MB is read; one byte more is refused.
      const megabyte = "c.test\n".padEnd(1024 * 1024, " ");

      await optionsPage.locator("#import-file").setInputFiles(file("huge.txt", `${megabyte}x`));

      await expect(status(optionsPage)).toHaveText(
        "huge.txt is larger than 1 MB, so the kept sites were not changed."
      );
      await expect(status(optionsPage)).toHaveClass(/error/);
      expect(await stored(serviceWorker, "keptSites")).toEqual(["b.test", "a.test"]);

      await optionsPage.locator("#import-file").setInputFiles(file("big.txt", megabyte));

      await expect(warning(optionsPage)).toBeVisible();
    });


    test("a file without valid domains changes nothing", async ({ optionsPage, serviceWorker }) => {
      await optionsPage.locator("#import-file").setInputFiles(file("notes.txt", "hello world\n"));

      await expect(status(optionsPage)).toHaveText(
        "notes.txt has no valid domains, so the kept sites were not changed."
      );
      await expect(status(optionsPage)).toHaveClass(/error/);
      await expect(warning(optionsPage)).toBeHidden();
      expect(await stored(serviceWorker, "keptSites")).toEqual(["b.test", "a.test"]);
    });
  });
});


test.describe("the last clear", () => {
  const TIME = Date.UTC(2026, 0, 15, 9, 30);

  for (const [name, lastClear, text] of [
    [
      "counts what was removed",
      { historyRemoved: 12, cookiesRemoved: 30 },
      "Last cleared WHEN: 12 history entries and 30 cookies deleted."
    ],
    [
      "uses the singular for one",
      { historyRemoved: 1, cookiesRemoved: 1 },
      "Last cleared WHEN: 1 history entry and 1 cookie deleted."
    ],
    [
      "says when site data and cache were cleared",
      { historyRemoved: 2, cookiesRemoved: 3, siteDataCleared: true },
      "Last cleared WHEN: 2 history entries and 3 cookies deleted, along with site data and cache."
    ],
    [
      "says when the site data of every site not kept was cleared",
      { historyRemoved: 2, cookiesRemoved: 3, siteDataCleared: true, leftoversCleared: true },
      "Last cleared WHEN: 2 history entries and 3 cookies deleted, along with the site data and cache of every site not kept."
    ],
    [
      "says when history and site data were skipped",
      { cookiesRemoved: 4, historySkipped: true, siteDataSkipped: true },
      "Last cleared WHEN: 4 cookies deleted. History and site data were skipped because this browser does not let extensions clear them."
    ],
    [
      "says when cookies were skipped",
      { historyRemoved: 3, cookiesRemoved: 0, cookiesSkipped: true },
      "Last cleared WHEN: 3 history entries deleted. Cookies were skipped because site access is off."
    ],
    [
      "says when history was skipped",
      { cookiesRemoved: 4, historySkipped: true },
      "Last cleared WHEN: 4 cookies deleted. History was skipped because this browser does not let extensions clear it."
    ],
    [
      "says when both were skipped",
      { historySkipped: true, cookiesSkipped: true },
      "Last cleared WHEN: nothing deleted. History was skipped because this browser does not let extensions clear it. Cookies were skipped because site access is off."
    ]
  ]) {
    test(name, async ({ optionsPage, serviceWorker }) => {
      await expect(optionsPage.locator("#last-clear")).toHaveText("Nothing has been cleared yet.");

      await serviceWorker.evaluate((lastClear) => {
        return chrome.storage.local.set({ lastClear });
      }, { time: TIME, cookiesSkipped: false, failed: false, ...lastClear });

      await expect(optionsPage.locator("#last-clear")).toHaveText(
        text.replace("WHEN", await formatted(optionsPage, TIME))
      );
      await expect(optionsPage.locator("#last-clear")).not.toHaveClass(/error/);
    });
  }


  test.describe("when it failed", () => {
    test.use({ storedData: { lastClear: { time: TIME, failed: true } } });


    test("says so as an error", async ({ optionsPage }) => {
      await expect(optionsPage.locator("#last-clear")).toHaveText(
        `Clearing on ${await formatted(optionsPage, TIME)} failed.`
      );
      await expect(optionsPage.locator("#last-clear")).toHaveClass(/error/);
    });
  });
});


test.describe("Clear Now", () => {
  test.use({ storedData: { keptSites: ["kept.test"] } });


  test("shows progress, then a reply that is not ok as a failure", async ({ optionsPage }) => {
    await holdClear(optionsPage);

    const button = optionsPage.getByRole("button", { name: "Clear Now" });
    const status = optionsPage.locator("#last-clear");

    await button.click();

    await expect(status).toHaveText("Clearing… This can take a few minutes.");
    await expect(button).toBeDisabled();
    expect(await optionsPage.evaluate(() => window.sentMessage)).toEqual({ type: "clear-now" });

    await optionsPage.evaluate(() => window.settleClear.resolve({ ok: false }));

    await expect(status).toHaveText(/^Clearing on .+ failed\.$/);
    await expect(status).toHaveClass(/error/);
    await expect(button).toBeEnabled();
  });


  test("a message that cannot be delivered is a failure", async ({ optionsPage }) => {
    await holdClear(optionsPage);

    await optionsPage.getByRole("button", { name: "Clear Now" }).click();
    await optionsPage.evaluate(() => {
      window.settleClear.reject(new Error("Receiving end does not exist."));
    });

    await expect(optionsPage.locator("#last-clear")).toHaveText(/^Clearing on .+ failed\.$/);
    await expect(optionsPage.getByRole("button", { name: "Clear Now" })).toBeEnabled();
  });


  test("a successful reply clears an earlier failure", async ({ optionsPage }) => {
    await holdClear(optionsPage);

    const status = optionsPage.locator("#last-clear");

    await optionsPage.getByRole("button", { name: "Clear Now" }).click();
    await optionsPage.evaluate(() => window.settleClear.resolve({ ok: false }));
    await expect(status).toHaveClass(/error/);

    await optionsPage.getByRole("button", { name: "Clear Now" }).click();
    await optionsPage.evaluate(() => {
      window.settleClear.resolve({
        ok: true,
        result: { time: Date.now(), historyRemoved: 2, cookiesRemoved: 0, cookiesSkipped: false, failed: false }
      });
    });

    await expect(status).toHaveText(/^Last cleared .+: 2 history entries and 0 cookies deleted\.$/);
    await expect(status).not.toHaveClass(/error/);
  });
});


test.describe("Clear Leftovers", () => {
  test.use({ storedData: { keptSites: ["kept.test"] } });


  async function startLeftovers(page) {
    await page.getByRole("button", { name: "Clear Leftovers" }).click();

    return page.getByRole("dialog", { name: "Clear leftover site data?" });
  }


  test("warns what is deleted, and Cancel sends nothing", async ({ optionsPage }) => {
    await holdClear(optionsPage);

    const warning = await startLeftovers(optionsPage);

    await expect(warning.locator("p")).toHaveText([
      "The history, cookies and site data of every site you do not keep will be deleted now, including the site data of sites the extension no longer finds.",
      "A kept site keeps its site data only at the addresses the extension finds in history, cookies and open tabs. Any other subdomain or port of a kept site, such as one you have not visited for months or a local server on another port, loses its site data, and you may be signed out of it.",
      "Deleted history, cookies and site data cannot be recovered."
    ]);
    await expect(warning.getByRole("button", { name: "Cancel" })).toBeFocused();

    await warning.getByRole("button", { name: "Cancel" }).click();

    await expect(warning).toBeHidden();
    await expect(optionsPage.locator("#leftovers-status")).toHaveText("");
    expect(await optionsPage.evaluate(() => window.sentMessage)).toBeUndefined();
  });


  test("confirming clears, with progress, then the result", async ({ optionsPage }) => {
    await holdClear(optionsPage);

    const warning = await startLeftovers(optionsPage);
    const status = optionsPage.locator("#leftovers-status");

    await warning.getByRole("button", { name: "Clear Leftovers" }).click();

    await expect(status).toHaveText("Clearing… This can take a few minutes.");
    await expect(optionsPage.getByRole("button", { name: "Clear Leftovers" })).toBeDisabled();
    await expect(optionsPage.getByRole("button", { name: "Clear Now" })).toBeDisabled();
    expect(await optionsPage.evaluate(() => window.sentMessage)).toEqual({ type: "clear-leftovers" });

    await optionsPage.evaluate(() => {
      window.settleClear.resolve({
        ok: true,
        result: { time: Date.now(), historyRemoved: 1, cookiesRemoved: 2, siteDataCleared: true, leftoversCleared: true, failed: false }
      });
    });

    await expect(status).toHaveText("Leftover site data cleared.");
    await expect(status).not.toHaveClass(/error/);
    await expect(optionsPage.locator("#last-clear")).toHaveText(
      /^Last cleared .+: 1 history entry and 2 cookies deleted, along with the site data and cache of every site not kept\.$/
    );
    await expect(optionsPage.getByRole("button", { name: "Clear Leftovers" })).toBeEnabled();
  });


  test("a reply that is not ok is a failure", async ({ optionsPage }) => {
    await holdClear(optionsPage);

    await (await startLeftovers(optionsPage)).getByRole("button", { name: "Clear Leftovers" }).click();
    await optionsPage.evaluate(() => window.settleClear.resolve({ ok: false }));

    await expect(optionsPage.locator("#leftovers-status")).toHaveText("Clearing leftover site data failed.");
    await expect(optionsPage.locator("#leftovers-status")).toHaveClass(/error/);
    await expect(optionsPage.locator("#last-clear")).toHaveText(/^Clearing on .+ failed\.$/);
  });


  test.describe("with no kept sites", () => {
    test.use({ storedData: {} });


    test("warns that every site is cleared", async ({ optionsPage }) => {
      const warning = await startLeftovers(optionsPage);

      await expect(warning.locator("p")).toHaveText([
        "You have not selected any sites to keep, so the history, cookies and site data of every site will be deleted now, and you will be signed out of every site.",
        "Deleted history, cookies and site data cannot be recovered."
      ]);
    });
  });
});


test.describe("site access", () => {
  test("granted at install, so no warning is shown", async ({ optionsPage }) => {
    await expect(optionsPage.getByRole("heading", { name: "Kept Sites" })).toBeVisible();
    await expect(optionsPage.getByRole("heading", { name: "Site access is off" })).toBeHidden();
  });


  test.describe("when turned off", () => {
    test.use({ sitePermissions: { granted: false, grant: true } });


    test("a warning offers to allow it again", async ({ optionsPage }) => {
      const warning = optionsPage.getByRole("region", { name: "Site access is off" });

      await expect(warning).toBeVisible();
      await expect(warning).toContainText("Without access to websites, the extension cannot delete cookies. History and site data are still cleared.");

      await warning.getByRole("button", { name: "Allow Site Access" }).click();

      await expect(warning).toBeHidden();
      expect(await optionsPage.evaluate(() => window.fakePermissions.requests)).toBe(1);
    });
  });


  test.describe("when the request is declined", () => {
    test.use({ sitePermissions: { granted: false, grant: false } });


    test("the warning stays", async ({ optionsPage }) => {
      const warning = optionsPage.getByRole("region", { name: "Site access is off" });

      await warning.getByRole("button", { name: "Allow Site Access" }).click();

      await expect.poll(() => optionsPage.evaluate(() => window.fakePermissions.requests)).toBe(1);
      await expect(warning).toBeVisible();
    });
  });
});


test.describe("when storage fails", () => {
  test.use({ storedData: { keptSites: ["a.test"] } });


  // Makes one storage call reject from now on, as a full or broken profile would.
  function failStorage(page, method) {
    return page.evaluate((method) => {
      chrome.storage.local[method] = () => Promise.reject(new Error("Storage failed."));
    }, method);
  }


  test("a site that cannot be kept says so", async ({ optionsPage }) => {
    await failStorage(optionsPage, "set");
    await keepSite(optionsPage, "b.test");

    await expect(optionsPage.locator("#message")).toHaveText("The site could not be added.");
    await expect(optionsPage.locator("#message")).toHaveClass(/error/);
    await expect(optionsPage.getByLabel("Website domain")).toBeEnabled();
    await expect(siteList(optionsPage)).toHaveText(["a.testRemove"]);
  });


  test("a site that cannot be removed says so", async ({ optionsPage }) => {
    await failStorage(optionsPage, "set");
    await optionsPage.getByRole("button", { name: "Remove a.test" }).click();

    await expect(optionsPage.locator("#message")).toHaveText("The site could not be removed.");
    await expect(optionsPage.locator("#message")).toHaveClass(/error/);
    await expect(optionsPage.getByRole("button", { name: "Remove a.test" })).toBeEnabled();
  });


  test("clearing that cannot be turned on stays off", async ({ optionsPage }) => {
    await failStorage(optionsPage, "set");
    await optionsPage.getByRole("button", { name: "Turn On Clearing" }).click();
    await optionsPage.getByRole("dialog").getByRole("button", { name: "Turn On Clearing" }).click();

    await expect(optionsPage.getByLabel("Clear automatically when the browser starts")).not.toBeChecked();
    await expect(optionsPage.getByRole("region", { name: "Clearing is off" })).toBeVisible();
  });


  test("sites that cannot be imported say so", async ({ optionsPage }) => {
    await failStorage(optionsPage, "set");
    await optionsPage.locator("#import-file").setInputFiles({
      name: "sites.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("a.test, b.test")
    });

    await expect(optionsPage.locator("#transfer-status")).toHaveText(
      "The kept sites could not be imported from sites.txt."
    );
    await expect(siteList(optionsPage)).toHaveText(["a.testRemove"]);
  });


  test("sites that cannot be exported say so", async ({ optionsPage }) => {
    await failStorage(optionsPage, "get");
    await optionsPage.getByRole("button", { name: "Export" }).click();

    await expect(optionsPage.locator("#transfer-status")).toHaveText(
      "The kept sites could not be exported."
    );
  });


  test("settings that cannot be loaded say so", async ({ optionsPage }) => {
    await optionsPage.addInitScript(() => {
      if (!globalThis.chrome?.storage) {
        return;
      }

      chrome.storage.local.get = () => Promise.reject(new Error("Storage failed."));
    });
    await optionsPage.reload();

    await expect(optionsPage.locator("#message")).toHaveText("The settings could not be loaded.");
    await expect(optionsPage.locator("#message")).toHaveClass(/error/);
  });
});
