import path from "node:path";

import {
  test,
  expect,
  openExtensionPage
} from "../../test-support/visual.js";


/*
 * Baseline screenshots of the popup and the settings page in Chromium,
 * drawn from stored phones and messages through the fake extension
 * APIs in test-support/visual.js. The pairing text is fixed, so the QR
 * code is too, and the clock is stopped at NOW, so message ages do not
 * change.
 */
const EXTENSION_PATH = path.resolve(__dirname, "..");

const NOW = Date.UTC(2026, 0, 15, 9, 30);

const minutesAgo = (minutes) => NOW - minutes * 60 * 1000;

const PAIRING_CODE = "sms_pair:v1|https://fcm.googleapis.com/fcm/send/test-token|test-p256dh|test-auth|Chrome (Linux)|extension-under-test";

const PIXEL = { id: "pixel", name: "Pixel 8", lastSeen: minutesAgo(5), paired: true };
const GALAXY = { id: "galaxy", name: "Galaxy S24", lastSeen: minutesAgo(90), paired: true };

const FEED = [
  {
    id: 1,
    sender: "BANK",
    body: "Your code is 482913",
    otp: "482913",
    timestamp: minutesAgo(2),
    deviceName: "Pixel 8",
    simSlot: 1,
    simName: "Jio"
  },
  {
    id: 2,
    sender: "MOM",
    body: "Call me when you land",
    otp: null,
    timestamp: minutesAgo(125),
    deviceName: "Pixel 8",
    simSlot: 0,
    simName: "Airtel"
  }
];


async function open(page, pagePath, storage = {}) {
  await page.clock.setFixedTime(NOW);

  await openExtensionPage(page, EXTENSION_PATH, pagePath, {
    storage,
    responses: {
      GET_PAIRING_CODE: { ok: true, code: PAIRING_CODE }
    }
  });
}


test("the popup without a linked phone", async ({ page }) => {
  await open(page, "src/popup.html");

  await expect(page.locator("#qrContainer canvas, #qrContainer img").first()).toBeVisible();

  await expect(page.locator("body")).toHaveScreenshot("popup-unpaired-chromium.png");
});


test("the popup with a linked phone and messages", async ({ page }) => {
  await open(page, "src/popup.html", {
    connected_devices: { pixel: PIXEL },
    recent_sms_feed: FEED
  });

  await expect(page.locator(".card")).toHaveCount(2);
  await expect(page.locator("#deviceBanner")).toBeVisible();

  await expect(page.locator("body")).toHaveScreenshot("popup-messages-chromium.png");
});


test("the settings page without a linked phone", async ({ page }) => {
  await open(page, "options/options.html");

  await expect(page.locator("#txtPairingCode")).toHaveValue(PAIRING_CODE);
  await expect(page.locator("#optionsQrContainer canvas, #optionsQrContainer img").first()).toBeVisible();

  await expect(page).toHaveScreenshot("options-unpaired-chromium.png", { fullPage: true });
});


test("the settings page with two linked phones", async ({ page }) => {
  await open(page, "options/options.html", {
    connected_devices: { pixel: PIXEL, galaxy: GALAXY },
    recent_sms_feed: FEED
  });

  await expect(page.locator("#deviceCountSpan")).toHaveText("2");

  await expect(page).toHaveScreenshot("options-paired-chromium.png", { fullPage: true });
});


for (const [theme, options] of [
  ["dark", { colorScheme: "dark" }],
  ["forced-colors", { forcedColors: "active" }]
]) {
  test.describe(`in ${theme} mode`, () => {
    test.use(options);


    test("the popup without a linked phone", async ({ page }) => {
      await open(page, "src/popup.html");

      await expect(page.locator("#qrContainer canvas")).toBeVisible();

      await expect(page.locator("body")).toHaveScreenshot(`popup-unpaired-${theme}-chromium.png`);
    });


    test("the popup with a linked phone and messages", async ({ page }) => {
      await open(page, "src/popup.html", {
        connected_devices: { pixel: PIXEL },
        recent_sms_feed: FEED
      });

      await expect(page.locator(".card")).toHaveCount(2);

      await expect(page.locator("body")).toHaveScreenshot(`popup-messages-${theme}-chromium.png`);
    });


    test("the settings page with two linked phones", async ({ page }) => {
      await open(page, "options/options.html", {
        connected_devices: { pixel: PIXEL, galaxy: GALAXY },
        recent_sms_feed: FEED
      });

      await expect(page.locator("#deviceCountSpan")).toHaveText("2");

      await expect(page).toHaveScreenshot(`options-paired-${theme}-chromium.png`, { fullPage: true });
    });


    test("the clear dialog", async ({ page }) => {
      await open(page, "options/options.html", { recent_sms_feed: FEED });

      await page.getByRole("button", { name: "Clear Recent Messages" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();

      await expect(page).toHaveScreenshot(`options-dialog-${theme}-chromium.png`);
    });
  });
}
