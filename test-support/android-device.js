import { execFileSync } from "node:child_process";


/*
 * The adb serial of the device the Firefox for Android tests run on.
 * FIREFOX_ANDROID_DEVICE names it when set; set to nothing, it keeps
 * the tests off a connected device. Otherwise the tests use arc:5555,
 * ChromeOS's Android container, when adb lists it as connected, and do
 * not run when it is absent or adb is missing. playwright.config.js,
 * firefox-android.js and check.sh all ask here, so they agree; the
 * file has no main of its own because Playwright loads it as CommonJS.
 */
export const DEFAULT_DEVICE = "arc:5555";

const ADB = process.env.ADB || "adb";


export function androidDevice() {
  if (process.env.FIREFOX_ANDROID_DEVICE !== undefined) {
    return process.env.FIREFOX_ANDROID_DEVICE;
  }

  try {
    const listed = execFileSync(ADB, ["devices"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const connected = listed.split("\n").some((line) => line.trim().split(/\s+/).join(" ") === `${DEFAULT_DEVICE} device`);

    return connected ? DEFAULT_DEVICE : "";
  } catch {
    // No adb, or it could not list devices: there is no device to test on.
    return "";
  }
}
