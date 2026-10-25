/**
 * The Chrome and Edge service worker: the browser's and the system's names, its PushManager,
 * the push, notificationclick and pushsubscriptionchange listeners, notifications shown and closed by
 * the worker, and clipboard copies through the offscreen document. What does not need the
 * worker is in sms-core.js.
 */

import { createBackground } from "./sms-core.js";

async function hasNotificationPermission() {
  try {
    return await chrome.notifications.getPermissionLevel() === "granted";
  } catch (err) {
    console.warn("[WebPush] Notification permission check error:", err);
  }
  // A check that failed must not silence every message.
  return true;
}

// Edge names itself in its brands, and in its user agent as "Edg/".
export function browserName() {
  const brands = navigator.userAgentData?.brands ?? [];
  const edge = brands.some(({ brand }) => brand === "Microsoft Edge") || /\bEdg\//.test(navigator.userAgent);
  return edge ? "Edge" : "Chrome";
}

// The names userAgentData gives each system, as the pairing code names them.
const OS_NAMES = {
  "Chrome OS": "ChromeOS",
  Android: "Android",
  Linux: "Linux",
  macOS: "Mac",
  Windows: "Windows"
};

/*
 * The system's name in the pairing code. userAgentData names ChromeOS, which the user agent
 * calls CrOS, and Android in desktop mode, which the user agent calls Linux; the user agent
 * is the fallback, read in that order as Android's also says Linux.
 */
export function osName() {
  const platform = navigator.userAgentData?.platform;
  if (platform && Object.hasOwn(OS_NAMES, platform)) return OS_NAMES[platform];
  const agent = navigator.userAgent;
  if (agent.includes("CrOS")) return "ChromeOS";
  if (agent.includes("Android")) return "Android";
  if (agent.includes("Linux")) return "Linux";
  if (agent.includes("Mac")) return "Mac";
  if (agent.includes("Win")) return "Windows";
  return "Desktop";
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

// Closes the worker's notifications for which pick(tag, data) is true.
async function closeWorkerNotifications(pick) {
  if (typeof self.registration?.getNotifications !== "function") return;
  for (const notification of await self.registration.getNotifications()) {
    if (pick(notification.tag, notification.data)) {
      notification.close();
    }
  }
}

let offscreenCreating = null;
// The close of the offscreen document under way, which a new one waits for.
let offscreenClosing = null;
// Copies that started and did not end; the last one to end closes the document.
let copiesInFlight = 0;

async function ensureOffscreenDocument() {
  // Chrome allows one offscreen document at a time, so a closing one must be gone first.
  await offscreenClosing;
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

/*
 * Closes the offscreen document: its CLIPBOARD reason gives it no lifetime, so it would
 * otherwise keep the extension's renderer process alive after the worker stops, for the
 * rest of the browser session. A failed close only means the next copy reuses the document.
 */
function closeOffscreenDocument() {
  offscreenClosing = (async () => {
    try {
      if (await hasOffscreenDocument()) {
        await chrome.offscreen.closeDocument();
      }
    } catch (err) {
      console.warn("[Clipboard] Could not close the offscreen document:", err);
    } finally {
      offscreenClosing = null;
    }
  })();
  return offscreenClosing;
}

async function copyTextToClipboard(text) {
  copiesInFlight++;
  try {
    await ensureOffscreenDocument();
    await chrome.runtime.sendMessage({
      type: "COPY_TO_CLIPBOARD",
      text: text
    });
  } catch (err) {
    console.warn("Failed to copy to clipboard via offscreen document:", err);
  } finally {
    copiesInFlight--;
    // Two copies at once share the document, and the last one to end closes it.
    if (copiesInFlight === 0) {
      await closeOffscreenDocument();
    }
  }
}

export const background = createBackground({
  name: browserName(),
  os: osName(),
  pushManager: () => self.registration?.pushManager ?? null,
  canNotify: hasNotificationPermission,
  showNotification: showWorkerNotification,
  closeNotifications: closeWorkerNotifications,
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
  const data = event.notification.data;
  if (!data) return;
  event.waitUntil(background.notificationClicked(data, event.action));
});

/*
 * The browser ended or replaced the push subscription. Chrome may never say so; the check
 * also runs at browser startup, when the popup opens and before each pairing code.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(background.checkSubscriptionLater());
});
