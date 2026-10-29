import fs from "node:fs";
import path from "node:path";

import { test as base, expect } from "@playwright/test";

import { ORIGIN, defaultLocaleMessages, installFakeI18n, routeExtensionFiles } from "./harness.js";


export { expect };


/*
 * Baseline screenshots in Chromium and Firefox. test.use({ browserName })
 * is only allowed for a whole file, so each test launches the browser
 * named by test.use({ engine }) instead. test.use({ colorScheme }) and
 * test.use({ forcedColors }) work as usual. Dates are formatted in en-US and UTC on every machine.
 */
export const test = base.extend({
  engine: ["chromium", { option: true }],


  page: async ({ playwright, engine, colorScheme, forcedColors }, use) => {
    const browser = await playwright[engine].launch();
    // Headless Firefox goes fullscreen at its window size, 1366x768.
    const page = await browser.newPage({
      viewport: { width: 1366, height: 768 },
      colorScheme,
      forcedColors,
      locale: "en-US",
      timezoneId: "UTC"
    });

    await use(page);

    await browser.close();
  }
});


/*
 * Opens one of an extension's pages, such as options/options.html,
 * as an ordinary web page: the extension's files are served from
 * http://extension.test/, and the extension APIs are replaced by the
 * fake below before the page's own scripts run. Playwright's Firefox
 * cannot load extensions, so this is how both browsers draw the same
 * page from the same state. In Firefox the page gets the Firefox
 * package's files and APIs, unless state.firefox says otherwise.
 * state.direction "rtl" lays the page out as a right-to-left language
 * does; see installFakeI18n().
 */
export async function openExtensionPage(page, extensionPath, pagePath, state = {}) {
  const firefox = state.firefox ??
    page.context().browser().browserType().name() === "firefox";

  await routeExtensionFiles(page, extensionPath, { firefox });

  await page.addInitScript(installFakeI18n, {
    messages: defaultLocaleMessages(extensionPath),
    direction: state.direction
  });
  const manifest = JSON.parse(fs.readFileSync(
    path.join(extensionPath, firefox && fs.existsSync(path.join(extensionPath, "manifest-firefox.json"))
      ? "manifest-firefox.json"
      : "manifest.json"),
    "utf8"
  ));

  await page.addInitScript(installFakeChrome, { ...state, firefox, manifest });

  await page.goto(`${ORIGIN}/${pagePath}`);
}


/*
 * Runs in the page. storage seeds chrome.storage.local; origins are
 * the host permissions already granted, and a permission request is
 * granted. runtime.sendMessage() answers with responses[message.type].
 * namespaces adds empty APIs, such as "history", for pages that only
 * check whether the browser has them. firefox names the fake browser,
 * as Firefox does, instead of chrome, and makes runtime.getURL() name
 * a moz-extension: URL, for pages that tell Firefox apart by it. i18n
 * answers from the extension's default locale; see installFakeI18n().
 * runtime.getManifest() answers manifest, the package's manifest.json.
 */
function installFakeChrome({
  storage = {},
  origins = [],
  responses = {},
  namespaces = [],
  firefox = false,
  manifest = {}
}) {
  const clone = (value) => {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  };

  const event = () => {
    const listeners = [];

    return {
      listeners,
      addListener: (listener) => listeners.push(listener),
      removeListener: () => {},
      hasListener: (listener) => listeners.includes(listener)
    };
  };

  const data = clone(storage);
  const granted = new Set(origins);
  const storageChanged = event();

  const get = async (keys) => {
    if (keys === null || keys === undefined) {
      return clone(data);
    }

    const defaults = typeof keys === "string"
      ? { [keys]: undefined }
      : Array.isArray(keys)
        ? Object.fromEntries(keys.map((key) => [key, undefined]))
        : keys;

    return Object.fromEntries(
      Object.entries(defaults)
        .map(([key, fallback]) => [key, key in data ? clone(data[key]) : fallback])
        .filter(([, value]) => value !== undefined)
    );
  };

  const set = async (items) => {
    const changes = {};

    for (const [key, value] of Object.entries(items)) {
      changes[key] = { oldValue: clone(data[key]), newValue: clone(value) };
      data[key] = clone(value);
    }

    for (const listener of storageChanged.listeners) {
      listener(changes, "local");
    }
  };

  const fake = {
    runtime: {
      id: "extension-under-test",
      getURL: (file = "") => {
        const base = firefox ? "moz-extension://extension-under-test" : location.origin;

        return `${base}/${file.replace(/^\//, "")}`;
      },
      getManifest: () => clone(manifest),
      sendMessage: async (message) => clone(responses[message?.type]),
      openOptionsPage: async () => {},
      onMessage: event()
    },

    storage: {
      local: { get, set },
      onChanged: storageChanged
    },

    permissions: {
      contains: async ({ origins: wanted = [] }) => {
        return wanted.every((origin) => granted.has(origin));
      },
      getAll: async () => ({ origins: [...granted], permissions: [] }),
      request: async ({ origins: wanted = [] }) => {
        wanted.forEach((origin) => granted.add(origin));
        return true;
      },
      remove: async ({ origins: unwanted = [] }) => {
        unwanted.forEach((origin) => granted.delete(origin));
        return true;
      },
      onAdded: event(),
      onRemoved: event()
    },

    i18n: window.fakeI18n
  };

  for (const namespace of namespaces) {
    fake[namespace] = {};
  }

  Object.defineProperty(window, firefox ? "browser" : "chrome", {
    value: fake,
    configurable: true,
    writable: true
  });
}
