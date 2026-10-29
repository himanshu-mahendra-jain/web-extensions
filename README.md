# Web Extensions

This repository holds several browser extensions and the build script they share. The script packages each one into ZIP files ready to upload to the Chrome Web Store, Microsoft Edge Add-ons, and Firefox Add-ons (AMO). The Firefox package also installs in Firefox for Android. HMJ SMS Desktop Sync ships for Chrome and Edge only, because Firefox does not give extensions Web Push. Every extension appears in the browser's own language, in each language the Chrome Web Store supports, and falls back to English otherwise.

https://github.com/user-attachments/assets/6886562a-5ff6-44c1-af17-faf84b35f0b2

## Extensions

| Directory | Extension |
| --- | --- |
| [`change-video-playback-speed/`](change-video-playback-speed/) | Change Video Playback Speed: cycle video and audio playback speed from the toolbar or a keyboard shortcut. |
| [`clear-browsing-data-except-kept-sites/`](clear-browsing-data-except-kept-sites/) | Clear Browsing Data Except Kept Sites: clear history, cookies, and site data on browser startup for every site not on your keep list. |
| [`enable-copy-and-right-click/`](enable-copy-and-right-click/) | Enable Copy and Right Click: restore copying, text selection, and right-click menus on restricted pages. |
| [`hmj-sms-desktop-sync/`](hmj-sms-desktop-sync/) | HMJ SMS Desktop Sync: end-to-end encrypted SMS and OTP notifications from an Android phone. |
| [`three-finger-tap-to-close-tab/`](three-finger-tap-to-close-tab/) | Three Finger Tap to Close Tab: close the current tab with a three-finger tap or middle click. |

## Build

`build.sh` needs Bash and `zip` (on Debian or Ubuntu: `sudo apt install zip`). It writes each extension's packages to that extension's `dist/` directory, named `<extension-name>-<browser>-v<version>.zip` after the manifest's `name` and `version`, made safe for filenames. The Chrome and Edge packages come from `manifest.json`. The Firefox package comes from `manifest-firefox.json`, which goes into the package as `manifest.json`, and is only built when that file exists.

```bash
./build.sh                                                            # every top-level directory that contains manifest.json
./build.sh change-video-playback-speed three-finger-tap-to-close-tab  # only these extensions
```

Paths are relative to where you run the script, so `../build.sh .` works from inside an extension directory. The output looks like this:

```text
Build complete: change-video-playback-speed

  change-video-playback-speed/dist/change-video-playback-speed-chrome-v<version>.zip
  change-video-playback-speed/dist/change-video-playback-speed-edge-v<version>.zip
  change-video-playback-speed/dist/change-video-playback-speed-firefox-v<version>.zip
```

Each build starts by deleting and recreating the extension's `dist/` directory, which Git ignores. The packages are staged in temporary directories inside it, removed once the build finishes. If one extension fails to build, the script stops there.

## Extension Layout

An extension directory must have this structure to be built:

```text
<extension>/
├── manifest.json            for Chromium-based browsers
├── manifest-firefox.json    for Firefox (optional)
├── _locales/                translations (optional)
├── icons/
├── options/
└── src/
```

A package holds `manifest.json`, `icons/`, `options/`, `src/`, and `_locales/` if the extension has one. In the Firefox package, `_locales/no` becomes `_locales/nb`: Chrome calls Norwegian Bokmål `no`, while Firefox looks for `nb-NO` and then `nb` and would never find `no`. If `options/placeholder` exists, `options/` is left out of the package; that lets an extension without a settings page keep the required folder. Everything else in the extension directory, such as `README.md`, `store-assets/`, and `tests/`, stays out of the package.

An extension with `_locales/` sets `default_locale` in both manifests. The manifest tests then check that every `__MSG_name__` in a manifest is defined, that each message declares the placeholders it uses, and that the other languages translate only messages the default language has. Keep the manifest's `name` a plain string rather than a message, because `build.sh` names the packages after it. Each extension's `tests/locales.spec.js` runs the shared checks in `test-support/locales.js`: every message the code asks for exists, every message is used, the name is never translated, every Chrome Web Store language translates every message, counted messages have each plural form their language uses, and every description fits within the 132 characters Chrome allows.

## Store Listings

Each store's English listing is in `store-assets/<browser>/<browser>.txt`. The translations are in `store-assets/store-descriptions/<language>/`, with the language named as in `_locales/`: `chrome.txt` and `edge.txt` for every Chrome Web Store language, and `firefox.txt` for every language AMO lists add-ons in. Nine languages exist only on AMO and so have only a `firefox.txt`: Lower Sorbian (`dsb`), Friulian (`fur`), Frisian (`fy`), Upper Sorbian (`hsb`), Interlingua (`ia`), Georgian (`ka`), Kabyle (`kab`), Norwegian Nynorsk (`nn`), and Albanian (`sq`). Every listing begins with the translated description.

