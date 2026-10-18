import {
  test as base,
  expect,
  chromium
} from "@playwright/test";


export { expect };


/*
 * Each test gets a fresh Chromium profile with one unpacked
 * extension loaded, so storage, history and cookies never leak
 * between tests. Pick the extension with test.use({ extensionPath }).
 *
 * channel "chromium" runs the full browser in new headless mode;
 * the default headless shell cannot load extensions.
 */
export const test = base.extend({
  extensionPath: [null, { option: true }],


  context: async ({ extensionPath }, use) => {
    if (!extensionPath) {
      throw new Error(
        "Set the extension with test.use({ extensionPath })."
      );
    }

    const context =
      await chromium.launchPersistentContext("", {
        channel: "chromium",
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`
        ]
      });

    await use(context);

    await context.close();
  },


  serviceWorker: async ({ context }, use) => {
    const [worker] = context.serviceWorkers();

    await use(
      worker ??
      await context.waitForEvent("serviceworker")
    );
  },


  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },


  // Set when the toolbar button injects scripts; see clickAction.
  actionInjects: [false, { option: true }],


  /*
   * Clicks the extension's toolbar button on a page's tab.
   * Chromium treats it as a user gesture, so activeTab is
   * granted just like a real click. The click goes to the tab in
   * front whatever tab it names, so the page is brought to the
   * front first, as it is for a real click.
   */
  triggerAction: async ({ context, extensionId }, use) => {
    const session =
      await context.browser().newBrowserCDPSession();

    await use(async (page) => {
      await page.bringToFront();

      const { targetInfos } =
        await session.send("Target.getTargets", {
          filter: [{ type: "tab" }]
        });

      const tabs = targetInfos.filter((target) => {
        return target.url === page.url();
      });

      if (tabs.length !== 1) {
        throw new Error(
          `Expected one tab at ${page.url()}, found ${tabs.length}.`
        );
      }

      await session.send("Extensions.triggerAction", {
        id: extensionId,
        targetId: tabs[0].targetId
      });
    });
  },


  /*
   * triggerAction, made reliable for extensions whose button
   * injects scripts with chrome.scripting.executeScript().
   *
   * The first click on a tab grants activeTab, and Chromium can
   * run the extension's executeScript() before the page learns of
   * the grant. The call then either injects into no frames or
   * rejects with "Cannot access contents of the page", and the
   * click is lost. Later clicks on the same page never race, so
   * only a click lost that way is sent again. The worker's
   * executeScript() is wrapped to record what each call reached;
   * what it does is unchanged.
   */
  clickAction: async ({ actionInjects, serviceWorker, triggerAction }, use) => {
    if (!actionInjects) {
      await use(triggerAction);

      return;
    }

    const injections = () => {
      return serviceWorker.evaluate(() => {
        if (!self.testInjections) {
          const executeScript =
            chrome.scripting.executeScript.bind(chrome.scripting);

          self.testInjections = [];

          chrome.scripting.executeScript = async (details) => {
            try {
              const results = await executeScript(details);

              self.testInjections.push(results.length);

              return results;
            } catch (error) {
              self.testInjections.push(error.message);

              throw error;
            }
          };
        }

        return self.testInjections;
      });
    };

    await use(async (page) => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const before = (await injections()).length;

        await triggerAction(page);

        await expect.poll(async () => {
          return (await injections()).length;
        }, {
          message: "the toolbar click never called executeScript()"
        }).toBeGreaterThan(before);

        const reached = (await injections())[before];

        if (
          reached !== 0 &&
          !String(reached).startsWith("Cannot access contents of the page")
        ) {
          return;
        }
      }
    });
  },


  // Opens one of the extension's own pages, such as its options page.
  openExtensionPage: async ({ context, extensionId }, use) => {
    await use(async (pagePath) => {
      const page = await context.newPage();

      await page.goto(
        `chrome-extension://${extensionId}/${pagePath}`
      );

      return page;
    });
  }
});


/*
 * Serves fake sites under the reserved .test domain from memory,
 * keyed by full URL. Unlisted URLs get a 404. Call it once per test.
 */
export async function routePages(context, pages) {
  await context.route(/^https?:\/\/[^/]+\.test\//, (route) => {
    const body = pages[route.request().url()];

    if (body === undefined) {
      return route.fulfill({
        status: 404,
        body: ""
      });
    }

    return route.fulfill({
      contentType: "text/html",
      body
    });
  });
}


/*
 * Records the text each live region (role="status") had when it was
 * added to the page, in window.insertedLiveRegions. Screen readers
 * skip the text a region arrives with, so it should arrive empty.
 */
export async function recordLiveRegions(page) {
  await page.addInitScript(() => {
    window.insertedLiveRegions = [];

    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) {
            continue;
          }

          const regions = [node, ...node.querySelectorAll("[role=status]")]
            .filter((element) => element.getAttribute("role") === "status");

          for (const region of regions) {
            window.insertedLiveRegions.push(region.textContent);
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}
