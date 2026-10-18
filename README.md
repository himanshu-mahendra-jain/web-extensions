# Web Extensions

Monorepo for browser extensions and the shared build script that packages them into ready-to-upload ZIP files for Chrome, Microsoft Edge, and Firefox. The Firefox package also installs in Firefox for Android. HMJ SMS Desktop Sync ships for Chrome and Edge only, since Firefox gives extensions no Web Push.

## Extensions

| Directory | Extension |
| --- | --- |
| [`change-video-playback-speed/`](change-video-playback-speed/) | Change Video Playback Speed: cycle video and audio playback speed from the toolbar or a keyboard shortcut. |
| [`clear-browsing-data-except-kept-sites/`](clear-browsing-data-except-kept-sites/) | Clear Browsing Data Except Kept Sites: clear history, cookies, and site data on browser startup for every site not on your keep list. |
| [`enable-copy-and-right-click/`](enable-copy-and-right-click/) | Enable Copy and Right Click: restore copying, text selection, and right-click menus on restricted pages. |
| [`hmj-sms-desktop-sync/`](hmj-sms-desktop-sync/) | HMJ SMS Desktop Sync: end-to-end encrypted SMS and OTP notifications from an Android phone. |
| [`three-finger-tap-to-close-tab/`](three-finger-tap-to-close-tab/) | Three Finger Tap to Close Tab: close the current tab with a three-finger tap or middle click. |

## Build

`build.sh` needs Bash and `zip` (on Debian or Ubuntu, `sudo apt install zip`). It packages each extension into its own `dist/` directory as `<extension-name>-<browser>-v<version>.zip`, a filename-friendly form of each manifest's `name` and `version` fields. Chrome and Edge packages are built from `manifest.json`; Firefox is built from `manifest-firefox.json`, copied into the package as `manifest.json`, and only when that file exists.

```bash
./build.sh                                                            # every top-level directory that contains manifest.json
./build.sh change-video-playback-speed three-finger-tap-to-close-tab  # only these extensions
```

Extension directories are resolved relative to the current directory, so `../build.sh .` works from inside an extension. Example output:

```text
Build complete: change-video-playback-speed

  change-video-playback-speed/dist/change-video-playback-speed-chrome-v<version>.zip
  change-video-playback-speed/dist/change-video-playback-speed-edge-v<version>.zip
  change-video-playback-speed/dist/change-video-playback-speed-firefox-v<version>.zip
```

Each build removes and recreates the extension's `dist/` directory, which Git ignores, and stages the packages in temporary directories inside it that are removed when the build finishes. The build stops at the first extension that fails.

## Extension Layout

An extension directory must have this structure to be built:

```text
<extension>/
├── manifest.json            for Chromium-based browsers
├── manifest-firefox.json    for Firefox (optional)
├── icons/
├── options/
└── src/
```

The packages contain `manifest.json`, `icons/`, `options/`, and `src/`. If `options/placeholder` exists, `options/` is left out, for extensions that do not currently ship an options page but still keep the required folder in place. Other files in the extension directory, such as `README.md`, `store-assets/`, and `tests/`, are not packaged.

## Firefox File Variants

Some extensions need Firefox-specific source files in addition to a separate manifest. The build script supports this with optional variant files named `*-firefox.*`, under `src/` and `options/` only. Example:

```text
src/
  background.js
  background-firefox.js
  nested/
    helper.js
    helper-firefox.js
```

During the Firefox build, `background-firefox.js` is copied into the package as `background.js`, and `nested/helper-firefox.js` becomes `nested/helper.js`. Manifest paths stay the same; only the packaged file contents change. No package contains the `*-firefox.*` files themselves: Chrome and Edge keep the default files, and Firefox gets the variants' contents under the default names. Extensions without `*-firefox.*` files are unaffected, and all three packages are built from the same source files.

