import path from "node:path";

import {
  test,
  expect
} from "../../../test-support/firefox-android.js";

import { playingVideoScript } from "../media.js";


test.use({
  extensionPath: path.resolve(__dirname, "../..")
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
    <iframe src="/playing-video"></iframe>`
};


test.beforeEach(async ({ firefox }) => {
  firefox.pages.route(PAGES);
});


// The page's documents: the top one first, then its frames.
const DOCUMENTS = `[
  document,
  ...[...document.querySelectorAll("iframe")].map((frame) => frame.contentDocument)
]`;


function playbackRates(tab) {
  return tab.evaluate(`
    return ${DOCUMENTS}.flatMap((doc) => {
      return [...doc.querySelectorAll("video, audio")]
        .map((media) => media.playbackRate);
    });
  `);
}


function waitForFramesToPlay(tab) {
  return expect.poll(() => tab.evaluate(`
    return ${DOCUMENTS}.every((doc) => {
      return [...doc.querySelectorAll("video[data-playing]")].every((video) => {
        return !video.paused && video.readyState > 2;
      });
    });
  `)).toBe(true);
}


function indicators(tab) {
  return tab.evaluate(`
    return ${DOCUMENTS}.map((doc) => {
      const indicator = doc.getElementById("cvps-speed-indicator");

      return indicator && {
        role: indicator.getAttribute("role"),
        live: indicator.getAttribute("aria-live"),
        text: indicator.textContent
      };
    });
  `);
}


// The toolbar badge and title the extension set for the tab.
function actionState(firefox, tab) {
  return firefox.inBackground(`
    return {
      badge: await browser.action.getBadgeText({ tabId: ${tab.id} }),
      title: await browser.action.getTitle({ tabId: ${tab.id} })
    };
  `);
}


test("the background script runs without errors", async ({ firefox }) => {
  expect(await firefox.extensionErrors()).toEqual([]);
});


test("each click moves to the next speed and wraps back to 1x", async ({ firefox }) => {
  const tab = await firefox.openTab("http://media.test/video");

  for (const speed of [1.2, 1.5, 2, 1, 1.2]) {
    await firefox.clickAction(tab);

    await expect.poll(() => playbackRates(tab)).toEqual([speed]);
  }
});


test("shows the new speed on the badge, the title and the page", async ({ firefox }) => {
  const tab = await firefox.openTab("http://media.test/video");

  await firefox.clickAction(tab);

  await expect.poll(() => indicators(tab)).toEqual([
    expect.objectContaining({
      role: "status",
      live: "polite",
      text: expect.stringContaining("1.2x")
    })
  ]);

  expect(await actionState(firefox, tab)).toEqual({
    badge: "1.2",
    title: "Playback speed: 1.2x - Change Video Playback Speed"
  });

  // The indicator hides itself after 1.5 seconds.
  await expect.poll(() => indicators(tab)).toEqual([null]);
});


test("a speed set by the site moves to the next listed speed", async ({ firefox }) => {
  const tab = await firefox.openTab("http://media.test/video");

  for (const [siteRate, next] of [[1.75, 2], [3, 1], [0.5, 1]]) {
    await tab.evaluate(`document.querySelector("video").playbackRate = ${siteRate};`);

    await firefox.clickAction(tab);

    await expect.poll(() => playbackRates(tab)).toEqual([next]);
  }
});


test("a page without media is left alone", async ({ firefox }) => {
  const tab = await firefox.openTab("http://media.test/no-media");

  await firefox.clickAction(tab);

  // Nothing signals that the click was ignored, so give it time to act.
  await new Promise((resolve) => setTimeout(resolve, 1000));

  expect(await indicators(tab)).toEqual([null]);

  expect(await actionState(firefox, tab)).toEqual({
    badge: "",
    title: "Change Video Playback Speed"
  });
});


test("media in the top frame decides the speed for every frame", async ({ firefox }) => {
  const tab = await firefox.openTab("http://media.test/top-and-frame");

  await waitForFramesToPlay(tab);

  // Top frame: paused 1x video. Frame: playing 1.5x video.
  await firefox.clickAction(tab);

  await expect.poll(() => playbackRates(tab)).toEqual([1.2, 1.2]);

  // Only the top frame shows the indicator.
  expect((await indicators(tab)).map(Boolean)).toEqual([true, false]);
});


test("without top-frame media, playing media in a frame decides the speed", async ({ firefox }) => {
  const tab = await firefox.openTab("http://media.test/frames-only");

  await waitForFramesToPlay(tab);

  // First frame: paused 1x video. Second frame: playing 1.5x video.
  await firefox.clickAction(tab);

  await expect.poll(() => playbackRates(tab)).toEqual([2, 2]);
});


/*
 * Firefox for Android has no extension keyboard shortcuts, so the
 * background must start without browser.commands; the toolbar tests
 * above show it does.
 */
test("there is no keyboard shortcut API", async ({ firefox }) => {
  expect(await firefox.inBackground("return typeof browser.commands;"))
    .toBe("undefined");
});
