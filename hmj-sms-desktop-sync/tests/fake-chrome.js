import path from "node:path";

import { test as base } from "@playwright/test";

import { openFakeHarness } from "../../test-support/fake-chrome.js";


const EXTENSION_PATH = path.resolve(__dirname, "..");


// The service worker's entry script.
const ENTRY = "/src/background.js";


// test.use({ permissionLevel: "denied" }) turns notifications off.
export const test = base.extend({
  permissionLevel: ["granted", { option: true }]
});


/*
 * Opens a page where the background entry script and sms-core.js run
 * unchanged against installFakeChrome(options); see openFakeHarness().
 * A real browser cannot hand a test its notifications. The entry's
 * createBackground() result is window.background.
 */
export async function openHarness(page, options = {}) {
  await openFakeHarness(page, EXTENSION_PATH, installFakeChrome, options);

  await page.evaluate(async (entry) => {
    window.background = (await import(entry)).background;
  }, ENTRY);
}


/*
 * Stops the background and starts it again, as the browser does with an
 * idle worker, by importing a fresh copy of the entry script: nothing
 * it kept in memory is left.
 */
export async function restartBackground(page) {
  await page.evaluate(async (entry) => {
    window.fake.stop();
    window.background = (await import(`${entry}?restart=${Date.now()}`)).background;
  }, ENTRY);
}


/*
 * Runs in the page. The page records what the scripts did on
 * window.fake: notifications created and cleared, local storage
 * writes, messages sent, text copied, offscreen documents open,
 * toolbar popups and windows opened.
 */
function installFakeChrome({ storage = {}, permissionLevel = "granted" }) {
  const { listeners, clone, storageArea, message, expose, i18n } = window.fakeKit;

  const fake = {
    notifications: [],
    cleared: [],
    // The keys of each chrome.storage.local write.
    writes: [],
    sentMessages: [],
    copiedTexts: [],
    offscreenDocuments: [],
    windows: [],
    // Toolbar popups opened; set openPopupFails to answer as without a window to open in.
    popupsOpened: 0,
    openPopupFails: false,
    // chrome.storage.session
    session: {},
    onMessage: listeners(),
    onClicked: listeners(),
    onButtonClicked: listeners(),
    onClosed: listeners(),
    onInstalled: listeners(),
    onStartup: listeners()
  };

  window.fake = fake;

  expose({
    runtime: {
      id: "test@extension",
      getURL: (file) => `chrome-extension://test-id/${file}`,
      onInstalled: fake.onInstalled,
      onStartup: fake.onStartup,
      onMessage: fake.onMessage,
      sendMessage: async (message) => {
        fake.sentMessages.push(message);

        // What the offscreen document would copy.
        if (message.type === "COPY_TO_CLIPBOARD") {
          fake.copiedTexts.push(message.text);
        }
      }
    },

    storage: {
      local: storageArea(clone(storage), (keys) => fake.writes.push(keys)),
      session: storageArea(fake.session)
    },

    notifications: {
      create: async (id, options) => {
        fake.notifications.push({ id, ...options });
      },
      clear: async (id) => {
        fake.cleared.push(id);
      },
      getPermissionLevel: async () => permissionLevel,
      onClicked: fake.onClicked,
      onButtonClicked: fake.onButtonClicked,
      onClosed: fake.onClosed
    },

    offscreen: {
      createDocument: async ({ url }) => {
        fake.offscreenDocuments.push(url);
      },
      closeDocument: async () => {
        fake.offscreenDocuments.length = 0;
      }
    },

    windows: {
      create: async (details) => {
        fake.windows.push(details);
      }
    },

    action: {
      openPopup: async () => {
        if (fake.openPopupFails) {
          throw new Error("Could not find an active browser window.");
        }
        fake.popupsOpened++;
      }
    },

    i18n
  }, false);

  chrome.runtime.getContexts = async ({ documentUrls }) => {
    return fake.offscreenDocuments.filter((url) => documentUrls.includes(chrome.runtime.getURL(url)));
  };

  // Sends a runtime message to the scripts and resolves with the reply.
  fake.message = (request) => message(fake.onMessage, request);

  fake.storage = () => chrome.storage.local.get(null);

  // Forgets the background's listeners, as when the browser stops it; storage stays.
  fake.stop = () => {
    for (const event of ["onMessage", "onClicked", "onButtonClicked", "onClosed", "onInstalled", "onStartup"]) {
      fake[event].list.length = 0;
    }
  };
}
