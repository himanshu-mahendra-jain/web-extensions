import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { test as base, expect } from "@playwright/test";

import { androidDevice } from "./android-device.js";
import { buildFirefoxPackage } from "./firefox-package.js";
import { RemoteFirefox, withTimeout } from "./firefox-rdp.js";


export { expect };


/*
 * Runs an extension's Firefox package in Firefox for Android on a
 * device, installed with web-ext and driven over the debugger socket.
 *
 * The device is the one android-device.js resolves, and
 * FIREFOX_ANDROID_APK the Firefox package (Nightly by default).
 */
const DEVICE = androidDevice();
const APK = process.env.FIREFOX_ANDROID_APK || "org.mozilla.fenix";
const ADB = process.env.ADB || "adb";

// GeckoView reads startup prefs from this file when the app is the debug app.
const CONFIG_FILE = `/data/local/tmp/${APK}-geckoview-config.yaml`;

const DEBUGGER_SOCKET = `localabstract:${APK}/firefox-debugger-socket`;

const ARTIFACTS_DIR = /\/data\/local\/tmp\/web-ext-artifacts-\d+/g;

const STATE_FILE = path.join(
  os.tmpdir(),
  `firefox-android-tests-${String(DEVICE).replace(/[^\w.-]/g, "_")}.json`
);


const execFileAsync = promisify(execFile);

async function adb(...args) {
  const { stdout } = await execFileAsync(ADB, ["-s", DEVICE, ...args]);

  return stdout.trim();
}

/*
 * What #checkManifest compares, with script URLs relative to base. Not
 * permissions: Firefox for Android leaves out those it lacks, such as
 * history.
 */
function manifestSummary(manifest, base = "") {
  const relative = (file) => file.replace(base, "");

  return {
    background: [
      manifest.background?.type ?? null,
      (manifest.background?.scripts ?? []).map(relative)
    ],
    contentScripts: (manifest.content_scripts ?? []).map(({ js }) => {
      return (js ?? []).map(relative);
    })
  };
}

// Ignores a failure, for cleanup that may find nothing left to undo.
function quietly(promise) {
  return promise.catch(() => {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


/*
 * Every change a run makes to the device is recorded here as it is
 * made, so the next run can undo what an interrupted one left behind.
 */
function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 4));
}

function remember(key, value) {
  const state = readState() ?? {
    forwards: [],
    reverses: [],
    artifacts: []
  };

  state[key] = [...new Set([...state[key], value])];
  writeState(state);
}

function forget(key, value) {
  const state = readState();

  if (state) {
    state[key] = state[key].filter((item) => item !== value);
    writeState(state);
  }
}


async function removeForward(local) {
  await quietly(adb("forward", "--remove", local));
  forget("forwards", local);
}

async function removeReverse(remote) {
  await quietly(adb("reverse", "--remove", remote));
  forget("reverses", remote);
}

async function removeArtifacts(directory) {
  // Only ever a directory web-ext created for this run.
  if (/^\/data\/local\/tmp\/web-ext-artifacts-\d+$/.test(directory)) {
    await quietly(adb("shell", "rm", "-rf", directory));
  }

  forget("artifacts", directory);
}


// Undoes everything the recorded run changed. Safe to call twice.
export async function restoreDevice() {
  const state = readState();

  if (!state) {
    return;
  }

  await quietly(adb("shell", "rm", "-f", CONFIG_FILE));

  if (state.debugApp) {
    await quietly(adb(
      "shell", "am", "set-debug-app",
      ...(state.waitForDebugger ? ["-w"] : []),
      "--persistent", state.debugApp
    ));
  } else {
    await quietly(adb("shell", "am", "clear-debug-app"));
  }

  await quietly(adb("shell", "am", "force-stop", APK));

  for (const local of state.forwards) {
    await removeForward(local);
  }

  for (const remote of state.reverses) {
    await removeReverse(remote);
  }

  for (const directory of state.artifacts) {
    await removeArtifacts(directory);
  }

  fs.rmSync(STATE_FILE, { force: true });
}


