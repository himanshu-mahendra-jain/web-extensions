import {
  test,
  expect,
  ENDPOINT,
  PAIRING_CODE_PATTERN,
  keysMatch,
  getStorage,
  setStorage,
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


  test("two real pushes with the same id from two phones give two notifications", async ({ push, serviceWorker }) => {
    const timestamp = Date.now();

    await push({ ...OTP_SMS, timestamp });
    await push({ ...OTP_SMS, deviceId: "galaxy", deviceName: "Galaxy S24", timestamp });

    await expect.poll(async () => {
      return (await serviceWorker.evaluate(async () => {
        return (await self.registration.getNotifications()).map(({ tag }) => tag);
      })).toSorted();
    }).toEqual(["sms_galaxy_sms-1", "sms_pixel-8_sms-1"]);
    await expect.poll(async () => (await storedFeed(serviceWorker)).map(({ key }) => key))
      .toEqual(["galaxy:sms-1", "pixel-8:sms-1"]);
  });


  test("a new OTP closes the earlier notifications, and only codes stay on screen", async ({ push, serviceWorker }) => {
    const shown = () => serviceWorker.evaluate(async () => {
      return (await self.registration.getNotifications()).map(({ tag, requireInteraction }) => [tag, requireInteraction]);
    });

    await push({ ...OTP_SMS, id: "otp-1", timestamp: minutesAgo(2) });
    await push({ id: "text-1", sender: "MOM", body: "Call me", timestamp: minutesAgo(1) });
    await expect.poll(async () => (await shown()).length).toBe(2);

    await push({ ...OTP_SMS, id: "otp-2", timestamp: Date.now() });

    await expect.poll(shown).toEqual([
      ["sms_pixel-8_otp-2", true]
    ]);
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

  test.beforeEach(async ({ openExtensionPage, fakeSubscription }) => {
    await fakeSubscription();

    // Any extension page can message the worker; this one has no side effects.
    const page = await openExtensionPage("src/offscreen.html");

    sendMessage = (message) => {
      return page.evaluate((value) => chrome.runtime.sendMessage(value), message);
    };
  });


  test("GET_PAIRING_CODE builds a v2 code with a VAPID key pair the phone accepts", async ({ serviceWorker }) => {
    const response = await sendMessage({ type: "GET_PAIRING_CODE" });

    expect(response.ok).toBe(true);
    expect(response.code).toMatch(PAIRING_CODE_PATTERN);
    expect(response.code.length).toBeLessThanOrEqual(2048);

    const [, endpoint, , , publicKey, privateKey] = response.code.split("|");

    expect(endpoint).toBe(ENDPOINT);
    expect(await keysMatch(serviceWorker, publicKey, privateKey)).toBe(true);

    // The subscription is made with that public key, and the pair is kept.
    expect(await serviceWorker.evaluate(async () => {
      const subscription = await self.registration.pushManager.getSubscription();
      const key = new Uint8Array(subscription.options.applicationServerKey);
      return btoa(String.fromCharCode(...key)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    })).toBe(publicKey);
    expect(await getStorage(serviceWorker, "vapid_key")).toEqual({ publicKey, privateKey });
  });


  test("every phone gets the same code until all are unlinked", async ({ serviceWorker }) => {
    const first = await sendMessage({ type: "GET_PAIRING_CODE" });
    const again = await sendMessage({ type: "GET_PAIRING_CODE" });

    expect(again.code).toBe(first.code);
    expect(await serviceWorker.evaluate(() => self.pushSubscriptions)).toEqual({ made: 1, ended: 0 });
  });


  test("two pages asking for the first code at once get the same key", async ({ serviceWorker }) => {
    // The key made at install is gone, so both requests would make one.
    await serviceWorker.evaluate(() => chrome.storage.local.remove("vapid_key"));

    const [one, two] = await Promise.all([
      sendMessage({ type: "GET_PAIRING_CODE" }),
      sendMessage({ type: "GET_PAIRING_CODE" })
    ]);

    expect(one.code).toBe(two.code);
  });


  test("a subscription made with another key is ended first", async ({ serviceWorker }) => {
    // As if the stored key were lost: a subscription with another key exists, but no key.
    await serviceWorker.evaluate(async () => {
      const pushManager = self.registration.pushManager;
      await (await pushManager.getSubscription())?.unsubscribe();

      const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
      const key = await crypto.subtle.exportKey("raw", pair.publicKey);
      await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await chrome.storage.local.remove("vapid_key");
      self.pushSubscriptions.ended = 0;
    });

    const response = await sendMessage({ type: "GET_PAIRING_CODE" });
    const [, endpoint, , , publicKey] = response.code.split("|");

    expect(response.code).toMatch(PAIRING_CODE_PATTERN);
    expect(await serviceWorker.evaluate(() => self.pushSubscriptions.ended)).toBe(1);
    expect(await serviceWorker.evaluate(async () => {
      return (await self.registration.pushManager.getSubscription()).endpoint;
    })).toBe(endpoint);
    expect((await getStorage(serviceWorker, "vapid_key")).publicKey).toBe(publicKey);
  });


  test("UNLINK_ALL ends the subscription, makes a new key and code, and clears the messages", async ({ serviceWorker }) => {
    const before = (await sendMessage({ type: "GET_PAIRING_CODE" })).code.split("|");

    await setStorage(serviceWorker, {
      connected_devices: { pixel: { id: "pixel", name: "Pixel 8", lastSeen: Date.now() } },
      unlinked_devices: { galaxy: { name: "Galaxy S24", unlinkedAt: Date.now(), ignored: 2 } },
      recent_sms_feed: [{ id: 1, sender: "BANK", body: "Hi", timestamp: Date.now() }]
    });

    expect(await sendMessage({ type: "UNLINK_ALL" })).toEqual({ ok: true });

    const after = (await sendMessage({ type: "GET_PAIRING_CODE" })).code.split("|");

    // A new push address with a new key pair; the old address is gone.
    expect(after[1]).toBe(`${ENDPOINT}-2`);
    expect(after[4]).not.toBe(before[4]);
    expect(after[5]).not.toBe(before[5]);
    expect(await keysMatch(serviceWorker, after[4], after[5])).toBe(true);
    expect(await serviceWorker.evaluate(() => self.pushSubscriptions)).toEqual({ made: 2, ended: 1 });

    // No phone is linked or ignored any more, and the messages are gone.
    expect(await getStorage(serviceWorker, "connected_devices")).toEqual({});
    expect(await getStorage(serviceWorker, "unlinked_devices")).toEqual({});
    expect(await getStorage(serviceWorker, "recent_sms_feed")).toEqual([]);
    // Nothing was lost behind the user's back, so nothing asks to pair again.
    expect(await getStorage(serviceWorker, "needs_repair")).toBe(false);
    expect(await getStorage(serviceWorker, "push_endpoint")).toBe(`${ENDPOINT}-2`);
  });


  test("a subscription ended behind the extension's back asks to pair again, until a phone does", async ({ push, serviceWorker }) => {
    await sendMessage({ type: "GET_PAIRING_CODE" });
    expect(await getStorage(serviceWorker, "push_endpoint")).toBe(ENDPOINT);

    await setStorage(serviceWorker, {
      connected_devices: { pixel: { id: "pixel", name: "Pixel 8", lastSeen: Date.now() } },
      unlinked_devices: { galaxy: { name: "Galaxy S24", unlinkedAt: Date.now(), ignored: 2 } }
    });

    // As the browser ends an unused subscription, then says so, if it does.
    await serviceWorker.evaluate(async () => {
      await (await self.registration.pushManager.getSubscription()).unsubscribe();
      self.dispatchEvent(new ExtendableEvent("pushsubscriptionchange"));
    });

    await expect.poll(() => getStorage(serviceWorker, "needs_repair")).toBe(true);
    expect(await getStorage(serviceWorker, "connected_devices")).toEqual({});
    expect(await getStorage(serviceWorker, "unlinked_devices")).toEqual({});
    expect(await getStorage(serviceWorker, "push_endpoint")).toBeNull();

    // The next code holds a new subscription; the request stays until a phone pairs again.
    const code = (await sendMessage({ type: "GET_PAIRING_CODE" })).code;

    expect(code.split("|")[1]).toBe(`${ENDPOINT}-2`);
    expect(await getStorage(serviceWorker, "push_endpoint")).toBe(`${ENDPOINT}-2`);
    expect(await getStorage(serviceWorker, "needs_repair")).toBe(true);

    await push({ type: "TEST_PING", deviceId: "pixel-8", deviceName: "Pixel 8" });

    await expect.poll(() => getStorage(serviceWorker, "needs_repair")).toBe(false);
    expect(Object.keys(await getStorage(serviceWorker, "connected_devices"))).toEqual(["pixel-8"]);
  });


  test("a pairing code notices a subscription that ended before it subscribes again", async ({ serviceWorker }) => {
    await sendMessage({ type: "GET_PAIRING_CODE" });
    await setStorage(serviceWorker, {
      connected_devices: { pixel: { id: "pixel", name: "Pixel 8", lastSeen: Date.now() } }
    });
    await serviceWorker.evaluate(async () => {
      await (await self.registration.pushManager.getSubscription()).unsubscribe();
    });

    const code = (await sendMessage({ type: "GET_PAIRING_CODE" })).code;

    expect(code.split("|")[1]).toBe(`${ENDPOINT}-2`);
    expect(await getStorage(serviceWorker, "needs_repair")).toBe(true);
    expect(await getStorage(serviceWorker, "connected_devices")).toEqual({});
  });


  test("GET_STATUS says whether notifications are off", async ({ serviceWorker }) => {
    expect(await sendMessage({ type: "GET_STATUS" })).toEqual({ ok: true, notificationsOff: false });

    await serviceWorker.evaluate(() => {
      chrome.notifications.getPermissionLevel = async () => "denied";
    });

    expect(await sendMessage({ type: "GET_STATUS" })).toEqual({ ok: true, notificationsOff: true });
  });
});


test.describe("an unlinked phone", () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await setStorage(serviceWorker, {
      unlinked_devices: { "pixel-8": { name: "Pixel 8", unlinkedAt: Date.now(), ignored: 0 } }
    });
  });


  test("its messages are counted in one quiet notice, never stored", async ({ push, serviceWorker }) => {
    await push({ ...OTP_SMS, timestamp: Date.now() });

    await expect.poll(() => shownNotifications(serviceWorker)).toEqual([{
      title: "Pixel 8 is unlinked",
      body: "1 message ignored. Unlink this computer in the SMS app on that phone to stop them, or click here to unlink all phones.",
      actions: []
    }]);

    await push({ ...OTP_SMS, id: "sms-2", timestamp: Date.now() });

    // The same notice, replaced without a sound.
    await expect.poll(async () => (await shownNotifications(serviceWorker)).map(({ body }) => body)).toEqual([
      "2 messages ignored. Unlink this computer in the SMS app on that phone to stop them, or click here to unlink all phones."
    ]);
    expect(await serviceWorker.evaluate(async () => {
      return (await self.registration.getNotifications()).map(({ tag, silent }) => [tag, silent]);
    })).toEqual([["unlinked_pixel-8", true]]);

    expect(await getStorage(serviceWorker, "recent_sms_feed")).toBeUndefined();
    expect(await getStorage(serviceWorker, "connected_devices")).toBeUndefined();
    expect((await getStorage(serviceWorker, "unlinked_devices"))["pixel-8"].ignored).toBe(2);
  });


  test("a click on the notice opens the toolbar popup", async ({ push, serviceWorker, context, extensionId }) => {
    await push({ ...OTP_SMS, timestamp: Date.now() });
    await expect.poll(async () => (await shownNotifications(serviceWorker)).length).toBe(1);

    const pages = context.pages().length;

    await serviceWorker.evaluate(async () => {
      const [notification] = await self.registration.getNotifications();

      self.dispatchEvent(new NotificationEvent("notificationclick", { notification, action: "" }));
    });

    // Headless Chromium has a window to open it in, so no window of its own opens.
    await expect.poll(() => serviceWorker.evaluate(async () => {
      return (await chrome.runtime.getContexts({ contextTypes: ["POPUP"] })).map(({ documentUrl }) => documentUrl);
    })).toEqual([`chrome-extension://${extensionId}/src/popup.html`]);
    expect(context.pages()).toHaveLength(pages);
  });


  test("a test ping links it again", async ({ push, serviceWorker }) => {
    await push({ type: "TEST_PING", deviceId: "pixel-8", deviceName: "Pixel 8" });

    await expect.poll(() => getStorage(serviceWorker, "unlinked_devices")).toEqual({});
    expect(Object.keys(await getStorage(serviceWorker, "connected_devices"))).toEqual(["pixel-8"]);

    await push({ ...OTP_SMS, timestamp: Date.now() });

    await expect.poll(async () => (await getStorage(serviceWorker, "recent_sms_feed")).map(({ id }) => id))
      .toEqual(["sms-1", expect.stringMatching(/^test_/)]);
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

  // Each OTP is older than the one before, as when it arrives late, so none closes another.
  for (const [index, id] of ["otp-1", "otp-2", "otp-3"].entries()) {
    await push({ ...OTP_SMS, id, timestamp: minutesAgo(index + 1) });
  }

  await push({ id: "text-1", sender: "MOM", body: "Call me", timestamp: Date.now() });

  await expect.poll(async () => (await shownNotifications(serviceWorker)).length).toBe(4);

  // [notification, button ("" is the notification itself), copied text]
  const clicks = [
    ["sms_pixel-8_otp-1", "copy_otp", "482913"],
    ["sms_pixel-8_otp-2", "copy_body", "Your code is 482913"],
    ["sms_pixel-8_otp-3", "", "482913"],
    ["sms_default_device_text-1", "", "Call me"]
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

  // So is the offscreen document, once its copy is done.
  await expect.poll(() => serviceWorker.evaluate(async () => {
    return (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length;
  })).toBe(0);
});


test("the offscreen document is closed after a copy, and opened again for the next", async ({ push, serviceWorker }) => {
  // Counts the documents opened and closed; copies are recorded as above.
  await serviceWorker.evaluate(() => {
    const createDocument = chrome.offscreen.createDocument.bind(chrome.offscreen);
    const closeDocument = chrome.offscreen.closeDocument.bind(chrome.offscreen);
    const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);

    self.copiedTexts = [];
    self.documents = { opened: 0, closed: 0 };

    chrome.offscreen.createDocument = (details) => {
      self.documents.opened++;
      return createDocument(details);
    };

    chrome.offscreen.closeDocument = () => {
      self.documents.closed++;
      return closeDocument();
    };

    chrome.runtime.sendMessage = (message) => {
      if (message?.type === "COPY_TO_CLIPBOARD") {
        self.copiedTexts.push(message.text);
      }

      return sendMessage(message);
    };
  });

  // Older each time, as above, so both stay open.
  for (const [index, id] of ["otp-1", "otp-2"].entries()) {
    await push({ ...OTP_SMS, id, timestamp: minutesAgo(index + 1) });
  }

  await expect.poll(async () => (await shownNotifications(serviceWorker)).length).toBe(2);

  const openDocuments = () => serviceWorker.evaluate(async () => {
    return (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length;
  });

  for (const [index, tag] of ["sms_pixel-8_otp-1", "sms_pixel-8_otp-2"].entries()) {
    await serviceWorker.evaluate(async (notificationTag) => {
      const [notification] = await self.registration.getNotifications({ tag: notificationTag });

      self.dispatchEvent(new NotificationEvent("notificationclick", { notification, action: "copy_otp" }));
    }, tag);

    await expect.poll(() => serviceWorker.evaluate(() => self.copiedTexts)).toHaveLength(index + 1);
    await expect.poll(openDocuments).toBe(0);
    expect(await serviceWorker.evaluate(() => self.documents)).toEqual({ opened: index + 1, closed: index + 1 });
  }
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

  // Older each time, as above, so both stay open.
  for (const [index, id] of ["otp-1", "otp-2"].entries()) {
    await push({ ...OTP_SMS, id, timestamp: minutesAgo(index + 1) });
  }

  await expect.poll(async () => (await shownNotifications(serviceWorker)).length).toBe(2);

  const click = (tag) => serviceWorker.evaluate(async (notificationTag) => {
    const [notification] = await self.registration.getNotifications({ tag: notificationTag });

    self.dispatchEvent(new NotificationEvent("notificationclick", { notification, action: "copy_otp" }));
  }, tag);

  await click("sms_pixel-8_otp-1");
  await expect.poll(() => serviceWorker.evaluate(() => self.createAttempts)).toBe(1);

  await click("sms_pixel-8_otp-2");
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
    for (const tag of ["sms_pixel-8_otp-1", "sms_default_device_text-1"]) {
      const [notification] = await self.registration.getNotifications({ tag });

      self.dispatchEvent(new NotificationEvent("notificationclick", { notification, action: "" }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });

  await expect.poll(async () => {
    return (await serviceWorker.evaluate(() => self.copiedTexts)).toSorted();
  }).toEqual(["482913", "Call me"]);

  expect(await serviceWorker.evaluate(() => self.createAttempts)).toBe(1);
  // The last copy to end closes the document they shared.
  await expect.poll(() => serviceWorker.evaluate(async () => {
    return (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length;
  })).toBe(0);
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

  const timestamp = Date.now();

  await push({ ...OTP_SMS, timestamp });

  await expect.poll(() => serviceWorker.evaluate(() => self.created)).toEqual([{
    id: "sms_pixel-8_sms-1",
    type: "basic",
    iconUrl: `chrome-extension://${extensionId}/icons/icon128.png`,
    title: "[Pixel 8] [SIM 2] New SMS from BANK",
    message: "Your code is 482913",
    buttons: [{ title: "Copy OTP (482913)" }, { title: "Copy Message" }],
    requireInteraction: true
  }]);

  await expect.poll(() => serviceWorker.evaluate(() => chrome.notifications.getAll()))
    .toEqual({ "sms_pixel-8_sms-1": true });
  expect(await shownNotifications(serviceWorker)).toEqual([]);

  // What its buttons copy, in the worker's session storage.
  expect(await serviceWorker.evaluate(async () => {
    return (await chrome.storage.session.get("notifications")).notifications;
  })).toEqual({
    "sms_pixel-8_sms-1": {
      sender: "BANK",
      body: "Your code is 482913",
      otp: "482913",
      timestamp,
      deviceId: "pixel-8",
      actions: ["copy_otp", "copy_body"]
    }
  });
});
