/**
 * SMS Desktop Sync - Popup Dashboard Logic
 * Direct, serverless VAPID Web Push with QR code pairing
 */

import { renderQrCode } from "./qrcode.js";
import { formatTimeAgo } from "./time.js";

const MAX_MESSAGE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const QR_CODE_SIZE = 260;

const qrPanel = document.getElementById("qrPanel");
const qrContainer = document.getElementById("qrContainer");
const btnToggleQr = document.getElementById("btnToggleQr");
const btnHideQr = document.getElementById("btnHideQr");
const btnShowQrEmpty = document.getElementById("btnShowQrEmpty");
const btnCopy = document.getElementById("btnCopyPairingCode");
const btnSettings = document.getElementById("btnSettings");
const copyStatus = document.getElementById("copyStatus");
const announcer = document.getElementById("announcer");
const emptyView = document.getElementById("emptyView");
const emptyTitle = document.getElementById("emptyTitle");
const emptySub = document.getElementById("emptySub");
const listItems = document.getElementById("listItems");
const deviceBanner = document.getElementById("deviceBanner");
const deviceBannerName = document.getElementById("deviceBannerName");
const deviceBannerCount = document.getElementById("deviceBannerCount");
const deviceBannerTime = document.getElementById("deviceBannerTime");
const syncStatusBadge = document.getElementById("syncStatusBadge");

let pairingCodeCache = null;
let pairingCodeLoading = null;
let renderQueued = false;
// The newest message shown, so only one that arrives later is announced.
let newestShownId;

// Says text to screen readers through the page's one live region.
function announce(text) {
  announcer.textContent = "";
  // Set after a frame, so the same text twice is announced twice.
  requestAnimationFrame(() => {
    announcer.textContent = text;
  });
}

// Shows "Copied!" on button for 2 seconds, then its label again, and says what was copied.
function showCopied(button, label, what) {
  button.textContent = "Copied!";
  announce(`${what} copied.`);
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
    showCopied(btnCopy, "Copy Code", "Pairing code");
  } catch (e) {
    copyStatus.textContent = "Failed to copy: " + e.message;
  }
});

btnSettings.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// The background stores every change, so storage is the one thing to watch.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.connected_devices || changes.recent_sms_feed)) {
    queueRender();
  }
});

loadMessages();

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
  try {
    const resp = await chrome.runtime.sendMessage({ type: "GET_PAIRING_CODE" });
    if (resp && resp.ok && resp.code) {
      pairingCodeCache = resp.code;
      renderQrCode(qrContainer, pairingCodeCache, QR_CODE_SIZE);
    }
  } catch (err) {
    console.warn("Could not load pairing code:", err);
  }
}

async function loadMessages() {
  try {
    const stored = await chrome.storage.local.get(["recent_sms_feed", "connected_devices"]);
    let feed = stored.recent_sms_feed || [];
    const now = Date.now();
    feed = feed.filter(m => m.timestamp && (now - m.timestamp) <= MAX_MESSAGE_AGE_MS);

    const deviceList = Object.values(stored.connected_devices || {});
    const isPaired = deviceList.length > 0;

    if (isPaired) {
      // 1. Move OUT of the pairing page (hide QR panel)
      qrPanel.hidden = true;
      btnToggleQr.textContent = "Pair Another";
      btnToggleQr.title = "Show QR code to link an additional phone";

      // 2. Show connected devices in banner and status badge
      deviceBanner.hidden = false;
      if (deviceList.length === 1) {
        const single = deviceList[0];
        deviceBannerName.textContent = single.name;
        deviceBannerCount.textContent = "(Linked)";
        deviceBannerTime.textContent = single.lastSeen ? formatTimeAgo(single.lastSeen) : "Active";
      } else {
        deviceBannerName.textContent = deviceList.map(d => d.name).join(", ");
        deviceBannerCount.textContent = `(${deviceList.length} Phones Linked)`;
        deviceBannerTime.textContent = "Active";
      }
      syncStatusBadge.textContent = deviceList.length === 1 ? "Linked" : `${deviceList.length} Linked`;
      syncStatusBadge.className = "status-badge";

      // 3. Update empty view to show connected status
      emptyTitle.textContent = deviceList.length === 1 ? `Connected to ${deviceList[0].name}` : `Connected to ${deviceList.length} Phones`;
      emptySub.textContent = `Waiting for incoming SMS & OTP alerts from ${deviceList.map(d => d.name).join(" and ")}.`;
      btnShowQrEmpty.hidden = true;
    } else {
      // Not paired yet: show QR code so user can pair
      deviceBanner.hidden = true;
      qrPanel.hidden = false;
      if (!pairingCodeCache) loadAndRenderQrCode();
      btnToggleQr.textContent = "Pair";
      btnToggleQr.title = "Show Pairing QR Code";
      syncStatusBadge.textContent = "Not Linked";
      syncStatusBadge.className = "status-badge syncing";
      emptyTitle.textContent = "Ready for incoming SMS";
      emptySub.textContent = "Incoming SMS and OTPs will appear here in real-time.";
      btnShowQrEmpty.hidden = false;
    }

    emptyView.hidden = feed.length > 0;
    renderList(feed);
    announceNewest(feed);
  } catch (err) {
    console.error("Failed to load messages:", err);
  }
}

// Announces a message that arrived while the popup is open; the first render says nothing.
function announceNewest(feed) {
  const [newest] = feed;
  if (newestShownId !== undefined && newest && newest.id !== newestShownId) {
    announce(`New message from ${newest.sender || "Unknown"}.`);
  }
  newestShownId = newest ? newest.id : null;
}

function renderList(messages) {
  listItems.replaceChildren(...messages.map(renderCard));
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
  sender.textContent = msg.sender || "Unknown";
  senderBox.append(sender);

  if (msg.deviceName) {
    const devTag = document.createElement("span");
    devTag.className = "tag tag-device";
    devTag.textContent = msg.deviceName;
    senderBox.append(devTag);
  }

  if (typeof msg.simSlot === "number" && msg.simSlot >= 0) {
    const simTag = document.createElement("span");
    simTag.className = "tag tag-sim";
    simTag.textContent = msg.simName ? `SIM ${msg.simSlot + 1}: ${msg.simName}` : `SIM ${msg.simSlot + 1}`;
    senderBox.append(simTag);
  }

  const time = document.createElement("span");
  time.className = "msg-time";
  time.textContent = formatTimeAgo(msg.timestamp);

  header.append(senderBox, time);

  const body = document.createElement("p");
  body.className = "msg-body";
  body.textContent = msg.body || "";

  const actions = document.createElement("div");
  actions.className = "msg-actions";

  if (msg.otp) {
    actions.append(copyButton(`Copy OTP (${msg.otp})`, msg.otp, "OTP", "msg-btn msg-btn-otp"));
  }
  actions.append(copyButton("Copy Text", msg.body, "Message", "msg-btn"));

  card.append(header, body, actions);
  return card;
}

function copyButton(label, text, what, className) {
  const button = document.createElement("button");
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      showCopied(button, label, what);
    } catch (e) {
      announce("Failed to copy: " + e.message);
    }
  });
  return button;
}
