/**
 * Background code of the Chrome and Edge service worker: incoming messages, linked phones,
 * the push key and pairing code, the message feed, desktop notifications and the pages'
 * runtime messages. background.js passes what needs the worker or the browser to
 * createBackground(), so the tests can run this in a page.
 */

import {
  ATTACHMENT_KINDS,
  MAX_MESSAGE_AGE_MS,
  messageText,
  messageTitle,
  notificationText
} from "./message-format.js";
import { plural, t } from "./i18n.js";

const MAX_FEED_ITEMS = 100;
const MAX_CONNECTED_DEVICES = 10;
const MAX_UNLINKED_DEVICES = 20;
const MAX_ACTIVE_NOTIFICATIONS = 50;
const FEED_KEY = "recent_sms_feed";
const NOTIFICATION_ICON = "icons/icon128.png";
const DEVICES_KEY = "connected_devices";
// Phones unlinked here, whose messages are ignored until they pair again.
const UNLINKED_KEY = "unlinked_devices";
// The VAPID key pair every phone signs its pushes with: { publicKey, privateKey }.
const VAPID_KEY = "vapid_key";
// The push subscription's endpoint the phones were given, or null once it ended.
const PUSH_ENDPOINT_KEY = "push_endpoint";
// True once that endpoint changed under linked phones, until a phone pairs again.
const NEEDS_REPAIR_KEY = "needs_repair";
// What the notice about an unlinked phone carries, so a click on it opens the popup.
const UNLINKED_NOTICE = "unlinked_phone";
const POPUP_PAGE = "src/popup.html";
// Sender of the extension's own messages, such as the test message when a phone pairs.
// A name, so it is not translated.
const SYNC_SENDER = "SMS Desktop Sync";

// What the phone accepts: sms_pair:v2|<endpoint>|<p256dh>|<auth>|<vapidPublic>|<vapidPrivate>|<name>
const PAIRING_PREFIX = "sms_pair:v2";
const MAX_PAIRING_CODE_LENGTH = 2048;
const MAX_PAIRING_NAME_LENGTH = 64;

// The longest text a push may set, in characters; anything longer is cut.
const MAX_NAME_LENGTH = 200;
const MAX_BODY_LENGTH = 4096;
const MAX_SUBJECT_LENGTH = 200;
const MAX_SIM_NAME_LENGTH = 32;
const MAX_ID_LENGTH = 64;
const MAX_ATTACHMENTS = 20;
const MAX_GROUP_MEMBERS = 20;
const OTP_PATTERN = /^[A-Za-z0-9-]{3,12}$/;
const DEVICE_ID_PATTERN = /^[\w-]{1,64}$/;
// IDs the pattern admits that would name an Object property instead of a phone.
const RESERVED_DEVICE_IDS = ["__proto__", "constructor", "prototype"];

function text(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

/*
 * A queue for changes that read and then write: each runs after the last one ended, so two
 * cannot cross and drop each other's write.
 */
function oneAtATime() {
  let last = Promise.resolve();
  return (change) => {
    // A change that failed was reported to its caller; the next one runs anyway.
    const run = last.catch(() => { }).then(change);
    last = run;
    return run;
  };
}

/**
 * What handleIncoming() takes from a push's JSON: known fields of the right type, text cut
 * to length, an OTP only when it looks like one and no timestamp in the future. An MMS has
 * kind "mms", and may have a subject, the kinds of its attachments and, for a group, the
 * other members. Returns null for a push without a JSON object, which then shows only that
 * a message arrived.
 */
export function normalizeIncoming(data, now = Date.now()) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const deviceName = text(data.deviceName, MAX_NAME_LENGTH);
  const deviceId = typeof data.deviceId === "string" && DEVICE_ID_PATTERN.test(data.deviceId) &&
    !RESERVED_DEVICE_IDS.includes(data.deviceId)
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
    sender: text(data.sender, MAX_NAME_LENGTH) || t("unknownSender"),
    body: text(data.body, MAX_BODY_LENGTH),
    timestamp: Number.isFinite(data.timestamp) && data.timestamp > 0 ? Math.min(data.timestamp, now) : now,
    otp: typeof otp === "string" && OTP_PATTERN.test(otp) ? otp : null,
    deviceId,
    deviceKey,
    deviceName: deviceName || t("phoneFallbackName"),
    simSlot: Number.isInteger(data.simSlot) && data.simSlot >= 0 && data.simSlot < 8 ? data.simSlot : -1,
    simName: text(data.simName, MAX_SIM_NAME_LENGTH),
    kind: data.kind === "mms" ? "mms" : "sms",
    subject: text(data.subject, MAX_SUBJECT_LENGTH),
    attachments: Array.isArray(data.attachments)
      ? data.attachments.filter((kind) => ATTACHMENT_KINDS.includes(kind)).slice(0, MAX_ATTACHMENTS)
      : [],
    group: Array.isArray(data.group)
      ? data.group.map((name) => text(name, MAX_NAME_LENGTH)).filter(Boolean).slice(0, MAX_GROUP_MEMBERS)
      : []
  };
}

