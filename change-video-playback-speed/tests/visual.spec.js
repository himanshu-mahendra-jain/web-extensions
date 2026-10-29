import { test, expect } from "../../test-support/visual.js";

import { enterFullscreenPlayer, indicatorScript } from "./media.js";


/*
 * Baseline screenshots of the on-page indicator. applyPlaybackSpeed()
 * runs straight in the page, with English labels: its inline styles are all there is to how
 * the indicator looks, so loading the extension would add nothing.
 */


// The indicator's 1.5-second timer never runs, so it stays up.
function keepIndicator(page) {
  return page.evaluate(() => {
    window.setTimeout = () => 0;
  });
}


for (const browserName of ["chromium", "firefox"]) {
  test.describe(browserName, () => {
    test.use({ engine: browserName });


    for (const speed of [1, 1.2, 1.5, 2]) {
      test(`the indicator at ${speed}x`, async ({ page }) => {
        await page.setContent("<p>Page text</p>");
        await keepIndicator(page);

        await page.evaluate(indicatorScript(speed));

        await expect(page.locator("#cvps-speed-indicator"))
          .toHaveScreenshot(`indicator-${speed}x-${browserName}.png`);
      });
    }


    test("the indicator over a fullscreen player", async ({ page }) => {
      await enterFullscreenPlayer(page);
      await keepIndicator(page);

      await page.evaluate(indicatorScript(1.5));

      await expect(page)
        .toHaveScreenshot(`fullscreen-${browserName}.png`);
    });
  });
}
