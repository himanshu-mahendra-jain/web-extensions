import path from "node:path";

import {
  test,
  expect,
  openExtensionPage
} from "../../test-support/visual.js";

import { tabThrough } from "../../test-support/keyboard.js";

import { getSiteOrigins } from "../src/site-utils.js";


/*
 * What screen readers get from the automatic sites page, and how far
 * the keyboard alone gets, drawn from stored sites and granted site
 * access through the fake extension APIs in test-support/visual.js.
 */
const EXTENSION_PATH = path.resolve(__dirname, "..");


function openAutomaticSites(page, state = {}) {
  return openExtensionPage(page, EXTENSION_PATH, "options/options.html", {
    ...state,
    responses: { "sync-automatic-sites": { ok: true } }
  });
}


test("with no automatic sites", async ({ page }) => {
  await openAutomaticSites(page);

  await expect(page.locator("#empty-state")).toBeVisible();
  await expect(page.locator("body")).toMatchAriaSnapshot(`
    - main:
      - paragraph: Enable Copy and Right Click
      - link "GitHub repository, opens in a new tab":
        - /url: https://github.com/himanshu-mahendra-jain/web-extensions
        - text: ""
      - heading "Automatic Sites" [level=1]
      - paragraph: Automatically enable copying, text selection, and right click on the websites you add.
      - text: Website domain
      - textbox "Website domain":
        - /placeholder: example.com
      - button "Add Site"
      - status
      - paragraph: No automatic sites added yet.
  `);

  const { stops, withoutOutline } = await tabThrough(page);

  expect(stops).toEqual([
    'link "GitHub repository, opens in a new tab"',
    'textbox "Website domain"',
    'button "Add Site"'
  ]);
  expect(withoutOutline).toEqual([]);
});


test("with automatic sites, one without site access", async ({ page }) => {
  await openAutomaticSites(page, {
    storage: { automaticSites: ["docs.example.com", "news.example.org"] },
    origins: getSiteOrigins("docs.example.com")
  });

  await expect(page.locator("#site-list li")).toHaveCount(2);
  await expect(page.locator("body")).toMatchAriaSnapshot(`
    - main:
      - paragraph: Enable Copy and Right Click
      - link "GitHub repository, opens in a new tab":
        - /url: https://github.com/himanshu-mahendra-jain/web-extensions
        - text: ""
      - heading "Automatic Sites" [level=1]
      - paragraph: Automatically enable copying, text selection, and right click on the websites you add.
      - text: Website domain
      - textbox "Website domain":
        - /placeholder: example.com
      - button "Add Site"
      - status
      - list "Automatic sites":
        - listitem:
          - text: docs.example.com
          - button "Remove docs.example.com"
        - listitem:
          - text: news.example.org (permission removed)
          - button "Remove news.example.org"
  `);

  const { stops, withoutOutline } = await tabThrough(page);

  expect(stops).toEqual([
    'link "GitHub repository, opens in a new tab"',
    'textbox "Website domain"',
    'button "Add Site"',
    'button "Remove docs.example.com": Remove',
    'button "Remove news.example.org": Remove'
  ]);
  expect(withoutOutline).toEqual([]);
});


test("a site is added and removed from the keyboard", async ({ page }) => {
  await openAutomaticSites(page);

  const domain = page.getByLabel("Website domain");

  await domain.focus();
  await page.keyboard.type("docs.example.com");
  await page.keyboard.press("Enter");

  const remove = page.getByRole("button", { name: "Remove docs.example.com" });

  await expect(page.locator("#site-list li")).toHaveText(["docs.example.comRemove"]);

  await remove.focus();
  await page.keyboard.press("Space");

  await expect(page.locator("#site-list li")).toHaveCount(0);
  await expect(page.locator("#empty-state")).toBeVisible();
});
