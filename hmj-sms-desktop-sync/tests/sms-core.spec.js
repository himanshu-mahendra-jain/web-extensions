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


// Chrome offers each copy action as a button.
const buttons = (...titles) => {
  return { buttons: titles.map((title) => ({ title })), requireInteraction: true };
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
      "pixel-8": { id: "pixel-8", name: "Pixel 8", lastSeen: expect.any(Number), paired: true }
    });

    expect(await created(page)).toEqual([{
      id: "sms_sms-1",
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


  test("at most 10 phones stay linked, dropping the least recently seen", async ({ page }) => {
    const devices = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`phone-${index}`, {
        id: `phone-${index}`,
        name: `Phone ${index}`,
        lastSeen: minutesAgo(60 - index),
        paired: true
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
      for (const id of ["sms_sms-1", "sms_sms-2"]) {
        for (const listener of window.fake.onClicked.list) {
          await listener(id);
        }
      }
    });

    expect(await page.evaluate(() => window.fake.copiedTexts)).toEqual(["482913", "Call me"]);
    expect(await page.evaluate(() => window.fake.cleared)).toEqual(["sms_sms-1", "sms_sms-2"]);
  });


  test("a notification's clicks still copy after the background was stopped", async ({ page }) => {
    await push(page, { ...OTP_SMS, timestamp: Date.now() });
    await push(page, { id: "sms-2", sender: "MOM", body: "Call me", timestamp: Date.now() });

    // Kept in memory-backed session storage, never with the stored messages.
    expect(Object.keys((await session(page)).notifications)).toEqual(["sms_sms-1", "sms_sms-2"]);
    expect(Object.keys(await stored(page)).sort()).toEqual(["connected_devices", "recent_sms_feed"]);

    await restartBackground(page);

    await page.evaluate(async () => {
      for (const listener of window.fake.onClicked.list) {
        await listener("sms_sms-1");
      }

      for (const listener of window.fake.onButtonClicked.list) {
        await listener("sms_sms-2", 0);
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
    expect([ids[0], ids.at(-1)]).toEqual(["sms_m1", "sms_m50"]);
  });


  test("a notification's buttons copy its OTP or its text", async ({ page }) => {
    for (const id of ["otp-1", "otp-2"]) {
      await push(page, { ...OTP_SMS, id, timestamp: Date.now() });
    }

    await push(page, { id: "text-1", sender: "MOM", body: "Call me", timestamp: Date.now() });

    // [notification, button index, copied text]
    const clicks = [
      ["sms_otp-1", 0, "482913"],
      ["sms_otp-2", 1, "Your code is 482913"],
      ["sms_text-1", 0, "Call me"]
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
    expect(await page.evaluate(() => window.fake.cleared)).toEqual(["sms_otp-1", "sms_otp-2", "sms_text-1"]);
  });


  test("a late OTP's only button copies its text, and a click on it copies the OTP", async ({ page }) => {
    for (const id of ["late-1", "late-2"]) {
      await push(page, { ...OTP_SMS, id, timestamp: minutesAgo(11) });
    }

    expect((await created(page))[0].buttons).toEqual([{ title: "Copy Message" }]);

    await page.evaluate(async () => {
      for (const listener of window.fake.onButtonClicked.list) {
        await listener("sms_late-1", 0);
      }

      for (const listener of window.fake.onClicked.list) {
        await listener("sms_late-2");
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
      return [null, undefined, "CLEAR_FEED", {}, { type: "toString" }].map((request) => {
        return window.fake.onMessage.list.map((listener) => listener(request, {}, () => {}));
      });
    });

    expect(answers).toEqual(Array(5).fill([undefined]));
  });


  test("a request that fails answers not ok with the reason", async ({ page }) => {
    await page.evaluate(() => {
      chrome.storage.local.set = async () => {
        throw new Error("Storage is full.");
      };
    });

    for (const type of ["CLEAR_FEED", "UNLINK_DEVICE"]) {
      expect(await message(page, { type })).toEqual({ ok: false, error: "Storage is full." });
    }
  });


  test("SEND_TEST_NOTIFICATION shows a test notification with an OTP", async ({ page }) => {
    expect(await message(page, { type: "SEND_TEST_NOTIFICATION" })).toEqual({ ok: true });

    expect(await created(page)).toEqual([expect.objectContaining({
      title: "[Chrome] New SMS from Test Notification",
      message: "Instant push alerts are working perfectly!",
      ...buttons("Copy OTP (123456)", "Copy Message")
    })]);
  });


  test("CLEAR_FEED removes every stored message", async ({ page }) => {
    await setStorage(page, {
      recent_sms_feed: [{ id: 1, sender: "BANK", body: "Hi", timestamp: Date.now() }]
    });

    expect(await message(page, { type: "CLEAR_FEED" })).toEqual({ ok: true });

    expect(await feed(page)).toEqual([]);
  });


  test("GET_CONNECTED_DEVICES and UNLINK_DEVICE list and unlink phones", async ({ page }) => {
    const pixel = { id: "pixel", name: "Pixel 8", lastSeen: 1, paired: true };
    const galaxy = { id: "galaxy", name: "Galaxy S24", lastSeen: 2, paired: true };

    await setStorage(page, { connected_devices: { pixel, galaxy } });

    // The fake storage keeps the order they were stored in.
    expect(await message(page, { type: "GET_CONNECTED_DEVICES" }))
      .toEqual({ ok: true, devices: [pixel, galaxy] });

    expect(await message(page, { type: "UNLINK_DEVICE", deviceId: "pixel" }))
      .toEqual({ ok: true, remaining: 1 });
    expect((await stored(page)).connected_devices).toEqual({ galaxy });

    // Without a device ID every phone is unlinked.
    expect(await message(page, { type: "UNLINK_DEVICE" }))
      .toEqual({ ok: true, remaining: 0 });
    expect((await stored(page)).connected_devices).toEqual({});
  });
});


test.describe("with notifications turned off", () => {
  test.use({ permissionLevel: "denied" });


  test("no notification is shown, but the SMS is stored", async ({ page }) => {
    await push(page, { ...OTP_SMS, timestamp: Date.now() });

    expect(await created(page)).toEqual([]);
    expect(await feedIds(page)).toEqual(["sms-1"]);
  });
});
