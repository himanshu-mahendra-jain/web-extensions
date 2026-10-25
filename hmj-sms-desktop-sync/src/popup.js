/**
 * SMS Desktop Sync - Popup Dashboard Logic
 * Direct, serverless VAPID Web Push with QR code pairing, the linked phones and the messages.
 */

import { renderQrCode } from "./qrcode.js";
import { formatDateTime, formatTimeAgo } from "./time.js";
import { MAX_MESSAGE_AGE_MS, attachmentSummary, groupNames, messageText } from "./message-format.js";
import { andList, listOf, localizePage, plural, t } from "./i18n.js";

const QR_CODE_SIZE = 260;
const STATUS_MS = 6000;
// How often the times shown, such as "5m ago", are written again while the popup is open.
const TIMES_REFRESH_MS = 60 * 1000;
// Stands for the time in a message, to split the message around it.
const TIME_MARK = "\u0001";

const qrPanel = document.getElementById("qrPanel");
const qrContainer = document.getElementById("qrContainer");
const btnToggleQr = document.getElementById("btnToggleQr");
const btnHideQr = document.getElementById("btnHideQr");
const btnShowQrEmpty = document.getElementById("btnShowQrEmpty");
const btnCopy = document.getElementById("btnCopyPairingCode");
const btnMenu = document.getElementById("btnMenu");
const menu = document.getElementById("menu");
const btnUnlinkAll = document.getElementById("btnUnlinkAll");
const btnClearFeed = document.getElementById("btnClearFeed");
const copyStatus = document.getElementById("copyStatus");
const actionStatus = document.getElementById("actionStatus");
const announcer = document.getElementById("announcer");
const emptyView = document.getElementById("emptyView");
const emptyTitle = document.getElementById("emptyTitle");
const emptySub = document.getElementById("emptySub");
const listItems = document.getElementById("listItems");
const deviceBanner = document.getElementById("deviceBanner");
const repairBanner = document.getElementById("repairBanner");
const notificationsOffBanner = document.getElementById("notificationsOffBanner");
const deviceBannerName = document.getElementById("deviceBannerName");
const deviceBannerCount = document.getElementById("deviceBannerCount");
const deviceBannerTime = document.getElementById("deviceBannerTime");
const phoneList = document.getElementById("phoneList");
const phoneItems = document.getElementById("phoneItems");
const syncStatusBadge = document.getElementById("syncStatusBadge");
const confirmDialog = document.getElementById("confirmDialog");
const confirmHeading = document.getElementById("confirmHeading");
const confirmText = document.getElementById("confirmText");
const confirmAction = document.getElementById("confirmAction");

localizePage();

let pairingCodeCache = null;
let pairingCodeLoading = null;
// Counts new keys, so a pairing code made with the last one is not shown.
let keyGeneration = 0;
let renderQueued = false;
let statusTimer;
// The key of the newest message shown, so only one that arrives later is announced.
let newestShownKey;

// True once the popup drew what it opened with; a banner that appears later is announced.
let opened = false;

// Says text to screen readers through the page's one live region.
function announce(text) {
  announcer.textContent = "";
  // Set after a frame, so the same text twice is announced twice.
  requestAnimationFrame(() => {
    announcer.textContent = text;
  });
}

// Shows how an action went under the header for a while; its region reads it out.
function showStatus(text, isError = false) {
  clearTimeout(statusTimer);
  actionStatus.textContent = text;
  actionStatus.classList.toggle("error", isError);
  statusTimer = setTimeout(() => {
    actionStatus.textContent = "";
  }, STATUS_MS);
}

// Shows "Copied!" on button for 2 seconds, then its label again, and announces what was copied.
function showCopied(button, label, announcement) {
  button.textContent = t("copied");
  announce(announcement);
  setTimeout(() => { button.textContent = label; }, 2000);
}

function toggleQr(show = qrPanel.hidden) {
  qrPanel.hidden = !show;
  if (show && !pairingCodeCache) {
    loadAndRenderQrCode();
  }
}

btnToggleQr.addEventListener("click", () => toggleQr());
btnHideQr.addEventListener("click", () => toggleQr(false));
btnShowQrEmpty.addEventListener("click", () => toggleQr(true));

btnCopy.addEventListener("click", async () => {
  copyStatus.textContent = "";
  if (!pairingCodeCache) {
    await loadAndRenderQrCode();
  }
  if (!pairingCodeCache) return;
  try {
    await navigator.clipboard.writeText(pairingCodeCache);
    showCopied(btnCopy, t("copyCode"), t("pairingCodeCopied"));
  } catch (e) {
    copyStatus.textContent = t("copyFailed", e.message);
  }
});