/** bytes as base64url without padding, as the pairing code carries keys. */
export function base64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
}

/**
 * A new P-256 VAPID key pair, base64url without padding: the public key as its 65-byte
 * uncompressed point, the private key as its 32-byte scalar.
 */
export async function createVapidKey() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = base64Url(await crypto.subtle.exportKey("raw", pair.publicKey));
  const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey, privateKey: d };
}

/**
 * The push subscription of pushManager for publicKey. One made with another key is ended
 * first, as a browser holds one subscription and refuses a second key.
 */
export async function subscribeWith(pushManager, publicKey) {
  const existing = await pushManager.getSubscription();
  const existingKey = existing?.options?.applicationServerKey;
  if (existing && existingKey && base64Url(existingKey) === publicKey) {
    return existing;
  }
  if (existing) {
    await existing.unsubscribe();
  }
  return pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: fromBase64Url(publicKey)
  });
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
 * - name: the browser's name in the pairing code, "Chrome" or "Edge"
 * - os: the system's name in the pairing code, such as "Windows" or "ChromeOS"
 * - pushManager(): the worker's PushManager, or null without one
 * - canNotify(): resolves false when notifications are turned off
 * - showNotification(title, options): resolves true once shown, or false to
 *   fall back to chrome.notifications
 * - closeNotifications(pick): closes the notifications it showed for which
 *   pick(tag, data) is true
 * - copyText(text): writes text to the clipboard
 *
 * Registers the listeners right away, so call it when the background script starts.
 */
