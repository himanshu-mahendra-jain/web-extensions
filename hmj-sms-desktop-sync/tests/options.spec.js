import {
  test as base,
  expect,
  ENDPOINT,
  getStorage,
  setStorage,
  shownNotifications,
  minutesAgo
} from "./fixtures.js";


function recordClipboard() {
  window.copiedTexts = [];

  if (navigator.clipboard) {
    navigator.clipboard.writeText = async (text) => {
      window.copiedTexts.push(text);
    };
  }
}


/*
 * The pairing code comes from the push subscription, so every test
 * fakes one first.
 */
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
  stored: [{}, { option: true }],

  optionsPage: async ({ context, extensionId, serviceWorker, fakeSubscription, stored }, use) => {
    await fakeSubscription();
    await setStorage(serviceWorker, stored);

    const page = await context.newPage();

    await page.addInitScript(recordClipboard);
    await page.addInitScript(recordActivity, "connected_devices");
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);

    await use(page);
  }
});


const PIXEL = { id: "pixel", name: "Pixel 8", lastSeen: minutesAgo(5), paired: true };
const GALAXY = { id: "galaxy", name: "Galaxy S24", lastSeen: minutesAgo(90), paired: true };


test("shows the pairing text and copies it", async ({ optionsPage, extensionId }) => {
  const pairingText = optionsPage.locator("#txtPairingCode");

  await expect(pairingText).toHaveValue(
    new RegExp(`^sms_pair:v1\\|${RegExp.escape(ENDPOINT)}\\|test-p256dh\\|test-auth\\|Chrome \\(\\w+\\)\\|${extensionId}$`)
  );
  await expect(optionsPage.locator("#optionsQrContainer canvas")).toBeVisible();

  const button = optionsPage.locator("#btnCopyCode");

  await button.click();

  await expect(button).toHaveText("Copied to Clipboard!");
  await expect(optionsPage.locator("#copyStatusNotice")).toHaveText("Pairing code copied.");
  expect(await optionsPage.evaluate(() => window.copiedTexts))
    .toEqual([await pairingText.inputValue()]);
});


test("without a linked phone the QR code is shown and no phones are listed", async ({ optionsPage }) => {
  await expect(optionsPage.locator("#qrContainerBox")).toBeVisible();
  await expect(optionsPage.locator("#connectedDeviceSection")).toBeHidden();
  await expect(optionsPage.locator("#alreadyPairedNotice")).toBeHidden();
});


test("a phone that links while the page is open is listed", async ({ optionsPage, serviceWorker }) => {
  await expect(optionsPage.locator("#txtPairingCode")).not.toHaveValue("");

  await setStorage(serviceWorker, { connected_devices: { pixel: PIXEL } });

  await expect(optionsPage.locator("#connectedDeviceSection")).toBeVisible();
  await expect(optionsPage.locator(".device-card")).toHaveCount(1);
  await expect(optionsPage.locator("#qrContainerBox")).toBeHidden();
});


test("an SMS from a new phone renders the phones once", async ({ optionsPage, push, serviceWorker }) => {
  await expect(optionsPage.locator("#qrContainerBox")).toBeVisible();
  const before = await optionsPage.evaluate(() => window.renders);

  await push({ id: "sms-1", sender: "BANK", body: "Hi", deviceId: "pixel", deviceName: "Pixel 8", timestamp: Date.now() });

  await expect(optionsPage.locator(".device-card")).toHaveCount(1);
  await expect.poll(async () => (await shownNotifications(serviceWorker)).length).toBe(1);
  expect(await rendersSince(optionsPage, serviceWorker, before)).toBe(1);
});