Every extension that ships to Firefox uses this to call each browser's own namespace: `src/extension-api.js` sets `globalThis.extensionApi = chrome` and `src/extension-api-firefox.js` sets it to `browser`, and the code calls only `extensionApi.*`. Content scripts list `extension-api.js` first and modules import it first; `sources.spec.js`, the manifest specs and `check.sh` fail on any other use of `chrome.` or `browser.`.

Files only Chrome and Edge use can be left out of the Firefox package by listing them in an optional `firefox-exclude.txt` in the extension directory: one path per line as it is in the package, such as `src/offscreen.js`, with `#` starting a comment. The build stops if a listed path is not in the package, and the manifest tests fail if Firefox still loads a listed file.

## Test

Each extension has Playwright tests in its `tests/` directory. They load the unpacked extension into Chromium and use it the way a person would: toolbar clicks on pages and frames served by the tests, the settings and popup pages, and real storage, history, cookies, and Web Push messages.

What a test browser cannot reach runs in a page against fake extension APIs instead (`tests/fake-chrome.js`, built on the shared parts in `test-support/fake-chrome.js`), with the extension's own source files loaded unchanged. This covers browser startup, keyboard shortcuts, Firefox-only APIs such as containers, and the background code of `hmj-sms-desktop-sync/`.

Every extension also checks that `manifest.json` and, where it has one, `manifest-firefox.json` agree, that the Firefox manifest declares Firefox for Android support with `gecko_android`, and that every file they reference exists, including Firefox variants, the scripts and stylesheets their HTML pages load, and the modules their scripts import. Every manifest gives extension pages the same content security policy: scripts from the package only, no plugins, no `<base>`, and no form that navigates.

Each extension with its own pages has `tests/accessibility.spec.js`: `toMatchAriaSnapshot()` pins what screen readers get in each state, and `tabThrough()` in `test-support/keyboard.js` walks a page with Tab alone, checking the order, a focus outline on every stop, and that an open dialog keeps the focus.

The tests need Node.js and Playwright with Chromium and Firefox. Run them from the repository root:

```bash
npx playwright test                                                   # every test
npx playwright test change-video-playback-speed hmj-sms-desktop-sync  # the tests of these extensions
```

`test-support/tests/sources.spec.js` is the repository's lint. It reads every source file and fails on suppression comments, skipped or expected-to-fail tests, fixed waits, HTML or code built from strings, blocking dialogs, `var`, `console.log`, event handler properties and attributes, inline styles and scripts, and empty catches with no comment saying why, and it checks that every shipped script parses. No file is exempt.

### Screenshots

Some tests compare what an extension draws, on a web page or on its own settings page or popup, with a baseline image: `toHaveScreenshot()` on the desktop, and `toMatchSnapshot()` on an element that `Tab.screenshot()` captures from the page alone in Firefox for Android. On the desktop, `openExtensionPage()` in `test-support/visual.js` draws an extension's own pages in Chromium and Firefox as ordinary pages against fake extension APIs; in Firefox for Android, `showExtensionTab()` shows them from the installed extension. Baselines are PNG files committed in `<test file>-snapshots/` next to the test, named after the screenshot, the Playwright project, and the platform.

When a screenshot differs from its baseline, the test fails and `test-results/` holds the expected, actual, and diff images. If the change is intended, check those images, then write new baselines for the tests that ran:

```bash
npx playwright test change-video-playback-speed --update-snapshots
FIREFOX_ANDROID_DEVICE=<serial> npx playwright test change-video-playback-speed --project=firefox-android --update-snapshots
```

Fonts and rendering differ between machines, so baselines belong to the machine that made them. For Firefox for Android they also belong to the device, and to the display Firefox was on, since a display's pixel density sets the screenshot's size.

### Desktop Firefox

Playwright's Firefox loads no extensions, so tests in an extension's `tests/firefox/` directory use `test-support/firefox-desktop.js`: it builds the Firefox package, starts Playwright's Firefox build as a plain headless Firefox with its own profile, installs the package as a temporary add-on, and drives it over the Remote Debugging Protocol. They run with the other desktop tests and touch nothing outside the test output directory.

### Firefox for Android

