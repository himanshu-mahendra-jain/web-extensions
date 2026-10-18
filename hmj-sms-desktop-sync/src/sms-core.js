/**
 * Background code of the Chrome and Edge service worker: incoming messages, linked phones,
 * the message feed, desktop notifications and the pages' runtime messages. background.js
 * passes what needs the worker or the browser to createBackground(), so the tests can run
 * this in a page.
 */

const MAX_MESSAGE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_FEED_ITEMS = 100;
const MAX_CONNECTED_DEVICES = 10;
const MAX_ACTIVE_NOTIFICATIONS = 50;
const FEED_KEY = "recent_sms_feed";
const NOTIFICATION_ICON = "icons/icon128.png";
const DEVICES_KEY = "connected_devices";

// The longest text a push may set, in characters; anything longer is cut.
const MAX_NAME_LENGTH = 200;
const MAX_BODY_LENGTH = 4096;
const MAX_SIM_NAME_LENGTH = 32;
const MAX_ID_LENGTH = 64;
const OTP_PATTERN = /^[A-Za-z0-9-]{3,12}$/;
const DEVICE_ID_PATTERN = /^[\w-]{1,64}$/;

function text(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

/**
 * What handleIncoming() takes from a push's JSON: known fields of the right type, text cut
 * to length, an OTP only when it looks like one and no timestamp in the future. Returns null
 * for a push without a JSON object, which then shows only that a message arrived.
 */
export function normalizeIncoming(data, now = Date.now()) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const deviceName = text(data.deviceName, MAX_NAME_LENGTH);
  const deviceId = typeof data.deviceId === "string" && DEVICE_ID_PATTERN.test(data.deviceId)
    ? data.deviceId
    : "";
  // The phone's key among the linked phones: its ID, else its name.
  let deviceKey = deviceId || "default_device";
  if (!deviceId && deviceName) {
    deviceKey = "device_" + deviceName.toLowerCase().replace(/[^a-z0-9]/g, "_");
  }

  const otp = typeof data.otp === "number" ? String(data.otp) : data.otp;
  const validId = (Number.isFinite(data.id) && data.id !== 0) ||
    (typeof data.id === "string" && data.id.length > 0 && data.id.length <= MAX_ID_LENGTH);

  return {
    type: data.type === "TEST_PING" ? "TEST_PING" : "SMS",
    message: text(data.message, MAX_BODY_LENGTH),
    id: validId ? data.id : now,
    sender: text(data.sender, MAX_NAME_LENGTH) || "Unknown",
    body: text(data.body, MAX_BODY_LENGTH),
    timestamp: Number.isFinite(data.timestamp) && data.timestamp > 0 ? Math.min(data.timestamp, now) : now,
    otp: typeof otp === "string" && OTP_PATTERN.test(otp) ? otp : null,
    deviceId,
    deviceKey,
    deviceName: deviceName || "Phone",
    simSlot: Number.isInteger(data.simSlot) && data.simSlot >= 0 && data.simSlot < 8 ? data.simSlot : -1,
    simName: text(data.simName, MAX_SIM_NAME_LENGTH)
  };
}

const VAPID_PUBLIC_KEY = "BMqhovLV8n3PzFu8iVVlORWI0IcDm0h7gl8jZPSbLSp7VxSWpBmdi8oNKo3QZNtklnipFtQgXp_1z-8EQDTf9Ko";

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Returns the push subscription of pushManager, subscribing with the VAPID key first if there is none.
 */
export async function getOrCreatePushSubscription(pushManager) {
  let sub = await pushManager.getSubscription();
  if (!sub) {
    const applicationServerKey = urlB64ToUint8Array(VAPID_PUBLIC_KEY);
    sub = await pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey
    });
  }
  return sub;
}

/**
 * Returns where a phone sends to: the endpoint and keys of a push subscription.
 */
export function pushAddress(sub) {
  const json = sub.toJSON();
  return {
    endpoint: json.endpoint || "",
    p256dh: json.keys?.p256dh || "",
    auth: json.keys?.auth || ""
  };
}

