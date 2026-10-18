import {
  test as base,
  expect,
  ENDPOINT,
  setStorage,
  shownNotifications,
  minutesAgo
} from "./fixtures.js";


// Records clipboard writes, since headless pages may not read the clipboard.
function recordClipboard() {
  window.copiedTexts = [];

  if (navigator.clipboard) {
    navigator.clipboard.writeText = async (text) => {
      window.copiedTexts.push(text);
    };
  }
}


/*
 * Counts the page's renders, each of which reads key from storage, the
 * storage changes it sees and the requests it sends the background.
 */
function recordActivity(key) {
  window.renders = 0;
  window.storageChanges = 0;
  window.requests = [];

  if (!globalThis.chrome?.storage) {
    return;
  }

  const get = chrome.storage.local.get.bind(chrome.storage.local);
  chrome.storage.local.get = (keys) => {
    if ([].concat(keys).includes(key)) {
      window.renders++;
    }
    return get(keys);
  };

  chrome.storage.onChanged.addListener(() => {
    window.storageChanges++;
  });

  const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (message) => {
    window.requests.push(message?.type);
    return sendMessage(message);
  };
}


/*
 * Renders since before, once every storage change the background made
 * has reached the page: the page sees a later change after them.
 */
async function rendersSince(page, serviceWorker, before) {
  const changes = await page.evaluate(() => window.storageChanges);

  await setStorage(serviceWorker, { barrier: Date.now() });
  await expect.poll(() => page.evaluate(() => window.storageChanges)).toBe(changes + 1);

  return (await page.evaluate(() => window.renders)) - before;
}


const test = base.extend({
  // Storage to seed before the popup opens.
  stored: [{}, { option: true }],

  popup: async ({ context, extensionId, serviceWorker, fakeSubscription, stored }, use) => {
    await fakeSubscription();
    await setStorage(serviceWorker, stored);

    const page = await context.newPage();

    await page.addInitScript(recordClipboard);
    await page.addInitScript(recordActivity, "recent_sms_feed");
    await page.goto(`chrome-extension://${extensionId}/src/popup.html`);

    await use(page);
  }
});


const PIXEL = { id: "pixel", name: "Pixel 8", lastSeen: minutesAgo(5), paired: true };
const GALAXY = { id: "galaxy", name: "Galaxy S24", lastSeen: minutesAgo(1), paired: true };


test.describe("without a linked phone", () => {
  test("shows the pairing QR code", async ({ popup }) => {
    await expect(popup.locator("#syncStatusBadge")).toHaveText("Not Linked");
    await expect(popup.locator("#qrContainer canvas")).toBeVisible();
    await expect(popup.locator("#deviceBanner")).toBeHidden();
    await expect(popup.locator("#emptyTitle")).toHaveText("Ready for incoming SMS");
    expect(await popup.evaluate(() => window.requests)).toEqual(["GET_PAIRING_CODE"]);
  });


  test("Copy Code copies the pairing text", async ({ popup }) => {
    const button = popup.locator("#btnCopyPairingCode");

    await expect(popup.locator("#qrContainer canvas")).toBeVisible();
    await button.click();

    await expect(button).toHaveText("Copied!");
    expect(await popup.evaluate(() => window.copiedTexts)).toEqual([
      expect.stringMatching(new RegExp(`^sms_pair:v1\\|${ENDPOINT}\\|test-p256dh\\|test-auth\\|`))
    ]);
  });


  test("Copy Code reports a clipboard that refuses in a status line", async ({ popup }) => {
    const button = popup.locator("#btnCopyPairingCode");

    await expect(popup.locator("#qrContainer canvas")).toBeVisible();
    await popup.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error("Clipboard is blocked."));
    });

    await button.click();

    await expect(popup.locator("#qrPanel").getByRole("status"))
      .toHaveText("Failed to copy: Clipboard is blocked.");
    await expect(button).not.toHaveText("Copied!");
  });


  test("a phone that links while the popup is open replaces the QR code",async ({ popup, serviceWorker }) => {
    await expect(popup.locator("#qrPanel")).toBeVisible();

    await setStorage(serviceWorker, { connected_devices: { pixel: PIXEL } });

    await expect(popup.locator("#qrPanel")).toBeHidden();
    await expect(popup.locator("#syncStatusBadge")).toHaveText("Linked");
  });
});


test.describe("with one linked phone", () => {
  test.use({ stored: { connected_devices: { pixel: PIXEL } } });


  test("names the phone instead of showing the QR code", async ({ popup }) => {
    await expect(popup.locator("#syncStatusBadge")).toHaveText("Linked");
    await expect(popup.locator("#qrPanel")).toBeHidden();
    await expect(popup.locator("#deviceBanner")).toHaveText(/Pixel 8\s*\(Linked\)\s*5m ago/);
    await expect(popup.locator("#emptyTitle")).toHaveText("Connected to Pixel 8");
    await expect(popup.locator("#emptySub")).toHaveText(
      "Waiting for incoming SMS & OTP alerts from Pixel 8."
    );
  });


  test("asks for the pairing code only when the QR code is shown", async ({ popup }) => {
    await expect(popup.locator("#syncStatusBadge")).toHaveText("Linked");
    expect(await popup.evaluate(() => window.requests)).toEqual([]);

    await popup.getByRole("button", { name: "Pair Another" }).click();

    await expect(popup.locator("#qrContainer canvas")).toBeVisible();
    expect(await popup.evaluate(() => window.requests)).toEqual(["GET_PAIRING_CODE"]);
  });


  test("an SMS that arrives while the popup is open renders it once", async ({ popup, push, serviceWorker }) => {
    await expect(popup.locator("#emptyView")).toBeVisible();
    const before = await popup.evaluate(() => window.renders);

    await push({ id: "sms-1", sender: "BANK", body: "Hi", deviceId: "pixel", deviceName: "Pixel 8", timestamp: Date.now() });

    await expect(popup.locator(".card")).toHaveCount(1);
    await expect.poll(async () => (await shownNotifications(serviceWorker)).length).toBe(1);
    expect(await rendersSince(popup, serviceWorker, before)).toBe(1);
  });


  test("Pair Another shows the QR code and Hide hides it", async ({ popup }) => {
    const panel = popup.locator("#qrPanel");

    await popup.getByRole("button", { name: "Pair Another" }).click();
    await expect(panel).toBeVisible();

    await popup.getByRole("button", { name: "Hide" }).click();
    await expect(panel).toBeHidden();
  });
});


