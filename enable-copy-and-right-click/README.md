# Enable Copy and Right Click

A lightweight browser extension for re-enabling copying, text selection, and right-click menus on restricted webpages.

The extension is designed to be simple, fast, private, and predictable. It supports one-click activation for the current tab and optional automatic activation on user-selected sites.

<a href="https://chromewebstore.google.com/detail/enable-copy-and-right-cli/gnampfpejlalfeddnekcfcdmpjacoojm" rel="noopener noreferrer"><img src="https://developer.chrome.com/static/docs/webstore/branding/image/UV4C4ybeBTsZt43U4xis.png" alt="Available in the Chrome Web Store"></a>
<a href="https://microsoftedge.microsoft.com/addons/detail/dcnpbiiiglpgpgpenonpdfhponjbcdkd" rel="noopener noreferrer"><img src="https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/add-ons-badge-images/microsoft-edge-add-ons-badge.png" alt="Get it from Microsoft Edge"></a>
<a href="https://addons.mozilla.org/en-US/firefox/addon/enable-copy-and-right-click/" rel="noopener noreferrer"><img src="https://blog.mozilla.org/addons/files/2015/11/get-the-addon.png" alt="Get the add-on"></a>

▶ [Watch the 42-second video on YouTube](https://www.youtube.com/watch?v=1QVVsUw3LLA)

## Supported Browsers

Google Chrome, Microsoft Edge, and Mozilla Firefox, each on Windows, macOS, Linux, ChromeOS, GooglebookOS, and Android. Chrome and Edge use the Chromium manifest. Firefox uses a separate manifest for browser-specific background execution and add-on metadata. The JavaScript source code is shared across all supported browsers.

## Features

* Enable right click on pages that block the context menu
* Enable copy, cut, paste, text selection, and drag start events
* Use a toolbar click to enable the current tab
* Use a keyboard shortcut to enable the current tab
* Add automatic sites from the options page
* Run automatic site activation at `document_start`
* Support accessible iframes where browser permissions allow script injection
* Show an `ON` toolbar badge after manual activation
* Handle rapid repeated actions sequentially per tab
* Use optional host permissions only for automatic sites
* No analytics or tracking
* No remote code
* No network requests

## Usage

### Toolbar and Keyboard Shortcut

Click the extension icon, or press the keyboard shortcut, to enable copying, text selection, and right click on the current tab. The shortcut performs exactly the same action as clicking the icon. Manual activation uses `activeTab`, so the extension gets temporary access only after the user invokes it.

Chrome and Edge keep a new extension's icon in their Extensions menu; pin it there to keep it on the toolbar. Firefox puts the icon on the toolbar when the extension is first installed.

| Operating System | Chrome and Edge | Firefox |
| ---------------- | --------------- | ------- |
| Windows, Linux, ChromeOS, GooglebookOS, and Android | `Alt+C` | `Alt+C` |
| macOS | `Command+Shift+Y` | `Command+Shift+Y` |

Users can change the shortcut at any time through their browser's extension keyboard shortcut settings.

After successful manual activation, the extension displays `ON` in the toolbar badge for that tab. The badge is cleared when the tab starts loading a new page.

### Automatic Sites

Open the extension options page and add a domain such as `example.com`. The browser asks for host permission for that domain. The extension stores the domain locally and registers a content script for automatic activation on that site. Only normal domain names are supported. IP addresses and `localhost` are intentionally not supported by the automatic site list.

To open the options page in Chrome and Edge, right-click the extension icon and select **Options**. In Firefox, open `about:addons`, select **Extensions**, open the three-dot menu next to **Enable Copy and Right Click**, and select **Preferences**.

### Removing Automatic Sites

Removing a site from the options page removes the domain from local extension storage, updates the registered automatic content script, and removes the active optional host permission through the browser permissions API.

In Chrome, the extension details page may still show removed host patterns under "Automatically allow access on the following sites" with grey/off toggles. This is Chrome remembering previously granted optional site access; grey/off means the extension does not currently have access. The authoritative runtime check is `chrome.permissions.getAll()`, and no extension API can make Chrome delete those remembered rows from its settings UI.

## Project Structure

```text
enable-copy-and-right-click/
├── icons/           icon16.png, icon32.png, icon48.png, icon128.png
├── options/
│   ├── options.css
│   ├── options.html
│   └── options.js
├── src/
│   ├── background.js
│   ├── enable.js
│   └── site-utils.js
├── store-assets/
│   ├── chrome/      chrome.md and Chrome Web Store images
│   ├── edge/        edge.md and Edge Add-ons images
│   └── firefox/     firefox.md and the Firefox screenshots
├── tests/
│   ├── android/
│   │   ├── automatic-sites.spec.js
│   │   ├── enable.spec.js
│   │   ├── visual.spec.js
│   │   └── visual.spec.js-snapshots/
│   ├── automatic-sites.spec.js
│   ├── command.spec.js
│   ├── enable.spec.js
│   ├── fake-chrome.js
│   ├── manifest.spec.js
│   ├── site-utils.spec.js
│   ├── visual.spec.js
│   └── visual.spec.js-snapshots/
├── manifest.json
├── manifest-firefox.json
└── README.md
```

* `manifest.json`: extension metadata, permissions, service worker, toolbar action, keyboard command, and options page for Chrome and Edge. The service worker uses ES modules.
* `manifest-firefox.json`: the Firefox-specific configuration, with the same permissions, source files, options page, and functionality.
* `src/background.js`: handles toolbar clicks, keyboard shortcut commands, active-tab lookup for keyboard commands, per-tab operation queues, automatic-site content-script registration, and permission synchronization. The queue processes rapid manual actions sequentially within a tab while different tabs operate independently.
* `src/enable.js`: the content script that restores page interactions. It clears common inline event handlers, captures blocking events before page listeners, and injects a small style rule to restore text selection. It is idempotent, so repeated manual activation does not add duplicate handlers or styles.
* `src/site-utils.js`: normalizes user-entered domains, validates automatic-site entries, sanitizes stored site lists, and converts domains into browser host permission patterns.
* `options/`: the options page for adding and removing automatic sites. It uses local browser extension APIs only and does not load external assets.
* `store-assets/`: browser-store listing text and images. They are not included in the distribution packages.
* `tests/`: Playwright tests. The `*-snapshots/` folders hold baseline screenshots of the options page in Chromium, Firefox, and Firefox for Android; see [Screenshots](../README.md#screenshots) in the monorepo README.

## Permissions

* `activeTab`: temporary access to the active tab after the user invokes the extension from the toolbar or keyboard shortcut. This is used for manual activation.
* `scripting`: executes the content script in the user-invoked tab and in registered automatic-site matches.
* `storage`: stores the automatic site list locally in the browser.
* `optional_host_permissions` for `http://*/*` and `https://*/*`: requested for a single site only when the user adds it for automatic activation. None are granted at install time.

## Privacy

The extension does not collect user data or browsing history, use analytics or tracking, make network requests, use remote code, or load external JavaScript. It stores automatic-site preferences locally in `chrome.storage.local` and requests optional host permissions only after user action.

All copy and right-click restoration happens locally in the browser.

## Performance and Security

The extension is event-driven and performs no continuous background work while idle. Manual activation runs only after a toolbar click or keyboard shortcut. Automatic activation runs only on user-added sites through browser-registered content scripts. There is no polling, `setInterval`, background network activity, analytics SDK, remote configuration, or persistent page monitoring loop.

It follows a minimal-capability approach and avoids remote code, external dependencies, web-accessible resources, native messaging, broad install-time host permissions, and unnecessary network access. Automatic-site input is normalized and validated before permission requests are made.

## Build

From the monorepo root, run:

```bash
./build.sh enable-copy-and-right-click
```

This writes Chrome, Edge, and Firefox ZIP files to `dist/`. For requirements and details about the shared build process, see the [monorepo README](../README.md#build).

## Development Install

**Chrome and Edge:** open `chrome://extensions` or `edge://extensions`, enable Developer mode, choose "Load unpacked", and select this project directory.

**Firefox:** the extension directory itself loads as the Chromium version, so build the Firefox package first (see [Build](#build)). Open `about:debugging#/runtime/this-firefox`, choose "Load Temporary Add-on", and select `dist/enable-copy-and-right-click-firefox-v<version>.zip`.

## Known Limitations

* Browser-protected pages do not allow extension script injection.
* Some embedded cross-origin frames may not be accessible because of browser security restrictions.
* Some websites may reapply blocking behavior after the extension runs.
* Automatic sites require user-granted optional host permissions.
* Chrome may continue showing removed host patterns as grey/off remembered rows in extension settings.

## Design Philosophy

> Restore normal page interactions quickly, without tracking, remote code, or install-time access to every website.

The extension favors explicit user actions, local-only behavior, limited permissions, and predictable automatic-site controls.

## License

This project is licensed under the [MIT License](../LICENSE).