// Makes Firefox read CONFIG_FILE. Run once before the tests.
export async function prepareDevice() {
  await restoreDevice();

  if (await adb("get-state") !== "device") {
    throw new Error(`${DEVICE} is not ready; check adb devices.`);
  }

  const debugApp =
    await adb("shell", "settings", "get", "global", "debug_app");

  const waitForDebugger =
    await adb("shell", "settings", "get", "global", "wait_for_debugger");

  writeState({
    debugApp: debugApp === "null" ? null : debugApp,
    waitForDebugger: waitForDebugger === "1",
    forwards: [],
    reverses: [],
    artifacts: []
  });

  await adb("shell", "am", "set-debug-app", "--persistent", APK);
}


/*
 * Serves the test pages. Firefox sends every http:// request here
 * through its proxy prefs, so any host name works; https:// is not
 * proxied.
 */
class PageServer {
  #server;
  #pages = new Map();


  static async start() {
    const pages = new PageServer();

    pages.#server = http.createServer((request, response) => {
      pages.#respond(request, response);
    });

    pages.#server.on("connect", (request, socket) => {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });

    await new Promise((resolve) => {
      pages.#server.listen(0, "127.0.0.1", resolve);
    });

    return pages;
  }


  get port() {
    return this.#server.address().port;
  }


  // Maps full URLs to HTML, or to { status, headers, body }.
  route(pages) {
    for (const [url, page] of Object.entries(pages)) {
      this.#pages.set(new URL(url).href, page);
    }
  }


  clear() {
    this.#pages.clear();
  }


  #respond(request, response) {
    // A proxy request names the full URL; a direct one only the path.
    const url = new URL(request.url, `http://${request.headers.host}`);
    const page = this.#pages.get(url.href);

    if (page === undefined) {
      response.writeHead(404).end();

      return;
    }

    const {
      status = 200,
      headers = {},
      body = ""
    } = typeof page === "string" ? { body: page } : page;

    response.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      ...headers
    });

    response.end(body);
  }


  close() {
    this.#server.closeAllConnections();

    return new Promise((resolve) => this.#server.close(resolve));
  }
}


function configFor(pagePort) {
  return `prefs:
  # The parent process, where the toolbar button is clicked.
  devtools.chrome.enabled: true
  devtools.debugger.prompt-connection: false
  # Every http:// page comes from the PageServer behind adb reverse.
  network.proxy.type: 1
  network.proxy.http: "127.0.0.1"
  network.proxy.http_port: ${pagePort}
  network.proxy.no_proxies_on: ""
  network.proxy.allow_hijacking_localhost: true
  dom.security.https_first: false
  dom.security.https_first_schemeless: false
  # Keeps the event page loaded between test steps.
  extensions.background.idle.timeout: 3600000
`;
}


async function pushConfig(pagePort) {
  const local = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "firefox-android-")),
    "config.yaml"
  );

  fs.writeFileSync(local, configFor(pagePort));

  try {
    await adb("push", local, CONFIG_FILE);
  } finally {
    fs.rmSync(path.dirname(local), { recursive: true, force: true });
  }
}


/*
 * Starts `web-ext run` and waits until it has installed the package
 * as a temporary add-on. The forward and artifacts directory it
 * creates are recorded, because it leaves them behind when stopped.
 */
