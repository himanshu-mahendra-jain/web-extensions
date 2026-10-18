/**
 * Chrome Extension Background Service Worker (Manifest V3)
 * Ultra-fast E2EE Push Relay (< 250ms), desktop notifications, and zero-server VAPID Web Push.
 * What does not need the worker is in sms-core.js.
 */

import {
  createBackground,
  getOrCreatePushSubscription,
  pushAddress
} from "./sms-core.js";

async function hasNotificationPermission() {
  try {
    return await chrome.notifications.getPermissionLevel() === "granted";
  } catch (err) {
    console.warn("[WebPush] Notification permission check error:", err);
  }
  return true;
}

async function getPushSubscription() {
  try {
    if (!self.registration || !self.registration.pushManager) {
      console.warn("[WebPush] pushManager is not supported or accessible in this context");
      return null;
    }
    return await getOrCreatePushSubscription(self.registration.pushManager);
  } catch (err) {
    console.error("[WebPush] pushManager.subscribe failed:", err);
    return null;
  }
}

/*
 * Primary: self.registration.showNotification satisfies Chromium's push contract and
 * prevents "This site has been updated in the background". Resolves false to fall back.
 */
async function showWorkerNotification(title, options) {
  if (self.registration && typeof self.registration.showNotification === "function") {
    try {
      await self.registration.showNotification(title, options);
      return true;
    } catch (err) {
      console.warn("[SMS Notification] self.registration.showNotification failed, falling back to chrome.notifications:", err);
    }
  }
  return false;
}

let offscreenCreating = null;

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }
  offscreenCreating = chrome.offscreen.createDocument({
    url: "src/offscreen.html",
    reasons: ["CLIPBOARD"],
    justification: "Copy OTP or SMS message to clipboard from desktop notification"
  });
  try {
    await offscreenCreating;
  } finally {
    // A failed attempt must not make every later copy wait on it.
    offscreenCreating = null;
  }
}

async function hasOffscreenDocument() {
  if ("getContexts" in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL("src/offscreen.html")]
    });
    return contexts.length > 0;
  }
  return false;
}

async function copyTextToClipboard(text) {
  try {
    await ensureOffscreenDocument();
    await chrome.runtime.sendMessage({
      type: "COPY_TO_CLIPBOARD",
      text: text
    });
  } catch (err) {
    console.warn("Failed to copy to clipboard via offscreen document:", err);
  }
}

export const background = createBackground({
  name: "Chrome",
  testNotificationText: "Instant push alerts are working perfectly!",
  getPushAddress: async () => {
    const sub = await getPushSubscription();
    return sub ? pushAddress(sub) : null;
  },
  canNotify: hasNotificationPermission,
  showNotification: showWorkerNotification,
  copyText: copyTextToClipboard
});

// Listen for incoming VAPID Web Push notifications from Android phone
self.addEventListener("push", (event) => {
  let data = null;
  if (event.data) {
    try {
      data = event.data.json();
    } catch (_) {
      data = { body: event.data.text() };
    }
  }
  event.waitUntil(background.handleIncoming(data));
});

// Handle notification actions and clicks for self.registration.showNotification
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const sms = event.notification.data;
  if (!sms) return;
  event.waitUntil(background.copyForAction(sms, event.action));
});

// getPushSubscription() reports its own failures and resolves null.
chrome.runtime.onInstalled.addListener(getPushSubscription);
chrome.runtime.onStartup.addListener(getPushSubscription);