// Storage returns the phones in ID order: galaxy, then pixel.
test.describe("with two linked phones", () => {
  test.use({ stored: { connected_devices: { pixel: PIXEL, galaxy: GALAXY } } });


  test("lists both and hides the QR code until asked", async ({ optionsPage }) => {
    const cards = optionsPage.locator(".device-card");

    await expect(optionsPage.locator("#deviceCountSpan")).toHaveText("2");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText("Galaxy S24Connected");
    await expect(cards.nth(0)).toContainText("Last active: 1h ago");
    await expect(cards.nth(1)).toContainText("Pixel 8Connected");
    await expect(cards.nth(1)).toContainText("Last active: 5m ago");

    await expect(optionsPage.locator("#pairedNoticeDeviceName")).toHaveText("Galaxy S24, Pixel 8");
    await expect(optionsPage.locator("#qrContainerBox")).toBeHidden();

    const toggle = optionsPage.locator("#btnShowQrToggle");

    await toggle.click();
    await expect(optionsPage.locator("#qrContainerBox")).toBeVisible();
    await expect(toggle).toHaveText("Hide QR Code");

    await toggle.click();
    await expect(optionsPage.locator("#qrContainerBox")).toBeHidden();
    await expect(toggle).toHaveText("Link Another Phone");
  });


  test("Unlink asks in a dialog, then removes the phone", async ({ optionsPage, serviceWorker }) => {
    await optionsPage.getByRole("button", { name: "Unlink Pixel 8" }).click();

    const dialog = optionsPage.getByRole("dialog", { name: "Unlink Pixel 8?" });

    await expect(dialog).toHaveAccessibleDescription(
      "Disconnect Pixel 8 from SMS Desktop Sync? Its messages stop arriving here until you pair it again."
    );
    // Cancel has the focus, so Enter does not unlink by accident.
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

    await dialog.getByRole("button", { name: "Unlink" }).click();

    await expect(dialog).toBeHidden();
    await expect(optionsPage.locator(".device-card")).toHaveCount(1);
    await expect(optionsPage.locator("#deviceCountSpan")).toHaveText("1");
    expect(Object.keys(await getStorage(serviceWorker, "connected_devices")))
      .toEqual(["galaxy"]);
  });


  for (const [how, dismiss] of [
    ["Cancel", (dialog) => dialog.getByRole("button", { name: "Cancel" }).click()],
    ["Escape", (dialog) => dialog.press("Escape")]
  ]) {
    test(`${how} in the unlink dialog keeps the phone`, async ({ optionsPage, serviceWorker }) => {
      const unlink = optionsPage.getByRole("button", { name: "Unlink Pixel 8" });

      await unlink.click();

      const dialog = optionsPage.getByRole("dialog");

      await expect(dialog).toBeVisible();
      await dismiss(dialog);

      await expect(dialog).toBeHidden();
      await expect(unlink).toBeFocused();
      await expect(optionsPage.locator(".device-card")).toHaveCount(2);
      expect(Object.keys(await getStorage(serviceWorker, "connected_devices")).sort())
        .toEqual(["galaxy", "pixel"]);
    });
  }
});


test("Send Test Notification shows a notification and says so", async ({ optionsPage, serviceWorker }) => {
  await optionsPage.getByRole("button", { name: "Send Test Notification" }).click();

  await expect(optionsPage.locator("#testStatusNotice")).toHaveText(
    "Test desktop notification sent! Look for the popup in your system tray."
  );
  await expect.poll(async () => (await shownNotifications(serviceWorker)).length).toBe(1);
});


test.describe("with stored messages", () => {
  test.use({
    stored: {
      recent_sms_feed: [{ id: 1, sender: "BANK", body: "Hi", timestamp: Date.now() }]
    }
  });


  test("Clear Recent Messages asks in a dialog, then empties the feed", async ({ optionsPage, serviceWorker }) => {
    await optionsPage.getByRole("button", { name: "Clear Recent Messages" }).click();

    const dialog = optionsPage.getByRole("dialog", { name: "Clear recent messages?" });

    await dialog.getByRole("button", { name: "Clear Messages" }).click();
    await expect(dialog).toBeHidden();

    await expect(optionsPage.locator("#clearStatusNotice")).toHaveText(
      "All stored messages cleared."
    );
    expect(await getStorage(serviceWorker, "recent_sms_feed")).toEqual([]);
  });


  test("a dialog shown again before the last one's close event still asks", async ({ optionsPage, serviceWorker }) => {
    const dialog = optionsPage.getByRole("dialog");

    await optionsPage.getByRole("button", { name: "Clear Recent Messages" }).click();
    await expect(dialog).toBeVisible();

    // Closed and shown again in one task, so the close event is still queued.
    await optionsPage.evaluate(() => {
      document.getElementById("confirmDialog").close();
      document.getElementById("btnClearFeed").click();
    });

    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Clear Messages" }).click();

    await expect(optionsPage.locator("#clearStatusNotice")).toHaveText("All stored messages cleared.");
    expect(await getStorage(serviceWorker, "recent_sms_feed")).toEqual([]);
  });


  test("cancelling the clear dialog keeps the messages", async ({ optionsPage, serviceWorker }) => {
    const clear = optionsPage.getByRole("button", { name: "Clear Recent Messages" });

    await clear.click();
    await optionsPage.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    await expect(clear).toBeFocused();

    await expect(optionsPage.locator("#clearStatusNotice")).toBeHidden();
    expect(await getStorage(serviceWorker, "recent_sms_feed")).toHaveLength(1);
  });
});


