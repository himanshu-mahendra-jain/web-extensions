import {
  test as base,
  expect,
  ENDPOINT,
  PAIRING_CODE_PATTERN,
  getStorage,
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


// Replaces the page's messages to the background script, before it loads.
async function answerMessages(page, answer) {
  await page.addInitScript((answer) => {
    if (!globalThis.chrome?.runtime) {
      return;
    }

    const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);

    chrome.runtime.sendMessage = (message) => {
      if (answer.only && message?.type !== answer.only) {
        return sendMessage(message);
      }

      return answer.error
        ? Promise.reject(new Error(answer.error))
        : Promise.resolve(answer.reply);
    };
  }, answer);

  await page.reload();
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


const PIXEL = { id: "pixel", name: "Pixel 8", lastSeen: minutesAgo(5) };
const GALAXY = { id: "galaxy", name: "Galaxy S24", lastSeen: minutesAgo(1) };


test.describe("without a linked phone", () => {
  test("shows the pairing QR code and warns that it holds keys", async ({ popup }) => {
    await expect(popup.locator("#syncStatusBadge")).toHaveText("Not Linked");
    await expect(popup.locator("#qrContainer canvas")).toBeVisible();
    await expect(popup.locator("#deviceBanner")).toBeHidden();
    await expect(popup.locator("#emptyTitle")).toHaveText("Ready for incoming SMS");
    await expect(popup.locator(".qr-warning")).toHaveText(
      /^This code holds the keys to your link\. Show or paste it only on your own phone, and keep it\s+away from clipboard sync and screen sharing\.$/
    );
    await expect(popup.locator("#repairBanner")).toBeHidden();
    await expect(popup.locator("#notificationsOffBanner")).toBeHidden();
    expect(await popup.evaluate(() => window.requests)).toEqual(["GET_STATUS", "GET_PAIRING_CODE"]);
  });


  test("Copy Code copies the v2 pairing code", async ({ popup }) => {
    const button = popup.locator("#btnCopyPairingCode");

    await expect(popup.locator("#qrContainer canvas")).toBeVisible();
    await button.click();

    await expect(button).toHaveText("Copied!");
    expect(await popup.evaluate(() => window.copiedTexts)).toEqual([
      expect.stringMatching(PAIRING_CODE_PATTERN)
    ]);
    expect((await popup.evaluate(() => window.copiedTexts))[0].split("|")[1]).toBe(ENDPOINT);
  });


  test("Copy Code reports a clipboard that refuses in a status line", async ({ popup }) => {
    const button = popup.locator("#btnCopyPairingCode");

    await expect(popup.locator("#qrContainer canvas")).toBeVisible();
    await popup.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error("Clipboard is blocked."));
    });

    await button.click();

    await expect(popup.locator("#copyStatus"))
      .toHaveText("Failed to copy: Clipboard is blocked.");
    await expect(button).not.toHaveText("Copied!");
  });


  test("a pairing code the background cannot make says why", async ({ popup }) => {
    await answerMessages(popup, {
      only: "GET_PAIRING_CODE",
      reply: { ok: false, error: "Registration failed - push service error" }
    });

    await expect(popup.locator("#copyStatus"))
      .toHaveText("Could not make a pairing code: Registration failed - push service error");
    await expect(popup.locator("#qrContainer canvas")).toHaveCount(0);
  });


  test("a phone that links while the popup is open replaces the QR code", async ({ popup, serviceWorker }) => {
    await expect(popup.locator("#qrPanel")).toBeVisible();

    await setStorage(serviceWorker, { connected_devices: { pixel: PIXEL } });

    await expect(popup.locator("#qrPanel")).toBeHidden();
    await expect(popup.locator("#syncStatusBadge")).toHaveText("Linked");
  });
});


test.describe("when the phones lost this browser", () => {
  // The phones were given an address that the browser has no subscription for any more.
  test.use({ stored: { push_endpoint: `${ENDPOINT}-old`, connected_devices: { pixel: PIXEL } } });


  test("opening the popup finds the subscription ended, and asks to pair again", async ({ popup, serviceWorker }) => {
    await expect(popup.locator("#repairBanner")).toHaveText(
      /^Your pairing changed\. Scan the QR code\s+again on each phone\.$/
    );
    await expect(popup.locator("#syncStatusBadge")).toHaveText("Not Linked");
    await expect(popup.locator("#deviceBanner")).toBeHidden();
    await expect(popup.locator("#qrContainer canvas")).toBeVisible();
    expect(await getStorage(serviceWorker, "connected_devices")).toEqual({});
    // The QR code holds a new subscription, which the phones are now given.
    await expect.poll(() => getStorage(serviceWorker, "push_endpoint")).toBe(ENDPOINT);
  });
});