AMO's language codes use a hyphen, as in `pt-BR` and `zh-CN`, and some carry a region. When pasting a listing there, use `es-ES` for `es`; `es-AR`, `es-CL`, and `es-MX` for `es_419`; `nb-NO` for `no`; `nn-NO` for `nn`; `sv-SE` for `sv`; and `fy-NL` for `fy`.

## Firefox File Variants

Besides a separate manifest, some extensions need source files that differ in Firefox. For these, add a variant file named `*-firefox.*` next to the original, under `src/` or `options/` only. For example:

```text
src/
  background.js
  background-firefox.js
  nested/
    helper.js
    helper-firefox.js
```

In the Firefox package, `background-firefox.js` takes the place of `background.js`, and `nested/helper-firefox.js` the place of `nested/helper.js`. The paths in the manifest stay the same; only the contents of the packaged files change. No package contains a `*-firefox.*` file under its own name: Chrome and Edge get the original files, and Firefox gets the variants under the original names. An extension without variant files is unaffected, and all three packages are built from the same source tree.

Every extension that ships to Firefox uses one such variant to call the browser's own API namespace. `src/extension-api.js` sets `globalThis.extensionApi = chrome`, `src/extension-api-firefox.js` sets it to `browser`, and the rest of the code only ever calls `extensionApi.*`. Content scripts list `extension-api.js` before their own files, and modules import it first. `sources.spec.js`, the manifest specs, and `check.sh` all fail on any other use of `chrome.` or `browser.`.

A file that only Chrome and Edge use can be kept out of the Firefox package by listing it in `firefox-exclude.txt` in the extension directory, one path per line as it appears in the package, such as `src/offscreen.js`. Lines starting with `#` are comments. The build stops if a listed path is not in the package, and the manifest tests fail if the Firefox manifest still loads a listed file.

## Test

Each extension keeps Playwright tests in its `tests/` directory. They load the unpacked extension into Chromium and use it the way a person would: clicking the toolbar button on pages and frames the tests serve, opening the settings and popup pages, and working with real storage, history, cookies, and Web Push messages.

Whatever a test browser cannot reach runs in an ordinary page against fake extension APIs instead, defined in each extension's `tests/fake-chrome.js` on top of the shared parts in `test-support/fake-chrome.js`. The extension's own source files load unchanged. This covers browser startup, keyboard shortcuts, Firefox-only APIs such as containers, and the background code of `hmj-sms-desktop-sync/`.

Every extension also checks its manifests: that `manifest.json` and `manifest-firefox.json`, where there is one, agree with each other; that the Firefox manifest declares Firefox for Android support with `gecko_android`; and that every file they refer to exists, including Firefox variants, the scripts and stylesheets the HTML pages load, and the modules the scripts import. All manifests give extension pages the same content security policy: scripts from the package only, no plugins, no `<base>`, and no form that navigates.

Each extension with pages of its own has a `tests/accessibility.spec.js`. There, `toMatchAriaSnapshot()` pins down what screen readers get in each state, and `tabThrough()` from `test-support/keyboard.js` walks the page using Tab alone, checking the order of stops, that each stop shows a focus outline, and that an open dialog keeps the focus inside it.

The tests need Node.js and Playwright with Chromium and Firefox. Run them from the repository root:

```bash
npx playwright test                                                   # every test
npx playwright test change-video-playback-speed hmj-sms-desktop-sync  # the tests of these extensions
```

`test-support/tests/sources.spec.js` is the repository's lint. It reads every source file and fails on suppression comments, skipped or expected-to-fail tests, fixed waits, HTML or code built from strings, blocking dialogs, `var`, `console.log`, event handler properties and attributes, inline styles and scripts, and empty `catch` blocks without a comment saying why. It also checks that every shipped script parses. No file is exempt.

### Screenshots

Some tests compare what an extension draws, on a web page or on its own settings page or popup, with a baseline image. On the desktop they use `toHaveScreenshot()`; in Firefox for Android they use `toMatchSnapshot()` on an element that `Tab.screenshot()` captures from the page alone. On the desktop, `openExtensionPage()` in `test-support/visual.js` renders an extension's pages in Chromium and Firefox as ordinary pages against fake extension APIs. In Firefox for Android, `showExtensionTab()` shows them from the installed extension. The baselines are PNG files committed in a `<test file>-snapshots/` directory next to the test, named after the screenshot, the Playwright project, and the platform.

When a screenshot differs from its baseline, the test fails and leaves the expected, actual, and diff images in `test-results/`. If the change is intended, look at those images and then write new baselines for the tests that ran:

```bash
npx playwright test change-video-playback-speed --update-snapshots
FIREFOX_ANDROID_DEVICE=<serial> npx playwright test change-video-playback-speed --project=firefox-android --update-snapshots
```

Fonts and rendering differ from machine to machine, so a baseline belongs to the machine that made it. A Firefox for Android baseline also belongs to the device. A screenshot's size follows the pixel density of the display it is taken on, so once Firefox has started, the tests move its window to the device's built-in screen, where it might otherwise open on an external monitor on ChromeOS.