deviceBanner.addEventListener("click", () => {
  const open = deviceBanner.getAttribute("aria-expanded") !== "true";
  deviceBanner.setAttribute("aria-expanded", String(open));
  phoneList.hidden = !open;
});

// Screen readers learn from aria-expanded whether the menu is open.
menu.addEventListener("toggle", (event) => {
  btnMenu.setAttribute("aria-expanded", String(event.newState === "open"));
});

// Answers the dialog that is open, or did not hear its close event yet.
let settleConfirm = () => {};

/*
 * Asks in a dialog and resolves true only when the user confirms.
 * Cancel has the focus, and Escape closes the dialog without a
 * value, so neither confirms by accident. Focus then goes to
 * returnFocus, as the button that opened the dialog may be gone.
 */
function confirmDanger({ title, text, action, returnFocus }) {
  // The close event is queued, so the last dialog's can still be on its way.
  settleConfirm();

  confirmHeading.textContent = title;
  confirmText.textContent = text;
  confirmAction.textContent = action;

  confirmDialog.returnValue = "";
  confirmDialog.showModal();

  const { promise, resolve } = Promise.withResolvers();

  const onClose = () => {
    // An open dialog got the last one's close event.
    if (!confirmDialog.open) {
      settleConfirm();
    }
  };

  settleConfirm = () => {
    confirmDialog.removeEventListener("close", onClose);
    settleConfirm = () => {};
    returnFocus.focus();
    resolve(confirmDialog.returnValue === "confirm");
  };

  confirmDialog.addEventListener("close", onClose);
  return promise;
}

// Sends a request to the background; rejects when it fails or answers not ok.
async function request(message) {
  const resp = await chrome.runtime.sendMessage(message);
  if (!resp?.ok) {
    throw new Error(resp?.error || t("noAnswer"));
  }
  return resp;
}

btnUnlinkAll.addEventListener("click", async () => {
  menu.hidePopover();
  const confirmed = await confirmDanger({
    title: t("unlinkAllTitle"),
    text: t("unlinkAllText"),
    action: t("unlinkAllAction"),
    returnFocus: btnMenu
  });
  if (!confirmed) return;
  try {
    await request({ type: "UNLINK_ALL" });
    showStatus(t("allPhonesUnlinked"));
  } catch (err) {
    showStatus(t("unlinkFailed", err.message), true);
  }
});

btnClearFeed.addEventListener("click", async () => {
  menu.hidePopover();
  const confirmed = await confirmDanger({
    title: t("clearTitle"),
    text: t("clearText"),
    action: t("clearMessages"),
    returnFocus: btnMenu
  });
  if (!confirmed) return;
  try {
    await request({ type: "CLEAR_FEED" });
    showStatus(t("messagesCleared"));
  } catch (err) {
    showStatus(t("clearFailed", err.message), true);
  }
});

// The background stores every change, so storage is the one thing to watch.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  // A new key makes a new pairing code; the first key changes no code already shown.
  if (changes.vapid_key?.oldValue) {
    keyGeneration++;
    pairingCodeCache = null;
    qrContainer.replaceChildren();
    if (!qrPanel.hidden) loadAndRenderQrCode();
  }
  if (changes.connected_devices || changes.recent_sms_feed || changes.needs_repair) {
    queueRender();
  }
});

Promise.allSettled([loadStatus(), loadMessages()]).then(() => {
  opened = true;
});

/*
 * Shows or hides a banner that says why messages may not arrive or show. One that appears
 * while the popup is open is read out, as nothing else says it changed.
 */
function showBanner(banner, show) {
  if (show && banner.hidden && opened) {
    announce(banner.textContent);
  }
  banner.hidden = !show;
}

const timesTimer = setInterval(refreshTimes, TIMES_REFRESH_MS);
window.addEventListener("pagehide", () => clearInterval(timesTimer));

/*
 * A <time> that says how long ago timestamp was, with the full local date and time as its
 * tooltip; refreshTimes() keeps its text current.
 */
function timeAgo(timestamp, className) {
  const time = document.createElement("time");
  if (className) time.className = className;
  time.dateTime = new Date(timestamp).toISOString();
  time.title = formatDateTime(timestamp);
  time.textContent = formatTimeAgo(timestamp);
  return time;
}

function refreshTimes() {
  for (const time of document.querySelectorAll("time[datetime]")) {
    time.textContent = formatTimeAgo(Date.parse(time.dateTime));
  }
}

// Changes that arrive together render once.
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    loadMessages();
  });
}

