import path from "node:path";

import { openFakeHarness } from "../../test-support/fake-chrome.js";


const EXTENSION_PATH = path.resolve(__dirname, "..");


/*
 * Opens a page where cleaner.js and background.js run unchanged
 * against installFakeChrome(options) and browser data the test
 * controls; see openFakeHarness(). With firefox: true the fake APIs
 * are browser, as Firefox names them; otherwise chrome.
 */
export function openHarness(page, options = {}) {
  return openFakeHarness(page, EXTENSION_PATH, installFakeChrome, options);
}


/*
 * Runs in the page. history holds { url, time } entries; cookies hold
 * cookies.Cookie objects; tabs hold { url } objects. Everything the
 * code under test does is recorded on window.fake, browsingData calls
 * in siteDataCalls.
 */
function installFakeChrome({
  firefox = false,
  history = [],
  cookies = [],
  cookieStores = [{ id: firefox ? "firefox-default" : "0" }],
  containers = [],
  siteAccess = true,
  historyFails = false,
  noHistory = false,
  noSiteData = false,
  unremovableCookies = [],
  tabs = [],
  siteDataFails = false,
  storage = {}
}) {
  const { listeners, clone, storageArea, message, expose } = window.fakeKit;

  // Newest first, like Chromium's history; deleted URLs are skipped.
  const entries = [...history].sort((a, b) => b.time - a.time);
  const deleted = new Set();

  const fake = {
    log: [],
    searches: 0,
    deletedUrls: [],
    cookieQueries: [],
    removedCookies: [],
    siteDataCalls: [],
    optionsPagesOpened: 0,
    // Tests may switch this between clears.
    historyFails,
    storage: clone(storage),
    onStartup: listeners(),
    onInstalled: listeners(),
    onMessage: listeners(),
    onClicked: listeners()
  };

  window.fake = fake;

  // Resolves with the background script's reply to a runtime message.
  fake.message = (request) => message(fake.onMessage, request);

  fake.remainingHistory = () => {
    return entries.filter((entry) => !deleted.has(entry.url)).map((entry) => entry.url);
  };

  const api = {
    runtime: {
      getURL: (file) => `${firefox ? "moz-extension" : "chrome-extension"}://test-id/${file}`,
      onStartup: fake.onStartup,
      onInstalled: fake.onInstalled,
      onMessage: fake.onMessage,
      openOptionsPage: async () => {
        fake.optionsPagesOpened++;
      }
    },

    action: {
      onClicked: fake.onClicked
    },

    // [startTime, endTime), newest first, like Chromium's history.
    history: {
      search: async ({ startTime = 0, endTime = Infinity, maxResults = 100 }) => {
        fake.searches++;
        fake.log.push("search");

        if (fake.historyFails) {
          throw new Error("History is unavailable.");
        }

        const found = [];

        for (const entry of entries) {
          if (found.length === maxResults) {
            break;
          }

          if (entry.time >= startTime && entry.time < endTime && !deleted.has(entry.url)) {
            found.push({ url: entry.url, lastVisitTime: entry.time });
          }
        }

        return found;
      },

      deleteUrl: async ({ url }) => {
        fake.deletedUrls.push(url);
        deleted.add(url);
      }
    },

    cookies: {
      getAllCookieStores: async () => cookieStores,

      getAll: async (details) => {
        fake.cookieQueries.push(details);
        return cookies.filter((cookie) => cookie.storeId === details.storeId);
      },

      remove: async (details) => {
        if (unremovableCookies.includes(details.name)) {
          throw new Error(`Cannot remove ${details.name}.`);
        }

        fake.removedCookies.push(details);
        return details;
      }
    },

    permissions: {
      contains: async () => siteAccess
    },

    tabs: {
      query: async () => tabs
    },

    browsingData: {
      remove: async (options, dataTypes) => {
        if (siteDataFails) {
          throw new Error("Site data is unavailable.");
        }

        fake.siteDataCalls.push({ method: "remove", options, dataTypes });
      },

      removeCache: async (options) => {
        fake.siteDataCalls.push({ method: "removeCache", options });
      }
    },

    storage: {
      local: storageArea(fake.storage, (keys) => {
        fake.log.push(...keys.map((key) => `set ${key}`));
      })
    }
  };

  // Firefox for Android has no history API; browsingData needs its permission.
  if (noHistory) {
    delete api.history;
  }

  if (noSiteData) {
    delete api.browsingData;
  }

  if (firefox) {
    api.contextualIdentities = {
      // Rejects when the user has turned containers off.
      query: async () => {
        if (containers === "off") {
          throw new Error("Contextual identities are disabled.");
        }

        return containers;
      }
    };
  }

  expose(api, firefox);
}