### Desktop Firefox

Playwright's Firefox cannot load extensions, so the tests in an extension's `tests/firefox/` directory go through `test-support/firefox-desktop.js` instead. It builds the Firefox package, starts Playwright's Firefox as a plain headless Firefox with a profile of its own, installs the package as a temporary add-on, and drives it over the Remote Debugging Protocol. These tests run alongside the other desktop tests and touch nothing outside the test output directory.

### Firefox for Android

The tests in each extension's `tests/android/` directory run its Firefox package in Firefox for Android, on a phone, tablet, or emulator connected over adb. The package is built with `build.sh` from a copy of the extension, installed as a temporary add-on with `web-ext run`, and driven through Firefox's remote debugging connection. They run on the device named by `FIREFOX_ANDROID_DEVICE`. When that is not set, they look for `arc:5555`, the Android container on ChromeOS, and use it if `adb devices` lists it. Otherwise they do not run, so on a machine without that container a plain `npx playwright test` never touches a device. To skip a connected container, set `FIREFOX_ANDROID_DEVICE` to an empty string.

Use a Firefox installed for testing and nothing else. The tests run in its profile, closing every tab and clearing all cookies there. While they run, Firefox sends every `http://` request to the test server and HTTPS-Only mode is off. Both go back to normal afterwards. They need adb with the device showing in `adb devices`, `web-ext` on the `PATH`, Firefox for Android with **Remote debugging via USB** turned on in its settings, `unzip`, and whatever `build.sh` needs.

```bash
FIREFOX_ANDROID_DEVICE=<serial> npx playwright test --project=firefox-android
```

`<serial>` is the device as `adb devices` lists it, such as `emulator-5554` or `192.168.1.20:5555`. The tests use Firefox Nightly (`org.mozilla.fenix`) unless `FIREFOX_ANDROID_APK` names another Firefox package, and `ADB` can point to an adb that is not on the `PATH`.

An extension's tests share one Firefox and run one at a time. Before each test, every tab is closed, and cookies, extension storage, and any host permissions a test granted are cleared. Unlike on the desktop, nothing else is reset between tests.

Test pages come from a server inside the test process, reached through `adb reverse` and Firefox's proxy settings, so any `http://*.test` address works. Pages open in a new tab, the way a link from another app would. Since adb cannot send a middle click, `Tab.click()` presses one through Firefox's `windowUtils.sendNativeMouseEvent()`, which pages see as a real click, and the toolbar button is pressed through Firefox's own handler for it. A `confirm()`, `alert()`, or permission prompt is answered from within the page.

#### Device Changes

When Firefox for Android is the device's debug app, it reads extra startup preferences from `/data/local/tmp/<package>-geckoview-config.yaml`. A run therefore pushes that file and makes Firefox the debug app. It also adds adb forwards, an adb reverse, and the `web-ext-artifacts-*` directories that `web-ext` creates. All of this is undone when the run ends, and the next run cleans up after one that was killed. To undo the first two by hand for Firefox Nightly:

```bash
adb shell rm /data/local/tmp/org.mozilla.fenix-geckoview-config.yaml
adb shell am clear-debug-app
```

## Checks and Releases

The tests run by hand on the machine that holds the screenshot baselines, not on GitHub. Before merging a branch or publishing a release, run `check.sh` on the committed tree:

```bash
./check.sh                                  # every extension, with Firefox for Android on arc:5555 if connected
FIREFOX_ANDROID_DEVICE=<serial> ./check.sh  # every extension, with Firefox for Android on <serial>
./check.sh hmj-sms-desktop-sync             # only this extension
```

It refuses to run on a tree with uncommitted changes or untracked files. It then builds the packages, checks each changelog, runs `web-ext lint` on each Firefox package, runs the tests, and finishes by naming the commit it checked. Lint fails on any error, warning, or notice. Besides what `build.sh` and the tests need, it needs `web-ext` on the `PATH`.

Each extension keeps a `CHANGELOG.md` in the [Keep a Changelog](https://keepachangelog.com/) format: one `## [<version>] - <date>` section per version, newest first, with `### New Features`, `### Changes`, and `### Bug Fixes` lists. Note anything people will notice under `## [Unreleased]`, and move those notes into a new version section when you bump the version in both manifests. `./release-notes.sh <extension>` prints the section for the version in `manifest.json` and fails if there is none.

After every push to `main`, the Draft releases workflow drafts a GitHub release for each extension version that has not been released yet, with the tag `<extension>-v<version>`, the packages, and the changelog section as the notes. Each push replaces the extension's existing drafts, so fix the notes in `CHANGELOG.md` rather than in the draft. Publishing a draft creates its tag, and that version is never drafted again, so an extension whose version has not changed gets no new draft. When publishing, untick **Set as the latest release**: with five extensions, no single release is the latest.

## License

This project is licensed under the [MIT License](LICENSE).
