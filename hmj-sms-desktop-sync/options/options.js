/**
 * Options Page JavaScript Logic
 * Pairing QR code rendering, connected device status, test alerts, and feed management.
 */

import { renderQrCode } from "../src/qrcode.js";
import { formatTimeAgo } from "../src/time.js";

const QR_CODE_SIZE = 260;
const NOTICE_MS = 4000;

const txtPairingCode = document.getElementById("txtPairingCode");
const btnCopyCode = document.getElementById("btnCopyCode");
const btnTestNotif = document.getElementById("btnTestNotif");
const btnClearFeed = document.getElementById("btnClearFeed");
const copyStatusNotice = document.getElementById("copyStatusNotice");
const testStatusNotice = document.getElementById("testStatusNotice");
const clearStatusNotice = document.getElementById("clearStatusNotice");

const connectedDeviceSection = document.getElementById("connectedDeviceSection");
const deviceCountSpan = document.getElementById("deviceCountSpan");
const devicesContainer = document.getElementById("devicesContainer");
const alreadyPairedNotice = document.getElementById("alreadyPairedNotice");
const pairedNoticeDeviceName = document.getElementById("pairedNoticeDeviceName");
const qrContainerBox = document.getElementById("qrContainerBox");
const btnShowQrToggle = document.getElementById("btnShowQrToggle");
const optionsQrContainer = document.getElementById("optionsQrContainer");

const confirmDialog = document.getElementById("confirmDialog");
const confirmHeading = document.getElementById("confirmHeading");
const confirmText = document.getElementById("confirmText");
const confirmAction = document.getElementById("confirmAction");

let pairingCode = "";
let isQrManuallyOpened = false;
let renderQueued = false;

function showQrToggleState() {
  qrContainerBox.hidden = !isQrManuallyOpened;
  btnShowQrToggle.textContent = isQrManuallyOpened ? "Hide QR Code" : "Link Another Phone";
}

async function updateDeviceState() {
  try {
    const stored = await chrome.storage.local.get(["connected_devices"]);
    const deviceList = Object.values(stored.connected_devices || {});
    const isPaired = deviceList.length > 0;

    if (isPaired) {
      // 1. Show Connected Devices section
      connectedDeviceSection.hidden = false;
      deviceCountSpan.textContent = deviceList.length;
      renderDevices(deviceList);
      pairedNoticeDeviceName.textContent = deviceList.map(d => d.name).join(", ");

      // 2. Move out of pairing view (collapse QR code)
      alreadyPairedNotice.hidden = false;
      showQrToggleState();
    } else {
      // Not paired: show full pairing section, hide connected device card
      connectedDeviceSection.hidden = true;
      alreadyPairedNotice.hidden = true;
      qrContainerBox.hidden = false;
      devicesContainer.replaceChildren();
      isQrManuallyOpened = false;
    }
  } catch (err) {
    console.error("Error updating device state:", err);
  }
}

function renderDevices(list) {
  devicesContainer.replaceChildren(...list.map((dev) => {
    const card = document.createElement("div");
    card.className = "device-card";

    const left = document.createElement("div");
    left.className = "device-left";

    const info = document.createElement("div");

    const nameRow = document.createElement("div");
    nameRow.className = "device-name-row";

    const nameSpan = document.createElement("span");
    nameSpan.className = "device-name-text";
    nameSpan.textContent = dev.name || "Android Phone";

    const badge = document.createElement("span");
    badge.className = "badge-linked";
    badge.textContent = "Connected";

    nameRow.append(nameSpan, badge);

    const meta = document.createElement("div");
    meta.className = "device-meta";
    meta.textContent = dev.lastSeen ? `Last active: ${formatTimeAgo(dev.lastSeen)}` : "Active";

    info.append(nameRow, meta);
    left.append(info);

    const name = dev.name || "this phone";
    const btnUnlink = document.createElement("button");
    btnUnlink.className = "btn btn-danger btn-small";
    btnUnlink.textContent = "Unlink";
    btnUnlink.setAttribute("aria-label", `Unlink ${dev.name || "phone"}`);
    btnUnlink.addEventListener("click", async () => {
      const confirmed = await confirmDanger({
        title: `Unlink ${name}?`,
        text: `Disconnect ${name} from SMS Desktop Sync? Its messages stop arriving here until you pair it again.`,
        action: "Unlink"
      });
      // The list redraws from the storage change.
      if (confirmed) {
        await chrome.runtime.sendMessage({ type: "UNLINK_DEVICE", deviceId: dev.id });
      }
    });

    card.append(left, btnUnlink);
    return card;
  }));
}

