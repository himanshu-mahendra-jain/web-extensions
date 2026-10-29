import { defineConfig } from "@playwright/test";

import { androidDevice as resolveAndroidDevice } from "./test-support/android-device.js";


// An adb serial, arc:5555 when it is connected, also runs the Firefox for Android tests there.
const androidDevice = resolveAndroidDevice();


export default defineConfig({
  // Each extension keeps its tests in <extension>/tests/.
  testMatch: "*/tests/**/*.spec.js",

  // Every browser test launches its own profile, so tests never share state.
  fullyParallel: true,

  // Half the cores: Chromium, Firefox and the Android device together
  // exhaust the memory with one worker per core, and tests time out.
  workers: "50%",

  forbidOnly: Boolean(process.env.CI),

  reporter: "list",

  globalSetup: androidDevice
    ? "./test-support/firefox-android-setup.js"
    : undefined,

  projects: [
    {
      name: "desktop",
      testIgnore: "*/tests/android/**"
    },

    // One device runs one Firefox, so its tests run one at a time.
    ...(androidDevice ? [{
      name: "firefox-android",
      testMatch: "*/tests/android/**/*.spec.js",
      fullyParallel: false,
      workers: 1,
      timeout: 60000
    }] : [])
  ]
});
