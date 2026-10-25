/**
 * Offscreen Document script for Manifest V3 clipboard operations.
 * Handles copying OTPs and SMS messages from background service worker.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's worker asks for copies.
  if (sender.id !== chrome.runtime.id) return;

  if (message?.type === "COPY_TO_CLIPBOARD" && message.text) {
    handleCopy(message.text)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// The page's one textarea, which every copy reuses.
const textarea = document.getElementById("clipboard-area");

async function handleCopy(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (_) {
    // Fallback to execCommand if navigator.clipboard fails
  }

  /*
   * An offscreen document never has focus, which navigator.clipboard needs; execCommand,
   * though deprecated, does not, and is the path Chrome documents for offscreen copies.
   */
  textarea.value = text;
  textarea.select();
  document.execCommand("copy");
  textarea.value = "";
}
