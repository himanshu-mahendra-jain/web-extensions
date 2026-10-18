import path from "node:path";

import {
  test,
  expect,
  recordLiveRegions,
  routePages
} from "../../test-support/extension.js";

import {
  videosArePlaying,
  playingVideoScript
} from "./media.js";


test.use({
  extensionPath: path.resolve(__dirname, ".."),
  actionInjects: true
});


const PAGES = {
  "http://media.test/video":
    "<video></video>",

  "http://media.test/no-media":
    "<p>Nothing to play.</p>",

  "http://media.test/paused-video":
    "<video></video>",

  "http://media.test/playing-video":
    `<body>${playingVideoScript(1.5)}</body>`,

  "http://media.test/top-and-frame":
    `<video></video>
    <iframe src="/playing-video"></iframe>`,

  "http://media.test/frames-only":
    `<iframe src="/paused-video"></iframe>
    <iframe src="/playing-video"></iframe>`,

  "http://media.test/audio":
    "<audio></audio>",

  "http://media.test/cross-origin-frame":
    `<video></video>
    <iframe src="http://other.test/playing-video"></iframe>`,

  "http://other.test/playing-video":
    `<body>${playingVideoScript(1.5)}</body>`
};


const DEFAULT_ACTION_STATE = {
  badge: "",
  title: "Change Video Playback Speed"
};


test.beforeEach(async ({ context }) => {
  await routePages(context, PAGES);
});


function playbackRates(page) {
  return Promise.all(
    page.frames().map((frame) => {
      return frame.evaluate(() => {
        return [...document.querySelectorAll("video, audio")]
          .map((media) => media.playbackRate);
      });
    })
  ).then((rates) => rates.flat());
}


// The toolbar badge and tooltip the extension set for a page's tab.
function actionState(serviceWorker, page) {
  return serviceWorker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });

    return {
      badge: await chrome.action.getBadgeText({ tabId: tab.id }),
      title: await chrome.action.getTitle({ tabId: tab.id })
    };
  }, page.url());
}


/*
 * The badge and tooltip of every open tab. Unlike actionState(), it
 * needs no tab's URL, which activeTab only shows after a click there.
 */
function allActionStates(serviceWorker) {
  return serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});

    return Promise.all(tabs.map(async (tab) => {
      return {
        badge: await chrome.action.getBadgeText({ tabId: tab.id }),
        title: await chrome.action.getTitle({ tabId: tab.id })
      };
    }));
  });
}


function badgeColors(serviceWorker, page) {
  return serviceWorker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });

    return {
      background: await chrome.action.getBadgeBackgroundColor({ tabId: tab.id }),
      text: await chrome.action.getBadgeTextColor({ tabId: tab.id })
    };
  }, page.url());
}


async function waitForFramesToPlay(page) {
  for (const frame of page.frames()) {
    await frame.waitForFunction(videosArePlaying);
  }
}


test("each click moves to the next speed and wraps back to 1x", async ({ page, clickAction }) => {
  await page.goto("http://media.test/video");

  for (const speed of [1.2, 1.5, 2, 1, 1.2]) {
    await clickAction(page);

    await expect.poll(() => playbackRates(page)).toEqual([speed]);
  }
});


test("shows the new speed on the badge, the tooltip and the page", async ({ page, clickAction, serviceWorker }) => {
  await recordLiveRegions(page);
  await page.goto("http://media.test/video");

  await clickAction(page);

  const indicator = page.locator("#cvps-speed-indicator");

  await expect(indicator).toHaveRole("status");
  await expect(indicator).toHaveAttribute("aria-live", "polite");
  await expect(indicator).toContainText("1.2x");
  await expect(indicator).toContainText("Playback speed 1.2 times");

  // It arrives with only the visual label, which screen readers skip;
  // the spoken text is set once it is in the page.
  expect(await page.evaluate(() => window.insertedLiveRegions)).toEqual(["1.2x"]);

  expect(await actionState(serviceWorker, page)).toEqual({
    badge: "1.2",
    title: "Playback speed: 1.2x - Change Video Playback Speed"
  });

  // The indicator hides itself after 1.5 seconds.
  await expect(indicator).toHaveCount(0);
});


test("clicks made in quick succession are applied one after another", async ({ page, clickAction, triggerAction, serviceWorker }) => {
  await page.goto("http://media.test/video");

  await clickAction(page);
  await expect.poll(() => playbackRates(page)).toEqual([1.2]);

  // Sent together, so each click arrives before the last one finished.
  await Promise.all([
    triggerAction(page),
    triggerAction(page),
    triggerAction(page)
  ]);

  await expect.poll(() => playbackRates(page)).toEqual([1]);

  await expect.poll(async () => {
    return (await actionState(serviceWorker, page)).badge;
  }).toBe("1");
});


