import zlib from "node:zlib";

import { test, expect } from "@playwright/test";

import {
  applyPlaybackSpeed,
  getMediaState
} from "../src/page.js";

import {
  addPlayingVideo,
  enterFullscreenPlayer,
  indicatorScript,
  videosArePlaying
} from "./media.js";


/*
 * The extension injects these functions with
 * chrome.scripting.executeScript({ func }), which serializes them
 * just like page.evaluate() does.
 */


test("getMediaState reports no media on an empty page", async ({ page }) => {
  await page.setContent("<p>Nothing to play.</p>");

  expect(await page.evaluate(getMediaState)).toEqual({
    hasMedia: false,
    isPlaying: false,
    playbackRate: 1
  });
});


test("getMediaState prefers playing media over the first element", async ({ page }) => {
  await page.setContent("<video></video>");
  await page.evaluate(addPlayingVideo, 1.5);
  await page.waitForFunction(videosArePlaying);

  expect(await page.evaluate(getMediaState)).toEqual({
    hasMedia: true,
    isPlaying: true,
    playbackRate: 1.5
  });
});


test("getMediaState falls back to the first element when nothing plays", async ({ page }) => {
  await page.setContent("<video></video><audio></audio>");

  await page.evaluate(() => {
    document.querySelector("video").playbackRate = 1.2;
    document.querySelector("audio").playbackRate = 2;
  });

  expect(await page.evaluate(getMediaState)).toEqual({
    hasMedia: true,
    isPlaying: false,
    playbackRate: 1.2
  });
});


test("applyPlaybackSpeed ignores speeds that are not listed", async ({ page }) => {
  await page.setContent("<video></video>");

  for (const speed of [1.3, 0, -1, 4, Number.NaN, "2", null]) {
    await page.evaluate(applyPlaybackSpeed, speed);
  }

  expect(
    await page.evaluate(() => document.querySelector("video").playbackRate)
  ).toBe(1);

  await expect(page.locator("#cvps-speed-indicator")).toHaveCount(0);
});


test("applyPlaybackSpeed sets every element and keeps one indicator", async ({ page }) => {
  await page.setContent("<video></video><audio></audio>");

  await page.evaluate(indicatorScript(1.5));
  await page.evaluate(indicatorScript(2));

  expect(
    await page.evaluate(() => {
      return [...document.querySelectorAll("video, audio")]
        .map((media) => media.playbackRate);
    })
  ).toEqual([2, 2]);

  const indicator = page.locator("#cvps-speed-indicator");

  await expect(indicator).toHaveCount(1);
  await expect(indicator).toContainText("2x");
});


test("the indicator says the speed in the language it is given", async ({ page }) => {
  const labels = { shown: "×1٫5", spoken: "سرعة التشغيل ×1٫5", lang: "ar", dir: "rtl" };

  await page.setContent("<video></video>");
  await page.evaluate(`(${applyPlaybackSpeed})(1.5, ${JSON.stringify(labels)})`);

  const indicator = page.locator("#cvps-speed-indicator");

  await expect(indicator).toHaveAttribute("lang", "ar");
  await expect(indicator).toHaveAttribute("dir", "rtl");
  await expect(indicator.locator("[aria-hidden]")).toHaveText("×1٫5");
  await expect(indicator).toContainText("سرعة التشغيل ×1٫5");
});


// [red, green, blue] of one pixel on screen. A 1x1 PNG keeps its pixel
// bytes unchanged under every row filter.
async function pixelAt(page, x, y) {
  const png = await page.screenshot({
    clip: { x, y, width: 1, height: 1 }
  });

  const data = [];

  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);

    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      data.push(png.subarray(offset + 8, offset + 8 + length));
    }

    offset += 12 + length;
  }

  return [...zlib.inflateSync(Buffer.concat(data)).subarray(1, 4)];
}


// The indicator's dark background, left of its text.
async function indicatorPixel(page) {
  const box = await page.locator("#cvps-speed-indicator").boundingBox();

  return pixelAt(page, box.x + 6, box.y + box.height / 2);
}


/*
 * A fullscreen player covers the rest of the page, whatever its
 * z-index. The white player shows through wherever the indicator is
 * hidden behind it.
 */
test("applyPlaybackSpeed shows the indicator over a fullscreen player", async ({ page }) => {
  await enterFullscreenPlayer(page);

  await page.evaluate(indicatorScript(1.5));

  expect(Math.max(...await indicatorPixel(page))).toBeLessThan(128);
});
