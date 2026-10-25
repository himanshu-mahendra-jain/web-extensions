import { expect } from "@playwright/test";

import { test, openHarness, restartBackground } from "./fake-chrome.js";


/*
 * sms-core.js through the Chrome and Edge entry script, against the
 * fake APIs in fake-chrome.js. Messages are handed to handleIncoming()
 * directly, as the worker's push listener does. Without a service
 * worker the entry shows chrome.notifications notifications, with
 * buttons.
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


function push(page, data) {
  return page.evaluate((value) => window.background.handleIncoming(value), data);
}


function message(page, request) {
  return page.evaluate((value) => window.fake.message(value), request);
}


function stored(page) {
  return page.evaluate(() => window.fake.storage());
}


async function feed(page) {
  return (await stored(page)).recent_sms_feed;
}


async function feedIds(page) {
  return ((await feed(page)) ?? []).map((sms) => sms.id);
}


function created(page) {
  return page.evaluate(() => window.fake.notifications);
}


function session(page) {
  return page.evaluate(() => window.fake.session);
}


function setStorage(page, items) {
  return page.evaluate((values) => chrome.storage.local.set(values), items);
}


function minutesAgo(minutes) {
  return Date.now() - minutes * 60 * 1000;
}


// Chrome offers each copy action as a button; only one with an OTP to copy stays on screen.
const buttons = (...titles) => {
  return {
    buttons: titles.map((title) => ({ title })),
    requireInteraction: titles[0].startsWith("Copy OTP")
  };
};


test.beforeEach(async ({ page, permissionLevel }) => {
  await openHarness(page, { permissionLevel });
});


test.describe("incoming messages", () => {
  test("an SMS is stored with its SIM, links its phone and shows a notification", async ({ page }) => {
    const timestamp = minutesAgo(1);

    await push(page, { ...OTP_SMS, timestamp });

    expect(await feed(page)).toEqual([{
      id: "sms-1",
      key: "pixel-8:sms-1",
      sender: "BANK",
      body: "Your code is 482913",
      timestamp,
      otp: "482913",
      deviceId: "pixel-8",
      deviceName: "Pixel 8",
      simSlot: 1,
      simName: "Jio"
    }]);

    expect((await stored(page)).connected_devices).toEqual({
      "pixel-8": { id: "pixel-8", name: "Pixel 8", lastSeen: expect.any(Number) }
    });

    expect(await created(page)).toEqual([{
      id: "sms_pixel-8_sms-1",
      type: "basic",
      iconUrl: "chrome-extension://test-id/icons/icon128.png",
      title: "[Pixel 8] [SIM 2] New SMS from BANK",
      message: "Your code is 482913",
      ...buttons("Copy OTP (482913)", "Copy Message")
    }]);

    // Pages render from the storage change; the phone and the SMS are stored in one write.
    expect(await page.evaluate(() => window.fake.sentMessages)).toEqual([]);
    expect(await page.evaluate(() => window.fake.writes)).toEqual([["connected_devices", "recent_sms_feed"]]);
  });


  test("a test ping from the phone confirms the link", async ({ page }) => {
    await push(page, { type: "TEST_PING", deviceName: "My Pixel 8" });

    expect(await feed(page)).toEqual([expect.objectContaining({
      id: expect.stringMatching(/^test_/),
      sender: "SMS Desktop Sync",
      body: "Link verified with My Pixel 8! Instant SMS alerts are active.",
      otp: null,
      deviceName: "My Pixel 8"
    })]);

    // Without a device ID the phone is keyed by its name.
    expect(Object.keys((await stored(page)).connected_devices))
      .toEqual(["device_my_pixel_8"]);

    expect(await created(page)).toEqual([expect.objectContaining({
      title: "[My Pixel 8] New SMS from SMS Desktop Sync",
      message: "Link verified with My Pixel 8! Instant SMS alerts are active.",
      ...buttons("Copy Message")
    })]);
  });


  test("an OTP delivered more than 10 minutes late is marked expired", async ({ page }) => {
    await push(page, { ...OTP_SMS, simSlot: -1, timestamp: minutesAgo(11) });

    expect(await created(page)).toEqual([expect.objectContaining({
      title: "[EXPIRED OTP] [Pixel 8] New SMS from BANK",
      message: "(Delivered after disconnect) Your code is 482913",
      ...buttons("Copy Message")
    })]);
  });


  test("an SMS older than 24 hours is shown but not stored", async ({ page }) => {
    await push(page, { id: "old", sender: "BANK", body: "Old news", timestamp: minutesAgo(25 * 60) });

    expect(await created(page)).toHaveLength(1);

    expect(await feed(page)).toBeUndefined();
  });


  test("a message with only a text gets a sender and a phone", async ({ page }) => {
    // What the Chromium worker makes of a push that is not JSON.
    await push(page, { body: "Plain text from the phone" });

    expect(await feed(page)).toEqual([expect.objectContaining({
      sender: "Unknown",
      body: "Plain text from the phone",
      deviceName: "Phone"
    })]);

    expect(Object.keys((await stored(page)).connected_devices))
      .toEqual(["default_device"]);
  });


  test("a push without data still says a message arrived", async ({ page }) => {
    await push(page, null);

    expect(await created(page)).toEqual([expect.objectContaining({
      title: "[Phone] New SMS from SMS Desktop Sync",
      message: "New message received from phone"
    })]);
  });


  test("the same SMS pushed twice is stored once", async ({ page }) => {
    await push(page, { ...OTP_SMS, timestamp: minutesAgo(2) });
    expect(await feedIds(page)).toEqual(["sms-1"]);

    await push(page, { ...OTP_SMS, timestamp: minutesAgo(2) });
    await push(page, { ...OTP_SMS, id: "sms-2", timestamp: minutesAgo(1) });

    expect(await feedIds(page)).toEqual(["sms-2", "sms-1"]);
  });


  test("the same id from two phones is stored twice and notified twice", async ({ page }) => {
    const timestamp = minutesAgo(1);

    // Each phone numbers its own messages, and both got the same text at the same time.
    await push(page, { ...OTP_SMS, timestamp });
    await push(page, { ...OTP_SMS, deviceId: "galaxy", deviceName: "Galaxy S24", timestamp });

    expect((await feed(page)).map(({ id, key }) => [id, key])).toEqual([
      ["sms-1", "galaxy:sms-1"],
      ["sms-1", "pixel-8:sms-1"]
    ]);
    expect((await created(page)).map(({ id }) => id)).toEqual(["sms_pixel-8_sms-1", "sms_galaxy_sms-1"]);
    expect(Object.keys((await session(page)).notifications)).toEqual(["sms_pixel-8_sms-1", "sms_galaxy_sms-1"]);

    // The same message from either phone again is still stored once.
    await push(page, { ...OTP_SMS, deviceId: "galaxy", deviceName: "Galaxy S24", timestamp });

    expect(await feedIds(page)).toEqual(["sms-1", "sms-1"]);
  });


  test("two pushes handled at once are both stored, with both phones", async ({ page }) => {
    await page.evaluate((sms) => Promise.all([
      window.background.handleIncoming({ ...sms, timestamp: Date.now() }),
      window.background.handleIncoming({ ...sms, deviceId: "galaxy", deviceName: "Galaxy S24", timestamp: Date.now() })
    ]), OTP_SMS);

    expect((await feed(page)).map(({ key }) => key).toSorted()).toEqual(["galaxy:sms-1", "pixel-8:sms-1"]);
    expect(Object.keys((await stored(page)).connected_devices).toSorted()).toEqual(["galaxy", "pixel-8"]);
  });


  test("the same text from the same sender within 5 seconds is stored once", async ({ page }) => {
    const timestamp = minutesAgo(1);

    await push(page, { ...OTP_SMS, id: "a", timestamp });
    await push(page, { ...OTP_SMS, id: "b", timestamp: timestamp + 3000 });
    await push(page, { ...OTP_SMS, id: "c", timestamp: timestamp + 6000 });

    // Another text at the same time is another message.
    await push(page, { ...OTP_SMS, id: "d", body: "Another", timestamp });

    expect(await feedIds(page)).toEqual(["d", "c", "a"]);
  });


  test("the feed keeps the 100 newest messages and drops ones older than 24 hours", async ({ page }) => {
    const seeded = Array.from({ length: 100 }, (_, index) => ({
      id: `m${index}`,
      sender: "SHOP",
      body: `Message ${index}`,
      timestamp: minutesAgo(index + 1)
    }));

    // The oldest one is past 24 hours.
    seeded[99].timestamp = minutesAgo(25 * 60);

    await setStorage(page, { recent_sms_feed: seeded });

    await push(page, { ...OTP_SMS, id: "new-1", timestamp: Date.now() });
    expect((await feedIds(page))[0]).toBe("new-1");

    await push(page, { ...OTP_SMS, id: "new-2", body: "Another", timestamp: Date.now() });
    expect((await feedIds(page))[0]).toBe("new-2");

    const ids = await feedIds(page);

    expect(ids).toHaveLength(100);
    expect(ids.slice(0, 3)).toEqual(["new-2", "new-1", "m0"]);
    expect(ids.at(-1)).toBe("m97");
  });


  test("a push that is not a JSON object only says a message arrived", async ({ page }) => {
    for (const data of [42, "text", ["BANK", "Hi"]]) {
      await push(page, data);
    }

    expect((await created(page)).map(({ title, message }) => [title, message])).toEqual(
      Array(3).fill(["[Phone] New SMS from SMS Desktop Sync", "New message received from phone"])
    );
  });


  test("fields of the wrong type, too long or in the future are fixed before storing", async ({ page }) => {
    const before = Date.now();

    await push(page, {
      id: { nested: true },
      sender: "S".repeat(500),
      body: "B".repeat(10000),
      otp: "<b>1</b>",
      timestamp: before + 60 * 60 * 1000,
      deviceId: "../../etc",
      deviceName: 7,
      simSlot: "1",
      simName: "N".repeat(100)
    });

    const [sms] = await feed(page);

    expect(sms).toEqual({
      id: expect.any(Number),
      key: `default_device:${sms.id}`,
      sender: "S".repeat(200),
      body: "B".repeat(4096),
      otp: null,
      timestamp: expect.any(Number),
      deviceId: "",
      deviceName: "Phone",
      simSlot: -1,
      simName: "N".repeat(32)
    });
    expect(sms.timestamp).toBeLessThanOrEqual(Date.now());
    expect(sms.id).toBeGreaterThanOrEqual(before);
    expect(Object.keys((await stored(page)).connected_devices)).toEqual(["default_device"]);
  });


  test("an OTP is kept only when it looks like one", async ({ page }) => {
    const otps = { a: "482913", b: 482913, c: "AB-12", d: "12", e: "1234567890123", f: "12 34" };

    for (const [id, otp] of Object.entries(otps)) {
      await push(page, { id, sender: id, body: id, otp, timestamp: Date.now() });
    }

    const kept = Object.fromEntries((await feed(page)).map((sms) => [sms.id, sms.otp]));

    expect(kept).toEqual({ a: "482913", b: "482913", c: "AB-12", d: null, e: null, f: null });
  });


  test("a phone without a usable ID is keyed by its name", async ({ page }) => {
    await push(page, { ...OTP_SMS, deviceId: "x".repeat(65), timestamp: Date.now() });

    expect(Object.keys((await stored(page)).connected_devices)).toEqual(["device_pixel_8"]);
    expect((await feed(page))[0].deviceId).toBe("");
  });


  test("a phone named __proto__ is keyed by its name", async ({ page }) => {
    // IDs that name Object properties, which a device map must never write.
    for (const deviceId of ["__proto__", "constructor", "prototype"]) {
      await push(page, { ...OTP_SMS, id: deviceId, body: deviceId, deviceId, timestamp: Date.now() });
    }

    const devices = await page.evaluate(async () => {
      const { connected_devices: stored } = await chrome.storage.local.get("connected_devices");
      return { keys: Object.keys(stored), plain: Object.getPrototypeOf(stored) === Object.prototype };
    });

    expect(devices).toEqual({ keys: ["device_pixel_8"], plain: true });
    expect((await feed(page)).map(({ key, deviceId }) => [key, deviceId])).toEqual([
      ["device_pixel_8:prototype", ""],
      ["device_pixel_8:constructor", ""],
      ["device_pixel_8:__proto__", ""]
    ]);
  });


  test("at most 10 phones stay linked, dropping the least recently seen", async ({ page }) => {
    const devices = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`phone-${index}`, {
        id: `phone-${index}`,
        name: `Phone ${index}`,
        lastSeen: minutesAgo(60 - index)
      }])
    );

    await setStorage(page, { connected_devices: devices });

    await push(page, { ...OTP_SMS, deviceId: "phone-new", timestamp: Date.now() });

    expect(Object.keys((await stored(page)).connected_devices).sort()).toEqual([
      "phone-1", "phone-2", "phone-3", "phone-4", "phone-5",
      "phone-6", "phone-7", "phone-8", "phone-9", "phone-new"
    ]);
  });
});


test.describe("notification clicks", () => {
  test("clicking a notification copies its OTP, or its text without one", async ({ page }) => {
    await push(page, { ...OTP_SMS, timestamp: Date.now() });
    await push(page, { id: "sms-2", sender: "MOM", body: "Call me", timestamp: Date.now() });

    await page.evaluate(async () => {
      for (const id of ["sms_pixel-8_sms-1", "sms_default_device_sms-2"]) {
        for (const listener of window.fake.onClicked.list) {
          await listener(id);
        }
      }
    });

    expect(await page.evaluate(() => window.fake.copiedTexts)).toEqual(["482913", "Call me"]);
    expect(await page.evaluate(() => window.fake.cleared)).toEqual(["sms_pixel-8_sms-1", "sms_default_device_sms-2"]);
  });


  test("a notification's clicks still copy after the background was stopped", async ({ page }) => {
    await push(page, { ...OTP_SMS, timestamp: Date.now() });
    await push(page, { id: "sms-2", sender: "MOM", body: "Call me", timestamp: Date.now() });

    // Kept in memory-backed session storage, never with the stored messages.
    expect(Object.keys((await session(page)).notifications)).toEqual(["sms_pixel-8_sms-1", "sms_default_device_sms-2"]);
    expect(Object.keys(await stored(page)).sort()).toEqual(["connected_devices", "recent_sms_feed"]);

    await restartBackground(page);

    await page.evaluate(async () => {
      for (const listener of window.fake.onClicked.list) {
        await listener("sms_pixel-8_sms-1");
      }

      for (const listener of window.fake.onButtonClicked.list) {
        await listener("sms_default_device_sms-2", 0);
      }
    });

    await expect.poll(() => page.evaluate(() => window.fake.copiedTexts)).toEqual(["482913", "Call me"]);
    expect((await session(page)).notifications).toEqual({});
  });


  test("at most 50 notifications are remembered, dropping the oldest", async ({ page }) => {
    for (let index = 0; index <= 50; index++) {
      await push(page, { id: `m${index}`, sender: "SHOP", body: `Message ${index}`, timestamp: Date.now() });
    }

    const ids = Object.keys((await session(page)).notifications);

    expect(ids).toHaveLength(50);
    expect([ids[0], ids.at(-1)]).toEqual(["sms_default_device_m1", "sms_default_device_m50"]);
  });


  test("a notification's buttons copy its OTP or its text", async ({ page }) => {
    // Each OTP is older than the one before, as when it arrives late, so both stay open.
    for (const [index, id] of ["otp-1", "otp-2"].entries()) {
      await push(page, { ...OTP_SMS, id, timestamp: minutesAgo(index + 1) });
    }

    await push(page, { id: "text-1", sender: "MOM", body: "Call me", timestamp: Date.now() });

    // [notification, button index, copied text]
    const clicks = [
      ["sms_pixel-8_otp-1", 0, "482913"],
      ["sms_pixel-8_otp-2", 1, "Your code is 482913"],
      ["sms_default_device_text-1", 0, "Call me"]
    ];

    for (const [id, index] of clicks) {
      await page.evaluate(([notificationId, buttonIndex]) => {
        for (const listener of window.fake.onButtonClicked.list) {
          listener(notificationId, buttonIndex);
        }
      }, [id, index]);
    }

    await expect.poll(() => page.evaluate(() => window.fake.copiedTexts))
      .toEqual(clicks.map(([, , text]) => text));
    expect(await page.evaluate(() => window.fake.cleared)).toEqual(["sms_pixel-8_otp-1", "sms_pixel-8_otp-2", "sms_default_device_text-1"]);
  });


  test("a new OTP closes the earlier notifications, and nothing else does", async ({ page }) => {
    const opened = async () => Object.keys((await session(page)).notifications);
    const cleared = () => page.evaluate(() => window.fake.cleared);

    await push(page, { ...OTP_SMS, id: "otp-1", timestamp: minutesAgo(3) });
    await push(page, { id: "text-1", sender: "MOM", body: "Call me", timestamp: minutesAgo(2) });
    await push(page, { ...OTP_SMS, id: "otp-2", timestamp: minutesAgo(1) });

    // Both earlier ones go, so the code is alone, and what they copied is forgotten.
    expect(await cleared()).toEqual(["sms_pixel-8_otp-1", "sms_default_device_text-1"]);
    expect(await opened()).toEqual(["sms_pixel-8_otp-2"]);

    // Neither an OTP that arrives late nor an expired one closes a newer code.
    await push(page, { ...OTP_SMS, id: "otp-3", timestamp: minutesAgo(5) });
    await push(page, { ...OTP_SMS, id: "otp-4", timestamp: minutesAgo(11) });
    // Nor does a message without one.
    await push(page, { id: "text-2", sender: "MOM", body: "Now", timestamp: Date.now() });

    expect(await cleared()).toEqual(["sms_pixel-8_otp-1", "sms_default_device_text-1"]);
    expect(await opened()).toEqual([
      "sms_pixel-8_otp-2",
      "sms_pixel-8_otp-3",
      "sms_pixel-8_otp-4",
      "sms_default_device_text-2"
    ]);

    // Only the OTPs still to be copied stay on screen.
    expect((await created(page)).map(({ id, requireInteraction }) => [id, requireInteraction])).toEqual([
      ["sms_pixel-8_otp-1", true],
      ["sms_default_device_text-1", false],
      ["sms_pixel-8_otp-2", true],
      ["sms_pixel-8_otp-3", true],
      ["sms_pixel-8_otp-4", false],
      ["sms_default_device_text-2", false]
    ]);
  });


  test("a late OTP's only button copies its text, and a click on it copies the OTP", async ({ page }) => {
    for (const id of ["late-1", "late-2"]) {
      await push(page, { ...OTP_SMS, id, timestamp: minutesAgo(11) });
    }

    expect((await created(page))[0].buttons).toEqual([{ title: "Copy Message" }]);

    await page.evaluate(async () => {
      for (const listener of window.fake.onButtonClicked.list) {
        await listener("sms_pixel-8_late-1", 0);
      }

      for (const listener of window.fake.onClicked.list) {
        await listener("sms_pixel-8_late-2");
      }
    });

    await expect.poll(() => page.evaluate(() => window.fake.copiedTexts))
      .toEqual(["Your code is 482913", "482913"]);
  });
});


test.describe("installing and starting the browser", () => {
  for (const event of ["onInstalled", "onStartup"]) {
    test(`${event} removes messages older than 24 hours`, async ({ page }) => {
      await setStorage(page, {
        recent_sms_feed: [
          { id: "new", sender: "BANK", body: "Today", timestamp: minutesAgo(5) },
          { id: "old", sender: "BANK", body: "Yesterday", timestamp: minutesAgo(25 * 60) }
        ]
      });

      await page.evaluate((name) => {
        for (const listener of window.fake[name].list) {
          listener({ reason: "update" });
        }
      }, event);

      await expect.poll(() => feedIds(page)).toEqual(["new"]);
      expect(await page.evaluate(() => window.fake.sentMessages)).toEqual([]);
    });
  }
});


test.describe("messages from the extension's pages", () => {
  test("a message without a known type gets no answer", async ({ page }) => {
    const answers = await page.evaluate(() => {
      const sender = { id: chrome.runtime.id, url: chrome.runtime.getURL("src/popup.html") };

      return [null, undefined, "CLEAR_FEED", {}, { type: "toString" }].map((request) => {
        return window.fake.onMessage.list.map((listener) => listener(request, sender, () => {}));
      });
    });

    expect(answers).toEqual(Array(5).fill([undefined]));
  });


  test("a message from another extension gets no answer", async ({ page }) => {
    await setStorage(page, {
      recent_sms_feed: [{ id: 1, sender: "BANK", body: "Hi", timestamp: Date.now() }]
    });

    const answers = await page.evaluate(() => {
      return [
        { id: "other-extension", url: "chrome-extension://other-extension/page.html" },
        // This extension's ID with a page that is not its own, as a content script would have.
        { id: chrome.runtime.id, url: "https://example.test/" },
        { id: chrome.runtime.id },
        {}
      ].map((sender) => {
        return window.fake.onMessage.list.map((listener) => listener({ type: "CLEAR_FEED" }, sender, () => {}));
      });
    });

    expect(answers).toEqual(Array(4).fill([undefined]));
    expect(await feedIds(page)).toEqual([1]);

    // The extension's own pages are still answered.
    expect(await message(page, { type: "CLEAR_FEED" })).toEqual({ ok: true });
  });


  test("a request that fails answers not ok with the reason", async ({ page }) => {
    await page.evaluate(() => {
      chrome.storage.local.set = async () => {
        throw new Error("Storage is full.");
      };
    });

    for (const request of [{ type: "CLEAR_FEED" }, { type: "UNLINK_DEVICE", deviceId: "pixel" }]) {
      expect(await message(page, request)).toEqual({ ok: false, error: "Storage is full." });
    }
  });


  test("CLEAR_FEED removes every stored message", async ({ page }) => {
    await setStorage(page, {
      recent_sms_feed: [{ id: 1, sender: "BANK", body: "Hi", timestamp: Date.now() }]
    });

    expect(await message(page, { type: "CLEAR_FEED" })).toEqual({ ok: true });

    expect(await feed(page)).toEqual([]);
  });


  test("UNLINK_DEVICE ignores a phone from then on", async ({ page }) => {
    const pixel = { id: "pixel", name: "Pixel 8", lastSeen: 1 };
    const galaxy = { id: "galaxy", name: "Galaxy S24", lastSeen: 2 };

    await setStorage(page, { connected_devices: { pixel, galaxy } });

    expect(await message(page, { type: "UNLINK_DEVICE", deviceId: "pixel" }))
      .toEqual({ ok: true, remaining: 1 });
    expect((await stored(page)).connected_devices).toEqual({ galaxy });
    expect((await stored(page)).unlinked_devices).toEqual({
      pixel: { name: "Pixel 8", unlinkedAt: expect.any(Number), ignored: 0 }
    });
  });


  test("UNLINK_DEVICE without a phone unlinks nothing", async ({ page }) => {
    await setStorage(page, { connected_devices: { pixel: { id: "pixel", name: "Pixel 8" } } });

    expect(await message(page, { type: "UNLINK_DEVICE" }))
      .toEqual({ ok: false, error: "No phone to unlink." });
    expect(Object.keys((await stored(page)).connected_devices)).toEqual(["pixel"]);
  });


  test("at most 20 phones stay unlinked, dropping the one unlinked first", async ({ page }) => {
    const unlinked = Object.fromEntries(Array.from({ length: 20 }, (_, index) => {
      return [`phone-${index}`, { name: `Phone ${index}`, unlinkedAt: minutesAgo(60 - index), ignored: 0 }];
    }));

    await setStorage(page, { unlinked_devices: unlinked });
    await message(page, { type: "UNLINK_DEVICE", deviceId: "phone-new" });

    const ids = Object.keys((await stored(page)).unlinked_devices);

    expect(ids).toHaveLength(20);
    expect(ids).toContain("phone-new");
    expect(ids).not.toContain("phone-0");
  });


  test("without a push service there is no pairing code and nothing to unlink all", async ({ page }) => {
    expect(await message(page, { type: "GET_PAIRING_CODE" }))
      .toEqual({ ok: false, error: "This browser cannot receive push messages." });
    expect(await message(page, { type: "UNLINK_ALL" }))
      .toEqual({ ok: false, error: "This browser cannot receive push messages." });
  });
});


test.describe("an unlinked phone", () => {
  test.beforeEach(async ({ page }) => {
    await setStorage(page, {
      unlinked_devices: { "pixel-8": { name: "Pixel 8", unlinkedAt: minutesAgo(5), ignored: 0 } }
    });
  });


  test("its messages are not stored but counted in one quiet notice", async ({ page }) => {
    await push(page, { ...OTP_SMS, timestamp: Date.now() });
    await push(page, { ...OTP_SMS, id: "sms-2", timestamp: Date.now() });

    const notice = (count) => ({
      id: "unlinked_pixel-8",
      type: "basic",
      iconUrl: "chrome-extension://test-id/icons/icon128.png",
      title: "Pixel 8 is unlinked",
      message: `${count} ignored. Unlink this computer in the SMS app on that phone to stop them, or click here to unlink all phones.`,
      buttons: [],
      requireInteraction: false,
      silent: true
    });

    // The second replaces the first: same ID, no sound.
    expect(await created(page)).toEqual([notice("1 message"), notice("2 messages")]);

    const after = await stored(page);

    expect(after.recent_sms_feed).toBeUndefined();
    expect(after.connected_devices).toBeUndefined();
    expect(after.unlinked_devices["pixel-8"].ignored).toBe(2);
    expect(Object.keys((await session(page)).notifications)).toEqual(["unlinked_pixel-8"]);
  });


  test("a click on its notice opens the toolbar popup", async ({ page }) => {
    await push(page, { ...OTP_SMS, timestamp: Date.now() });

    await page.evaluate(async () => {
      for (const listener of window.fake.onClicked.list) {
        await listener("unlinked_pixel-8");
      }

      // As the worker's notificationclick hands it over.
      await window.background.notificationClicked({ notice: "unlinked_phone" }, "");
    });

    expect(await page.evaluate(() => window.fake.popupsOpened)).toBe(2);
    expect(await page.evaluate(() => window.fake.windows)).toEqual([]);
    expect(await page.evaluate(() => window.fake.copiedTexts)).toEqual([]);
    expect(await page.evaluate(() => window.fake.cleared)).toEqual(["unlinked_pixel-8"]);
  });


  test("a click on its notice opens the popup in a window when the browser has none to open it in", async ({ page }) => {
    await push(page, { ...OTP_SMS, timestamp: Date.now() });

    await page.evaluate(async () => {
      window.fake.openPopupFails = true;

      for (const listener of window.fake.onClicked.list) {
        await listener("unlinked_pixel-8");
      }

      await window.background.notificationClicked({ notice: "unlinked_phone" }, "");
    });

    expect(await page.evaluate(() => window.fake.popupsOpened)).toBe(0);
    expect(await page.evaluate(() => window.fake.windows)).toEqual(Array(2).fill({
      url: "chrome-extension://test-id/src/popup.html",
      type: "popup",
      width: 420,
      height: 600
    }));
  });


  test("a test ping links it again, and its messages arrive", async ({ page }) => {
    await push(page, { type: "TEST_PING", deviceId: "pixel-8", deviceName: "Pixel 8" });

    expect((await stored(page)).unlinked_devices).toEqual({});
    expect(Object.keys((await stored(page)).connected_devices)).toEqual(["pixel-8"]);

    await push(page, { ...OTP_SMS, timestamp: Date.now() });

    expect((await feedIds(page))[0]).toBe("sms-1");
  });


  test("other phones are not affected", async ({ page }) => {
    await push(page, { ...OTP_SMS, deviceId: "galaxy", deviceName: "Galaxy S24", timestamp: Date.now() });

    expect(await feedIds(page)).toEqual(["sms-1"]);
    expect((await created(page))[0].title).toBe("[Galaxy S24] [SIM 2] New SMS from BANK");
  });
});


test.describe("MMS", () => {
  const PHOTOS = {
    id: -42,
    kind: "mms",
    sender: "Alice",
    subject: "Trip photos",
    body: "Look at this view!",
    attachments: ["image", "image", "video"],
    deviceId: "pixel-8",
    deviceName: "Pixel 8"
  };


  test("an MMS says so, with its subject before its text and a line for its attachments", async ({ page }) => {
    const timestamp = minutesAgo(1);

    await push(page, { ...PHOTOS, timestamp });

    expect(await feed(page)).toEqual([{
      id: -42,
      key: "pixel-8:-42",
      kind: "mms",
      sender: "Alice",
      subject: "Trip photos",
      body: "Look at this view!",
      attachments: ["image", "image", "video"],
      group: [],
      timestamp,
      otp: null,
      deviceId: "pixel-8",
      deviceName: "Pixel 8",
      simSlot: -1,
      simName: ""
    }]);

    expect(await created(page)).toEqual([expect.objectContaining({
      id: "sms_pixel-8_-42",
      title: "[Pixel 8] New MMS from Alice",
      message: "Trip photos — Look at this view!\n📷 2 photos · 🎬 Video",
      ...buttons("Copy Message")
    })]);
  });


  test("a group MMS names the group, and more than three members are counted", async ({ page }) => {
    await push(page, { ...PHOTOS, id: -43, subject: "", body: "Dinner at 8?", attachments: ["image"], group: ["Bob", "Carol"], timestamp: Date.now() });
    await push(page, { ...PHOTOS, id: -44, subject: "", body: "Who's in?", attachments: [], group: ["Bob", "Carol", "Dave", "Erin", "Frank"], timestamp: Date.now() });

    expect((await created(page)).map(({ title, message }) => [title, message])).toEqual([
      ["[Pixel 8] Alice in group with Bob, Carol", "Dinner at 8?\n📷 Photo"],
      ["[Pixel 8] Alice in group with Bob, Carol, Dave +2", "Who's in?"]
    ]);
  });


  test("an MMS without text shows its attachments, and Copy Message copies the subject and text", async ({ page }) => {
    await push(page, { ...PHOTOS, id: -45, subject: "", body: "", attachments: ["contact", "file", "audio"], timestamp: Date.now() });
    await push(page, { ...PHOTOS, timestamp: Date.now() });

    expect((await created(page))[0].message).toBe("🎵 Audio · 👤 Contact · 📎 File");

    await page.evaluate(async () => {
      for (const listener of window.fake.onButtonClicked.list) {
        await listener("sms_pixel-8_-42", 0);
      }
    });

    await expect.poll(() => page.evaluate(() => window.fake.copiedTexts))
      .toEqual(["Trip photos\nLook at this view!"]);
  });


  test("unknown attachment kinds, names that are not text and too many members are dropped", async ({ page }) => {
    await push(page, {
      ...PHOTOS,
      subject: "S".repeat(500),
      attachments: ["image", "<script>", 7, "video", ...Array(30).fill("file")],
      group: ["Bob", 42, "", null, "N".repeat(300), ...Array(30).fill("Zed")],
      timestamp: Date.now()
    });

    const [mms] = await feed(page);

    expect(mms.subject).toBe("S".repeat(200));
    expect(mms.attachments).toEqual(["image", "video", ...Array(18).fill("file")]);
    expect(mms.group).toEqual(["Bob", "N".repeat(200), ...Array(18).fill("Zed")]);
  });


  test("MMS fields count only on a message whose kind is mms", async ({ page }) => {
    await push(page, { ...OTP_SMS, kind: "fax", subject: "Hi", attachments: ["image"], group: ["Bob"], timestamp: Date.now() });

    const [sms] = await feed(page);

    expect(sms).not.toHaveProperty("kind");
    expect(sms).not.toHaveProperty("subject");
    expect((await created(page))[0].title).toBe("[Pixel 8] [SIM 2] New SMS from BANK");
  });
});


test.describe("the browser's and the system's names in the pairing code", () => {
  for (const [browser, brands, userAgent, name] of [
    ["Chrome", [{ brand: "Google Chrome" }], "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36", "Chrome"],
    ["Edge", [{ brand: "Microsoft Edge" }], "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0", "Edge"],
    ["Edge without brands", [], "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0", "Edge"]
  ]) {
    test(`${browser} is named ${name}`, async ({ page }) => {
      expect(await page.evaluate(async ([brandList, agent]) => {
        Object.defineProperty(navigator, "userAgentData", { value: { brands: brandList }, configurable: true });
        Object.defineProperty(navigator, "userAgent", { value: agent, configurable: true });

        return (await import("/src/background.js")).browserName();
      }, [brands, userAgent])).toBe(name);
    });
  }


  for (const [system, platform, userAgent, name] of [
    ["ChromeOS", "Chrome OS", "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/140.0.0.0", "ChromeOS"],
    ["ChromeOS without userAgentData", undefined, "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/140.0.0.0", "ChromeOS"],
    ["Android in desktop mode", "Android", "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0", "Android"],
    ["Android without userAgentData", undefined, "Mozilla/5.0 (Linux; Android 14) Chrome/140.0.0.0 Mobile", "Android"],
    ["Linux", "Linux", "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0", "Linux"],
    ["macOS", "macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0.0.0", "Mac"],
    ["Windows", "Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0", "Windows"],
    ["Windows without userAgentData", undefined, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0", "Windows"],
    ["an unknown system", "Fuchsia", "Mozilla/5.0 Chrome/140.0.0.0", "Desktop"]
  ]) {
    test(`${system} is named ${name}`, async ({ page }) => {
      expect(await page.evaluate(async ([platformName, agent]) => {
        const data = platformName === undefined ? undefined : { brands: [], platform: platformName };
        Object.defineProperty(navigator, "userAgentData", { value: data, configurable: true });
        Object.defineProperty(navigator, "userAgent", { value: agent, configurable: true });

        return (await import("/src/background.js")).osName();
      }, [platform, userAgent])).toBe(name);
    });
  }
});


test.describe("the push subscription", () => {
  const PIXEL = { id: "pixel", name: "Pixel 8", lastSeen: 1 };


  // Gives the background a PushManager whose subscription has endpoint, or none for null.
  function subscribed(page, endpoint) {
    return page.evaluate((address) => {
      window.registration = {
        pushManager: { getSubscription: async () => (address ? { endpoint: address } : null) }
      };
    }, endpoint);
  }


  function startBrowser(page) {
    return page.evaluate(() => Promise.all(window.fake.onStartup.list.map((listener) => listener())));
  }


  for (const [how, endpoint] of [["changed", "https://push.test/new"], ["ended", null]]) {
    test(`at startup, an address that ${how} under linked phones asks to pair again`, async ({ page }) => {
      await setStorage(page, {
        push_endpoint: "https://push.test/old",
        connected_devices: { pixel: PIXEL },
        unlinked_devices: { galaxy: { name: "Galaxy S24", unlinkedAt: 1, ignored: 0 } }
      });
      await subscribed(page, endpoint);

      await startBrowser(page);

      expect(await stored(page)).toEqual({
        push_endpoint: endpoint,
        needs_repair: true,
        connected_devices: {},
        unlinked_devices: {}
      });
    });
  }


  test("nothing asks to pair again without linked phones, or when the address is first noted", async ({ page }) => {
    await setStorage(page, { push_endpoint: "https://push.test/old" });
    await subscribed(page, "https://push.test/new");
    await startBrowser(page);

    expect(await stored(page)).toEqual({ push_endpoint: "https://push.test/new" });

    // As after an update from a version that noted no address.
    await page.evaluate(() => chrome.storage.local.remove("push_endpoint"));
    await setStorage(page, { connected_devices: { pixel: PIXEL } });
    await subscribed(page, "https://push.test/first");
    await startBrowser(page);

    expect(await stored(page)).toEqual({
      push_endpoint: "https://push.test/first",
      connected_devices: { pixel: PIXEL }
    });
  });


  // Only a phone that scanned the new code reaches the new address, whatever it sends.
  for (const [what, data] of [
    ["a test ping", { type: "TEST_PING", deviceId: "pixel-8", deviceName: "Pixel 8" }],
    ["an SMS", { ...OTP_SMS, timestamp: Date.now() }]
  ]) {
    test(`${what} at the new address clears the request to pair again`, async ({ page }) => {
      await setStorage(page, { needs_repair: true });

      await push(page, data);

      expect((await stored(page)).needs_repair).toBe(false);
      expect(Object.keys((await stored(page)).connected_devices)).toEqual(["pixel-8"]);
    });
  }


  test("GET_STATUS says notifications are on", async ({ page }) => {
    expect(await message(page, { type: "GET_STATUS" })).toEqual({ ok: true, notificationsOff: false });
  });
});


test.describe("with notifications turned off", () => {
  test.use({ permissionLevel: "denied" });


  test("GET_STATUS says so", async ({ page }) => {
    expect(await message(page, { type: "GET_STATUS" })).toEqual({ ok: true, notificationsOff: true });
  });



  test("no notification is shown, but the SMS is stored", async ({ page }) => {
    await push(page, { ...OTP_SMS, timestamp: Date.now() });

    expect(await created(page)).toEqual([]);
    expect(await feedIds(page)).toEqual(["sms-1"]);
  });
});