async function startWebExt(packageDir) {
  const webExt = spawn("web-ext", [
    "run",
    "--target=firefox-android",
    `--adb-device=${DEVICE}`,
    `--firefox-apk=${APK}`,
    ...(process.env.ADB ? [`--adb-bin=${ADB}`] : []),
    `--source-dir=${packageDir}`,
    "--no-input",
    "--no-reload",
    "--verbose"
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";

  const installed = new Promise((resolve, reject) => {
    const read = (chunk) => {
      output = (output + chunk).slice(-20000);

      for (const [directory] of String(chunk).matchAll(ARTIFACTS_DIR)) {
        remember("artifacts", directory);
      }

      const port = /on TCP port (\d+)/.exec(chunk);

      if (port) {
        remember("forwards", `tcp:${port[1]}`);
      }

      if (/ as a temporary add-on/.test(chunk)) {
        resolve();
      }
    };

    webExt.stdout.on("data", read);
    webExt.stderr.on("data", read);

    webExt.on("exit", (code) => {
      reject(new Error(`web-ext exited with ${code}:\n${output}`));
    });

    webExt.on("error", reject);
  });

  try {
    await withTimeout(installed, 120000, "web-ext did not install the extension");
  } catch (error) {
    webExt.kill("SIGKILL");

    throw error;
  }

  return webExt;
}


/*
 * Moves Firefox's window to the device's default display, display 0,
 * once web-ext has started it. On ChromeOS the window may open on an
 * external monitor instead of the built-in screen, and a screenshot's
 * size follows the density of the display it is taken on, so the
 * baselines would match or fail by where the window landed. A device
 * with one display has nothing to move.
 */
async function moveFirefoxToDefaultDisplay() {
  const firefoxRootTask = async () => {
    let rootTask;

    for (const line of (await adb("shell", "am", "stack", "list")).split("\n")) {
      const root = /^RootTask id=(\d+) .*\bdisplayId=(\d+)/.exec(line);

      if (root) {
        rootTask = { id: root[1], displayId: root[2] };
      } else if (rootTask && /^\s*taskId=\d+: /.test(line) && line.includes(`${APK}/`)) {
        return rootTask;
      }
    }

    return undefined;
  };

  const found = await firefoxRootTask();

  if (!found || found.displayId === "0") {
    return;
  }

  await adb("shell", "am", "display", "move-stack", found.id, "0");

  // The window is laid out again for the new display's density.
  for (let tries = 0; tries < 25; tries += 1) {
    if ((await firefoxRootTask())?.displayId === "0") {
      return;
    }

    await sleep(200);
  }

  throw new Error("Firefox's window did not move to the default display.");
}


async function stopWebExt(webExt) {
  if (webExt.exitCode !== null || webExt.signalCode !== null) {
    return;
  }

  const exited = new Promise((resolve) => webExt.once("exit", resolve));

  webExt.kill("SIGTERM");

  await withTimeout(exited, 5000, "web-ext did not stop")
    .catch(() => webExt.kill("SIGKILL"));
}


export class FirefoxAndroid {
  #client;
  #webExt;
  #parentConsole;
  #addonActor;
  #targets = [];


  static async launch(packageDir, pages) {
    const reverse = `tcp:${pages.port}`;

    await adb("reverse", reverse, reverse);
    remember("reverses", reverse);

    await pushConfig(pages.port);

    const firefox = new FirefoxAndroid();

    firefox.pages = pages;
    firefox.addonId = JSON.parse(
      fs.readFileSync(path.join(packageDir, "manifest.json"), "utf8")
    ).browser_specific_settings.gecko.id;

    try {
      firefox.#webExt = await startWebExt(packageDir);
      await moveFirefoxToDefaultDisplay();
      await firefox.#attach();
      await firefox.#checkManifest(packageDir);
    } catch (error) {
      await firefox.close();

      throw error;
    }

    return firefox;
  }


  /*
   * Firefox caches each add-on's parsed manifest by ID and version,
   * and has run a reinstall under the manifest it had before an edit.
   * Fails then; close() clears the cache, so a rerun parses afresh.
   */
  async #checkManifest(packageDir) {
    const packaged = JSON.parse(
      fs.readFileSync(path.join(packageDir, "manifest.json"), "utf8")
    );

    const { base, parsed } = await this.inBackground(`
      return {
        base: browser.runtime.getURL(""),
        parsed: browser.runtime.getManifest()
      };
    `);

    const ran = JSON.stringify(manifestSummary(parsed, base));
    const built = JSON.stringify(manifestSummary(packaged));

    if (ran !== built) {
      throw new Error(
        `Firefox ran ${this.addonId} under a cached manifest that differs ` +
        "from the package's. The cache is now cleared; run the tests again." +
        `\n  ran:      ${ran}\n  packaged: ${built}`
      );
    }
  }


  async #attach() {
    const port = await adb("forward", "tcp:0", DEBUGGER_SOCKET);

    remember("forwards", `tcp:${port}`);

    const client = this.#client = await RemoteFirefox.connect(Number(port));

    const { processDescriptor } =
      await client.request("root", "getProcess", { id: 0 });

    const { process } =
      await client.request(processDescriptor.actor, "getTarget");

    this.#parentConsole = process.consoleActor;

    // Fenix applies its own HTTPS-Only setting after the startup prefs.
    await this.inParent(
      "Services.prefs.setBoolPref('dom.security.https_only_mode', false);"
    );

    const { addons } = await client.request("root", "listAddons");
    const addon = addons.find((item) => item.id === this.addonId);

    if (!addon) {
      throw new Error(`${this.addonId} is not installed.`);
    }

    this.#addonActor = addon.actor;

    const { actor: watcher } = await client.request(
      addon.actor,
      "getWatcher",
      { isServerTargetSwitchingEnabled: true }
    );

    client.onEvent((packet) => {
      if (packet.from !== watcher) {
        return;
      }

      if (packet.type === "target-available-form") {
        this.#targets.push(packet.target);
      } else if (packet.type === "target-destroyed-form") {
        this.#targets = this.#targets.filter((target) => {
          return target.actor !== packet.target.actor;
        });
      }
    });

    await client.request(watcher, "watchTargets", { targetType: "frame" });

    await this.reset();
  }


  // Runs an async function body in the browser's parent process.
  inParent(body) {
    return this.#client.evaluate(this.#parentConsole, body);
  }


  // Runs an async function body in the extension's background page.
  async inBackground(body) {
    const background = await poll(() => {
      return this.#targets.findLast((target) => {
        return target.url.endsWith("/_generated_background_page.html");
      });
    }, 10000, "The background page did not start");

    return this.#client.evaluate(background.consoleActor, body);
  }


  // Reloads the extension, which starts its background page afresh.
  async reload() {
    const before = this.#targets.length;

    await this.#client.request(this.#addonActor, "reload");

    await poll(() => {
      return this.#targets.length !== before &&
        this.#targets.some((target) => {
          return target.url.endsWith("/_generated_background_page.html");
        });
    }, 10000, "The background page did not restart");
  }


  /*
   * Opens the URL the way a link from another app does, so Firefox
   * shows the tab. A tab the extension creates is not shown, and a
   * tab that is not shown has no viewport.
   */
  async openTab(url) {
    const tabIds = () => this.inBackground(
      "return (await browser.tabs.query({})).map((tab) => tab.id);"
    );

    const before = new Set(await tabIds());

    await adb(
      "shell", "am", "start",
      "-a", "android.intent.action.VIEW",
      "-d", `'${url}'`,
      APK
    );

    const [id] = await poll(async () => {
      const added = (await tabIds()).filter((tabId) => !before.has(tabId));

      return added.length ? added : null;
    }, 15000, `No tab opened for ${url}`);

    const tab = new Tab(this, id);

    await poll(async () => {
      return await tab.status() === "complete" &&
        await quietlyFalse(tab.evaluate(
          "return document.readyState === 'complete' && innerWidth > 0;"
        ));
    }, 30000, `${url} did not load`);

    return tab;
  }


  // Every open tab, as { id, url }.
  tabs() {
    return this.inParent(`
      return [...Services.wm.getEnumerator("navigator:geckoview")]
        .filter((window) => window.tab)
        .map((window) => ({
          id: window.tab.id,
          url: window.browser.currentURI.spec
        }));
    `);
  }


  // Opens one of the extension's pages in a tab Firefox does not show.
  async openExtensionTab(page) {
    const id = await this.inBackground(`
      const tab = await browser.tabs.create({
        url: browser.runtime.getURL(${JSON.stringify(page)})
      });
      return tab.id;
    `);

    const tab = new Tab(this, id);

    await poll(async () => {
      return await tab.status() === "complete" &&
        await quietlyFalse(tab.evaluate("return document.readyState === 'complete';"));
    }, 30000, `${page} did not load`);

    return tab;
  }


  /*
   * Opens one of the extension's pages in the tab Firefox shows, for
   * a screenshot. A tab openExtensionTab() creates is never laid out,
   * so its window stays 0x0 even when made active. A tab opened from
   * another app is shown, and the extension can navigate it.
   */
  async showExtensionTab(page) {
    this.pages.route({ "http://extension-page.test/": "" });

    const tab = await this.openTab("http://extension-page.test/");
    const url = await this.inBackground(`
      const url = browser.runtime.getURL(${JSON.stringify(page)});
      await browser.tabs.update(${tab.id}, { url });
      return url;
    `);

    await poll(async () => {
      return await tab.status() === "complete" &&
        await quietlyFalse(tab.evaluate(
          `return location.href === ${JSON.stringify(url)} &&
            document.readyState === "complete" && innerWidth > 0;`
        ));
    }, 30000, `${page} did not load`);

    return tab;
  }


  /*
   * Grants host permissions as accepting Firefox's prompt for them does.
   *
   * inParent() code runs in DevTools' own module loader, whose copy of
   * ExtensionPermissions caches the stored grants separately, so a
   * grant made through it was invisible to browser.permissions.remove().
   * Firefox's shared copy is used instead. Grants that copy made still
   * sit in the store without the extension having them, and adding an
   * origin the store already lists tells the extension nothing, so the
   * origins are removed from the store first.
   */
  grantOrigins(origins) {
    return this.inParent(`
      const { ExtensionPermissions } = ChromeUtils.importESModule(
        "resource://gre/modules/ExtensionPermissions.sys.mjs",
        { global: "shared" }
      );
      const id = ${JSON.stringify(this.addonId)};
      const permissions = { permissions: [], origins: ${JSON.stringify(origins)} };
      const { extension } = WebExtensionPolicy.getByID(id);

      await ExtensionPermissions.remove(id, permissions, extension);
      await ExtensionPermissions.add(id, permissions, extension);
    `);
  }


  /*
   * Errors thrown by the extension's own scripts since it was
   * installed, as "message (file:line)", from the browser console.
   */
  extensionErrors() {
    return this.inParent(`
      const base = WebExtensionPolicy.getByID(${JSON.stringify(this.addonId)}).getURL("");

      return Services.console.getMessageArray()
        .filter((message) => {
          return message instanceof Ci.nsIScriptError &&
            !(message.flags & Ci.nsIScriptError.warningFlag) &&
            message.sourceName.startsWith(base);
        })
        .map((message) => {
          const file = message.sourceName.slice(base.length);
          return \`\${message.errorMessage} (\${file}:\${message.lineNumber})\`;
        });
    `);
  }


  /*
   * Clicks the extension's toolbar button with the tab selected,
   * as a tap on the button in Firefox's menu does.
   */
  async clickAction(tab) {
    await this.inBackground(`await browser.tabs.update(${tab.id}, { active: true });`);

    await poll(() => {
      return this.inBackground(`
        const [active] = await browser.tabs.query({ active: true });
        return active?.id === ${tab.id};
      `);
    }, 5000, "The tab did not become active");

    await this.inParent(`
      const { GeckoViewWebExtension } = ChromeUtils.importESModule(
        "resource://gre/modules/GeckoViewWebExtension.sys.mjs"
      );
      await GeckoViewWebExtension.browserActionClick(${JSON.stringify(this.addonId)});
    `);
  }


  // The page target of the tab with this browserId.
  async tabTarget(browserId) {
    const { tabs } = await this.#client.request("root", "listTabs");
    const descriptor = tabs.find((tab) => tab.browserId === browserId);

    if (!descriptor) {
      throw new Error(`No debuggable tab has browser ${browserId}.`);
    }

    const { frame } = await this.#client.request(descriptor.actor, "getTarget");

    return frame;
  }


  evaluateInTarget(target, body) {
    return this.#client.evaluate(target.consoleActor, body);
  }


  /*
   * Closes every tab and clears pages, cookies and extension storage.
   * Origins a test granted outlive a reinstall, so every origin the
   * manifest does not require is revoked too.
   */
  async reset() {
    await this.inBackground(`
      const tabs = await browser.tabs.query({});
      await browser.tabs.remove(tabs.map((tab) => tab.id));
      await browser.storage?.local.clear();
      await browser.storage?.session?.clear();

      const manifest = browser.runtime.getManifest();

      const required = new Set([
        ...manifest.host_permissions ?? [],
        ...(manifest.content_scripts ?? []).flatMap((script) => script.matches)
      ]);

      const { origins = [] } = await browser.permissions.getAll();
      const granted = origins.filter((origin) => !required.has(origin));

      if (granted.length) {
        await browser.permissions.remove({ origins: granted });
      }
    `);

    await this.inParent("Services.cookies.removeAll();");

    this.pages.clear();
  }


  async close() {
    /*
     * Firefox caches the parsed manifest by add-on ID and version,
     * so the next install would run a manifest edited since under
     * the old one. Written now, as the force-stop below skips it.
     */
    if (this.#parentConsole) {
      await quietly(withTimeout(this.inParent(`
        const { ExtensionParent } = ChromeUtils.importESModule(
          "resource://gre/modules/ExtensionParent.sys.mjs"
        );

        await ExtensionParent.StartupCache.clearAddonData(${JSON.stringify(this.addonId)});
        await ExtensionParent.StartupCache._saveNow();
      `), 5000, "The manifest cache was not cleared"));
    }

    this.#client?.close();

    await quietly(adb("shell", "am", "force-stop", APK));

    if (this.#webExt) {
      await stopWebExt(this.#webExt);
    }

    const state = readState();

    for (const local of state?.forwards ?? []) {
      await removeForward(local);
    }

    for (const directory of state?.artifacts ?? []) {
      await removeArtifacts(directory);
    }

    await removeReverse(`tcp:${this.pages.port}`);
  }
}


