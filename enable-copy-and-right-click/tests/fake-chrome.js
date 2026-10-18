import path from "node:path";

import { openFakeHarness } from "../../test-support/fake-chrome.js";


const EXTENSION_PATH = path.resolve(__dirname, "..");


/*
 * Opens a page where background.js runs unchanged against
 * installFakeChrome(options); see openFakeHarness(). With
 * firefox: true the fake APIs are browser, as Firefox names them;
 * otherwise chrome.
 */
export function openHarness(page, options = {}) {
  return openFakeHarness(page, EXTENSION_PATH, installFakeChrome, options);
}


/*
 * Runs in the page. Registers the events background.js listens to and
 * records every call that enables a tab on window.fake. With
 * allFramesFails, injecting into all frames throws and is not recorded;
 * with injectsNothing, every injection reaches no frame.
 */
function installFakeChrome({
  activeTabs = [],
  queryFails = false,
  allFramesFails = false,
  injectsNothing = false,
  noCommands = false,
  firefox = false
}) {
  const { listeners, storageArea, recordingAction, recordingQuery, expose } = window.fakeKit;

  const fake = {
    activeTabs,
    queryFails,
    allFramesFails,
    injectsNothing,
    queries: [],
    scripts: [],
    badges: [],
    titles: [],
    // storage.session
    session: {},
    onClicked: listeners(),
    onCommand: listeners(),
    onUpdated: listeners()
  };

  window.fake = fake;

  const api = {
    action: recordingAction(fake),

    commands: {
      onCommand: fake.onCommand
    },

    tabs: {
      onUpdated: fake.onUpdated,
      query: recordingQuery(fake)
    },

    scripting: {
      executeScript: async ({ target, files }) => {
        if (target.allFrames && fake.allFramesFails) {
          throw new Error("A frame cannot be scripted.");
        }

        fake.scripts.push({ ...target, files });

        // One result per frame reached, as browsers return.
        return fake.injectsNothing ? [] : [{ frameId: 0 }];
      }
    },

    runtime: {
      onInstalled: listeners(),
      onStartup: listeners(),
      onMessage: listeners()
    },

    storage: {
      onChanged: listeners(),
      session: storageArea(fake.session)
    },

    permissions: {
      onAdded: listeners(),
      onRemoved: listeners()
    }
  };

  // Firefox for Android has no keyboard shortcuts.
  if (noCommands) {
    delete api.commands;
  }

  expose(api, firefox);
}
