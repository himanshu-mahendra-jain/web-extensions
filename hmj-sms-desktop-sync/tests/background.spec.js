import {
  test,
  expect,
  ENDPOINT,
  getStorage,
  shownNotifications,
  minutesAgo
} from "./fixtures.js";


/*
 * The Chromium service worker itself: real Web Push messages, its
 * notifications and their actions, the offscreen document that copies,
 * and the pairing code from the push subscription. sms-core.spec.js
 * covers the shared message handling against fake APIs.
 */

const OTP_SMS = {
  id: "sms-1",
  sender: "BANK",
  body: "Your code is 482913",
  otp: "482913",
  deviceId: "pixel-8",
  deviceName: "Pixel 8",
  simSlot: 1,
  simName: "Jio"
};


function storedFeed(serviceWorker) {
  return getStorage(serviceWorker, "recent_sms_feed");
}


test.describe("incoming pushes", () => {
  test("an SMS is stored, links its phone and shows a notification with copy buttons", async ({ push, serviceWorker }) => {
    const timestamp = minutesAgo(1);

    await push({ ...OTP_SMS, timestamp });

    await expect.poll(() => storedFeed(serviceWorker)).toEqual([
      expect.objectContaining({
        id: "sms-1",
        sender: "BANK",
        body: "Your code is 482913",
        otp: "482913",
        timestamp,
        deviceId: "pixel-8",
        deviceName: "Pixel 8"
      })
    ]);

    expect(await getStorage(serviceWorker, "connected_devices")).toEqual({
      "pixel-8": {
        id: "pixel-8",
        name: "Pixel 8",
        paired: true,
        lastSeen: expect.any(Number)
      }
    });

    await expect.poll(() => shownNotifications(serviceWorker)).toEqual([{
      title: "[Pixel 8] [SIM 2] New SMS from BANK",
      body: "Your code is 482913",
      actions: [
        ["copy_otp", "Copy OTP (482913)"],
        ["copy_body", "Copy Message"]
      ]
    }]);
  });


  test("notifications show the extension's icon", async ({ push, serviceWorker, extensionId }) => {
    await push({ ...OTP_SMS, timestamp: Date.now() });

    await expect.poll(() => serviceWorker.evaluate(async () => {
      return (await self.registration.getNotifications()).map(({ icon, badge }) => [icon, badge]);
    })).toEqual([Array(2).fill(`chrome-extension://${extensionId}/icons/icon128.png`)]);
  });


  test("a test ping from the phone confirms the link", async ({ push, serviceWorker }) => {
    await push({ type: "TEST_PING", deviceName: "My Pixel 8" });

    await expect.poll(() => storedFeed(serviceWorker)).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^test_/),
        sender: "SMS Desktop Sync",
        body: "Link verified with My Pixel 8! Instant SMS alerts are active.",
        otp: null,
        deviceName: "My Pixel 8"
      })
    ]);

    // Without a device ID the phone is keyed by its name.
    expect(Object.keys(await getStorage(serviceWorker, "connected_devices")))
      .toEqual(["device_my_pixel_8"]);

    await expect.poll(() => shownNotifications(serviceWorker)).toEqual([{
      title: "[My Pixel 8] New SMS from SMS Desktop Sync",
      body: "Link verified with My Pixel 8! Instant SMS alerts are active.",
      actions: [["copy_body", "Copy Message"]]
    }]);
  });


  test("an OTP delivered more than 10 minutes late is marked expired", async ({ push, serviceWorker }) => {
    await push({ ...OTP_SMS, simSlot: -1, timestamp: minutesAgo(11) });

    await expect.poll(() => shownNotifications(serviceWorker)).toEqual([{
      title: "[EXPIRED OTP] [Pixel 8] New SMS from BANK",
      body: "(Delivered after disconnect) Your code is 482913",
      actions: [["copy_body", "Copy Message"]]
    }]);
  });


  test("a push that is not JSON is stored as the message text", async ({ push, serviceWorker }) => {
    await push("Plain text from the phone");

    await expect.poll(() => storedFeed(serviceWorker)).toEqual([
      expect.objectContaining({
        sender: "Unknown",
        body: "Plain text from the phone",
        deviceName: "Phone"
      })
    ]);

    expect(Object.keys(await getStorage(serviceWorker, "connected_devices")))
      .toEqual(["default_device"]);
  });
});