class Tab {
  constructor(firefox, id) {
    this.firefox = firefox;
    this.id = id;
  }


  // The tab's load status, or null once it is closed.
  status() {
    return this.firefox.inBackground(`
      try {
        return (await browser.tabs.get(${this.id})).status;
      } catch {
        return null;
      }
    `);
  }


  // The tab's window in the parent process, as { url, browserId }.
  async browser() {
    return this.firefox.inParent(`
      for (const window of Services.wm.getEnumerator("navigator:geckoview")) {
        if (window.tab?.id === ${this.id}) {
          return {
            url: window.browser.currentURI.spec,
            browserId: window.browser.browserId
          };
        }
      }
      return null;
    `);
  }


  async url() {
    return (await this.browser())?.url ?? null;
  }


  // Runs an async function body in the tab's page.
  async evaluate(body) {
    const browser = await this.browser();

    if (!browser) {
      throw new Error(`Tab ${this.id} is closed.`);
    }

    const target = await this.firefox.tabTarget(browser.browserId);

    return this.firefox.evaluateInTarget(target, body);
  }


  /*
   * A PNG of the first element matching selector, as a Buffer for
   * expect().toMatchSnapshot(). Firefox draws it from the page alone,
   * as its devtools screenshot does, so the status bar and toolbar
   * never show; it is at the page's device pixel ratio. The element
   * is measured once fonts have loaded and a frame has been drawn,
   * so a late font cannot change its size after it is measured.
   */
  async screenshot(selector) {
    const area = await this.evaluate(`
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const element = document.querySelector(${JSON.stringify(selector)});

      if (!element) {
        return null;
      }

      const box = element.getBoundingClientRect();

      return {
        x: box.x + scrollX,
        y: box.y + scrollY,
        width: box.width,
        height: box.height,
        scale: devicePixelRatio
      };
    `);

    if (!area) {
      throw new Error(`Nothing in tab ${this.id} matches ${selector}.`);
    }

    const png = await this.firefox.inParent(`
      for (const window of Services.wm.getEnumerator("navigator:geckoview")) {
        if (window.tab?.id !== ${this.id}) {
          continue;
        }

        const { x, y, width, height, scale } = ${JSON.stringify(area)};

        const bitmap = await window.browser.browsingContext.currentWindowGlobal
          .drawSnapshot(new window.DOMRect(x, y, width, height), scale, "white");

        const canvas = window.document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "canvas"
        );

        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        bitmap.close();

        return canvas.toDataURL("image/png");
      }

      return null;
    `);

    if (!png) {
      throw new Error(`Tab ${this.id} is closed.`);
    }

    return Buffer.from(png.slice(png.indexOf(",") + 1), "base64");
  }