/*
 * platform holds what needs the worker or the browser:
 * - name: the browser's name in the pairing code and the test notification
 * - testNotificationText: the test notification's message
 * - getPushAddress(): { endpoint, p256dh, auth } for the pairing code, or null
 * - canNotify(): resolves false when notifications are turned off
 * - showNotification(title, options): resolves true once shown, or false to
 *   fall back to chrome.notifications
 * - copyText(text): writes text to the clipboard
 *
 * Registers the listeners right away, so call it when the background script starts.
 */
export function createBackground(platform) {
  /*
   * What each chrome.notifications notification copies, by notification ID, oldest first.
   * Session storage outlives a stopped worker or background page, so its buttons and
   * clicks still work, and it is held in memory, so OTPs never reach the disk. Changes
   * run one at a time, so two notifications at once cannot drop each other.
   */
  const NOTIFICATIONS_KEY = "notifications";
  let notificationsQueue = Promise.resolve();

  function changeNotifications(change) {
    // A change that failed was reported to its caller; the next one runs anyway.
    const run = notificationsQueue.catch(() => { }).then(async () => {
      const stored = await chrome.storage.session.get([NOTIFICATIONS_KEY]);
      const notifications = stored[NOTIFICATIONS_KEY] || {};
      const result = change(notifications);
      await chrome.storage.session.set({ [NOTIFICATIONS_KEY]: notifications });
      return result;
    });
    notificationsQueue = run;
    return run;
  }

  // Removes a notification's entry and returns it.
  function takeNotification(notifId) {
    return changeNotifications((notifications) => {
      const notifData = notifications[notifId];
      delete notifications[notifId];
      return notifData;
    });
  }

  /**
   * Handles a message from a phone: data is the push's JSON, or null when it had none. The
   * phone and the message are stored in one write, so open pages render once.
   */
  async function handleIncoming(data) {
    const now = Date.now();
    try {
      const incoming = normalizeIncoming(data, now) ?? {
        ...normalizeIncoming({}, now),
        sender: "SMS Desktop Sync",
        body: "New message received from phone"
      };
      const { deviceKey, deviceName } = incoming;

      const item = incoming.type === "TEST_PING" ? {
        id: "test_" + now,
        sender: "SMS Desktop Sync",
        body: incoming.message || `Link verified with ${deviceName}! Instant SMS alerts are active.`,
        timestamp: now,
        otp: null,
        deviceName: deviceName
      } : {
        id: incoming.id,
        sender: incoming.sender,
        body: incoming.body,
        timestamp: incoming.timestamp,
        otp: incoming.otp,
        deviceId: incoming.deviceId,
        deviceName: deviceName,
        simSlot: incoming.simSlot,
        simName: incoming.simName
      };

      const stored = await chrome.storage.local.get([DEVICES_KEY, FEED_KEY]);
      const changes = { [DEVICES_KEY]: withDevice(stored[DEVICES_KEY], deviceKey, deviceName, now) };
      const feed = withSms(stored[FEED_KEY], item, now);
      if (feed) {
        changes[FEED_KEY] = feed;
      }
      await chrome.storage.local.set(changes);

      await showSmsNotification(item);
    } catch (err) {
      console.error("[WebPush] Error handling push event:", err);
      await showSmsNotification({
        id: "alert_" + now,
        sender: "SMS Desktop Sync",
        body: "New message received from phone",
        timestamp: now
      }).catch((notifyErr) => console.error("[WebPush] Could not say a message arrived:", notifyErr));
    }
  }

  // The linked phones with this one seen now, keeping the MAX_CONNECTED_DEVICES seen last.
  function withDevice(devices, deviceId, deviceName, now) {
    const devicesMap = { ...devices };
    devicesMap[deviceId] = {
      id: deviceId,
      name: deviceName,
      lastSeen: now,
      paired: true
    };

    const sorted = Object.values(devicesMap).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    if (sorted.length <= MAX_CONNECTED_DEVICES) return devicesMap;
    return Object.fromEntries(sorted.slice(0, MAX_CONNECTED_DEVICES).map((d) => [d.id, d]));
  }

  /**
   * The feed with an incoming SMS added, newest first and capped at 100 recent messages, or
   * null when it is unchanged. Messages older than 24 hours are not kept. The same ID, or the
   * same text from the same sender within 5 seconds, is stored once.
   */
  function withSms(before, sms, now) {
    before = Array.isArray(before) ? before : [];
    if (now - sms.timestamp > MAX_MESSAGE_AGE_MS) {
      return null;
    }

    const feed = before.filter(m => m.timestamp && (now - m.timestamp) <= MAX_MESSAGE_AGE_MS);
    const exists = feed.some(m =>
      m.id === sms.id ||
      (m.sender === sms.sender &&
        m.body === sms.body &&
        Math.abs(m.timestamp - sms.timestamp) < 5000)
    );
    if (exists) {
      return feed.length === before.length ? null : feed;
    }

    feed.unshift({
      deviceId: "",
      simSlot: -1,
      simName: "",
      ...sms
    });
    if (feed.length > MAX_FEED_ITEMS) {
      feed.length = MAX_FEED_ITEMS;
    }
    return feed;
  }

  /**
   * Prunes messages older than 24 hours from local storage.
   */
  async function pruneOldSms() {
    const stored = await chrome.storage.local.get([FEED_KEY]);
    if (!Array.isArray(stored[FEED_KEY])) return;
    const now = Date.now();
    const valid = stored[FEED_KEY].filter(m => m.timestamp && (now - m.timestamp) <= MAX_MESSAGE_AGE_MS);
    if (valid.length !== stored[FEED_KEY].length) {
      await chrome.storage.local.set({ [FEED_KEY]: valid });
    }
  }

  function pruneOldSmsLater() {
    pruneOldSms().catch((err) => console.warn("[Storage] Could not remove old messages:", err));
  }

  async function showSmsNotification(sms) {
    if (!(await platform.canNotify())) {
      console.warn("[SMS Notification] Notification permission is not granted or disabled. Skipping notification.");
      return;
    }

    const notifId = "sms_" + (sms.id || Date.now());
    const deviceBadge = sms.deviceName ? `[${sms.deviceName}] ` : "";
    const simBadge = (typeof sms.simSlot === "number" && sms.simSlot >= 0) ? `[SIM ${sms.simSlot + 1}] ` : "";

    // Check for stale OTP delivered after laptop reconnection
    const isOtp = !!(sms.otp && sms.otp.length > 0);
    const isStaleOtp = isOtp && sms.timestamp && (Date.now() - sms.timestamp > 10 * 60 * 1000);

    const staleBadge = isStaleOtp ? "[EXPIRED OTP] " : "";
    const title = `${staleBadge}${deviceBadge}${simBadge}New SMS from ${sms.sender || "Unknown"}`;
    const message = isStaleOtp ? `(Delivered after disconnect) ${sms.body || ""}` : (sms.body || "");

    const actions = [];
    if (isOtp && !isStaleOtp) {
      actions.push({ action: "copy_otp", title: `Copy OTP (${sms.otp})` });
      actions.push({ action: "copy_body", title: "Copy Message" });
    } else {
      actions.push({ action: "copy_body", title: "Copy Message" });
    }

    const iconUrl = chrome.runtime.getURL(NOTIFICATION_ICON);

    const shown = await platform.showNotification(title, {
      body: message,
      icon: iconUrl,
      badge: iconUrl,
      tag: notifId,
      requireInteraction: true,
      data: sms,
      actions: actions
    });
    if (shown) return;

    // chrome.notifications, remembering what a click on it copies
    try {
      await changeNotifications((notifications) => {
        const ids = Object.keys(notifications);
        if (ids.length >= MAX_ACTIVE_NOTIFICATIONS) {
          delete notifications[ids[0]];
        }
        notifications[notifId] = {
          sender: sms.sender,
          body: sms.body,
          otp: sms.otp,
          deviceId: sms.deviceId || "",
          actions: actions.map(a => a.action)
        };
      });
    } catch (err) {
      console.warn("[SMS Notification] Could not remember what the notification copies", err);
    }

    try {
      await chrome.notifications.create(notifId, {
        type: "basic",
        iconUrl: iconUrl,
        title: title,
        message: message,
        buttons: actions.map(a => ({ title: a.title })),
        requireInteraction: true
      });
    } catch (err) {
      console.error("[SMS Notification] Failed to display notification", err);
    }
  }

  /**
   * Copies what a notification's action asks for; any other action, such as a click on the
   * notification itself, copies the OTP, or the message when it has none.
   */
  function copyForAction(sms, action) {
    if (action === "copy_otp" && sms.otp) {
      return copyText(sms.otp);
    } else if (action === "copy_body") {
      return copyText(sms.body);
    } else if (sms.otp) {
      return copyText(sms.otp);
    } else {
      return copyText(sms.body);
    }
  }

  async function copyText(text) {
    if (!text) return;
    await platform.copyText(text);
  }

  async function getPairingCode() {
    const address = await platform.getPushAddress();
    if (!address) return null;
    const os = navigator.userAgent.includes("Linux") ? "Linux" :
      navigator.userAgent.includes("Mac") ? "Mac" :
        navigator.userAgent.includes("Win") ? "Windows" : "Desktop";
    const name = `${platform.name} (${os})`;
    // sms_pair:v1|<endpoint>|<p256dh>|<auth>|<desktop_name>|<extension_id>
    return `sms_pair:v1|${address.endpoint}|${address.p256dh}|${address.auth}|${name}|${chrome.runtime.id}`;
  }

  // Buttons of chrome.notifications notifications, in the order of their actions
  chrome.notifications.onButtonClicked.addListener(async (notifId, buttonIndex) => {
    const notifData = await takeNotification(notifId);
    if (!notifData) return;

    const action = notifData.actions[buttonIndex];
    if (action) {
      copyForAction(notifData, action);
      chrome.notifications.clear(notifId);
    }
  });

  // Handle notification body click: 1-click copy OTP or SMS body
  chrome.notifications.onClicked.addListener(async (notifId) => {
    const notifData = await takeNotification(notifId);
    if (!notifData) return;
    await copyForAction(notifData);
    chrome.notifications.clear(notifId);
  });

  chrome.notifications.onClosed.addListener((notifId) => {
    takeNotification(notifId);
  });

  // Drops the messages that aged past 24 hours while the browser was closed
  chrome.runtime.onInstalled.addListener(pruneOldSmsLater);
  chrome.runtime.onStartup.addListener(pruneOldSmsLater);

  async function unlinkDevice(deviceId) {
    const stored = await chrome.storage.local.get([DEVICES_KEY]);
    const devices = stored[DEVICES_KEY] || {};
    if (deviceId && devices[deviceId]) {
      delete devices[deviceId];
    } else if (!deviceId) {
      // Clear all
      for (const k of Object.keys(devices)) delete devices[k];
    }
    await chrome.storage.local.set({ [DEVICES_KEY]: devices });
    return { remaining: Object.keys(devices).length };
  }

  async function getConnectedDevices() {
    const stored = await chrome.storage.local.get([DEVICES_KEY]);
    return { devices: Object.values(stored[DEVICES_KEY] || {}) };
  }

  /*
   * What each page request runs; each resolves with what the reply adds to { ok: true }.
   * Pages render from storage.onChanged, so nothing here messages them.
   */
  const requests = {
    GET_PAIRING_CODE: async () => {
      const code = await getPairingCode();
      return code ? { code } : { ok: false, code: null };
    },
    SEND_TEST_NOTIFICATION: () => showSmsNotification({
      id: "test_" + Date.now(),
      sender: "Test Notification",
      body: platform.testNotificationText,
      timestamp: Date.now(),
      otp: "123456",
      deviceName: platform.name
    }),
    CLEAR_FEED: () => chrome.storage.local.set({ [FEED_KEY]: [] }),
    UNLINK_DEVICE: (request) => unlinkDevice(request.deviceId),
    GET_CONNECTED_DEVICES: getConnectedDevices
  };

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const run = Object.hasOwn(requests, request?.type) ? requests[request.type] : null;
    if (!run) return;

    Promise.resolve()
      .then(() => run(request))
      .then((reply) => sendResponse({ ok: true, ...reply }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  });

  return { handleIncoming, copyForAction };
}
