import path from "node:path";

import {
  test,
  expect
} from "../../../test-support/firefox-android.js";

import { indicatorScript } from "../media.js";


test.use({
  extensionPath: path.resolve(__dirname, "../..")
});


test.beforeEach(async ({ firefox }) => {
  firefox.pages.route({
    "http://media.test/text":
      "<p>Page text</p>"
  });
});


/*
 * Baseline screenshots of the on-page indicator in Firefox for Android,
 * as tests/visual.spec.js takes them on desktop: applyPlaybackSpeed()
 * runs straight in the page, with its 1.5-second timer stubbed out so
 * the indicator stays up.
 */
for (const speed of [1, 1.2, 1.5, 2]) {
  test(`the indicator at ${speed}x`, async ({ firefox }) => {
    const tab = await firefox.openTab("http://media.test/text");

    await tab.evaluate(`
      window.setTimeout = () => 0;
      ${indicatorScript(speed)};
    `);

    expect(await tab.screenshot("#cvps-speed-indicator"))
      .toMatchSnapshot(`indicator-${speed}x.png`);
  });
}