  /*
   * Clicks point, in CSS pixels of the page's viewport, with a native
   * mouse button: 0 is the left one, 1 the middle one and 2 the right
   * one. The page gets trusted events, as from a real mouse, which a
   * page cannot make up; adb presses only the left button. Resolves
   * once the events are sent, before the page has them.
   */
  async click(point, button = 0) {
    const scale = await this.#inputScale();

    await this.#nativeClick({ x: point.x / scale.x, y: point.y / scale.y }, button);
  }


  /*
   * CSS pixels of the page per native pixel. It is not 1 / devicePixelRatio
   * where the system scales input, as ChromeOS does for Android apps, so
   * it is measured once, from where a left click lands on a button laid
   * over the page. Extensions leave clicks on buttons alone, and the
   * page's own listeners never see it.
   */
  async #inputScale() {
    this.firefox.inputScale ??= await this.#measureInputScale();

    return this.firefox.inputScale;
  }


  async #measureInputScale() {
    const offset = 200;

    await this.evaluate(`
      const cover = document.createElement("button");

      cover.id = "native-click-cover";
      cover.style.cssText = "position: fixed; inset: 0; width: 100%; height: 100%; " +
        "margin: 0; z-index: 2147483647; opacity: 0;";

      window.nativeClickLanded = null;
      window.addEventListener("mouseup", function landed(event) {
        if (event.target !== cover) {
          return;
        }

        event.stopImmediatePropagation();
        window.removeEventListener("mouseup", landed, true);
        window.nativeClickLanded = { x: event.clientX, y: event.clientY };
      }, true);

      document.documentElement.append(cover);
    `);

    await this.#nativeClick({ x: offset, y: offset }, 0);

    const landed = await poll(() => {
      return this.evaluate("return window.nativeClickLanded;");
    }, 5000, "The measuring click did not land");

    await this.evaluate(`document.getElementById("native-click-cover").remove();`);

    return { x: landed.x / offset, y: landed.y / offset };
  }


  // Presses and releases button offset native pixels from the page's top left.
  #nativeClick(offset, button) {
    return this.firefox.inParent(`
      for (const window of Services.wm.getEnumerator("navigator:geckoview")) {
        if (window.tab?.id !== ${this.id}) {
          continue;
        }

        const utils = window.windowUtils;
        const x = Math.round(window.mozInnerScreenX * window.devicePixelRatio + ${offset.x});
        const y = Math.round(window.mozInnerScreenY * window.devicePixelRatio + ${offset.y});

        for (const message of [
          utils.NATIVE_MOUSE_MESSAGE_BUTTON_DOWN,
          utils.NATIVE_MOUSE_MESSAGE_BUTTON_UP
        ]) {
          utils.sendNativeMouseEvent(x, y, message, ${button}, 0, window.browser, null);
        }

        return;
      }

      throw new Error("Tab ${this.id} is closed.");
    `);
  }


  async isClosed() {
    return await this.status() === null;
  }


  waitForClose(timeout = 10000) {
    return poll(() => this.isClosed(), timeout, "The tab did not close");
  }
}