test("a speed set by the site moves to the next listed speed", async ({ page, clickAction }) => {
  await page.goto("http://media.test/video");

  const setRate = (rate) => {
    return page.evaluate((value) => {
      document.querySelector("video").playbackRate = value;
    }, rate);
  };

  await setRate(1.75);
  await clickAction(page);
  await expect.poll(() => playbackRates(page)).toEqual([2]);

  await setRate(3);
  await clickAction(page);
  await expect.poll(() => playbackRates(page)).toEqual([1]);

  await setRate(0.5);
  await clickAction(page);
  await expect.poll(() => playbackRates(page)).toEqual([1]);
});


test("a page without media is left alone", async ({ page, clickAction, serviceWorker }) => {
  await page.goto("http://media.test/no-media");

  // Records each script the worker starts to inject, by function name.
  await serviceWorker.evaluate(() => {
    const executeScript = chrome.scripting.executeScript.bind(chrome.scripting);

    self.startedScripts = [];

    chrome.scripting.executeScript = (details) => {
      self.startedScripts.push(details.func.name);

      return executeScript(details);
    };
  });

  await clickAction(page);

  // clickAction() returns once the media check has answered. Applying a
  // speed would have started right after it, before this evaluate runs.
  expect(await serviceWorker.evaluate(() => self.startedScripts))
    .toEqual(["getMediaState"]);

  await expect(page.locator("#cvps-speed-indicator")).toHaveCount(0);

  expect(await actionState(serviceWorker, page)).toEqual({
    badge: "",
    title: "Change Video Playback Speed"
  });
});


test("media in the top frame decides the speed for every frame", async ({ page, clickAction }) => {
  await page.goto("http://media.test/top-and-frame");
  await waitForFramesToPlay(page);

  // Top frame: paused 1x video. Frame: playing 1.5x video.
  await clickAction(page);

  await expect.poll(() => playbackRates(page)).toEqual([1.2, 1.2]);

  // Only the top frame shows the indicator.
  await expect(page.locator("#cvps-speed-indicator")).toHaveCount(1);
  await expect(
    page.frameLocator("iframe").locator("#cvps-speed-indicator")
  ).toHaveCount(0);
});


test("without top-frame media, playing media in a frame decides the speed", async ({ page, clickAction }) => {
  await page.goto("http://media.test/frames-only");
  await waitForFramesToPlay(page);

  // First frame: paused 1x video. Second frame: playing 1.5x video.
  await clickAction(page);

  await expect.poll(() => playbackRates(page)).toEqual([2, 2]);
});


test("the badge is blue with white text, on the clicked tab only", async ({ context, page, clickAction, serviceWorker }) => {
  const otherPage = await context.newPage();

  await otherPage.goto("http://media.test/paused-video");
  await page.goto("http://media.test/video");

  await clickAction(page);

  // The tooltip is set last.
  await expect.poll(() => actionState(serviceWorker, page)).toEqual({
    badge: "1.2",
    title: "Playback speed: 1.2x - Change Video Playback Speed"
  });

  expect(await badgeColors(serviceWorker, page)).toEqual({
    background: [26, 115, 232, 255],
    text: [255, 255, 255, 255]
  });

  const changed = (await allActionStates(serviceWorker)).filter((state) => {
    return state.badge !== "";
  });

  expect(changed).toEqual([await actionState(serviceWorker, page)]);
});


test("a browser page closed to extensions is left alone, and later clicks still work", async ({ page, clickAction, serviceWorker }) => {
  await page.goto("chrome://version");

  // Returns once the extension's executeScript() call was refused.
  await clickAction(page);

  for (const state of await allActionStates(serviceWorker)) {
    expect(state).toEqual(DEFAULT_ACTION_STATE);
  }

  await page.goto("http://media.test/video");

  await clickAction(page);

  await expect.poll(() => playbackRates(page)).toEqual([1.2]);
});


// activeTab reaches only the clicked site, as the README's limitations say.
test("media in a frame from another site keeps its speed", async ({ page, clickAction }) => {
  await page.goto("http://media.test/cross-origin-frame");
  await waitForFramesToPlay(page);

  // Top frame: paused 1x video. Frame from other.test: playing 1.5x video.
  await clickAction(page);

  await expect.poll(() => playbackRates(page)).toEqual([1.2, 1.5]);
});


test("the keyboard shortcut is registered as Alt+S", async ({ serviceWorker }) => {
  expect(await serviceWorker.evaluate(() => chrome.commands.getAll()))
    .toContainEqual({
      name: "change-playback-speed",
      description: "Change video playback speed",
      shortcut: "Alt+S"
    });
});


test("a page with only audio changes speed too", async ({ page, clickAction }) => {
  await page.goto("http://media.test/audio");

  await clickAction(page);

  await expect.poll(() => playbackRates(page)).toEqual([1.2]);
});
