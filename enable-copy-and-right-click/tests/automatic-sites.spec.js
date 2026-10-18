import fs from "node:fs";
import path from "node:path";

import {
  test,
  expect,
  routePages
} from "../../test-support/extension.js";


const EXTENSION_PATH = path.resolve(__dirname, "..");


test.use({
  extensionPath: EXTENSION_PATH
});


/*
 * Headless Chromium never answers chrome.permissions.request(), so the
 * options page gets a fake chrome.permissions that answers from
 * window.fakePermissions. Storage and the sync message to the real
 * background script are untouched.
 */
function fakeSitePermissions({ granted, grant, removable }) {
  if (!globalThis.chrome?.permissions) {
    return;
  }

  const state = {
    granted: new Set(granted),
    grant,
    removable,
    getAllCalls: 0
  };

  window.fakePermissions = state;

  Object.assign(chrome.permissions, {
    contains: async ({ origins = [] }) => {
      return origins.every((origin) => state.granted.has(origin));
    },

    request: async ({ origins = [] }) => {
      if (state.grant) {
        origins.forEach((origin) => state.granted.add(origin));
      }

      return state.grant;
    },

    remove: async ({ origins = [] }) => {
      if (state.removable) {
        origins.forEach((origin) => state.granted.delete(origin));
      }

      return state.removable;
    },

    getAll: async () => {
      state.getAllCalls++;

      return {
        permissions: [],
        origins: [...state.granted]
      };
    }
  });
}


const EXAMPLE_ORIGINS = [
  "http://example.com/*",
  "https://example.com/*",
  "http://*.example.com/*",
  "https://*.example.com/*"
];


function storedSites(serviceWorker) {
  return serviceWorker.evaluate(async () => {
    return (await chrome.storage.local.get("automaticSites")).automaticSites;
  });
}


function storeSites(serviceWorker, sites) {
  return serviceWorker.evaluate((automaticSites) => {
    return chrome.storage.local.set({ automaticSites });
  }, sites);
}


