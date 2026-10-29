export function getMediaState() {
  const media = document.querySelectorAll("video, audio");

  if (media.length === 0) {
    return {
      hasMedia: false,
      isPlaying: false,
      playbackRate: 1
    };
  }

  let selectedMedia = null;
  let isPlaying = false;

  // Prefer the first actively playing media element.
  for (const element of media) {
    if (
      !element.paused &&
      !element.ended &&
      element.readyState > 2
    ) {
      selectedMedia = element;
      isPlaying = true;
      break;
    }
  }

  selectedMedia ??= media[0];

  const playbackRate =
    Number.isFinite(selectedMedia.playbackRate) &&
      selectedMedia.playbackRate > 0
      ? selectedMedia.playbackRate
      : 1;

  return {
    hasMedia: true,
    isPlaying,
    playbackRate
  };
}


/*
 * labels is what the indicator says, from speedLabels() in i18n.js:
 * shown and spoken text, and their lang and dir.
 */
export function applyPlaybackSpeed(speed, labels) {
  const ALLOWED_SPEEDS = Object.freeze([
    1,
    1.2,
    1.5,
    2
  ]);

  if (
    !Number.isFinite(speed) ||
    !ALLOWED_SPEEDS.includes(speed)
  ) {
    return;
  }

  const media = document.querySelectorAll("video, audio");

  // A failure on one media element must not prevent updating others.
  for (const element of media) {
    try {
      element.playbackRate = speed;
    } catch {
      // Continue with the remaining media elements.
    }
  }

  // Only the top frame displays the visual indicator.
  if (window !== window.top) {
    return;
  }

  const INDICATOR_ID = "cvps-speed-indicator";
  const ANNOUNCE_DELAY_MS = 100;

  const existingIndicator =
    document.getElementById(INDICATOR_ID);

  if (existingIndicator) {
    existingIndicator.remove();
  }

  const indicator = document.createElement("div");

  indicator.id = INDICATOR_ID;
  indicator.setAttribute("role", "status");
  indicator.setAttribute("aria-live", "polite");
  indicator.setAttribute("aria-atomic", "true");
  indicator.lang = labels.lang;
  indicator.dir = labels.dir;

  const visualText = document.createElement("span");
  visualText.setAttribute("aria-hidden", "true");
  visualText.textContent = labels.shown;

  const srText = document.createElement("span");
  Object.assign(srText.style, {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: "0",
    margin: "-1px",
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    border: "0"
  });

  indicator.appendChild(visualText);
  indicator.appendChild(srText);

  // A popover joins the top layer, above a fullscreen player.
  indicator.popover = "manual";

  Object.assign(indicator.style, {
    position: "fixed",
    // Undo the popover defaults that stretch it across the screen.
    inset: "auto",
    margin: "0",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    background: "rgba(0, 0, 0, 0.8)",
    color: "#ffffff",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    outline: "2px solid transparent",
    padding: "10px 20px",
    borderRadius: "6px",
    fontSize: "24px",
    fontWeight: "bold",
    fontFamily: "Arial, sans-serif",
    lineHeight: "1.2",
    zIndex: "2147483647",
    pointerEvents: "none",
    userSelect: "none"
  });

  document.documentElement.appendChild(indicator);
  indicator.showPopover();

  /*
   * Screen readers announce a change to a live region they already
   * know, not one that arrives with its text, so the text comes after.
   */
  setTimeout(() => {
    srText.textContent = labels.spoken;
  }, ANNOUNCE_DELAY_MS);

  setTimeout(() => {
    indicator.remove();
  }, 1500);
}
