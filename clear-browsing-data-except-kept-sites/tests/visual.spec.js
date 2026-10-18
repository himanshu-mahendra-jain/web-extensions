import path from "node:path";

import {
  test,
  expect,
  openExtensionPage
} from "../../test-support/visual.js";

import { SITE_ORIGINS } from "../src/site-utils.js";


/*
 * Baseline screenshots of the settings page in Chromium and Firefox,
 * drawn from stored settings through the fake extension APIs in
 * test-support/visual.js.
 */
const EXTENSION_PATH = path.resolve(__dirname, "..");

const KEPT_SITES = ["github.com", "mail.example.com", "localhost"];

const LAST_CLEAR = {
  time: Date.UTC(2026, 0, 15, 9, 30),
  historyRemoved: 128,
  historySkipped: false,
  cookiesRemoved: 42,
  cookiesSkipped: false,
  siteDataCleared: true,
  failed: false
};


function openSettings(page, { storage = {}, siteAccess = true } = {}) {
  return openExtensionPage(page, EXTENSION_PATH, "options/options.html", {
    storage,
    origins: siteAccess ? SITE_ORIGINS : [],
    // In Firefox, which does not offer Clear Leftovers, the page gets moz-extension: URLs.
    namespaces: ["history", "browsingData"]
  });
}


for (const browserName of ["chromium", "firefox"]) {
  test.describe(browserName, () => {
    test.use({ engine: browserName });


    test("with no kept sites and nothing cleared yet", async ({ page }) => {
      await openSettings(page);

      await expect(page.locator("#empty-state")).toBeVisible();
      await expect(page.locator("#clearing-off")).toBeVisible();
      await expect(page.locator("#last-clear")).toHaveText("Nothing has been cleared yet.");

      await expect(page).toHaveScreenshot(`empty-${browserName}.png`, { fullPage: true });
    });


    test("warning before clearing is turned on", async ({ page }) => {
      await openSettings(page);

      await page.getByRole("button", { name: "Turn On Clearing" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();

      await expect(page).toHaveScreenshot(`turn-on-warning-${browserName}.png`);
    });


    test("with kept sites and the last clear", async ({ page }) => {
      await openSettings(page, {
        storage: { keptSites: KEPT_SITES, lastClear: LAST_CLEAR, clearOnStartup: true }
      });

      await expect(page.locator("#site-list li")).toHaveCount(3);
      await expect(page.locator("#last-clear")).toContainText("128 history entries");

      await expect(page).toHaveScreenshot(`kept-sites-${browserName}.png`, { fullPage: true });
    });


    test("with site access off", async ({ page }) => {
      await openSettings(page, {
        storage: { keptSites: KEPT_SITES, clearOnStartup: true },
        siteAccess: false
      });

      await expect(page.locator("#access-warning")).toBeVisible();
      await expect(page.locator("#site-list li")).toHaveCount(3);

      await expect(page).toHaveScreenshot(`site-access-off-${browserName}.png`, { fullPage: true });
    });


    test("after a clear that failed", async ({ page }) => {
      await openSettings(page, {
        storage: { keptSites: KEPT_SITES, lastClear: { ...LAST_CLEAR, failed: true }, clearOnStartup: true }
      });

      await expect(page.locator("#last-clear")).toHaveClass(/error/);
      await expect(page.locator("#site-list li")).toHaveCount(3);

      await expect(page).toHaveScreenshot(`clear-failed-${browserName}.png`, { fullPage: true });
    });


    test.describe("in dark mode", () => {
      test.use({ colorScheme: "dark" });


      test("with no kept sites and nothing cleared yet", async ({ page }) => {
        await openSettings(page);

        await expect(page.locator("#clearing-off")).toBeVisible();

        await expect(page).toHaveScreenshot(`empty-dark-${browserName}.png`, { fullPage: true });
      });


      test("warning before clearing is turned on", async ({ page }) => {
        await openSettings(page, { storage: { keptSites: KEPT_SITES } });

        await page.getByRole("button", { name: "Turn On Clearing" }).click();
        await expect(page.getByRole("dialog")).toBeVisible();

        await expect(page).toHaveScreenshot(`turn-on-warning-dark-${browserName}.png`);
      });


      test("with kept sites and the last clear", async ({ page }) => {
        await openSettings(page, {
          storage: { keptSites: KEPT_SITES, lastClear: LAST_CLEAR, clearOnStartup: true }
        });

        await expect(page.locator("#site-list li")).toHaveCount(3);
        await expect(page.locator("#last-clear")).toContainText("128 history entries");

        await expect(page).toHaveScreenshot(`kept-sites-dark-${browserName}.png`, { fullPage: true });
      });
    });
  });
}