The tests in each extension's `tests/android/` directory run its Firefox package in Firefox for Android on a phone, tablet or emulator connected over adb. The package is built with `build.sh` from a copy of the extension, installed as a temporary add-on with `web-ext run`, and driven through Firefox's remote debugging connection. They run only when `FIREFOX_ANDROID_DEVICE` names the device, so a plain `npx playwright test` never touches one.

Use a Firefox installed for testing only. The tests run in its own profile and close every tab and clear all cookies there. While they run, Firefox sends all `http://` requests to the test server and HTTPS-Only is off; both go back to normal afterwards.

They need adb, with the device listed by `adb devices`; `web-ext` on the `PATH`; Firefox for Android with Remote debugging via USB turned on in its settings; `unzip`; and the requirements of `build.sh`.

```bash
FIREFOX_ANDROID_DEVICE=<serial> npx playwright test --project=firefox-android
```

`<serial>` is the device as `adb devices` lists it, such as `emulator-5554` or `192.168.1.20:5555`. Firefox Nightly (`org.mozilla.fenix`) is used unless `FIREFOX_ANDROID_APK` names another Firefox package, and `ADB` can point at an adb outside the `PATH`.

The tests of one extension share one Firefox, and run one at a time. Before each test, every tab is closed and cookies, extension storage, and host permissions a test granted are cleared. Unlike the desktop tests, nothing else is reset between tests.

Test pages come from a server in the test process, reached through `adb reverse` and Firefox's proxy settings, so any `http://*.test` address works. Pages open in a new tab as a link from another app would. adb cannot send a middle click, so `Tab.click()` presses one through Firefox's `windowUtils.sendNativeMouseEvent()`, which pages see as a real click; the toolbar button is pressed through Firefox's own handler for it. A `confirm()`, `alert()` or permission prompt is answered in the page.

#### Device Changes

Firefox for Android reads extra startup preferences from `/data/local/tmp/<package>-geckoview-config.yaml` when it is the device's debug app. A run therefore pushes that file and makes Firefox the debug app, and adds adb forwards, an adb reverse, and the `web-ext-artifacts-*` directories `web-ext` creates. All of this is undone after the run, and a run that was killed is cleaned up by the next one. To undo the first two by hand for Firefox Nightly:

```bash
adb shell rm /data/local/tmp/org.mozilla.fenix-geckoview-config.yaml
adb shell am clear-debug-app
```

## Checks and Releases

The tests run by hand on the machine that holds the screenshot baselines, not on GitHub. Before merging a branch or publishing a release, run `check.sh` on the committed tree:

```bash
FIREFOX_ANDROID_DEVICE=<serial> ./check.sh  # every extension, with Firefox for Android
./check.sh hmj-sms-desktop-sync             # only this extension
```

It refuses a tree with uncommitted changes or untracked files. It then builds the packages, checks each changelog, runs `web-ext lint` on each Firefox package, and runs the tests, and ends by naming the commit it checked. Lint fails on any error, warning, or notice. It needs `web-ext` on the `PATH` besides the requirements of `build.sh` and the tests.

Each extension keeps a `CHANGELOG.md` in the [Keep a Changelog](https://keepachangelog.com/) format: a `## [<version>] - <date>` section for each version, newest first, with `### New Features`, `### Changes`, and `### Bug Fixes` lists. Note changes people will notice under `## [Unreleased]`, and move them to a new version section when you change the version in both manifests. `./release-notes.sh <extension>` prints the section for the version in `manifest.json`, and fails if there is none.

After each push to `main`, the Draft releases workflow drafts a GitHub release for every extension version not yet released: tag `<extension>-v<version>`, its packages, and the changelog section as notes. It replaces the extension's drafts on every push, so correct the notes in `CHANGELOG.md` rather than in the draft. Publishing a draft creates its tag, and that version is not drafted again, so an extension whose version did not change gets no new draft. When publishing, untick **Set as the latest release**: with five extensions, no single release is the latest.

## License

This project is licensed under the [MIT License](LICENSE).