// Answers the dialog that is open, or did not hear its close event yet.
let settleConfirm = () => {};

/*
 * Asks in a dialog and resolves true only when the user confirms.
 * Cancel has the focus, and Escape closes the dialog without a
 * value, so neither confirms by accident. Focus goes back to the
 * button that opened it.
 */
function confirmDanger({ title, text, action }) {
  // The close event is queued, so the last dialog's can still be on its way.
  settleConfirm();

  confirmHeading.textContent = title;
  confirmText.textContent = text;
  confirmAction.textContent = action;

  confirmDialog.returnValue = "";
  confirmDialog.showModal();

  return new Promise((resolve) => {
    const onClose = () => {
      // An open dialog got the last one's close event.
      if (!confirmDialog.open) {
        settleConfirm();
      }
    };

    settleConfirm = () => {
      confirmDialog.removeEventListener("close", onClose);
      settleConfirm = () => {};
      resolve(confirmDialog.returnValue === "confirm");
    };

    confirmDialog.addEventListener("close", onClose);
  });
}

btnShowQrToggle.addEventListener("click", () => {
  isQrManuallyOpened = !isQrManuallyOpened;
  showQrToggleState();
});

// The background stores every change, so storage is the one thing to watch.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.connected_devices || renderQueued) return;
  // Changes that arrive together render once.
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    updateDeviceState();
  });
});

// Sends a request to the background; rejects when it fails or answers not ok.
async function request(message) {
  const resp = await chrome.runtime.sendMessage(message);
  if (!resp?.ok) {
    throw new Error(resp?.error || "No answer from the background.");
  }
  return resp;
}

async function loadAndRenderQr() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "GET_PAIRING_CODE" });
    if (resp && resp.ok && resp.code) {
      pairingCode = resp.code;
      txtPairingCode.value = pairingCode;
      renderQrCode(optionsQrContainer, pairingCode, QR_CODE_SIZE);
    } else {
      txtPairingCode.value = "Failed to load push subscription: " + (resp?.error || "Unknown");
    }
  } catch (err) {
    txtPairingCode.value = "Error: " + err.message;
  }
}

btnCopyCode.addEventListener("click", async () => {
  if (!pairingCode) return;
  try {
    await navigator.clipboard.writeText(pairingCode);
    btnCopyCode.textContent = "Copied to Clipboard!";
    showNotice(copyStatusNotice, "Pairing code copied.", "success");
    setTimeout(() => { btnCopyCode.textContent = "Copy Pairing Code"; }, 2500);
  } catch (err) {
    showNotice(copyStatusNotice, "Failed to copy: " + err.message, "error");
  }
});

btnTestNotif.addEventListener("click", async () => {
  try {
    await request({ type: "SEND_TEST_NOTIFICATION" });
    showNotice(testStatusNotice, "Test desktop notification sent! Look for the popup in your system tray.", "success");
  } catch (err) {
    showNotice(testStatusNotice, "Failed to send test notification: " + err.message, "error");
  }
});

btnClearFeed.addEventListener("click", async () => {
  const confirmed = await confirmDanger({
    title: "Clear recent messages?",
    text: "Every message stored in this extension will be removed. Messages on your phone are not affected.",
    action: "Clear Messages"
  });
  if (!confirmed) return;
  try {
    await request({ type: "CLEAR_FEED" });
    showNotice(clearStatusNotice, "All stored messages cleared.", "success");
  } catch (err) {
    showNotice(clearStatusNotice, "Failed to clear messages: " + err.message, "error");
  }
});

// The buttons are wired first, so they work while the pairing code loads.
loadAndRenderQr();
updateDeviceState();

// Each notice's hide timer, so a newer notice is not hidden early.
const noticeTimers = new Map();

function showNotice(elem, text, type) {
  clearTimeout(noticeTimers.get(elem));
  elem.textContent = text;
  elem.className = "status-notice " + type;
  elem.hidden = false;
  noticeTimers.set(elem, setTimeout(() => {
    elem.hidden = true;
  }, NOTICE_MS));
}
