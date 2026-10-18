import path from "node:path";

import {
  test,
  expect,
  openExtensionPage
} from "../../test-support/visual.js";

import { tabThrough } from "../../test-support/keyboard.js";


/*
 * What screen readers get from the popup and the settings page, and
 * how far the keyboard alone gets, drawn from stored phones and
 * messages through the fake extension APIs in test-support/visual.js.
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
    timestamp: minutesAgo(125),
    deviceName: "Pixel 8",
    simSlot: 0
  }
];


async function open(page, pagePath, storage = {}) {
  await page.clock.setFixedTime(NOW);

  await openExtensionPage(page, EXTENSION_PATH, pagePath, {
    storage,
    responses: {
      GET_PAIRING_CODE: { ok: true, code: PAIRING_CODE },
      CLEAR_FEED: { ok: true }
    }
  });
}


test.describe("the popup", () => {
  test("without a linked phone", async ({ page }) => {
    await open(page, "src/popup.html");

    await expect(page.locator("#qrContainer canvas")).toBeVisible();
    await expect(page.locator("body")).toMatchAriaSnapshot(`
      - banner:
        - heading "HMJ SMS" [level=1]
        - text: Not Linked
        - button "Pair"
        - button "Settings"
      - region "Pair with Android Phone":
        - heading "Pair with Android Phone" [level=2]
        - paragraph: Open SMS app on phone → Settings → Desktop Sync → Scan QR Code
        - img "Pairing QR code"
        - button "Copy Code"
        - button "Hide"
      - main:
        - paragraph: Ready for incoming SMS
        - text: Incoming SMS and OTPs will appear here in real-time.
        - button "Show Pairing QR Code"
      - status
    `);

    const { stops, withoutOutline } = await tabThrough(page);

    expect(stops).toEqual([
      'button "Pair"',
      'button "Settings"',
      'button "Copy Code"',
      'button "Hide"',
      'button "Show Pairing QR Code"'
    ]);
    expect(withoutOutline).toEqual([]);
  });


  test("with a linked phone and messages", async ({ page }) => {
    await open(page, "src/popup.html", {
      connected_devices: { pixel: PIXEL },
      recent_sms_feed: FEED
    });

    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(page.locator("body")).toMatchAriaSnapshot(`
      - banner:
        - heading "HMJ SMS" [level=1]
        - text: Linked
        - button "Pair Another"
        - button "Settings"
      - text: Pixel 8 (Linked) 5m ago
      - main:
        - article:
          - heading "BANK" [level=2]
          - text: "Pixel 8 SIM 2: Jio 2m ago"
          - paragraph: Your code is 482913
          - button "Copy OTP (482913)"
          - button "Copy Text"
        - article:
          - heading "MOM" [level=2]
          - text: Pixel 8 SIM 1 2h ago
          - paragraph: Call me when you land
          - button "Copy Text"
      - status
    `);

    const { stops, withoutOutline } = await tabThrough(page);

    expect(stops).toEqual([
      'button "Pair Another"',
      'button "Settings"',
      'button "Copy OTP (482913)"',
      'button "Copy Text"',
      'button "Copy Text"'
    ]);
    expect(withoutOutline).toEqual([]);
  });


  test("the keyboard shows and hides the QR code", async ({ page }) => {
    await open(page, "src/popup.html", { connected_devices: { pixel: PIXEL } });

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
});


test.describe("the settings page", () => {
  test("without a linked phone", async ({ page }) => {
    await open(page, "options/options.html");

    await expect(page.locator("#txtPairingCode")).toHaveValue(PAIRING_CODE);
    await expect(page.locator("body")).toMatchAriaSnapshot(`
      - main:
        - heading "HMJ SMS Desktop Sync" [level=1]
        - paragraph: Zero-server, end-to-end encrypted SMS & OTP alerts delivered directly from your phone over VAPID Web Push.
        - region "Link Android Phone":
          - heading "Link Android Phone" [level=2]
          - img "Pairing QR code"
          - list:
            - listitem: Open the SMS app on your Android phone.
            - listitem: Tap the top-right menu → Desktop Sync.
            - listitem: Tap Scan QR Code and point your camera at this screen.
          - button "Copy Pairing Code"
          - status
          - group: Manual pairing string (fallback)
        - region "Test Desktop Alerts":
          - heading "Test Desktop Alerts" [level=2]
          - paragraph: Trigger a local test notification to verify Chrome notification permissions and offscreen clipboard support.
          - button "Send Test Notification"
          - status
        - region "Message Feed":
          - heading "Message Feed" [level=2]
          - paragraph: Messages older than 24 hours are automatically purged. You can also clear all stored messages now.
          - button "Clear Recent Messages"
          - status
    `);

    const { stops, withoutOutline } = await tabThrough(page);

    expect(stops).toEqual([
      'button "Copy Pairing Code"',
      "text: Manual pairing string (fallback)",
      'button "Send Test Notification"',
      'button "Clear Recent Messages"'
    ]);
    expect(withoutOutline).toEqual([]);
  });


  test("with two linked phones", async ({ page }) => {
    await open(page, "options/options.html", {
      connected_devices: { pixel: PIXEL, galaxy: GALAXY }
    });

    await expect(page.locator("#deviceCountSpan")).toHaveText("2");
    await expect(page.locator("body")).toMatchAriaSnapshot(`
      - main:
        - heading "HMJ SMS Desktop Sync" [level=1]
        - paragraph: Zero-server, end-to-end encrypted SMS & OTP alerts delivered directly from your phone over VAPID Web Push.
        - region "Connected Devices (2)":
          - heading "Connected Devices (2)" [level=2]
          - text: "Pixel 8 Connected Last active: 5m ago"
          - button "Unlink Pixel 8"
          - text: "Galaxy S24 Connected Last active: 1h ago"
          - button "Unlink Galaxy S24"
        - region "Link Android Phone":
          - heading "Link Android Phone" [level=2]
          - text: Currently linked to
          - strong: Pixel 8, Galaxy S24
          - text: .
          - button "Link Another Phone"
        - region "Test Desktop Alerts":
          - heading "Test Desktop Alerts" [level=2]
          - paragraph: Trigger a local test notification to verify Chrome notification permissions and offscreen clipboard support.
          - button "Send Test Notification"
          - status
        - region "Message Feed":
          - heading "Message Feed" [level=2]
          - paragraph: Messages older than 24 hours are automatically purged. You can also clear all stored messages now.
          - button "Clear Recent Messages"
          - status
    `);

    const { stops, withoutOutline } = await tabThrough(page);

    expect(stops).toEqual([
      'button "Unlink Pixel 8": Unlink',
      'button "Unlink Galaxy S24": Unlink',
      'button "Link Another Phone"',
      'button "Send Test Notification"',
      'button "Clear Recent Messages"'
    ]);
    expect(withoutOutline).toEqual([]);
  });


  test("the clear dialog works from the keyboard", async ({ page }) => {
    await open(page, "options/options.html", { recent_sms_feed: FEED });

    const clear = page.getByRole("button", { name: "Clear Recent Messages" });
    const dialog = page.getByRole("dialog", { name: "Clear recent messages?" });

    await clear.focus();
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

    // Escape cancels and gives the focus back.
    await cancel.focus();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(clear).toBeFocused();

    // Space opens it, Cancel has the focus, and Tab then Enter clears.
    await page.keyboard.press("Space");
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");

    await expect(page.locator("#clearStatusNotice")).toHaveText("All stored messages cleared.");
    await expect(clear).toBeFocused();
  });
});