async function quietlyFalse(promise) {
  try {
    return await promise;
  } catch {
    return false;
  }
}


async function poll(check, timeout, message) {
  const deadline = Date.now() + timeout;

  for (;;) {
    const value = await check();

    if (value) {
      return value;
    }

    if (Date.now() > deadline) {
      throw new Error(`${message} within ${timeout} ms.`);
    }

    await sleep(200);
  }
}


/*
 * One Firefox runs per worker: the tests of one extension share it,
 * and reset() between tests closes the tabs and clears cookies and
 * extension storage. Pick the extension with
 * test.use({ extensionPath }).
 */
export const test = base.extend({
  extensionPath: [null, { option: true, scope: "worker" }],


  firefoxWorker: [async ({ extensionPath }, use, workerInfo) => {
    if (!extensionPath) {
      throw new Error(
        "Set the extension with test.use({ extensionPath })."
      );
    }

    const packageDir = await buildFirefoxPackage(
      extensionPath,
      path.join(workerInfo.project.outputDir, "firefox-android")
    );

    const pages = await PageServer.start();

    try {
      const firefox = await FirefoxAndroid.launch(packageDir, pages);

      try {
        await use(firefox);
      } finally {
        await firefox.close();
      }
    } finally {
      await pages.close();
    }
  }, { scope: "worker", timeout: 180000 }],


  firefox: async ({ firefoxWorker }, use) => {
    // Firefox can restore a tab from its last session after launch.
    await firefoxWorker.reset();

    await use(firefoxWorker);
  }
});