test.describe("messages from the extension's pages", () => {
  let sendMessage;

  test.beforeEach(async ({ openExtensionPage }) => {
    // Any extension page can message the worker; this one has no side effects.
    const page = await openExtensionPage("src/offscreen.html");

    sendMessage = (message) => {
      return page.evaluate((value) => chrome.runtime.sendMessage(value), message);
    };
  });


  test("GET_PAIRING_CODE builds the pairing text from the push subscription", async ({ fakeSubscription, extensionId }) => {
    await fakeSubscription();

    const response = await sendMessage({ type: "GET_PAIRING_CODE" });

    expect(response.ok).toBe(true);
    expect(response.code.split("|")).toEqual([
      "sms_pair:v1",
      ENDPOINT,
      "test-p256dh",
      "test-auth",
      expect.stringMatching(/^Chrome \((Linux|Mac|Windows|Desktop)\)$/),
      extensionId
    ]);
  });


  test("SEND_TEST_NOTIFICATION shows a notification with an OTP", async ({ serviceWorker }) => {
    expect(await sendMessage({ type: "SEND_TEST_NOTIFICATION" })).toEqual({ ok: true });

    // The browser records a notification a moment after it is shown.
    await expect.poll(() => shownNotifications(serviceWorker)).toEqual([{
      title: "[Chrome] New SMS from Test Notification",
      body: "Instant push alerts are working perfectly!",
      actions: [
        ["copy_otp", "Copy OTP (123456)"],
        ["copy_body", "Copy Message"]
      ]
    }]);
  });
});


test("clicking a notification copies its OTP or text through the offscreen document", async ({ push, serviceWorker }) => {
  // Records what the worker asks the offscreen document to copy.
  await serviceWorker.evaluate(() => {
    const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);

    self.copiedTexts = [];

    chrome.runtime.sendMessage = (message) => {
      if (message?.type === "COPY_TO_CLIPBOARD") {
        self.copiedTexts.push(message.text);
      }

      return sendMessage(message);
    };
  });

  for (const id of ["otp-1", "otp-2", "otp-3"]) {
    await push({ ...OTP_SMS, id, timestamp: Date.now() });
  }

  await push({ id: "text-1", sender: "MOM", body: "Call me", timestamp: Date.now() });

  await expect.poll(async () => (await shownNotifications(serviceWorker)).length).toBe(4);

  // [notification, button ("" is the notification itself), copied text]
  const clicks = [
    ["sms_otp-1", "copy_otp", "482913"],
    ["sms_otp-2", "copy_body", "Your code is 482913"],
    ["sms_otp-3", "", "482913"],
    ["sms_text-1", "", "Call me"]
  ];

  for (const [index, [tag, action, text]] of clicks.entries()) {
    await serviceWorker.evaluate(async ([notificationTag, notificationAction]) => {
      const [notification] = await self.registration.getNotifications({ tag: notificationTag });

      self.dispatchEvent(new NotificationEvent("notificationclick", {
        notification,
        action: notificationAction
      }));
    }, [tag, action]);

    await expect.poll(() => {
      return serviceWorker.evaluate(() => self.copiedTexts);
    }).toHaveLength(index + 1);

    expect((await serviceWorker.evaluate(() => self.copiedTexts))[index]).toBe(text);
  }

  // Clicked notifications are closed.
  await expect.poll(() => shownNotifications(serviceWorker)).toEqual([]);

  expect(await serviceWorker.evaluate(async () => {
    return (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length;
  })).toBe(1);
});