test.describe("options page", () => {
  test.use({
    sitePermissions: [{
      granted: [],
      grant: true,
      removable: true
    }, { option: true }],

    optionsPage: async ({ context, extensionId, sitePermissions, serviceWorker }, use) => {
      // The worker must be running before the page sends it messages.
      void serviceWorker;

      const page = await context.newPage();

      await page.addInitScript(fakeSitePermissions, sitePermissions);
      await page.goto(`chrome-extension://${extensionId}/options/options.html`);

      await use(page);
    }
  });


  async function addSite(page, value) {
    await page.getByLabel("Website domain").fill(value);
    await page.getByRole("button", { name: "Add Site" }).click();
  }


  test("starts with an empty list", async ({ optionsPage }) => {
    await expect(optionsPage.getByText("No automatic sites added yet.")).toBeVisible();
    await expect(optionsPage.getByRole("list", { name: "Automatic sites" })).toBeHidden();
  });


  test("an added site is stored as its domain and listed", async ({ optionsPage, serviceWorker }) => {
    await addSite(optionsPage, "https://www.Example.com/some/page");

    await expect(optionsPage.getByRole("status").first()).toHaveText("example.com added.");
    await expect(optionsPage.getByRole("listitem")).toHaveText(["example.comRemove"]);
    await expect(optionsPage.getByLabel("Website domain")).toHaveValue("");

    expect(await storedSites(serviceWorker)).toEqual(["example.com"]);
    expect(
      await optionsPage.evaluate(() => [...window.fakePermissions.granted])
    ).toEqual(EXAMPLE_ORIGINS);
  });


  test("sites are listed in alphabetical order", async ({ optionsPage, serviceWorker }) => {
    await addSite(optionsPage, "b.com");
    await expect(optionsPage.getByRole("listitem")).toHaveCount(1);

    await addSite(optionsPage, "a.com");

    await expect(optionsPage.getByRole("listitem")).toHaveText([
      "a.comRemove",
      "b.comRemove"
    ]);
    expect(await storedSites(serviceWorker)).toEqual(["a.com", "b.com"]);
  });


  test("an invalid domain is refused until it is corrected", async ({ optionsPage, serviceWorker }) => {
    const input = optionsPage.getByLabel("Website domain");

    await addSite(optionsPage, "not a domain");

    await expect(optionsPage.locator("#message")).toHaveText(
      "Enter a valid domain, such as example.com."
    );
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toBeFocused();

    await input.pressSequentially(".com");

    await expect(input).not.toHaveAttribute("aria-invalid");
    await expect(optionsPage.locator("#message")).toHaveText("");

    expect(await storedSites(serviceWorker)).toBeUndefined();
  });


  test.describe("when the permission is refused", () => {
    test.use({
      sitePermissions: { granted: [], grant: false, removable: true }
    });


    test("nothing is added", async ({ optionsPage, serviceWorker }) => {
      await addSite(optionsPage, "example.com");

      await expect(optionsPage.locator("#message")).toHaveText(
        "Site permission was not granted."
      );
      expect(await storedSites(serviceWorker)).toBeUndefined();
    });
  });


  test.describe("with example.com stored and permitted", () => {
    test.use({
      sitePermissions: { granted: EXAMPLE_ORIGINS, grant: true, removable: true },

      optionsPage: async ({ context, extensionId, sitePermissions, serviceWorker }, use) => {
        await storeSites(serviceWorker, ["example.com"]);

        const page = await context.newPage();

        await page.addInitScript(fakeSitePermissions, sitePermissions);
        await page.goto(`chrome-extension://${extensionId}/options/options.html`);

        await use(page);
      }
    });


    test("adding it again says it is already enabled", async ({ optionsPage }) => {
      await expect(optionsPage.getByRole("listitem")).toHaveText(["example.comRemove"]);

      await addSite(optionsPage, "example.com");

      await expect(optionsPage.locator("#message")).toHaveText(
        "This site is already enabled."
      );
    });


    test("removing it drops the site and its permission", async ({ optionsPage, serviceWorker }) => {
      await optionsPage.getByRole("button", { name: "Remove example.com" }).click();

      await expect(optionsPage.locator("#message")).toHaveText("example.com removed.");
      await expect(optionsPage.getByText("No automatic sites added yet.")).toBeVisible();

      expect(await storedSites(serviceWorker)).toEqual([]);
      expect(
        await optionsPage.evaluate(() => window.fakePermissions.granted.size)
      ).toBe(0);
    });


    test("removing a site moves focus to the next Remove button", async ({ optionsPage }) => {
      await optionsPage.getByLabel("Website domain").fill("other.com");
      await optionsPage.getByRole("button", { name: "Add Site" }).click();
      await expect(optionsPage.getByRole("listitem")).toHaveCount(2);

      await optionsPage.getByRole("button", { name: "Remove example.com" }).click();

      await expect(
        optionsPage.getByRole("button", { name: "Remove other.com" })
      ).toBeFocused();
    });


    test("removing the last site moves focus to the domain field", async ({ optionsPage }) => {
      await optionsPage.getByRole("button", { name: "Remove example.com" }).click();
      await expect(optionsPage.locator("#message")).toHaveText("example.com removed.");

      await expect(optionsPage.getByLabel("Website domain")).toBeFocused({ timeout: 1000 });
    });
  });


  test.describe("with several sites stored", () => {
    test.use({
      sitePermissions: { granted: EXAMPLE_ORIGINS, grant: true, removable: true },

      optionsPage: async ({ context, extensionId, sitePermissions, serviceWorker }, use) => {
        await storeSites(serviceWorker, ["a.com", "b.com", "example.com"]);

        const page = await context.newPage();

        await page.addInitScript(fakeSitePermissions, sitePermissions);
        await page.goto(`chrome-extension://${extensionId}/options/options.html`);

        await use(page);
      }
    });


    test("they are listed after one look at the permissions", async ({ optionsPage }) => {
      await expect(optionsPage.getByRole("listitem")).toHaveText([
        "a.com (permission removed)Remove",
        "b.com (permission removed)Remove",
        "example.comRemove"
      ]);

      expect(await optionsPage.evaluate(() => window.fakePermissions.getAllCalls)).toBe(1);
    });
  });


  test.describe("with example.com stored but its permission revoked", () => {
    test.use({
      sitePermissions: { granted: [], grant: true, removable: true },

      optionsPage: async ({ context, extensionId, sitePermissions, serviceWorker }, use) => {
        await storeSites(serviceWorker, ["example.com"]);

        const page = await context.newPage();

        await page.addInitScript(fakeSitePermissions, sitePermissions);
        await page.goto(`chrome-extension://${extensionId}/options/options.html`);

        await use(page);
      }
    });


    test("the list says so and adding it again re-enables it", async ({ optionsPage }) => {
      await expect(optionsPage.getByRole("listitem")).toHaveText([
        "example.com (permission removed)Remove"
      ]);

      await addSite(optionsPage, "example.com");

      await expect(optionsPage.locator("#message")).toHaveText("example.com re-enabled.");
      await expect(optionsPage.getByRole("listitem")).toHaveText(["example.comRemove"]);
    });


    test("re-enabling it without a sync takes the permission back", async ({ optionsPage, serviceWorker }) => {
      await optionsPage.evaluate(() => {
        chrome.runtime.sendMessage = () => Promise.resolve({ ok: false });
      });
      await addSite(optionsPage, "example.com");

      await expect(optionsPage.locator("#message")).toHaveText("The site could not be added.");
      await expect(optionsPage.getByRole("listitem")).toHaveText([
        "example.com (permission removed)Remove"
      ]);

      expect(await storedSites(serviceWorker)).toEqual(["example.com"]);
      expect(
        await optionsPage.evaluate(() => window.fakePermissions.granted.size)
      ).toBe(0);
    });
  });


  test.describe("when the permission cannot be removed", () => {
    test.use({
      sitePermissions: { granted: EXAMPLE_ORIGINS, grant: true, removable: false },

      optionsPage: async ({ context, extensionId, sitePermissions, serviceWorker }, use) => {
        await storeSites(serviceWorker, ["example.com"]);

        const page = await context.newPage();

        await page.addInitScript(fakeSitePermissions, sitePermissions);
        await page.goto(`chrome-extension://${extensionId}/options/options.html`);

        await use(page);
      }
    });


    test("removing the site is rolled back", async ({ optionsPage, serviceWorker }) => {
      await optionsPage.getByRole("button", { name: "Remove example.com" }).click();

      await expect(optionsPage.locator("#message")).toHaveText(
        "The site could not be removed."
      );
      await expect(optionsPage.getByRole("listitem")).toHaveText(["example.comRemove"]);
      expect(await storedSites(serviceWorker)).toEqual(["example.com"]);
    });
  });


  test("a site the background script cannot synchronize is not kept", async ({ optionsPage, serviceWorker }) => {
    await optionsPage.evaluate(() => {
      chrome.runtime.sendMessage = () => Promise.resolve({ ok: false });
    });
    await addSite(optionsPage, "example.com");

    await expect(optionsPage.locator("#message")).toHaveText("The site could not be added.");
    await expect(optionsPage.locator("#message")).toHaveClass(/error/);
    await expect(optionsPage.getByLabel("Website domain")).toBeEnabled();
    await expect(optionsPage.getByText("No automatic sites added yet.")).toBeVisible();

    // It was stored and granted before the sync failed; both are undone.
    expect(await storedSites(serviceWorker)).toEqual([]);
    expect(
      await optionsPage.evaluate(() => window.fakePermissions.granted.size)
    ).toBe(0);
  });


  test("a site that cannot be stored gives its permission back", async ({ optionsPage, serviceWorker }) => {
    await optionsPage.evaluate(() => {
      chrome.storage.local.set = () => Promise.reject(new Error("Storage failed."));
    });
    await addSite(optionsPage, "example.com");

    await expect(optionsPage.locator("#message")).toHaveText("The site could not be added.");
    await expect(optionsPage.locator("#message")).toHaveClass(/error/);
    await expect(optionsPage.getByLabel("Website domain")).toBeEnabled();

    // The request had granted it; the failed write takes it back.
    expect(
      await optionsPage.evaluate(() => window.fakePermissions.granted.size)
    ).toBe(0);
    expect(await storedSites(serviceWorker)).toBeUndefined();
  });


  test("a permission that cannot be given back is logged", async ({ optionsPage }) => {
    const errors = [];

    optionsPage.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });

    await optionsPage.evaluate(() => {
      chrome.storage.local.set = () => Promise.reject(new Error("Storage failed."));
      chrome.permissions.remove = () => Promise.reject(new Error("Permissions failed."));
    });
    await addSite(optionsPage, "example.com");

    await expect(optionsPage.locator("#message")).toHaveText("The site could not be added.");
    expect(errors.join("\n")).toContain("Permission rollback failed");
  });


  test("a list that cannot be loaded says so", async ({ optionsPage }) => {
    await optionsPage.addInitScript(() => {
      if (!globalThis.chrome?.storage) {
        return;
      }

      chrome.storage.local.get = () => Promise.reject(new Error("Storage failed."));
    });
    await optionsPage.reload();

    await expect(optionsPage.locator("#message")).toHaveText("The site list could not be loaded.");
    await expect(optionsPage.locator("#message")).toHaveClass(/error/);
  });
});