// Storage returns the phones in ID order: galaxy, then pixel.
test.describe("with two linked phones", () => {
  test.use({ stored: { connected_devices: { pixel: PIXEL, galaxy: GALAXY } } });


  test("names both phones", async ({ popup }) => {
    await expect(popup.locator("#syncStatusBadge")).toHaveText("2 Linked");
    await expect(popup.locator("#deviceBanner")).toHaveText(
      /Galaxy S24, Pixel 8\s*\(2 Phones Linked\)\s*Active/
    );
    await expect(popup.locator("#emptyTitle")).toHaveText("Connected to 2 Phones");
    await expect(popup.locator("#emptySub")).toHaveText(
      "Waiting for incoming SMS & OTP alerts from Galaxy S24 and Pixel 8."
    );
  });
});


test.describe("with stored messages", () => {
  test.use({
    stored: {
      connected_devices: { pixel: PIXEL },
      recent_sms_feed: [
        {
          id: 1,
          sender: "BANK",
          body: "Your code is 482913",
          otp: "482913",
          timestamp: minutesAgo(0.2),
          deviceName: "Pixel 8",
          simSlot: 1,
          simName: "Jio"
        },
        {
          id: 2,
          sender: "MOM",
          body: "Call me",
          timestamp: minutesAgo(125),
          deviceName: "Galaxy S24",
          simSlot: 0
        },
        {
          id: 3,
          sender: "OLD",
          body: "From yesterday",
          timestamp: minutesAgo(25 * 60)
        }
      ]
    }
  });


  test("lists the last 24 hours with phone, SIM, age and copy buttons", async ({ popup }) => {
    const cards = popup.getByRole("article");

    await expect(cards).toHaveCount(2);
    await expect(popup.locator("#emptyView")).toBeHidden();
    await expect(popup.getByRole("heading", { level: 2 })).toHaveText(["BANK", "MOM"]);
    // Messages already there when the popup opens are not announced.
    await expect(popup.locator("#announcer")).toBeEmpty();

    await expect(cards.nth(0)).toContainText("BANK");
    await expect(cards.nth(0)).toContainText("Pixel 8");
    await expect(cards.nth(0)).toContainText("SIM 2: Jio");
    await expect(cards.nth(0)).toContainText("Just now");
    await expect(cards.nth(0)).toContainText("Your code is 482913");
    await expect(cards.nth(0).getByRole("button")).toHaveText([
      "Copy OTP (482913)",
      "Copy Text"
    ]);

    await expect(cards.nth(1)).toContainText("MOM");
    await expect(cards.nth(1)).toContainText("Galaxy S24");
    await expect(cards.nth(1)).toContainText("SIM 1");
    await expect(cards.nth(1)).toContainText("2h ago");
    await expect(cards.nth(1).getByRole("button")).toHaveText(["Copy Text"]);
  });


  test("the copy buttons copy the OTP and the message", async ({ popup }) => {
    // The label, and so the name, turns to "Copied!" for a while.
    const [otpButton, textButton] = await popup.locator(".card").nth(0).getByRole("button").all();

    await expect(otpButton).toHaveText("Copy OTP (482913)");
    await otpButton.click();
    await expect(otpButton).toHaveText("Copied!");
    await expect(popup.locator("#announcer")).toHaveText("OTP copied.");

    await expect(textButton).toHaveText("Copy Text");
    await textButton.click();
    await expect(popup.locator("#announcer")).toHaveText("Message copied.");

    expect(await popup.evaluate(() => window.copiedTexts)).toEqual([
      "482913",
      "Your code is 482913"
    ]);
  });


  test("a message that arrives while the popup is open is added on top", async ({ popup, serviceWorker }) => {
    await expect(popup.locator(".card")).toHaveCount(2);

    await serviceWorker.evaluate(async () => {
      const { recent_sms_feed: feed } = await chrome.storage.local.get("recent_sms_feed");

      await chrome.storage.local.set({
        recent_sms_feed: [
          { id: 4, sender: "SHOP", body: "Order shipped", timestamp: Date.now() },
          ...feed
        ]
      });
    });

    await expect(popup.locator(".card")).toHaveCount(3);
    await expect(popup.locator(".card").first()).toContainText("Order shipped");
    await expect(popup.locator("#announcer")).toHaveText("New message from SHOP.");
  });
});


test("the settings button opens the options page", async ({ popup, context, extensionId }) => {
  const optionsPage = context.waitForEvent("page");

  await popup.getByRole("button", { name: "Settings" }).click();

  await expect(await optionsPage).toHaveURL(
    `chrome-extension://${extensionId}/options/options.html`
  );
});