test("a copy works again after the offscreen document once failed to open", async ({ push, serviceWorker }) => {
  // The first createDocument() fails; copies are recorded as above.
  await serviceWorker.evaluate(() => {
    const createDocument = chrome.offscreen.createDocument.bind(chrome.offscreen);
    const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);

    self.copiedTexts = [];
    self.createAttempts = 0;

    chrome.offscreen.createDocument = (details) => {
      self.createAttempts++;

      return self.createAttempts === 1
        ? Promise.reject(new Error("The offscreen document could not open."))
        : createDocument(details);
    };

    chrome.runtime.sendMessage = (message) => {
      if (message?.type === "COPY_TO_CLIPBOARD") {
        self.copiedTexts.push(message.text);
      }

      return sendMessage(message);
    };
  });

  for (const id of ["otp-1", "otp-2"]) {
    await push({ ...OTP_SMS, id, timestamp: Date.now() });
  }

  await expect.poll(async () => (await shownNotifications(serviceWorker)).length).toBe(2);

  const click = (tag) => serviceWorker.evaluate(async (notificationTag) => {
    const [notification] = await self.registration.getNotifications({ tag: notificationTag });

    self.dispatchEvent(new NotificationEvent("notificationclick", { notification, action: "copy_otp" }));
  }, tag);

  await click("sms_otp-1");
  await expect.poll(() => serviceWorker.evaluate(() => self.createAttempts)).toBe(1);

  await click("sms_otp-2");
  await expect.poll(() => serviceWorker.evaluate(() => self.copiedTexts)).toEqual(["482913"]);
});


test("two copies while the offscreen document opens share it", async ({ push, serviceWorker }) => {
  // createDocument() takes 300 ms; copies are recorded as above.
  await serviceWorker.evaluate(() => {
    const createDocument = chrome.offscreen.createDocument.bind(chrome.offscreen);
    const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);

    self.copiedTexts = [];
    self.createAttempts = 0;

    chrome.offscreen.createDocument = async (details) => {
      self.createAttempts++;
      await new Promise((resolve) => setTimeout(resolve, 300));

      return createDocument(details);
    };

    chrome.runtime.sendMessage = (message) => {
      if (message?.type === "COPY_TO_CLIPBOARD") {
        self.copiedTexts.push(message.text);
      }

      return sendMessage(message);
    };
  });

  await push({ ...OTP_SMS, id: "otp-1", timestamp: Date.now() });
  await push({ id: "text-1", sender: "MOM", body: "Call me", timestamp: Date.now() });

  await expect.poll(async () => (await shownNotifications(serviceWorker)).length).toBe(2);

  // The second click comes while the first is still opening the document.
  await serviceWorker.evaluate(async () => {
    for (const tag of ["sms_otp-1", "sms_text-1"]) {
      const [notification] = await self.registration.getNotifications({ tag });

      self.dispatchEvent(new NotificationEvent("notificationclick", { notification, action: "" }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });

  await expect.poll(async () => {
    return (await serviceWorker.evaluate(() => self.copiedTexts)).toSorted();
  }).toEqual(["482913", "Call me"]);

  expect(await serviceWorker.evaluate(() => self.createAttempts)).toBe(1);
  expect(await serviceWorker.evaluate(async () => {
    return (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length;
  })).toBe(1);
});


test("when showNotification fails, chrome.notifications shows the SMS with copy buttons", async ({ push, serviceWorker, extensionId }) => {
  // showNotification rejects; chrome.notifications.create() is recorded and still runs.
  await serviceWorker.evaluate(() => {
    const create = chrome.notifications.create.bind(chrome.notifications);

    self.created = [];

    self.registration.showNotification = async () => {
      throw new Error("Notifications are unavailable.");
    };

    chrome.notifications.create = (id, options) => {
      self.created.push({ id, ...options });

      return create(id, options);
    };
  });

  await push({ ...OTP_SMS, timestamp: Date.now() });

  await expect.poll(() => serviceWorker.evaluate(() => self.created)).toEqual([{
    id: "sms_sms-1",
    type: "basic",
    iconUrl: `chrome-extension://${extensionId}/icons/icon128.png`,
    title: "[Pixel 8] [SIM 2] New SMS from BANK",
    message: "Your code is 482913",
    buttons: [{ title: "Copy OTP (482913)" }, { title: "Copy Message" }],
    requireInteraction: true
  }]);

  await expect.poll(() => serviceWorker.evaluate(() => chrome.notifications.getAll()))
    .toEqual({ "sms_sms-1": true });
  expect(await shownNotifications(serviceWorker)).toEqual([]);

  // What its buttons copy, in the worker's session storage.
  expect(await serviceWorker.evaluate(async () => {
    return (await chrome.storage.session.get("notifications")).notifications;
  })).toEqual({
    "sms_sms-1": {
      sender: "BANK",
      body: "Your code is 482913",
      otp: "482913",
      deviceId: "pixel-8",
      actions: ["copy_otp", "copy_body"]
    }
  });
});