// Asks the background for the pairing code once, when the QR code is first shown.
function loadAndRenderQrCode() {
  pairingCodeLoading ??= renderPairingCode().finally(() => {
    pairingCodeLoading = null;
  });
  return pairingCodeLoading;
}

async function renderPairingCode() {
  const generation = keyGeneration;
  try {
    const { code } = await request({ type: "GET_PAIRING_CODE" });
    if (generation !== keyGeneration) return;
    pairingCodeCache = code;
    renderQrCode(qrContainer, pairingCodeCache, QR_CODE_SIZE);
  } catch (err) {
    // A code asked for before a new key is not shown, nor is why it failed.
    if (generation !== keyGeneration) return;
    copyStatus.textContent = t("pairingCodeFailed", err.message);
  }
}

/*
 * Asks the background to check the push subscription, which stores a request to pair
 * again when the phones lost this browser, and whether notifications are off.
 */
async function loadStatus() {
  try {
    const { notificationsOff } = await request({ type: "GET_STATUS" });
    showBanner(notificationsOffBanner, notificationsOff);
  } catch (err) {
    console.warn("Could not check the status:", err);
  }
}

async function loadMessages() {
  try {
    const stored = await chrome.storage.local.get(["recent_sms_feed", "connected_devices", "needs_repair"]);
    let feed = stored.recent_sms_feed || [];
    const now = Date.now();
    feed = feed.filter(m => m.timestamp && (now - m.timestamp) <= MAX_MESSAGE_AGE_MS);

    const deviceList = Object.values(stored.connected_devices || {});
    const isPaired = deviceList.length > 0;
    showBanner(repairBanner, Boolean(stored.needs_repair));

    if (isPaired) {
      // 1. Move OUT of the pairing page (hide QR panel)
      qrPanel.hidden = true;
      btnToggleQr.textContent = t("pairAnotherButton");
      btnToggleQr.title = t("pairAnotherButtonTitle");

      // 2. Show connected devices in banner and status badge
      deviceBanner.hidden = false;
      const names = deviceList.map(d => d.name);
      if (deviceList.length === 1) {
        const single = deviceList[0];
        deviceBannerName.textContent = single.name;
        deviceBannerCount.textContent = t("bannerLinked");
        if (single.lastSeen) {
          deviceBannerTime.replaceChildren(timeAgo(single.lastSeen));
        } else {
          deviceBannerTime.textContent = t("active");
        }
      } else {
        deviceBannerName.textContent = listOf(names);
        deviceBannerCount.textContent = plural("bannerLinkedCount", deviceList.length);
        deviceBannerTime.textContent = t("active");
      }
      renderPhones(deviceList);
      syncStatusBadge.textContent = deviceList.length === 1 ? t("statusLinked") : plural("statusLinkedCount", deviceList.length);
      syncStatusBadge.className = "status-badge";

      // 3. Update empty view to show connected status
      emptyTitle.textContent = deviceList.length === 1
        ? t("connectedTo", deviceList[0].name)
        : plural("connectedToCount", deviceList.length);
      emptySub.textContent = t("waitingFor", andList(names));
      btnShowQrEmpty.hidden = true;
    } else {
      // Not paired yet: show QR code so user can pair
      deviceBanner.hidden = true;
      deviceBanner.setAttribute("aria-expanded", "false");
      phoneList.hidden = true;
      phoneItems.replaceChildren();
      qrPanel.hidden = false;
      if (!pairingCodeCache) loadAndRenderQrCode();
      btnToggleQr.textContent = t("pairButton");
      btnToggleQr.title = t("pairButtonTitle");
      syncStatusBadge.textContent = t("statusNotLinked");
      syncStatusBadge.className = "status-badge syncing";
      emptyTitle.textContent = t("emptyTitle");
      emptySub.textContent = t("emptyText");
      btnShowQrEmpty.hidden = false;
    }

    emptyView.hidden = feed.length > 0;
    renderList(feed);
    announceNewest(feed);
  } catch (err) {
    console.error("Failed to load messages:", err);
  }
}

