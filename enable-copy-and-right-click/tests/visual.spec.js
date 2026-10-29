import path from "node:path";

import {
  test,
  expect,
  openExtensionPage
} from "../../test-support/visual.js";

import { getSiteOrigins } from "../src/site-utils.js";


/*
 * Baseline screenshots of the automatic sites page in Chromium and
 * Firefox, drawn from stored sites and granted site access through
 * the fake extension APIs in test-support/visual.js.
 */
const EXTENSION_PATH = path.resolve(__dirname, "..");

// news.example.org is stored, but its site access was taken away.
const SITES = {
  storage: { automaticSites: ["docs.example.com", "news.example.org"] },
  origins: getSiteOrigins("docs.example.com")
};


function openAutomaticSites(page, state = {}) {
  return openExtensionPage(page, EXTENSION_PATH, "options/options.html", state);
}


for (const browserName of ["chromium", "firefox"]) {
  test.describe(browserName, () => {
    test.use({ engine: browserName });


    test("with no automatic sites", async ({ page }) => {
      await openAutomaticSites(page);

      await expect(page.locator("#empty-state")).toBeVisible();

      await expect(page).toHaveScreenshot(`empty-${browserName}.png`, { fullPage: true });
    });


    test("with automatic sites, one without site access", async ({ page }) => {
      await openAutomaticSites(page, SITES);

      await expect(page.locator("#site-list li")).toHaveText([
        "docs.example.comRemove",
        "news.example.org (permission removed)Remove"
      ]);

      await expect(page).toHaveScreenshot(`sites-${browserName}.png`, { fullPage: true });
    });


    test("after an invalid domain", async ({ page }) => {
      await openAutomaticSites(page);

      // Enter submits without leaving the pointer over Add Site.
      await page.getByLabel("Website domain").fill("not a domain");
      await page.getByLabel("Website domain").press("Enter");

      await expect(page.locator("#message")).toHaveText(
        "Enter a valid domain, such as example.com."
      );

      await expect(page).toHaveScreenshot(`invalid-domain-${browserName}.png`, { fullPage: true });
    });


    test("laid out right to left, as Arabic, Hebrew and Persian are", async ({ page }) => {
      await openAutomaticSites(page, { ...SITES, direction: "rtl" });

      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("#site-list li")).toHaveCount(2);

      await expect(page).toHaveScreenshot(`sites-rtl-${browserName}.png`, { fullPage: true });
    });


    test.describe("in dark mode", () => {
      test.use({ colorScheme: "dark" });


      test("with automatic sites, one without site access", async ({ page }) => {
        await openAutomaticSites(page, SITES);

        await expect(page.locator("#site-list li")).toHaveCount(2);

        await expect(page).toHaveScreenshot(`sites-dark-${browserName}.png`, { fullPage: true });
      });
    });
  });
}
