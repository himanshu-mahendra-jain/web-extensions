# Change Video Playback Speed

A lightweight browser extension for quickly changing video and audio playback speed with a toolbar click or keyboard shortcut.

The extension is designed to be simple, fast, private, and predictable. It has no popup, no floating controller, no settings page, no analytics, and no broad website access.

<a href="https://chromewebstore.google.com/detail/change-video-playback-spe/bennolgojnfnlnckehpkjljdlebchjmb" rel="noopener noreferrer"><img src="https://developer.chrome.com/static/docs/webstore/branding/image/UV4C4ybeBTsZt43U4xis.png" alt="Available in the Chrome Web Store"></a>
<a href="https://microsoftedge.microsoft.com/addons/detail/hdppmackgjnhnjhnoncehnfiljjeaeam" rel="noopener noreferrer"><img src="https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/add-ons-badge-images/microsoft-edge-add-ons-badge.png" alt="Get it from Microsoft Edge"></a>
<a href="https://addons.mozilla.org/en-US/firefox/addon/change-video-playback-speed/" rel="noopener noreferrer"><img src="https://blog.mozilla.org/addons/files/2015/11/get-the-addon.png" alt="Get the add-on"></a>

▶ [Watch the 45-second video on YouTube](https://www.youtube.com/watch?v=OSOUU5dIDgI)

## Supported Browsers

Google Chrome, Microsoft Edge, and Mozilla Firefox, each on Windows, macOS, Linux, ChromeOS, GooglebookOS, and Android. Chrome and Edge use the Chromium manifest. Firefox uses a separate manifest for browser-specific background execution, keyboard shortcuts, and add-on metadata. The JavaScript source code is shared across all supported browsers.

## Features

* Cycle playback speed with one toolbar click
* Use a keyboard shortcut to change speed
* Synchronize video and audio elements to the same playback speed
* Support media in accessible iframes
* Show a temporary on-page speed indicator, also over fullscreen players
* Show the selected speed in the extension toolbar badge
* Handle rapid repeated actions sequentially per tab
* No persistent background monitoring
* No storage or browsing-history collection
* No network requests
* No analytics or tracking

## Playback Speed Cycle

The extension cycles through the following speeds:

```text
1x → 1.2x → 1.5x → 2x → 1x
```

If the current playback rate is not one of the configured values, the extension selects the next higher configured speed, for example `1.1x → 1.2x`, `1.3x → 1.5x`, `1.75x → 2x`, and `2.5x → 1x`.

## Usage

Click the extension icon, or press the keyboard shortcut, to move to the next playback speed. The shortcut performs exactly the same action as clicking the icon.

Chrome and Edge keep a new extension's icon in their Extensions menu; pin it there to keep it on the toolbar. Firefox puts the icon on the toolbar when the extension is first installed.

| Operating System | Chrome and Edge | Firefox |
| ---------------- | --------------- | ------- |
| Windows, Linux, ChromeOS, GooglebookOS, and Android | `Alt+S` | `Ctrl+Shift+Period` |
| macOS | `Command+Shift+Period` | `Command+Shift+Period` |

Users can change the shortcut at any time through their browser's extension keyboard shortcut settings.

## Project Structure

```text
change-video-playback-speed/
├── icons/           icon16.png, icon32.png, icon48.png, icon128.png
├── options/
│   └── placeholder
├── src/
│   ├── background.js
│   ├── playback.js
│   └── page.js
├── store-assets/
│   ├── chrome/      chrome.md and Chrome Web Store images
│   ├── edge/        edge.md and Edge Add-ons images
│   └── firefox/     firefox.md and the Firefox screenshot
├── tests/
│   ├── android/
│   │   ├── playback.spec.js
│   │   ├── visual.spec.js
│   │   └── visual.spec.js-snapshots/
│   ├── command.spec.js
│   ├── fake-chrome.js
│   ├── manifest.spec.js
│   ├── media.js
│   ├── page.spec.js
│   ├── playback.spec.js
│   ├── visual.spec.js
│   └── visual.spec.js-snapshots/
├── manifest.json
├── manifest-firefox.json
└── README.md
```

* `manifest.json`: extension metadata, permissions, service worker, toolbar action, and keyboard command for Chrome and Edge. The service worker uses ES modules.
* `manifest-firefox.json`: the Firefox-specific configuration, with the same permissions, source files, and functionality.
* `src/background.js`: handles toolbar clicks, keyboard shortcut commands, active-tab lookup for keyboard commands, and per-tab operation queues. The queue processes rapid actions sequentially within a tab while different tabs operate independently.
* `src/playback.js`: coordinates the two-pass playback-speed workflow, first inspecting accessible frames, then applying one synchronized speed to media across them.
* `src/page.js`: self-contained functions executed in webpage contexts to inspect media state and apply playback speed.
* `options/placeholder`: only keeps the required directory present. The extension does not provide an options page.
* `store-assets/`: browser-store listing text and promotional images. They are not included in the distribution packages.
* `tests/`: Playwright tests. The `*-snapshots/` folders hold baseline screenshots of the on-page indicator in Chromium, Firefox, and Firefox for Android; see [Screenshots](../README.md#screenshots) in the monorepo README.

Generated distribution packages are written to `dist/`, which is not tracked in Git.

## Iframe Handling

The extension uses a tab-level two-pass strategy for iframe support. The speed is calculated once and then applied consistently across accessible frames.

Some embedded frames may not be accessible because of browser security restrictions and the extension's intentionally limited permission model.

## Toolbar Badge and Speed Indicator

After changing playback speed, the extension displays the selected value (`1`, `1.2`, `1.5`, or `2`) in the toolbar badge. The badge is tab-specific.

Every successful playback-speed change also displays a temporary indicator in the center of the page. It appears only in the top frame, shows over fullscreen players, does not intercept pointer events, cannot be selected, uses a very high stacking order, and automatically disappears after one and a half seconds.

## Permissions

The extension requests only `activeTab` and `scripting`:

* `activeTab` provides temporary access to the active tab after the user invokes the extension. The extension does not request permanent access to all websites.
* `scripting` executes the media detection and playback-speed functions in the user-invoked tab and accessible frames.

## Privacy

The extension does not collect user data or browsing history, use analytics or tracking, make network requests, store playback history or per-site preferences, use remote code, load external JavaScript, or request broad host permissions.

All playback-speed operations happen locally in the browser.

## Performance and Security

The extension is event-driven and performs no continuous work while idle. There is no polling, `setInterval`, `MutationObserver`, persistent content script, automatic media monitoring, or background network activity. Work occurs only after a toolbar click or keyboard shortcut.

It follows a minimal-capability approach and intentionally avoids broad host permissions, remote code, external dependencies, analytics SDKs, advertising SDKs, remote configuration, web-accessible resources, unnecessary message listeners, native messaging, and persistent page monitoring. Playback speeds are validated before being applied to media elements.

## Build

From the monorepo root, run:

```bash
./build.sh change-video-playback-speed
```

This writes Chrome, Edge, and Firefox ZIP files to `dist/`. For requirements and details about the shared build process, see the [monorepo README](../README.md#build).

## Known Limitations

* Some browser-protected pages do not allow script injection.
* Some embedded cross-origin players may not be accessible under the extension's limited permission model.
* Websites may independently override playback speed after the extension applies it.
* The extension intentionally does not monitor pages continuously to reapply playback speed.

## Design Philosophy

> Change playback speed quickly, without menus, overlays, configuration, tracking, or permanent website access.

The extension favors explicit user actions, limited permissions, predictable behavior, and minimal background activity over automatic playback management.

## License

This project is licensed under the [MIT License](../LICENSE).
