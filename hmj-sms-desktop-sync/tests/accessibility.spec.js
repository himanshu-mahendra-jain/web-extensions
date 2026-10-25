import path from "node:path";

import {
  test,
  expect,
  openExtensionPage
} from "../../test-support/visual.js";

import { tabThrough } from "../../test-support/keyboard.js";


/*
 * What screen readers get from the popup, and how far the keyboard
 * alone gets, drawn from stored phones and messages through the fake
 * extension APIs in test-support/visual.js.
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
    id: -2,
    kind: "mms",
    sender: "Alice",
    subject: "Trip photos",
    body: "Look at this view!",
    attachments: ["image", "image"],
    group: ["Bob", "Carol"],
    timestamp: minutesAgo(125),
    deviceName: "Pixel 8",
    simSlot: 0
  }
];


async function open(page, storage = {}, responses = {}) {
  await page.clock.setFixedTime(NOW);

  await openExtensionPage(page, EXTENSION_PATH, "src/popup.html", {
    storage,
    responses: {
      GET_STATUS: { ok: true, notificationsOff: false },
      GET_PAIRING_CODE: { ok: true, code: PAIRING_CODE },
      CLEAR_FEED: { ok: true },
      UNLINK_ALL: { ok: true },
      UNLINK_DEVICE: { ok: true, remaining: 1 },
      ...responses
    }
  });
}


test("without a linked phone", async ({ page }) => {
  await open(page);

  await expect(page.locator("#qrContainer canvas")).toBeVisible();
  await expect(page.locator("body")).toMatchAriaSnapshot(`
    - banner:
      - heading "HMJ SMS" [level=1]
      - text: Not Linked
      - button "Pair"
      - button "More options"
    - region "Pair with Android Phone":
      - heading "Pair with Android Phone" [level=2]
      - paragraph: Open HMJ SMS app on phone → Settings → Desktop Sync → Scan QR Code
      - img "Pairing QR code"
      - button "Copy Code"
      - button "Hide"
      - paragraph: This code holds the keys to your link. Show or paste it only on your own phone, and keep it away from clipboard sync and screen sharing.
    - main:
      - paragraph: Ready for incoming SMS
      - text: Incoming SMS and OTPs will appear here in real-time.
      - button "Show Pairing QR Code"
    - status
  `);

  const { stops, withoutOutline } = await tabThrough(page);

  expect(stops).toEqual([
    'button "Pair"',
    'button "More options"',
    'button "Copy Code"',
    'button "Hide"',
    'button "Show Pairing QR Code"'
  ]);
  expect(withoutOutline).toEqual([]);
});


test("asking to pair again, with notifications turned off", async ({ page }) => {
  await open(page, { needs_repair: true }, { GET_STATUS: { ok: true, notificationsOff: true } });

  await expect(page.locator("#qrContainer canvas")).toBeVisible();
  await expect(page.locator("#notificationsOffBanner")).toBeVisible();
  await expect(page.locator("body")).toMatchAriaSnapshot(`
    - banner:
      - heading "HMJ SMS" [level=1]
      - text: Not Linked
      - button "Pair"
      - button "More options"
    - paragraph: Your pairing changed. Scan the QR code again on each phone.
    - paragraph: Notifications are turned off for this extension in the browser, so messages are stored but not shown.
    - region "Pair with Android Phone":
      - heading "Pair with Android Phone" [level=2]
      - paragraph: Open HMJ SMS app on phone → Settings → Desktop Sync → Scan QR Code
      - img "Pairing QR code"
      - button "Copy Code"
      - button "Hide"
      - paragraph: This code holds the keys to your link. Show or paste it only on your own phone, and keep it away from clipboard sync and screen sharing.
    - main:
      - paragraph: Ready for incoming SMS
      - text: Incoming SMS and OTPs will appear here in real-time.
      - button "Show Pairing QR Code"
    - status
  `);

  const { stops, withoutOutline } = await tabThrough(page);

  // The banners only say something, so the keyboard passes them by.
  expect(stops).toEqual([
    'button "Pair"',
    'button "More options"',
    'button "Copy Code"',
    'button "Hide"',
    'button "Show Pairing QR Code"'
  ]);
  expect(withoutOutline).toEqual([]);
});


test("with linked phones and messages", async ({ page }) => {
  await open(page, {
    connected_devices: { pixel: PIXEL, galaxy: GALAXY },
    recent_sms_feed: FEED
  });

  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.locator("body")).toMatchAriaSnapshot(`
    - banner:
      - heading "HMJ SMS" [level=1]
      - text: 2 Linked
      - button "Pair Another"
      - button "More options"
    - button "Pixel 8, Galaxy S24 (2 Phones Linked) Active" [expanded=false]
    - main:
      - article:
        - heading "BANK" [level=2]
        - text: "Pixel 8 SIM 2: Jio"
        - time: 2m ago
        - paragraph: Your code is 482913
        - button "Copy OTP (482913)"
        - button "Copy Text"
      - article:
        - heading "Alice" [level=2]
        - text: Group Pixel 8 SIM 1
        - time: 2h ago
        - paragraph: With Bob, Carol
        - paragraph: Trip photos
        - paragraph: Look at this view!
        - paragraph: 📷 2 photos
        - button "Copy Text"
    - status
  `);

  const { stops, withoutOutline } = await tabThrough(page);

  expect(stops).toEqual([
    'button "Pair Another"',
    'button "More options"',
    'button "Pixel 8, Galaxy S24 (2 Phones Linked) Active"',
    'button "Copy OTP (482913)"',
    'button "Copy Text"',
    'button "Copy Text"'
  ]);
  expect(withoutOutline).toEqual([]);
});


test("the keyboard opens the list of phones and reaches each Unlink", async ({ page }) => {
  await open(page, { connected_devices: { pixel: PIXEL, galaxy: GALAXY } });

  const banner = page.getByRole("button", { name: /2 Phones Linked/ });

  await banner.focus();
  await page.keyboard.press("Enter");

  const list = page.getByRole("region", { name: "Linked phones" });

  await expect(banner).toHaveAttribute("aria-expanded", "true");
  await expect(list).toMatchAriaSnapshot(`
    - region "Linked phones":
      - list:
        - listitem:
          - text: Pixel 8 Last active
          - time: 5m ago
          - button "Unlink Pixel 8": Unlink
        - listitem:
          - text: Galaxy S24 Last active
          - time: 1h ago
          - button "Unlink Galaxy S24": Unlink
  `);

  const { stops, withoutOutline } = await tabThrough(page, { fromFocus: true });

  expect(stops.slice(0, 3)).toEqual([
    'button "Pixel 8, Galaxy S24 (2 Phones Linked) Active" [expanded]',
    'button "Unlink Pixel 8": Unlink',
    'button "Unlink Galaxy S24": Unlink'
  ]);
  expect(withoutOutline).toEqual([]);

  // Space closes it again.
  await banner.focus();
  await page.keyboard.press("Space");
  await expect(list).toBeHidden();
});


test("the keyboard opens the menu and its items", async ({ page }) => {
  await open(page, { connected_devices: { pixel: PIXEL } });

  const menuButton = page.getByRole("button", { name: "More options" });

  await menuButton.focus();
  await page.keyboard.press("Enter");

  await expect(page.locator("#menu")).toBeVisible();
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");

  const { stops, withoutOutline } = await tabThrough(page, { fromFocus: true });

  // The menu's items come right after its button.
  expect(stops.slice(0, 3)).toEqual([
    'button "More options" [expanded]',
    'button "Unlink All Phones"',
    'button "Clear Messages"'
  ]);
  expect(withoutOutline).toEqual([]);

  // Escape closes it, and its button says so.
  await page.keyboard.press("Escape");
  await expect(page.locator("#menu")).toBeHidden();
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
});


test("the clear dialog works from the keyboard", async ({ page }) => {
  await open(page, { connected_devices: { pixel: PIXEL }, recent_sms_feed: FEED });

  const menuButton = page.getByRole("button", { name: "More options" });
  const dialog = page.getByRole("dialog", { name: "Clear recent messages?" });

  await menuButton.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Clear Messages" }).focus();
  await page.keyboard.press("Enter");

  await expect(dialog).toBeVisible();
  await expect(dialog).toMatchAriaSnapshot(`
    - dialog "Clear recent messages?":
      - heading "Clear recent messages?" [level=2]
      - paragraph: Every message stored in this extension will be removed. Messages on your phone are not affected.
      - button "Cancel"
      - button "Clear Messages"
  `);

  const cancel = dialog.getByRole("button", { name: "Cancel" });

  await expect(cancel).toBeFocused();

  const { stops, withoutOutline } = await tabThrough(page, { fromFocus: true });

  // The page behind the dialog is out of reach.
  expect(stops).toEqual(['button "Cancel"', 'button "Clear Messages"']);
  expect(withoutOutline).toEqual([]);

  // Escape cancels and gives the focus back to the menu's button.
  await cancel.focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(menuButton).toBeFocused();

  // Enter opens the menu again, and Tab then Enter clears.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  await expect(page.locator("#actionStatus")).toHaveText("All stored messages cleared.");
  await expect(menuButton).toBeFocused();
});


test("the keyboard shows and hides the QR code", async ({ page }) => {
  await open(page, { connected_devices: { pixel: PIXEL } });

  const panel = page.getByRole("region", { name: "Pair with Android Phone" });
  const pairAnother = page.getByRole("button", { name: "Pair Another" });

  await expect(pairAnother).toBeVisible();
  await expect(panel).toBeHidden();

  await pairAnother.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  await expect(panel.locator("canvas")).toBeVisible();

  await page.keyboard.press("Space");
  await expect(panel).toBeHidden();

  await page.keyboard.press("Space");
  await panel.getByRole("button", { name: "Hide" }).focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeHidden();
});