test("a pairing lost while the popup is open shows the banner and the QR code", async ({ popup, serviceWorker }) => {
  await setStorage(serviceWorker, { connected_devices: { pixel: PIXEL } });
  await expect(popup.locator("#syncStatusBadge")).toHaveText("Linked");
  await expect(popup.locator("#repairBanner")).toBeHidden();

  await setStorage(serviceWorker, { needs_repair: true, connected_devices: {} });

  await expect(popup.locator("#repairBanner")).toBeVisible();
  await expect(popup.locator("#qrPanel")).toBeVisible();
  // A banner that appears while the popup is open is read out.
  await expect(popup.locator("#announcer")).toHaveText("Your pairing changed. Scan the QR code again on each phone.");

  // A phone that pairs again reaches the new address.
  await setStorage(serviceWorker, { needs_repair: false, connected_devices: { pixel: PIXEL } });

  await expect(popup.locator("#repairBanner")).toBeHidden();
});


test("notifications turned off in the browser show a banner", async ({ popup, serviceWorker }) => {
  await serviceWorker.evaluate(() => {
    chrome.notifications.getPermissionLevel = async () => "denied";
  });
  await popup.reload();

  await expect(popup.locator("#notificationsOffBanner")).toHaveText(
    /^Notifications are turned\s+off for this extension in the browser, so messages are stored but not shown\.$/
  );
  await expect(popup.locator("#repairBanner")).toBeHidden();
  // A banner the popup opens with is read in its place, not announced as well.
  await expect(popup.locator("#announcer")).toBeEmpty();
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
    expect(await popup.evaluate(() => window.requests)).toEqual(["GET_STATUS"]);

    await popup.getByRole("button", { name: "Pair Another" }).click();

    await expect(popup.locator("#qrContainer canvas")).toBeVisible();
    expect(await popup.evaluate(() => window.requests)).toEqual(["GET_STATUS", "GET_PAIRING_CODE"]);
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


  test("the banner opens and closes the list of phones", async ({ popup }) => {
    const banner = popup.locator("#deviceBanner");
    const list = popup.getByRole("region", { name: "Linked phones" });

    await expect(banner).toHaveAttribute("aria-expanded", "false");
    await expect(list).toBeHidden();

    await banner.click();

    await expect(banner).toHaveAttribute("aria-expanded", "true");
    await expect(list.getByRole("listitem")).toHaveText([
      /Galaxy S24\s*Last active 1m ago\s*Unlink/,
      /Pixel 8\s*Last active 5m ago\s*Unlink/
    ]);

    await banner.click();
    await expect(list).toBeHidden();
  });


  test("Unlink asks in a dialog, then ignores the phone", async ({ popup, serviceWorker }) => {
    await popup.locator("#deviceBanner").click();
    await popup.getByRole("button", { name: "Unlink Pixel 8" }).click();

    const dialog = popup.getByRole("dialog", { name: "Unlink Pixel 8?" });

    await expect(dialog).toHaveAccessibleDescription(
      "Messages from Pixel 8 will be ignored here. To stop it sending them, also unlink this computer in the SMS app on that phone."
    );
    // Cancel has the focus, so Enter does not unlink by accident.
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

    await dialog.getByRole("button", { name: "Unlink" }).click();

    await expect(dialog).toBeHidden();
    await expect(popup.getByRole("listitem")).toHaveCount(1);
    await expect(popup.locator("#actionStatus")).toHaveText("Pixel 8 unlinked.");
    await expect(popup.locator("#deviceBanner")).toBeFocused();
    expect(Object.keys(await getStorage(serviceWorker, "connected_devices"))).toEqual(["galaxy"]);
    expect(Object.keys(await getStorage(serviceWorker, "unlinked_devices"))).toEqual(["pixel"]);
  });


  for (const [how, dismiss] of [
    ["Cancel", (dialog) => dialog.getByRole("button", { name: "Cancel" }).click()],
    ["Escape", (dialog) => dialog.press("Escape")]
  ]) {
    test(`${how} in the unlink dialog keeps the phone`, async ({ popup, serviceWorker }) => {
      await popup.locator("#deviceBanner").click();
      await popup.getByRole("button", { name: "Unlink Pixel 8" }).click();

      const dialog = popup.getByRole("dialog");

      await expect(dialog).toBeVisible();
      await dismiss(dialog);

      await expect(dialog).toBeHidden();
      await expect(popup.getByRole("listitem")).toHaveCount(2);
      expect(Object.keys(await getStorage(serviceWorker, "connected_devices")).sort())
        .toEqual(["galaxy", "pixel"]);
      expect(await getStorage(serviceWorker, "unlinked_devices")).toBeUndefined();
    });
  }


  test("Unlink All Phones asks, then shows a new QR code for a new key", async ({ popup, serviceWorker }) => {
    await popup.getByRole("button", { name: "Pair Another" }).click();
    await expect(popup.locator("#qrContainer canvas")).toBeVisible();
    await popup.locator("#btnCopyPairingCode").click();

    await popup.getByRole("button", { name: "More options" }).click();
    await popup.getByRole("button", { name: "Unlink All Phones" }).click();

    const dialog = popup.getByRole("dialog", { name: "Unlink all phones?" });

    await expect(dialog).toHaveAccessibleDescription(
      "This computer gets a new pairing code, and no phone can reach it any more. Every message stored in this extension is removed. Phones you keep must scan the new QR code."
    );
    await dialog.getByRole("button", { name: "Unlink All" }).click();

    await expect(popup.locator("#actionStatus"))
      .toHaveText("All phones unlinked and messages cleared. Scan the new QR code to pair again.");
    await expect(popup.locator("#syncStatusBadge")).toHaveText("Not Linked");
    await expect(popup.locator("#qrContainer canvas")).toBeVisible();
    await expect(popup.getByRole("button", { name: "More options" })).toBeFocused();

    // The copied code is the new one, with the new push address.
    await popup.locator("#btnCopyPairingCode").click();

    const [before, after] = await popup.evaluate(() => window.copiedTexts);

    expect(after).toMatch(PAIRING_CODE_PATTERN);
    expect(after.split("|")[1]).toBe(`${ENDPOINT}-2`);
    expect(after.split("|")[4]).not.toBe(before.split("|")[4]);
    expect(await getStorage(serviceWorker, "connected_devices")).toEqual({});
  });


  test("a request that fails says why", async ({ popup }) => {
    await answerMessages(popup, { only: "UNLINK_ALL", reply: { ok: false, error: "No push service." } });

    await popup.getByRole("button", { name: "More options" }).click();
    await popup.getByRole("button", { name: "Unlink All Phones" }).click();
    await popup.getByRole("dialog").getByRole("button", { name: "Unlink All" }).click();

    await expect(popup.locator("#actionStatus")).toHaveText("Failed to unlink: No push service.");
    await expect(popup.locator("#actionStatus")).toHaveClass(/error/);
    await expect(popup.locator("#syncStatusBadge")).toHaveText("2 Linked");
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


  test("Clear Messages asks in a dialog, then empties the feed", async ({ popup, serviceWorker }) => {
    await popup.getByRole("button", { name: "More options" }).click();
    await popup.getByRole("button", { name: "Clear Messages" }).click();

    const dialog = popup.getByRole("dialog", { name: "Clear recent messages?" });

    await dialog.getByRole("button", { name: "Clear Messages" }).click();
    await expect(dialog).toBeHidden();

    await expect(popup.locator("#actionStatus")).toHaveText("All stored messages cleared.");
    await expect(popup.locator(".card")).toHaveCount(0);
    expect(await getStorage(serviceWorker, "recent_sms_feed")).toEqual([]);
  });


  test("Unlink All Phones also empties the feed", async ({ popup, serviceWorker }) => {
    await expect(popup.locator(".card")).toHaveCount(2);

    await popup.getByRole("button", { name: "More options" }).click();
    await popup.getByRole("button", { name: "Unlink All Phones" }).click();
    await popup.getByRole("dialog", { name: "Unlink all phones?" }).getByRole("button", { name: "Unlink All" }).click();

    await expect(popup.locator("#actionStatus"))
      .toHaveText("All phones unlinked and messages cleared. Scan the new QR code to pair again.");
    await expect(popup.locator(".card")).toHaveCount(0);
    expect(await getStorage(serviceWorker, "recent_sms_feed")).toEqual([]);
  });


  test("cancelling the clear dialog keeps the messages", async ({ popup, serviceWorker }) => {
    await popup.getByRole("button", { name: "More options" }).click();
    await popup.getByRole("button", { name: "Clear Messages" }).click();
    await popup.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    await expect(popup.getByRole("button", { name: "More options" })).toBeFocused();
    await expect(popup.locator("#actionStatus")).toBeEmpty();
    expect(await getStorage(serviceWorker, "recent_sms_feed")).toHaveLength(3);
  });


  test("a dialog shown again before the last one's close event still asks", async ({ popup, serviceWorker }) => {
    const dialog = popup.getByRole("dialog");

    await popup.getByRole("button", { name: "More options" }).click();
    await popup.getByRole("button", { name: "Clear Messages" }).click();
    await expect(dialog).toBeVisible();

    // Closed and shown again in one task, so the close event is still queued.
    await popup.evaluate(() => {
      document.getElementById("confirmDialog").close();
      document.getElementById("btnClearFeed").click();
    });

    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Clear Messages" }).click();

    await expect(popup.locator("#actionStatus")).toHaveText("All stored messages cleared.");
    expect(await getStorage(serviceWorker, "recent_sms_feed")).toEqual([]);
  });
});


test.describe("times", () => {
  const sent = minutesAgo(2.5);

  test.use({
    stored: {
      connected_devices: { pixel: PIXEL },
      recent_sms_feed: [{ id: 1, sender: "BANK", body: "Hi", timestamp: sent, deviceName: "Pixel 8" }]
    }
  });


  test("each time gives its full date and time, and counts on while the popup is open", async ({ popup }) => {
    // The clock starts now and moves only when the test says.
    await popup.clock.install();
    await popup.reload();

    const time = popup.locator(".card time");

    await expect(time).toHaveText("2m ago");
    await expect(time).toHaveAttribute("datetime", new Date(sent).toISOString());
    await expect(time).toHaveAttribute("title", /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s[AP]M$/);

    await popup.locator("#deviceBanner").click();
    await expect(popup.locator(".phone-meta time")).toHaveText("5m ago");
    await expect(popup.locator("#deviceBanner time")).toHaveAttribute("datetime", new Date(PIXEL.lastSeen).toISOString());

    await popup.clock.runFor(60 * 1000);

    await expect(time).toHaveText("3m ago");
    await expect(popup.locator(".phone-meta")).toHaveText("Last active 6m ago");
  });
});


test.describe("with MMS messages", () => {
  test.use({
    stored: {
      connected_devices: { pixel: PIXEL },
      recent_sms_feed: [
        {
          id: -2,
          kind: "mms",
          sender: "Alice",
          subject: "",
          body: "Dinner at 8?",
          attachments: ["image"],
          group: ["Bob", "Carol", "Dave", "Erin"],
          timestamp: minutesAgo(1),
          deviceName: "Pixel 8",
          simSlot: -1
        },
        {
          id: -1,
          kind: "mms",
          sender: "Alice",
          subject: "Trip photos",
          body: "",
          attachments: ["image", "image", "video"],
          group: [],
          timestamp: minutesAgo(3),
          deviceName: "Pixel 8",
          simSlot: -1
        }
      ]
    }
  });


  test("a card names its kind, its group, its subject and its attachments", async ({ popup }) => {
    const cards = popup.getByRole("article");

    await expect(cards).toHaveCount(2);

    await expect(cards.nth(0).locator(".tag-kind")).toHaveText("Group");
    await expect(cards.nth(0).locator(".msg-group")).toHaveText("With Bob, Carol, Dave +1");
    await expect(cards.nth(0).locator(".msg-body")).toHaveText("Dinner at 8?");
    await expect(cards.nth(0).locator(".msg-attachments")).toHaveText("📷 Photo");

    await expect(cards.nth(1).locator(".tag-kind")).toHaveText("MMS");
    await expect(cards.nth(1).locator(".msg-subject")).toHaveText("Trip photos");
    await expect(cards.nth(1).locator(".msg-body")).toHaveCount(0);
    await expect(cards.nth(1).locator(".msg-attachments")).toHaveText("📷 2 photos · 🎬 Video");

    await cards.nth(1).getByRole("button", { name: "Copy Text" }).click();
    expect(await popup.evaluate(() => window.copiedTexts)).toEqual(["Trip photos"]);
  });
});
