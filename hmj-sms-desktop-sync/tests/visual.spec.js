import path from "node:path";

import {
  test,
  expect,
  openExtensionPage
} from "../../test-support/visual.js";


/*
 * Baseline screenshots of the popup in Chromium, drawn from stored
 * phones and messages through the fake extension APIs in
 * test-support/visual.js. The pairing text is fixed, so the QR code is
 * too, and the clock is stopped at NOW, so message ages do not change.
 */
const EXTENSION_PATH = path.resolve(__dirname, "..");

const NOW = Date.UTC(2026, 0, 15, 9, 30);

const minutesAgo = (minutes) => NOW - minutes * 60 * 1000;

// A v2 pairing code of the length a real one has; its keys are made up.
const PAIRING_CODE = "sms_pair:v2|https://fcm.googleapis.com/fcm/send/SE27j7XPBio:APA91bpfN_kiOZUKYMzUfLcvZaMdIP2eaF-CB62CFWkvr27WYpRr6dTqggm-lxl5vpOhhwpspyK1b_QCkJyQQD0eeMEAX53xF6vsbPWgu7Le8wXXMrpsNuYXLzrbW96bD49fVYZJZc96qlnyuy|BACR02pP4xdh2sDkCceaW-yu2XVEMQ7D8M0P1ll4Uhm25OdqIUMQHU5l-bT8jJb4OCAcTDYN4jR3n8P3VKhuLaQ|-WV0Xt6SCuVo2AgMRfy49g|BCPkgAisl3Ovq3QY9vVfz3GCwNuSo-Qv9td3zOoNqhI_6BHKPB0uK0HrUA9p4IDHtuNO07IrYZkrn6rnItDQxDQ|53UhCT2YZm6Ks0NtfJR4TnzAYBwt-9W-M16cTwkVFss|Chrome (Linux)";

const PIXEL = { id: "pixel", name: "Pixel 8", lastSeen: minutesAgo(5) };
const GALAXY = { id: "galaxy", name: "Galaxy S24", lastSeen: minutesAgo(90) };

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
    id: -3,
    kind: "mms",
    sender: "Alice",
    subject: "",
    body: "Dinner at 8?",
    attachments: ["image"],
    group: ["Bob", "Carol"],
    timestamp: minutesAgo(40),
    deviceName: "Pixel 8",
    simSlot: -1
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


async function open(page, storage = {}, direction = "ltr") {
  // The popup's own size, which its menu and dialogs are placed in.
  await page.setViewportSize({ width: 400, height: 540 });
  await page.clock.setFixedTime(NOW);

  await openExtensionPage(page, EXTENSION_PATH, "src/popup.html", {
    storage,
    direction,
    responses: {
      GET_STATUS: { ok: true, notificationsOff: false },
      GET_PAIRING_CODE: { ok: true, code: PAIRING_CODE }
    }
  });
}


for (const [theme, options, suffix] of [
  ["light", {}, ""],
  ["dark", { colorScheme: "dark" }, "-dark"],
  ["forced-colors", { forcedColors: "active" }, "-forced-colors"]
]) {
  test.describe(`in ${theme} mode`, () => {
    test.use(options);


    test("the popup without a linked phone", async ({ page }) => {
      await open(page);

      await expect(page.locator("#qrContainer canvas")).toBeVisible();

      await expect(page.locator("body")).toHaveScreenshot(`popup-unpaired${suffix}-chromium.png`);
    });


    test("the popup asking to pair again", async ({ page }) => {
      await open(page, { needs_repair: true });

      await expect(page.locator("#repairBanner")).toBeVisible();
      await expect(page.locator("#qrContainer canvas")).toBeVisible();

      await expect(page.locator("body")).toHaveScreenshot(`popup-repair${suffix}-chromium.png`);
    });


    test("the popup with a linked phone and messages", async ({ page }) => {
      await open(page, {
        connected_devices: { pixel: PIXEL },
        recent_sms_feed: FEED
      });

      await expect(page.locator(".card")).toHaveCount(3);
      await expect(page.locator("#deviceBanner")).toBeVisible();

      await expect(page.locator("body")).toHaveScreenshot(`popup-messages${suffix}-chromium.png`);
    });


    test("the popup with the list of phones open", async ({ page }) => {
      await open(page, {
        connected_devices: { pixel: PIXEL, galaxy: GALAXY },
        recent_sms_feed: FEED
      });

      await page.locator("#deviceBanner").click();
      await expect(page.getByRole("listitem")).toHaveCount(2);

      await expect(page.locator("body")).toHaveScreenshot(`popup-phones${suffix}-chromium.png`);
    });


    test("the popup with its menu open", async ({ page }) => {
      await open(page, {
        connected_devices: { pixel: PIXEL },
        recent_sms_feed: FEED
      });

      await page.getByRole("button", { name: "More options" }).click();
      await expect(page.locator("#menu")).toBeVisible();

      await expect(page).toHaveScreenshot(`popup-menu${suffix}-chromium.png`);
    });


    test("the popup's unlink dialog", async ({ page }) => {
      await open(page, {
        connected_devices: { pixel: PIXEL },
        recent_sms_feed: FEED
      });

      await page.locator("#deviceBanner").click();
      await page.getByRole("button", { name: "Unlink Pixel 8" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();

      await expect(page).toHaveScreenshot(`popup-dialog${suffix}-chromium.png`);
    });
  });
}


/*
 * A right-to-left language, such as Arabic, Hebrew or Persian, lays the
 * popup out from the right; the text stays English, as the fake i18n
 * answers from the default locale.
 */
test("the popup with the list of phones open in a right-to-left language", async ({ page }) => {
  await open(page, {
    connected_devices: { pixel: PIXEL, galaxy: GALAXY },
    recent_sms_feed: FEED
  }, "rtl");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.locator("#deviceBanner").click();
  await expect(page.getByRole("listitem")).toHaveCount(2);

  await expect(page.locator("body")).toHaveScreenshot("popup-phones-rtl-chromium.png");
});