// The linked phones, each with when it was last active and its Unlink button.
function renderPhones(list) {
  phoneItems.replaceChildren(...list.map((dev) => {
    const name = dev.name || t("phoneFallbackName");
    const item = document.createElement("li");
    item.className = "phone-item";

    const info = document.createElement("span");
    info.className = "phone-info";

    const nameText = document.createElement("span");
    nameText.className = "phone-name";
    // A phone's name reads in its own direction, whatever the popup's language.
    nameText.dir = "auto";
    nameText.textContent = name;

    const meta = document.createElement("span");
    meta.className = "phone-meta";
    if (dev.lastSeen) {
      // The message says where its time goes, which is a <time> of its own.
      const [before, after = ""] = t("lastActive", TIME_MARK).split(TIME_MARK);
      meta.append(before, timeAgo(dev.lastSeen), after);
    } else {
      meta.textContent = t("active");
    }

    info.append(nameText, meta);

    const unlink = document.createElement("button");
    unlink.className = "phone-unlink";
    unlink.textContent = t("unlink");
    unlink.setAttribute("aria-label", t("unlinkPhone", name));
    unlink.addEventListener("click", async () => {
      const confirmed = await confirmDanger({
        title: t("unlinkPhoneTitle", name),
        text: t("unlinkPhoneText", name),
        action: t("unlink"),
        returnFocus: deviceBanner
      });
      if (!confirmed) return;
      try {
        // The list redraws from the storage change.
        await request({ type: "UNLINK_DEVICE", deviceId: dev.id });
        showStatus(t("phoneUnlinked", name));
      } catch (err) {
        showStatus(t("unlinkFailed", err.message), true);
      }
    });

    item.append(info, unlink);
    return item;
  }));
}

// Announces a message that arrived while the popup is open; the first render says nothing.
function announceNewest(feed) {
  const [newest] = feed;
  // Two phones can send the same ID; messages stored before keys existed have only an ID.
  const newestKey = newest ? newest.key ?? newest.id : null;
  if (newestShownKey !== undefined && newest && newestKey !== newestShownKey) {
    announce(t("newMessageFrom", newest.sender || t("unknownSender")));
  }
  newestShownKey = newestKey;
}

function renderList(messages) {
  listItems.replaceChildren(...messages.map(renderCard));
}

function tag(className, text) {
  const span = document.createElement("span");
  span.className = `tag ${className}`;
  span.textContent = text;
  return span;
}

/*
 * A paragraph; one of what the phone sent sets dir="auto", so an English message reads
 * left to right in a right-to-left popup, and the other way round.
 */
function paragraph(className, text, fromPhone = false) {
  const p = document.createElement("p");
  p.className = className;
  if (fromPhone) p.dir = "auto";
  p.textContent = text;
  return p;
}

function renderCard(msg) {
  const card = document.createElement("article");
  card.className = "card";

  const header = document.createElement("div");
  header.className = "card-header";

  const senderBox = document.createElement("div");
  senderBox.className = "sender-box";

  const sender = document.createElement("h2");
  sender.className = "sender-name";
  sender.dir = "auto";
  sender.textContent = msg.sender || t("unknownSender");
  senderBox.append(sender);

  const group = Array.isArray(msg.group) ? msg.group : [];
  if (msg.kind === "mms") {
    senderBox.append(tag("tag-kind", t(group.length > 0 ? "tagGroup" : "tagMms")));
  }

  if (msg.deviceName) {
    const device = tag("tag-device", msg.deviceName);
    device.dir = "auto";
    senderBox.append(device);
  }

  if (typeof msg.simSlot === "number" && msg.simSlot >= 0) {
    senderBox.append(tag("tag-sim", msg.simName ? t("simWithName", msg.simSlot + 1, msg.simName) : t("sim", msg.simSlot + 1)));
  }

  const time = timeAgo(msg.timestamp, "msg-time");

  header.append(senderBox, time);
  card.append(header);

  if (group.length > 0) {
    card.append(paragraph("msg-group", t("groupWith", groupNames(group))));
  }
  if (msg.subject && msg.subject !== msg.body) {
    card.append(paragraph("msg-subject", msg.subject, true));
  }
  if (msg.body || !msg.kind) {
    card.append(paragraph("msg-body", msg.body || "", true));
  }
  const attachments = attachmentSummary(msg.attachments);
  if (attachments) {
    card.append(paragraph("msg-attachments", attachments));
  }

  const actions = document.createElement("div");
  actions.className = "msg-actions";

  if (msg.otp) {
    actions.append(copyButton(t("copyOtp", msg.otp), msg.otp, t("otpCopied"), "msg-btn msg-btn-otp"));
  }
  const text = messageText(msg);
  if (text || !msg.kind) {
    actions.append(copyButton(t("copyText"), text, t("messageCopied"), "msg-btn"));
  }

  card.append(actions);
  return card;
}

function copyButton(label, text, announcement, className) {
  const button = document.createElement("button");
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      showCopied(button, label, announcement);
    } catch (e) {
      announce(t("copyFailed", e.message));
    }
  });
  return button;
}
