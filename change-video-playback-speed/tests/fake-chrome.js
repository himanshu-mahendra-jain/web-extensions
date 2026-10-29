import path from "node:path";

import { openFakeHarness } from "../../test-support/fake-chrome.js";


const EXTENSION_PATH = path.resolve(__dirname, "..");


/*
 * Opens a page where background.js and playback.js run unchanged
 * against installFakeChrome(options); see openFakeHarness(). With
 * firefox: true the fake APIs are browser, as Firefox names them;
 * otherwise chrome.
 */
export function openHarness(page, options = {}) {
  return openFakeHarness(page, EXTENSION_PATH, installFakeChrome, options);
}


/*
 * Runs in the page. Every tab has one video at playbackRate in its top
 * frame; executeScript returns that for the extension's media check and
 * records every call on window.fake. i18n answers in English.
 */
function installFakeChrome({
  activeTabs = [],
  queryFails = false,
  playbackRate = 1,
  noCommands = false,
  firefox = false
}) {
  const { listeners, recordingAction, recordingQuery, expose, i18n } = window.fakeKit;

  const fake = {
    activeTabs,
    queryFails,
    queries: [],
    scripts: [],
    badges: [],
    titles: [],
    onClicked: listeners(),
    onCommand: listeners()
  };

  window.fake = fake;

  const api = {
    action: recordingAction(fake),

    commands: {
      onCommand: fake.onCommand
    },

    tabs: {
      query: recordingQuery(fake)
    },

    runtime: {
      getManifest: () => ({ name: "Change Video Playback Speed" })
    },

    i18n,

    scripting: {
      executeScript: async ({ target, func, args }) => {
        fake.scripts.push({ tabId: target.tabId, func: func.name, args });

        if (func.name === "getMediaState") {
          return [{
            frameId: 0,
            result: { hasMedia: true, isPlaying: true, playbackRate }
          }];
        }

        return [{ frameId: 0, result: null }];
      }
    }
  };

  // Firefox for Android has no keyboard shortcuts.
  if (noCommands) {
    delete api.commands;
  }

  expose(api, firefox);
}
