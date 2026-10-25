import { ORIGIN, defaultLocaleMessages, installFakeI18n, routeExtensionFiles } from "./harness.js";


/*
 * Opens a page that serves an extension's files and replaces the
 * WebExtension APIs with installFake(options), so its scripts run
 * unchanged against browser state the test controls. Import modules in
 * the page with import("/src/<file>.js"). With options.firefox the page
 * gets the Firefox package's files. installFake runs in the page after
 * installFakeKit(), so it can build on window.fakeKit.
 */
export async function openFakeHarness(page, extensionPath, installFake, options = {}) {
  await routeExtensionFiles(page, extensionPath, { firefox: options.firefox });

  await page.goto(`${ORIGIN}/`);
  await page.evaluate(installFakeI18n, { messages: defaultLocaleMessages(extensionPath) });
  await page.evaluate(installFakeKit);
  await page.evaluate(installFake, options);
}


/*
 * Runs in the page. The parts every extension's fake shares, on
 * window.fakeKit:
 * - listeners(): an event whose listeners are in .list
 * - clone(value): a copy, as the browser hands out
 * - storageArea(items, onSet): get and set over items, the way
 *   storage.local and storage.session behave; onSet gets the keys of
 *   each write
 * - recordingAction(fake): an action that records badge texts and
 *   titles in fake.badges and fake.titles
 * - recordingQuery(fake): a tabs.query() that records each query in
 *   fake.queries, answers fake.activeTabs and fails while
 *   fake.queryFails is set
 * - message(event, request, sender): resolves with the reply of the
 *   listener that answers a runtime message; sender is what the
 *   browser says sent it, by default one of the extension's own pages
 * - expose(api, firefox): names the fake APIs browser in Firefox and
 *   chrome elsewhere, never both
 * - i18n: an i18n API that answers from the extension's default
 *   locale; see installFakeI18n()
 */
function installFakeKit() {
  const listeners = () => {
    const list = [];
    return { list, addListener: (listener) => list.push(listener) };
  };

  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

  const storageArea = (items, onSet = () => {}) => ({
    get: async (keys) => {
      const names = keys === null || keys === undefined
        ? Object.keys(items)
        : [].concat(keys);

      return Object.fromEntries(
        names.filter((name) => name in items).map((name) => [name, clone(items[name])])
      );
    },

    set: async (values) => {
      onSet(Object.keys(values));
      Object.assign(items, clone(values));
    },

    remove: async (keys) => {
      for (const name of [].concat(keys)) {
        delete items[name];
      }
    }
  });

  const recordingAction = (fake) => ({
    onClicked: fake.onClicked,
    setBadgeText: async (details) => {
      fake.badges.push(details);
    },
    setBadgeBackgroundColor: async () => {},
    setBadgeTextColor: async () => {},
    setTitle: async (details) => {
      fake.titles.push(details);
    }
  });

  const recordingQuery = (fake) => async (query) => {
    fake.queries.push(query);

    if (fake.queryFails) {
      throw new Error("Tabs are unavailable.");
    }

    return fake.activeTabs;
  };

  // A sender as the browser describes one of the extension's own pages.
  const ownPage = () => {
    const { runtime } = window.browser ?? window.chrome;

    return { id: runtime.id, url: runtime.getURL("src/popup.html") };
  };

  const message = (event, request, sender = ownPage()) => {
    return new Promise((resolve) => {
      for (const listener of event.list) {
        listener(request, sender, resolve);
      }
    });
  };

  const expose = (api, firefox) => {
    window[firefox ? "browser" : "chrome"] = api;
  };

  window.fakeKit = {
    listeners,
    clone,
    storageArea,
    recordingAction,
    recordingQuery,
    message,
    expose,
    i18n: window.fakeI18n
  };
}
