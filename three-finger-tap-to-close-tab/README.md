# Three Finger Tap to Close Tab

A lightweight browser extension for quickly closing the current tab with
a three-finger tap, middle click, or toolbar click. The extension is
designed to be simple, fast, private, and predictable. It has no popup,
no settings page, no analytics, no tracking, and no unnecessary browser
permissions.

<a href="https://chromewebstore.google.com/detail/three-finger-tap-to-close/gghapcpoaemlejgeamgmelhnfdllamcm" rel="noopener noreferrer"><img src="https://developer.chrome.com/static/docs/webstore/branding/image/UV4C4ybeBTsZt43U4xis.png" alt="Available in the Chrome Web Store"></a>
<a href="https://microsoftedge.microsoft.com/addons/detail/three-finger-tap-to-close/ghdidknoepfeijgnjfkgebohjecfhnob" rel="noopener noreferrer"><img src="https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/add-ons-badge-images/microsoft-edge-add-ons-badge.png" alt="Get it from Microsoft Edge"></a>
<a href="https://addons.mozilla.org/en-US/firefox/addon/three-finger-tap-close-tab/" rel="noopener noreferrer"><img src="https://blog.mozilla.org/addons/files/2015/11/get-the-addon.png" alt="Get the add-on"></a>

▶ [Watch the 38-second video on YouTube](https://www.youtube.com/watch?v=SNpCBOL_JhU)

## Supported Browsers

Google Chrome, Microsoft Edge, and Mozilla Firefox, each on Windows,
macOS, Linux, ChromeOS, GooglebookOS, and Android. Chrome and Edge use
the Chromium manifest. Firefox uses a separate manifest for
browser-specific background execution and add-on metadata. The
JavaScript source code is shared across all supported browsers.

## Features

-   Close the current tab with a three-finger tap, middle click, or
    toolbar click
-   Preserve normal middle-click behavior on links and controls
-   Avoid closing tabs while interacting with interactive controls
-   Support event detection through Shadow DOM event paths
-   No popup, settings page, storage, or browsing-history collection
-   No network requests, analytics, or tracking
-   Description in the browser's language, for every Chrome Web Store one

## Usage

-   **Three-finger tap** on a webpage outside links, buttons, and
    editable fields to close the current tab. The touchpad and
    operating system must be configured so that a three-finger tap
    generates a middle click.
-   **Middle-click** on a webpage outside links, buttons, and editable
    fields to close the current tab. Middle-clicking a link or
    interactive control preserves the browser's normal behavior instead.
-   **Click the extension icon** to close the current tab. In Chrome
    and Edge, pin it in the Extensions menu to keep it on the toolbar;
    Firefox puts it on the toolbar when the extension is installed.
-   **In Firefox for Android**, tap the extension in the browser's
    Extensions menu to close the current tab. All of these close it
    the same way.

## Project Structure

``` text
three-finger-tap-to-close-tab/
├── _locales/        <language>/messages.json: the description, one per Chrome Web Store language
├── icons/           icon16.png, icon32.png, icon48.png, icon128.png
├── options/
│   └── placeholder
├── src/
│   ├── background.js
│   └── content.js
├── store-assets/
│   ├── chrome/      chrome.txt and Chrome Web Store images
│   ├── edge/        edge.txt and Edge Add-ons images
│   ├── firefox/     firefox.txt and the Firefox screenshots
│   └── store-descriptions/<language>/  the listings translated
├── tests/
│   ├── android/
│   │   └── close-tab.spec.js
│   ├── close-tab.spec.js
│   ├── locales.spec.js
│   └── manifest.spec.js
├── manifest.json
├── manifest-firefox.json
└── README.md
```

-   `manifest.json`: extension metadata, content script, background
    service worker, and toolbar action for Chrome and Edge. The content
    script runs on supported webpages so it can detect middle clicks
    from a mouse or a touchpad three-finger tap.
-   `manifest-firefox.json`: the Firefox-specific configuration, with
    the same source files and functionality. Firefox uses
    `background.scripts` for background execution.
-   `src/background.js`: closes the sender tab on a content-script
    request, or the toolbar action's tab on an icon click.
-   `src/content.js`: listens for auxiliary click events, ignores
    buttons other than the middle mouse button, prevents a handled
    event from continuing, and asks the background script to close the
    tab.
-   `options/placeholder`: keeps the required directory; no options page.
-   `store-assets/`: store listing texts and images, not packaged, with
    [translated listings](../README.md#store-listings) in `store-descriptions/`.
-   `tests/`: Playwright tests, with the Firefox for Android ones in `tests/android/`.

## Interactive Elements

The extension avoids closing the current tab when the interaction occurs
within supported interactive elements:

-   Links and map areas (`a[href]`, `area[href]`)
-   Form controls (`button`, `input`, `textarea`, `select`)
-   Disclosure controls (`summary`, `details`)
-   Dialogs and modals (`dialog`, `[role="dialog"]`, `[role="alertdialog"]`)
-   Interactive viewports and media (`canvas`, `audio[controls]`, `video[controls]`)
-   Editable content regions (`[contenteditable]`)
-   Keyboard-focusable custom controls (`[tabindex]:not([tabindex="-1"])`)
-   ARIA widget roles (`button`, `link`, `textbox`, `searchbox`, `checkbox`, `radio`, `switch`, `slider`, `spinbutton`, `combobox`, `menuitem`, `menuitemcheckbox`, `menuitemradio`, `tab`, `treeitem`, `option`)
-   Articles and feed items (`article[role="article"]`)

A proximity safety buffer around interactive elements prevents
accidental tab closures when a tap lands slightly outside a target.
The check uses the event's composed path rather than only the direct
target, which improves detection on websites that use Shadow DOM.

## Permissions, Privacy, and Security

The extension requests no `permissions`. The content script matches all
webpages because a three-finger tap or middle click can only be
detected where its listener is present. This access is not used to
collect, store, transmit, or analyze webpage content.

The extension does not collect user data or browsing history, use
analytics or tracking, make network requests, store browsing activity or
per-site preferences, use remote code, or load external JavaScript. All
tab-closing operations happen locally in the browser.

The extension is event-driven and does no work while idle: no polling,
`setInterval`, `MutationObserver`, page scanning, or background network
activity. The content script registers a single event listener and
sends only a fixed tab-close message. It also uses no external
dependencies, advertising SDKs, remote configuration, or native messaging.

## Build

From the monorepo root, run:

``` bash
./build.sh three-finger-tap-to-close-tab
```

This writes Chrome, Edge, and Firefox ZIP files to `dist/`. For
requirements and details about the shared build process, see the
[monorepo README](../README.md#build).

## Known Limitations

-   Browser-protected pages, other restricted pages, and browser
    interfaces outside webpage content do not run content scripts.
-   A three-finger tap and a physical middle click are the same
    middle-button event to the browser, so the extension cannot tell
    them apart.
-   Middle-clicking a link keeps the browser's default behavior, so a
    three-finger tap directly on a link may open it in a new tab
    instead of closing the current tab.
-   In Firefox for Android, a touchscreen tap is not a middle click,
    but a touchpad three-finger tap and a mouse middle click are.

## License

This project is licensed under the [MIT License](../LICENSE).
