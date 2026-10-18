import { defineConfig } from "@playwright/test";


// An adb serial, such as arc:5555, also runs the Firefox for Android tests there.
const androidDevice = process.env.FIREFOX_ANDROID_DEVICE;


export default defineConfig({
  // Each extension keeps its tests in <extension>/tests/.
  testMatch: "*/tests/**/*.spec.js",

  // Every browser test launches its own profile, so tests never share state.
  fullyParallel: true,

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