test.describe("when a request fails", () => {
  // Replaces the page's messages to the background script, before it loads.
  async function answerMessages(page, answer) {
    await page.addInitScript((answer) => {
      if (!globalThis.chrome?.runtime) {
        return;
      }

      chrome.runtime.sendMessage = () => answer.error
        ? Promise.reject(new Error(answer.error))
        : Promise.resolve(answer.reply);
    }, answer);

    await page.reload();
  }


  test("a request answered not ok says why", async ({ optionsPage }) => {
    await answerMessages(optionsPage, { reply: { ok: false, error: "Storage is full." } });

    await optionsPage.getByRole("button", { name: "Send Test Notification" }).click();

    await expect(optionsPage.locator("#testStatusNotice")).toHaveText(
      "Failed to send test notification: Storage is full."
    );
    await expect(optionsPage.locator("#testStatusNotice")).toHaveClass(/error/);
  });


  test("a pairing code that is refused shows the reason", async ({ optionsPage }) => {
    await answerMessages(optionsPage, { reply: { ok: false, error: "No push subscription." } });

    await expect(optionsPage.locator("#txtPairingCode")).toHaveValue(
      "Failed to load push subscription: No push subscription."
    );
  });


  test.describe("with a pairing code that never arrives", () => {
    test.use({ stored: { connected_devices: { pixel: PIXEL } } });


    test("the phones are listed and the buttons work", async ({ optionsPage, serviceWorker }) => {
      await optionsPage.addInitScript(() => {
        if (!globalThis.chrome?.runtime) {
          return;
        }

        const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);

        chrome.runtime.sendMessage = (message) => message?.type === "GET_PAIRING_CODE"
          ? new Promise(() => {})
          : sendMessage(message);
      });
      await optionsPage.reload();

      await expect(optionsPage.getByText("Last active: 5m ago")).toBeVisible();

      await optionsPage.getByRole("button", { name: "Send Test Notification" }).click();

      await expect(optionsPage.locator("#testStatusNotice")).toHaveText(
        "Test desktop notification sent! Look for the popup in your system tray."
      );
      await expect.poll(async () => (await shownNotifications(serviceWorker)).length).toBe(1);
      await expect(optionsPage.locator("#txtPairingCode")).toHaveValue("");
    });
  });


  test("a pairing code that is not answered shows the error", async ({ optionsPage }) => {
    await answerMessages(optionsPage, { error: "Receiving end does not exist." });

    await expect(optionsPage.locator("#txtPairingCode")).toHaveValue("Error: Receiving end does not exist.");
  });


  test("a pairing text that cannot be copied is reported in a status line", async ({ optionsPage }) => {
    await expect(optionsPage.locator("#txtPairingCode")).toHaveValue(/^sms_pair:/);
    await optionsPage.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error("Clipboard is blocked."));
    });

    await optionsPage.locator("#btnCopyCode").click();

    const notice = optionsPage.locator("#copyStatusNotice");

    await expect(notice).toHaveText("Failed to copy: Clipboard is blocked.");
    await expect(notice).toHaveClass(/error/);
    await expect(optionsPage.getByRole("status").filter({ has: notice })).toHaveCount(1);
    await expect(optionsPage.locator("#btnCopyCode")).not.toHaveText("Copied to Clipboard!");
  });


  test("a test notification that cannot be sent says so", async ({ optionsPage }) => {
    await optionsPage.evaluate(() => {
      chrome.runtime.sendMessage = () => Promise.reject(new Error("Worker is gone."));
    });
    await optionsPage.getByRole("button", { name: "Send Test Notification" }).click();

    await expect(optionsPage.locator("#testStatusNotice")).toHaveText(
      "Failed to send test notification: Worker is gone."
    );
    await expect(optionsPage.locator("#testStatusNotice")).toHaveClass(/error/);
  });


  test("messages that cannot be cleared say so", async ({ optionsPage }) => {
    await optionsPage.evaluate(() => {
      chrome.runtime.sendMessage = () => Promise.reject(new Error("Worker is gone."));
    });
    await optionsPage.getByRole("button", { name: "Clear Recent Messages" }).click();
    await optionsPage.getByRole("dialog").getByRole("button", { name: "Clear Messages" }).click();

    await expect(optionsPage.locator("#clearStatusNotice")).toHaveText(
      "Failed to clear messages: Worker is gone."
    );
    await expect(optionsPage.locator("#clearStatusNotice")).toHaveClass(/error/);
  });
});
