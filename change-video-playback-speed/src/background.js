import "./extension-api.js";
import { changePlaybackSpeed } from "./playback.js";

const CHANGE_SPEED_COMMAND = "change-playback-speed";

// Keeps playback-speed changes sequential within each tab.
// Different tabs can still process changes independently.
const tabQueues = new Map();


function queuePlaybackSpeedChange(tabId) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  const previous = tabQueues.get(tabId) ?? Promise.resolve();

  const current = previous
    .catch(() => {
      // Keep the queue usable if an earlier operation failed.
    })
    .then(() => changePlaybackSpeed(tabId));

  tabQueues.set(tabId, current);

  void current.finally(() => {
    // Delete only if this is still the latest queued operation.
    if (tabQueues.get(tabId) === current) {
      tabQueues.delete(tabId);
    }
  });
}


extensionApi.action.onClicked.addListener((tab) => {
  queuePlaybackSpeedChange(tab.id);
});


// Firefox for Android has no keyboard shortcuts, so no commands API.
if (extensionApi.commands) {
  extensionApi.commands.onCommand.addListener(async (command) => {
    if (command !== CHANGE_SPEED_COMMAND) {
      return;
    }

    try {
      const [tab] = await extensionApi.tabs.query({
        active: true,
        currentWindow: true
      });

      queuePlaybackSpeedChange(tab?.id);
    } catch (error) {
      console.error(
        "Unable to process playback speed command:",
        error
      );
    }
  });
}