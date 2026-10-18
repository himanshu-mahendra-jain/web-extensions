import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

import { test as base, expect, firefox as playwrightFirefox } from "@playwright/test";

import { buildFirefoxPackage } from "./firefox-package.js";
import { RemoteFirefox, withTimeout } from "./firefox-rdp.js";


export { expect };


/*
 * Runs an extension's Firefox package in desktop Firefox, for what
 * Playwright's Firefox cannot do: it loads no extensions. Playwright's
 * Firefox build is started as a plain headless Firefox with its own
 * profile and debugger server, the package is installed as a
 * temporary add-on, and the browser is driven over the Remote
 * Debugging Protocol, as test-support/firefox-android.js drives
 * Firefox for Android.
 */

// Lets the debugger server in without asking, and keeps startup quiet.
const PREFS = {
  "devtools.debugger.remote-enabled": true,
  "devtools.chrome.enabled": true,
  "devtools.debugger.prompt-connection": false,
  "browser.shell.checkDefaultBrowser": false,
  "browser.startup.homepage_override.mstone": "ignore",
  "datareporting.policy.dataSubmissionEnabled": false,
  "toolkit.telemetry.reportingpolicy.firstRun": false
};


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


async function poll(check, timeout, message) {
  const deadline = Date.now() + timeout;

  for (;;) {
    const value = await check();

    if (value) {
      return value;
    }

    if (Date.now() > deadline) {
      throw new Error(message);
    }

    await sleep(100);
  }
}


function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}


/*
 * Serves the test pages at http://127.0.0.1:<port>/, keyed by path.
 * Unlisted paths get a 404.
 */
class PageServer {
  #server;
  #pages = {};


  static async start() {
    const pages = new PageServer();

    pages.#server = http.createServer((request, response) => {
      const body = pages.#pages[new URL(request.url, "http://localhost").pathname];

      response.writeHead(body === undefined ? 404 : 200, { "content-type": "text/html" });
      response.end(body ?? "");
    });

    await new Promise((resolve) => pages.#server.listen(0, "127.0.0.1", resolve));

    pages.origin = `http://127.0.0.1:${pages.#server.address().port}`;

    return pages;
  }


  route(pages) {
    Object.assign(this.#pages, pages);
  }


  close() {
    return new Promise((resolve) => this.#server.close(resolve));
  }
}


export class FirefoxDesktop {
  #process;
  #client;
  #parentConsole;
  #targets = [];


  static async launch(packageDir, profileDir, pages) {
    const firefox = new FirefoxDesktop();

    firefox.pages = pages;
    firefox.profileDir = profileDir;

    fs.rmSync(profileDir, { recursive: true, force: true });
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(profileDir, "user.js"),
      Object.entries(PREFS)
        .map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`)
        .join("")
    );

    const port = await freePort();

    firefox.#process = spawn(
      playwrightFirefox.executablePath(),
      ["-headless", "-no-remote", "-profile", profileDir, "-start-debugger-server", String(port)],
      { stdio: "ignore" }
    );

    try {
      firefox.#client = await poll(
        () => RemoteFirefox.connect(port).catch(() => null),
        30000,
        "Firefox did not open its debugger server"
      );

      await firefox.#install(packageDir);
    } catch (error) {
      await firefox.close();

      throw error;
    }

    return firefox;
  }


  async #install(packageDir) {
    const client = this.#client;

    const { addonsActor } = await client.request("root", "getRoot");
    const { addon } = await client.request(addonsActor, "installTemporaryAddon", {
      addonPath: packageDir
    });

    this.addonId = addon.id;

    const { processDescriptor } = await client.request("root", "getProcess", { id: 0 });
    const { process } = await client.request(processDescriptor.actor, "getTarget");

    this.#parentConsole = process.consoleActor;

    const { addons } = await client.request("root", "listAddons");
    const { actor } = addons.find((item) => item.id === addon.id);
    const { actor: watcher } = await client.request(actor, "getWatcher", {
      isServerTargetSwitchingEnabled: true
    });

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


  /*
   * Loads url in the tab, or in a new tab that is then selected, and
   * resolves with the tab's ID once the page has loaded.
   */
  load(url, tabId) {
    return this.inBackground(`
      const url = ${JSON.stringify(url)};
      let tabId = ${JSON.stringify(tabId ?? null)};

      // Without the tabs permission no URL is given, so a load is loading, then complete.
      const loading = new Set();
      const loaded = new Set();
      const listener = (id, changeInfo) => {
        if (changeInfo.status === "loading") {
          loading.add(id);
        } else if (changeInfo.status === "complete" && loading.has(id)) {
          loaded.add(id);
        }
      };

      browser.tabs.onUpdated.addListener(listener);

      try {
        if (tabId === null) {
          tabId = (await browser.tabs.create({ url })).id;
        } else {
          await browser.tabs.update(tabId, { url });
        }

        const deadline = Date.now() + 15000;

        while (!loaded.has(tabId)) {
          if (Date.now() > deadline) {
            throw new Error(\`\${url} did not load\`);
          }

          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        browser.tabs.onUpdated.removeListener(listener);
      }

      return tabId;
    `);
  }


  // Presses the extension's toolbar button in the selected tab.
  clickAction() {
    return this.inParent(`
      const { ExtensionParent } = ChromeUtils.importESModule(
        "resource://gre/modules/ExtensionParent.sys.mjs"
      );
      const { extension } = WebExtensionPolicy.getByID(${JSON.stringify(this.addonId)});
      const window = Services.wm.getMostRecentWindow("navigator:browser");

      await ExtensionParent.apiManager.global.browserActionFor(extension).triggerAction(window);
    `);
  }


  /*
   * The events that wake the extension's background page once it
   * has stopped, as { namespace: [event, ...] }.
   */
  wakingEvents() {
    return this.inParent(`
      const { extension } = WebExtensionPolicy.getByID(${JSON.stringify(this.addonId)});
      const events = {};

      for (const [namespace, listeners] of extension.persistentListeners ?? []) {
        events[namespace] = [...listeners.keys()].sort();
      }

      return events;
    `);
  }


  async close() {
    this.#client?.close();

    if (this.#process && this.#process.exitCode === null) {
      const exited = new Promise((resolve) => this.#process.once("exit", resolve));

      this.#process.kill();
      await withTimeout(exited, 10000, "Firefox did not exit").catch(() => {
        this.#process.kill("SIGKILL");
      });
    }

    fs.rmSync(this.profileDir, { recursive: true, force: true });
  }
}


/*
 * test.use({ extensionPath }) names the extension. Each worker builds
 * the package and starts one Firefox for the tests it runs, and pages
 * the tests route are served at firefox.pages.origin.
 */
export const test = base.extend({
  extensionPath: [null, { option: true, scope: "worker" }],


  firefox: [async ({ extensionPath }, use, workerInfo) => {
    if (!extensionPath) {
      throw new Error("Set the extension with test.use({ extensionPath }).");
    }

    // Workers run at once, so each builds and keeps its profile apart.
    const workerDir = path.join(
      workerInfo.project.outputDir,
      "firefox-desktop",
      `worker-${workerInfo.workerIndex}`
    );

    const packageDir = await buildFirefoxPackage(extensionPath, workerDir);
    const pages = await PageServer.start();

    try {
      const firefox = await FirefoxDesktop.launch(
        packageDir,
        path.join(workerDir, "profile"),
        pages
      );

      try {
        await use(firefox);
      } finally {
        await firefox.close();
      }
    } finally {
      await pages.close();
    }
  }, { scope: "worker", timeout: 120000 }]
});