export function createBackground(platform) {
  /*
   * What each chrome.notifications notification copies, by notification ID, oldest first.
   * Session storage outlives a stopped worker or background page, so its buttons and
   * clicks still work, and it is held in memory, so OTPs never reach the disk.
   */
  const NOTIFICATIONS_KEY = "notifications";
  const notificationsQueue = oneAtATime();

  function changeNotifications(change) {
    return notificationsQueue(async () => {
      const stored = await chrome.storage.session.get([NOTIFICATIONS_KEY]);
      const notifications = stored[NOTIFICATIONS_KEY] || {};
      const result = change(notifications);
      await chrome.storage.session.set({ [NOTIFICATIONS_KEY]: notifications });
      return result;
    });
  }

  // Removes a notification's entry and returns it.
  function takeNotification(notifId) {
    return changeNotifications((notifications) => {
      const notifData = notifications[notifId];
      delete notifications[notifId];
      return notifData;
    });
  }

  /*
   * Changes to the VAPID key run one at a time, so two pages asking for the first pairing
   * code at once get the same key, and Unlink All cannot cross a code being made.
   */
  const changeKey = oneAtATime();

  /*
   * Changes to the phones and the feed run one at a time, so two pushes at once, such as
   * from two phones, cannot drop each other's message.
   */
  const changeStored = oneAtATime();

  // The VAPID key, made the first time a phone is to pair.
  function currentKey() {
    return changeKey(async () => {
      const key = (await chrome.storage.local.get([VAPID_KEY]))[VAPID_KEY];
      if (key?.publicKey && key?.privateKey) return key;
      const fresh = await createVapidKey();
      await chrome.storage.local.set({ [VAPID_KEY]: fresh });
      return fresh;
    });
  }

  /**
   * Handles a message from a phone: data is the push's JSON, or null when it had none. The
   * phone and the message are stored in one write, so open pages render once. A phone
   * unlinked here gets its message counted and a quiet notice instead, until a test ping
   * says it paired again.
   */
  async function handleIncoming(data) {
    const now = Date.now();
    try {
      const incoming = normalizeIncoming(data, now) ?? {
        ...normalizeIncoming({}, now),
        sender: SYNC_SENDER,
        body: t("unreadableMessage")
      };
      const { deviceKey, deviceName } = incoming;

      const mms = incoming.kind === "mms" ? {
        kind: "mms",
        subject: incoming.subject,
        attachments: incoming.attachments,
        group: incoming.group
      } : {};

      /*
       * Each phone numbers its own messages, so two phones can send the same ID: key is the
       * message's identity across phones, and the notification's.
       */
      const item = incoming.type === "TEST_PING" ? {
        id: "test_" + now,
        sender: SYNC_SENDER,
        body: incoming.message || t("linkVerified", deviceName),
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
        simName: incoming.simName,
        ...mms
      };

      item.key = `${deviceKey}:${item.id}`;

      // The unlinked phone's entry when its message is ignored, else null.
      const ignoredBy = await changeStored(async () => {
        const stored = await chrome.storage.local.get([DEVICES_KEY, FEED_KEY, UNLINKED_KEY, NEEDS_REPAIR_KEY]);
        const unlinked = { ...stored[UNLINKED_KEY] };
        const wasUnlinked = Object.hasOwn(unlinked, deviceKey);

        if (wasUnlinked && incoming.type !== "TEST_PING") {
          const entry = { ...unlinked[deviceKey], ignored: (unlinked[deviceKey].ignored || 0) + 1 };
          unlinked[deviceKey] = entry;
          await chrome.storage.local.set({ [UNLINKED_KEY]: unlinked });
          return entry;
        }

        const changes = { [DEVICES_KEY]: withDevice(stored[DEVICES_KEY], deviceKey, deviceName, now) };
        if (wasUnlinked) {
          // A phone that pairs again says so with a test ping.
          delete unlinked[deviceKey];
          changes[UNLINKED_KEY] = unlinked;
        }
        if (stored[NEEDS_REPAIR_KEY]) {
          // Only a phone that scanned the new code reaches the new push address, so it paired again.
          changes[NEEDS_REPAIR_KEY] = false;
        }
        const feed = withSms(stored[FEED_KEY], item, now);
        if (feed) {
          changes[FEED_KEY] = feed;
        }
        await chrome.storage.local.set(changes);
        return null;
      });

      if (ignoredBy) {
        await showUnlinkedNotice(deviceKey, ignoredBy);
        return;
      }
      await showSmsNotification(item, deviceKey);
    } catch (err) {
      console.error("[WebPush] Error handling push event:", err);
      await showSmsNotification({
        id: "alert_" + now,
        sender: SYNC_SENDER,
        body: t("unreadableMessage"),
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
      lastSeen: now
    };

    const sorted = Object.values(devicesMap).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    if (sorted.length <= MAX_CONNECTED_DEVICES) return devicesMap;
    return Object.fromEntries(sorted.slice(0, MAX_CONNECTED_DEVICES).map((d) => [d.id, d]));
  }

  // The unlinked phones with this one added, keeping the MAX_UNLINKED_DEVICES unlinked last.
  function withUnlinked(unlinked, deviceId, name, now) {
    const entries = Object.entries({ ...unlinked, [deviceId]: { name, unlinkedAt: now, ignored: 0 } })
      .sort(([, a], [, b]) => (b.unlinkedAt || 0) - (a.unlinkedAt || 0));
    return Object.fromEntries(entries.slice(0, MAX_UNLINKED_DEVICES));
  }

  /**
   * The feed with an incoming SMS added, newest first and capped at 100 recent messages, or
   * null when it is unchanged. Messages older than 24 hours are not kept. The same key (the
   * phone and its ID), or the same text from the same sender on the same phone within 5
   * seconds, is stored once.
   */
  function withSms(before, sms, now) {
    before = Array.isArray(before) ? before : [];
    if (now - sms.timestamp > MAX_MESSAGE_AGE_MS) {
      return null;
    }

    const feed = before.filter(m => m.timestamp && (now - m.timestamp) <= MAX_MESSAGE_AGE_MS);
    // A key starts with its phone's key and a ":", which no phone's key holds.
    const phone = sms.key.slice(0, sms.key.indexOf(":") + 1);
    const exists = feed.some(m =>
      m.key === sms.key ||
      (m.key?.startsWith(phone) &&
        m.sender === sms.sender &&
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
  function pruneOldSms() {
    return changeStored(async () => {
      const stored = await chrome.storage.local.get([FEED_KEY]);
      if (!Array.isArray(stored[FEED_KEY])) return;
      const now = Date.now();
      const valid = stored[FEED_KEY].filter(m => m.timestamp && (now - m.timestamp) <= MAX_MESSAGE_AGE_MS);
      if (valid.length !== stored[FEED_KEY].length) {
        await chrome.storage.local.set({ [FEED_KEY]: valid });
      }
    });
  }

  function pruneOldSmsLater() {
    pruneOldSms().catch((err) => console.warn("[Storage] Could not remove old messages:", err));
  }

  /*
   * Shows a notification with the worker, else with chrome.notifications, remembering in
   * session storage what a click on that one does (remembered, plus its actions).
   */
  async function notify({ id, title, message, actions = [], data, remembered, requireInteraction = false, silent = false }) {
    const iconUrl = chrome.runtime.getURL(NOTIFICATION_ICON);

    const shown = await platform.showNotification(title, {
      body: message,
      icon: iconUrl,
      badge: iconUrl,
      tag: id,
      requireInteraction,
      ...(silent && { silent: true }),
      data,
      actions
    });
    if (shown) return;

    try {
      await changeNotifications((notifications) => {
        const ids = Object.keys(notifications).filter((key) => key !== id);
        if (ids.length >= MAX_ACTIVE_NOTIFICATIONS) {
          delete notifications[ids[0]];
        }
        notifications[id] = { ...remembered, actions: actions.map(a => a.action) };
      });
    } catch (err) {
      console.warn("[SMS Notification] Could not remember what the notification copies", err);
    }

    try {
      await chrome.notifications.create(id, {
        type: "basic",
        iconUrl: iconUrl,
        title: title,
        message: message,
        buttons: actions.map(a => ({ title: a.title })),
        requireInteraction,
        ...(silent && { silent: true })
      });
    } catch (err) {
      console.error("[SMS Notification] Failed to display notification", err);
    }
  }

  // deviceKey names the phone in the notification's ID, as each phone numbers its own messages.
  async function showSmsNotification(sms, deviceKey = "") {
    if (!(await platform.canNotify())) {
      console.warn("[SMS Notification] Notification permission is not granted or disabled. Skipping notification.");
      return;
    }

    const deviceBadge = sms.deviceName ? `[${sms.deviceName}] ` : "";
    const simBadge = (typeof sms.simSlot === "number" && sms.simSlot >= 0) ? `${t("simBadge", sms.simSlot + 1)} ` : "";

    // Check for stale OTP delivered after laptop reconnection
    const isOtp = !!(sms.otp && sms.otp.length > 0);
    const isStaleOtp = isOtp && sms.timestamp && (Date.now() - sms.timestamp > 10 * 60 * 1000);

    const staleBadge = isStaleOtp ? `${t("expiredOtpBadge")} ` : "";
    const text = notificationText(sms);

    const freshOtp = isOtp && !isStaleOtp;
    const actions = [];
    if (freshOtp) {
      actions.push({ action: "copy_otp", title: t("copyOtp", sms.otp) });
    }
    actions.push({ action: "copy_body", title: t("copyMessage") });

    const id = deviceKey ? `sms_${deviceKey}_${sms.id}` : `sms_${sms.id || Date.now()}`;
    if (freshOtp) {
      await closeEarlierNotifications(id, sms.timestamp);
    }

    // Only a code still to be copied stays on screen; every message is also in the popup.
    await notify({
      id,
      title: `${staleBadge}${deviceBadge}${simBadge}${messageTitle(sms)}`,
      message: isStaleOtp ? t("deliveredLate", text) : text,
      actions,
      data: sms,
      remembered: {
        sender: sms.sender,
        body: messageText(sms),
        otp: sms.otp,
        timestamp: sms.timestamp,
        deviceId: sms.deviceId || ""
      },
      requireInteraction: freshOtp
    });
  }

  /*
   * Closes the notifications older than a new OTP's, or of no known time, such as the
   * unlinked-phone notice: ChromeOS and GNOME group an extension's notifications, and the
   * new one would open collapsed in the stack, its Copy OTP button hidden until expanded.
   * A code newer than the OTP, which then arrived late, stays. Every message is in the popup.
   */
  async function closeEarlierNotifications(id, timestamp) {
    const earlier = (tag, sent) => tag !== id && !(sent >= timestamp);
    try {
      await platform.closeNotifications((tag, data) => earlier(tag, data?.timestamp));
    } catch (err) {
      console.warn("[SMS Notification] Could not close the earlier notifications:", err);
    }
    try {
      const ids = await changeNotifications((notifications) => {
        const closing = Object.keys(notifications)
          .filter((key) => earlier(key, notifications[key].timestamp));
        for (const key of closing) {
          delete notifications[key];
        }
        return closing;
      });
      await Promise.all(ids.map((key) => chrome.notifications.clear(key)));
    } catch (err) {
      console.warn("[SMS Notification] Could not close the earlier notifications:", err);
    }
  }

  /*
   * The one notice per unlinked phone, replaced quietly as its ignored messages add up:
   * Chrome wants every push to show a notification, and this one says no more than that.
   */
  async function showUnlinkedNotice(deviceKey, entry) {
    if (!(await platform.canNotify())) return;

    await notify({
      id: "unlinked_" + deviceKey,
      title: t("phoneUnlinkedTitle", entry.name || t("aPhone")),
      message: plural("ignoredMessages", entry.ignored),
      data: { notice: UNLINKED_NOTICE },
      remembered: { notice: UNLINKED_NOTICE },
      silent: true
    });
  }

  /*
   * Opens the toolbar popup, where Unlink All is, or the popup page in a window of its own
   * when the browser has no window to open it in.
   */
  async function openPopup() {
    try {
      await chrome.action.openPopup();
      return;
    } catch (err) {
      console.warn("[SMS Notification] Could not open the toolbar popup, opening a window:", err);
    }
    try {
      await chrome.windows.create({
        url: chrome.runtime.getURL(POPUP_PAGE),
        type: "popup",
        width: 420,
        height: 600
      });
    } catch (err) {
      console.warn("[SMS Notification] Could not open the popup:", err);
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
      return copyText(messageText(sms));
    } else if (sms.otp) {
      return copyText(sms.otp);
    } else {
      return copyText(messageText(sms));
    }
  }

  // What a click on a notification does: a notice opens the popup, a message copies.
  function notificationClicked(data, action) {
    if (data?.notice === UNLINKED_NOTICE) {
      return openPopup();
    }
    return copyForAction(data, action);
  }

  async function copyText(text) {
    if (!text) return;
    await platform.copyText(text);
  }

  /*
   * Notes the push subscription's endpoint, or null when there is none. The browser can end
   * a subscription on its own, such as after months without a push, when notifications are
   * blocked or when its profile is repaired, and the phones then lose this browser. Another
   * endpoint than the one noted, while phones are linked, takes them off the lists and asks
   * to pair again. The first endpoint noted, as after an update, asks nothing.
   */
  function noteEndpoint(endpoint) {
    return changeStored(async () => {
      const stored = await chrome.storage.local.get([PUSH_ENDPOINT_KEY, DEVICES_KEY]);
      const noted = stored[PUSH_ENDPOINT_KEY];
      if (endpoint === noted || (noted === undefined && !endpoint)) return;

      const changes = { [PUSH_ENDPOINT_KEY]: endpoint };
      if (noted !== undefined && Object.keys(stored[DEVICES_KEY] || {}).length > 0) {
        // No phone can reach the old address, so neither list means anything any more.
        changes[NEEDS_REPAIR_KEY] = true;
        changes[DEVICES_KEY] = {};
        changes[UNLINKED_KEY] = {};
      }
      await chrome.storage.local.set(changes);
    });
  }

  // Checks whether the browser ended or replaced the push subscription; see noteEndpoint().
  async function checkSubscription() {
    const pushManager = platform.pushManager();
    if (!pushManager) return;
    // In the key's queue, so a subscription Unlink All is replacing is not taken for lost.
    await changeKey(async () => noteEndpoint((await pushManager.getSubscription())?.endpoint ?? null));
  }

  function checkSubscriptionLater() {
    return checkSubscription().catch((err) => console.warn("[WebPush] Could not check the push subscription:", err));
  }

  // subscribeWith(), noting the endpoint the phones are given.
  async function subscribe(pushManager, publicKey) {
    const subscription = await subscribeWith(pushManager, publicKey);
    await noteEndpoint(pushAddress(subscription).endpoint);
    return subscription;
  }

  async function getPairingCode() {
    const pushManager = platform.pushManager();
    if (!pushManager) return null;
    // Before subscribing, which would hide that the phones lost the last subscription.
    await checkSubscription();
    const key = await currentKey();
    const address = pushAddress(await subscribe(pushManager, key.publicKey));
    const name = `${platform.name} (${platform.os})`.slice(0, MAX_PAIRING_NAME_LENGTH);
    const code = [
      PAIRING_PREFIX,
      address.endpoint,
      address.p256dh,
      address.auth,
      key.publicKey,
      key.privateKey,
      name
    ].join("|");
    if (code.length > MAX_PAIRING_CODE_LENGTH) {
      throw new Error(t("pairingCodeTooLong"));
    }
    return code;
  }

  // Makes the key and the subscription ahead of the first pairing code.
  function preparePairingCode() {
    getPairingCode().catch((err) => console.warn("[WebPush] Could not prepare the pairing code:", err));
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

  // Handle notification body click: 1-click copy OTP or SMS body, or open the popup from a notice
  chrome.notifications.onClicked.addListener(async (notifId) => {
    const notifData = await takeNotification(notifId);
    if (!notifData) return;
    await notificationClicked(notifData);
    chrome.notifications.clear(notifId);
  });

  chrome.notifications.onClosed.addListener((notifId) => {
    takeNotification(notifId);
  });

  // Drops the messages that aged past 24 hours while the browser was closed
  chrome.runtime.onInstalled.addListener(pruneOldSmsLater);
  chrome.runtime.onStartup.addListener(pruneOldSmsLater);
  chrome.runtime.onInstalled.addListener(preparePairingCode);
  chrome.runtime.onStartup.addListener(checkSubscriptionLater);

  /*
   * Takes a phone off the list and ignores its messages from then on. Every phone shares
   * the one push address, so only the phone itself, or Unlink All, can stop it sending.
   */
  async function unlinkDevice(deviceId) {
    if (!deviceId) throw new Error(t("noPhoneToUnlink"));
    return changeStored(async () => {
      const stored = await chrome.storage.local.get([DEVICES_KEY, UNLINKED_KEY]);
      const devices = { ...stored[DEVICES_KEY] };
      const name = devices[deviceId]?.name || "";
      delete devices[deviceId];
      await chrome.storage.local.set({
        [DEVICES_KEY]: devices,
        [UNLINKED_KEY]: withUnlinked(stored[UNLINKED_KEY], deviceId, name, Date.now())
      });
      return { remaining: Object.keys(devices).length };
    });
  }

  /*
   * Ends the push subscription and makes a new key, so no phone can send here any more:
   * each removes the link on its next send, when the push service says the address is gone.
   * The stored messages go too, as what the phones sent is cut off with them.
   */
  async function unlinkAll() {
    const pushManager = platform.pushManager();
    if (!pushManager) throw new Error(t("noPushService"));
    const key = await changeKey(async () => {
      const subscription = await pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
      }
      const fresh = await createVapidKey();
      await changeStored(() => chrome.storage.local.set({
        [VAPID_KEY]: fresh,
        [PUSH_ENDPOINT_KEY]: null,
        [NEEDS_REPAIR_KEY]: false,
        [DEVICES_KEY]: {},
        [UNLINKED_KEY]: {},
        [FEED_KEY]: []
      }));
      return fresh;
    });
    await subscribe(pushManager, key.publicKey);
  }

  /*
   * What each page request runs; each resolves with what the reply adds to { ok: true }.
   * Pages render from storage.onChanged, so nothing here messages them.
   */
  const requests = {
    GET_PAIRING_CODE: async () => {
      const code = await getPairingCode();
      if (!code) throw new Error(t("noPushService"));
      return { code };
    },
    CLEAR_FEED: () => changeStored(() => chrome.storage.local.set({ [FEED_KEY]: [] })),
    UNLINK_DEVICE: (request) => unlinkDevice(request.deviceId),
    UNLINK_ALL: unlinkAll,
    // What the popup checks when it opens: whether the phones lost this browser, which it
    // reads from storage, and whether notifications are off.
    GET_STATUS: async () => {
      await checkSubscription();
      return { notificationsOff: !(await platform.canNotify()) };
    }
  };

  /*
   * Whether a runtime message came from one of this extension's own pages. No other
   * extension or web page can message it (there is no externally_connectable), so this only
   * guards against that changing.
   */
  function fromOwnPage(sender) {
    return sender?.id === chrome.runtime.id &&
      typeof sender.url === "string" &&
      sender.url.startsWith(chrome.runtime.getURL(""));
  }

  /*
   * Returns true to answer through sendResponse later. A listener that returns a promise
   * needs Chrome 148, rolling out gradually, and a rejection reaches the sender from 146.
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!fromOwnPage(sender)) return;
    const run = Object.hasOwn(requests, request?.type) ? requests[request.type] : null;
    if (!run) return;

    Promise.resolve()
      .then(() => run(request))
      .then((reply) => sendResponse({ ok: true, ...reply }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  });

  return { handleIncoming, copyForAction, notificationClicked, checkSubscriptionLater };
}