/*
 * A copy of the extension with its optional site access granted at
 * install, so the background script's real permission checks pass and
 * the automatic-site content script is really registered and injected.
 */
test.describe("with site access granted", () => {
  test.use({
    extensionPath: async ({}, use, testInfo) => {
      const copy = testInfo.outputPath("extension");

      for (const entry of ["manifest.json", "icons", "options", "src"]) {
        fs.cpSync(
          path.join(EXTENSION_PATH, entry),
          path.join(copy, entry),
          { recursive: true }
        );
      }

      const manifestPath = path.join(copy, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

      manifest.host_permissions = manifest.optional_host_permissions;
      delete manifest.optional_host_permissions;

      fs.writeFileSync(manifestPath, JSON.stringify(manifest));

      await use(copy);
    }
  });


  test.beforeEach(async ({ context }) => {
    const page = "<p id=\"text\">Text</p>";

    await routePages(context, {
      "http://example.test/": page,
      "http://www.sub.example.test/": page,
      "http://other.test/": page
    });
  });


  function registeredMatches(serviceWorker) {
    return serviceWorker.evaluate(async () => {
      return (await chrome.scripting.getRegisteredContentScripts())
        .flatMap((script) => script.matches)
        .sort();
    });
  }


  async function isEnabled(page, url) {
    await page.goto(url);

    return page.evaluate(() => {
      return document.documentElement.hasAttribute("data-enable-copy-right-click");
    });
  }


  test("a site added on the options page is enabled on every visit, subdomains included", async ({ page, openExtensionPage }) => {
    const options = await openExtensionPage("options/options.html");

    await options.getByLabel("Website domain").fill("example.test");
    await options.getByRole("button", { name: "Add Site" }).click();
    await expect(options.locator("#message")).toHaveText("example.test added.");

    expect(await isEnabled(page, "http://example.test/")).toBe(true);
    expect(await isEnabled(page, "http://www.sub.example.test/")).toBe(true);
    expect(await isEnabled(page, "http://other.test/")).toBe(false);
  });


  test("the registered content script follows the stored list", async ({ page, serviceWorker }) => {
    await storeSites(serviceWorker, ["a.test", "example.test"]);

    await expect.poll(() => registeredMatches(serviceWorker)).toEqual([
      "http://*.a.test/*",
      "http://*.example.test/*",
      "http://a.test/*",
      "http://example.test/*",
      "https://*.a.test/*",
      "https://*.example.test/*",
      "https://a.test/*",
      "https://example.test/*"
    ]);

    await storeSites(serviceWorker, ["a.test"]);

    await expect.poll(() => registeredMatches(serviceWorker)).toEqual([
      "http://*.a.test/*",
      "http://a.test/*",
      "https://*.a.test/*",
      "https://a.test/*"
    ]);

    expect(await isEnabled(page, "http://example.test/")).toBe(false);

    await storeSites(serviceWorker, []);

    await expect.poll(() => registeredMatches(serviceWorker)).toEqual([]);
  });
});
