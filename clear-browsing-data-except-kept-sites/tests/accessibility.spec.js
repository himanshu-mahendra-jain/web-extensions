import path from "node:path";

import {
  test,
  expect,
  openExtensionPage
} from "../../test-support/visual.js";

import { tabThrough } from "../../test-support/keyboard.js";

import { SITE_ORIGINS } from "../src/site-utils.js";


/*
 * What screen readers get from the settings page, and how far the
 * keyboard alone gets, drawn from stored settings through the fake
 * extension APIs in test-support/visual.js.
 */
const EXTENSION_PATH = path.resolve(__dirname, "..");

const KEPT_SITES = ["github.com", "mail.example.com"];

const LAST_CLEAR = {
  time: Date.UTC(2026, 0, 15, 9, 30),
  historyRemoved: 128,
  historySkipped: false,
  cookiesRemoved: 42,
  cookiesSkipped: false,
  siteDataCleared: true,
  failed: false
};


function openSettings(page, storage = {}) {
  return openExtensionPage(page, EXTENSION_PATH, "options/options.html", {
    storage,
    origins: SITE_ORIGINS,
    namespaces: ["history", "browsingData"]
  });
}


test("with no kept sites and nothing cleared yet", async ({ page }) => {
  await openSettings(page);

  await expect(page.locator("#empty-state")).toBeVisible();
  await expect(page.locator("body")).toMatchAriaSnapshot(`
    - main:
      - paragraph: Clear Browsing Data Except Kept Sites
      - link "GitHub repository, opens in a new tab":
        - /url: https://github.com/himanshu-mahendra-jain/web-extensions
        - text: ""
      - region "Clearing is off":
        - heading "Clearing is off" [level=2]
        - paragraph: Nothing is deleted yet. Add the sites you want to stay signed in to, then turn clearing on. From then on, each time the browser starts, the history, cookies and site data of every other site are deleted.
        - button "Turn On Clearing"
      - heading "Kept Sites" [level=1]
      - paragraph: These sites and their subdomains keep their history, cookies and site data, so you stay signed in. While clearing is on, every other site loses them each time the browser starts.
      - text: Website domains
      - textbox "Website domains":
        - /placeholder: example.com, github.com
      - button "Keep"
      - paragraph: Separate several sites with commas.
      - status
      - paragraph: No sites are kept yet, so a clear deletes the history, cookies and site data of every site.
      - region "Clearing":
        - heading "Clearing" [level=2]
        - checkbox "Clear automatically when the browser starts"
        - text: Clear automatically when the browser starts
        - button "Clear Now"
        - status: Nothing has been cleared yet.
        - paragraph: The first clear can take several minutes when the browser holds a lot of browsing data. You can keep browsing in the meantime.
      - region "Leftover Site Data":
        - heading "Leftover Site Data" [level=2]
        - paragraph: Once the history and cookies of a site are deleted, the extension no longer finds it, so its local storage, databases and cache stay. Clear Leftovers deletes the site data of every site you do not keep, found or not, after a clear like Clear Now.
        - button "Clear Leftovers"
        - status
      - region "Import and Export":
        - heading "Import and Export" [level=2]
        - paragraph: Save your kept sites to a text file, or replace them with the sites in one. A file can list one site per line or separate them with commas.
        - button "Export" [disabled]
        - button "Import"
        - status
  `);

  const { stops, withoutOutline } = await tabThrough(page);

  expect(stops).toEqual([
    'link "GitHub repository, opens in a new tab"',
    'button "Turn On Clearing"',
    'textbox "Website domains"',
    'button "Keep"',
    'checkbox "Clear automatically when the browser starts"',
    'button "Clear Now"',
    'button "Clear Leftovers"',
    'button "Import"'
  ]);
  expect(withoutOutline).toEqual([]);
});


test("with kept sites and the last clear", async ({ page }) => {
  await openSettings(page, { keptSites: KEPT_SITES, lastClear: LAST_CLEAR, clearOnStartup: true });

  await expect(page.locator("#site-list li")).toHaveCount(2);
  await expect(page.locator("body")).toMatchAriaSnapshot(`
    - main:
      - paragraph: Clear Browsing Data Except Kept Sites
      - link "GitHub repository, opens in a new tab":
        - /url: https://github.com/himanshu-mahendra-jain/web-extensions
        - text: ""
      - heading "Kept Sites" [level=1]
      - paragraph: These sites and their subdomains keep their history, cookies and site data, so you stay signed in. While clearing is on, every other site loses them each time the browser starts.
      - text: Website domains
      - textbox "Website domains":
        - /placeholder: example.com, github.com
      - button "Keep"
      - paragraph: Separate several sites with commas.
      - status
      - list "Kept sites":
        - listitem:
          - text: github.com
          - button "Remove github.com"
        - listitem:
          - text: mail.example.com
          - button "Remove mail.example.com"
      - region "Clearing":
        - heading "Clearing" [level=2]
        - checkbox "Clear automatically when the browser starts" [checked]
        - text: Clear automatically when the browser starts
        - button "Clear Now"
        - status: "Last cleared Jan 15, 2026, 9:30 AM: 128 history entries and 42 cookies deleted, along with site data and cache."
        - paragraph: The first clear can take several minutes when the browser holds a lot of browsing data. You can keep browsing in the meantime.
      - region "Leftover Site Data":
        - heading "Leftover Site Data" [level=2]
        - paragraph: Once the history and cookies of a site are deleted, the extension no longer finds it, so its local storage, databases and cache stay. Clear Leftovers deletes the site data of every site you do not keep, found or not, after a clear like Clear Now.
        - button "Clear Leftovers"
        - status
      - region "Import and Export":
        - heading "Import and Export" [level=2]
        - paragraph: Save your kept sites to a text file, or replace them with the sites in one. A file can list one site per line or separate them with commas.
        - button "Export"
        - button "Import"
        - status
  `);

  const { stops, withoutOutline } = await tabThrough(page);

  expect(stops).toEqual([
    'link "GitHub repository, opens in a new tab"',
    'textbox "Website domains"',
    'button "Keep"',
    'button "Remove github.com": Remove',
    'button "Remove mail.example.com": Remove',
    'checkbox "Clear automatically when the browser starts" [checked]',
    'button "Clear Now"',
    'button "Clear Leftovers"',
    'button "Export"',
    'button "Import"'
  ]);
  expect(withoutOutline).toEqual([]);
});


test("the warning before clearing works from the keyboard", async ({ page }) => {
  await openSettings(page, { keptSites: KEPT_SITES });

  const turnOn = page.getByRole("button", { name: "Turn On Clearing" });
  const dialog = page.getByRole("dialog");

  await turnOn.focus();
  await page.keyboard.press("Enter");

  await expect(dialog).toBeVisible();
  await expect(dialog).toMatchAriaSnapshot(`
    - dialog "Turn on clearing?":
      - heading "Turn on clearing?" [level=2]
      - paragraph: Each time the browser starts, history, cookies and site data will be deleted for every site except the ones you selected to keep. You will be signed out of all other sites.
      - paragraph: Deleted history, cookies and site data cannot be recovered.
      - button "Cancel"
      - button "Turn On Clearing"
  `);

  const { stops, withoutOutline } = await tabThrough(page, { fromFocus: true });

  // The page behind the dialog is out of reach.
  expect(stops).toEqual(['button "Cancel"', 'button "Turn On Clearing"']);
  expect(withoutOutline).toEqual([]);

  // Escape cancels and gives the focus back.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(turnOn).toBeFocused();
});
