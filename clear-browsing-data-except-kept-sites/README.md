# Clear Browsing Data Except Kept Sites

A browser extension that clears browsing history, cookies, and site data for every site except the ones you choose to keep.

Add the sites you want to stay signed in to and remember on the settings page, then turn clearing on. Each time the browser starts, the extension removes the history entries, cookies, and site data of all other sites. You can also clear on demand from the settings page.

<a href="https://microsoftedge.microsoft.com/addons/detail/clear-browsing-data-excep/fknkfbjpdbiobbibjcpjkpeebbcgljlc" rel="noopener noreferrer"><img src="https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/add-ons-badge-images/microsoft-edge-add-ons-badge.png" alt="Get it from Microsoft Edge"></a>
<a href="https://addons.mozilla.org/en-US/firefox/addon/clear-browsing-data-except/" rel="noopener noreferrer"><img src="https://blog.mozilla.org/addons/files/2015/11/get-the-addon.png" alt="Get the add-on"></a>

▶ [Watch the 42-second video on YouTube](https://www.youtube.com/watch?v=t0ZZ6IDzdIU)

## Supported Browsers

Google Chrome, Microsoft Edge, and Mozilla Firefox, each on Windows, macOS, Linux, ChromeOS, GooglebookOS, and Android. Chrome and Edge use the Chromium manifest. Firefox uses a separate manifest for browser-specific background execution, add-on metadata, and container access. The JavaScript source code is shared across all supported browsers.

## Features

* Keep a list of sites whose history and cookies are never cleared, and import or export it as a text file
* Clear history and cookies for all other sites when the browser starts, once you turn it on
* Clear on demand with **Clear Now**, and in Chrome and Edge, clear the leftover site data of sites no longer found with **Clear Leftovers**
* Keep subdomains of a kept site automatically
* Keep the parent-domain cookies a kept site needs to stay signed in
* Clear partitioned (third-party) cookies and Firefox container cookies; a kept site's partitioned cookies are kept only under kept sites
* Clear the local storage, IndexedDB, service workers, and cache of sites that are not kept
* Show the result of the last clear on the settings page
* Warn when site access is turned off and cookies cannot be cleared
* No analytics, tracking, remote code, or network requests

## Usage

### Kept Sites

Open the settings page and add a domain such as `example.com`, or several separated by commas. A full URL such as `https://mail.example.com/inbox` is reduced to its domain, and a leading `www.` is dropped.

`localhost` and IPv4 addresses such as `192.168.1.1` are also accepted, so local development servers and router admin pages can stay signed in. **Export** saves the list as `kept-sites.txt`, one domain per line. **Import** replaces the list with the sites in a text file, one per line or separated by commas; when that drops sites that are kept now, it warns first. Files over 1 MB are refused.

The settings page opens automatically after installation, so the keep list can be filled in before clearing is turned on. Later, open it by clicking the extension icon in the toolbar, or in Firefox for Android by tapping the extension in the browser's Extensions menu. Chrome and Edge keep a new extension's icon in their Extensions menu; pin it there to keep it on the toolbar. Firefox puts the icon on the toolbar when the extension is first installed. The page is also available from the browser's extension settings: in Chrome and Edge, right-click the extension icon and select **Options**; in Firefox, open `about:addons`, select **Extensions**, open the three-dot menu next to **Clear Browsing Data Except Kept Sites**, and select **Preferences**.

### Clearing on Startup

Clearing is off after installation, so the extension removes nothing until you ask it to. While it is off, the settings page shows a **Clearing is off** notice with a **Turn On Clearing** button. Turning it on, with the button or the checkbox, first shows a warning: every startup deletes the history and cookies of all sites except the kept ones and signs you out of them, or of every site when none are kept.

Once on, clearing runs each time the browser starts. Browsers do not give extensions a chance to run when they close, so clearing at startup removes what the previous session left behind. Turn it off or on again with **Clear automatically when the browser starts** on the settings page.

### Clear Now

**Clear Now** on the settings page clears immediately. When no sites are kept, it first shows a red warning that everything will be deleted. The settings page shows when the last clear ran and how many history entries and cookies it deleted. Once a clear has removed a site's history and cookies, later clears no longer find it, so its site data stays (see [Site Data](#site-data)). In Chrome and Edge, **Clear Leftovers** runs a clear and then deletes the site data of every site except the kept ones, found or not. Chrome can spare only exact origins, so a kept site keeps its data only for the site itself and the kept origins the clear finds in history, cookies, and open tabs; another subdomain or port, such as a `localhost` server not in history, loses it. A red warning says so first. Firefox cannot clear all sites but some, so it does not offer the button.

## What Is Kept

| Kept site | History kept for | Cookies kept for |
| --- | --- | --- |
| `example.com` | `example.com`, `www.example.com`, `mail.example.com` | `example.com` and all its subdomains |
| `mail.example.com` | `mail.example.com` and its subdomains | `mail.example.com`, its subdomains, and the parent domain `example.com` |

Cookies set on a parent domain, such as `example.com`, are sent to the kept subdomain and often hold its sign-in, so they are kept too. History for other subdomains of the parent, such as `www.example.com`, is still cleared. A partitioned cookie, which an embedded site such as a YouTube video sets under the site that embeds it, is kept only when both its own domain and that site are kept; the site it is partitioned under counts as found for [Site Data](#site-data).

History entries that do not belong to a website, such as `file://` pages, are cleared.

### Site Data

Local storage, IndexedDB, service workers, and cache follow the history rule: they are kept for a kept site and all its subdomains. Browsers cannot be told to keep a site with its subdomains, so the extension names only the sites to clear: every site that is not kept and that the clear finds in history, cookies, or open tabs. Chrome and Edge clear those origins with their schemes and ports, and Firefox those hosts. No subdomain of a kept site is ever touched, even one the extension has never seen. Firefox clears a host's service workers together with its subdomains', so a host with a kept subdomain keeps its service workers. A site that is not kept and is found in none of these keeps its data, such as storage left from before the extension was installed. Firefox clears the whole cache, because it cannot clear cache by site; that signs no one out.

## Site Access

Cookies can only be read and removed for sites the extension has access to, so the extension asks for access to all `http` and `https` sites.

If site access is turned off or limited, for example with Chrome's **On click** site access setting or by revoking it in Firefox, history is still cleared but cookies are skipped. The settings page then shows a warning with an **Allow Site Access** button.

## Project Structure

```text
clear-browsing-data-except-kept-sites/
├── icons/           icon16.png, icon32.png, icon48.png, icon128.png
├── options/
│   ├── options.css
│   ├── options.html
│   └── options.js
├── src/
│   ├── background.js
│   ├── cleaner.js
│   └── site-utils.js
├── store-assets/
│   ├── chrome/      chrome.txt and Chrome Web Store images
│   ├── edge/        edge.txt and Edge Add-ons images
│   └── firefox/     firefox.txt and the Firefox screenshots
├── tests/
│   ├── android/
│   │   ├── clearing.spec.js
│   │   ├── visual.spec.js
│   │   └── visual.spec.js-snapshots/
│   ├── accessibility.spec.js
│   ├── background.spec.js
│   ├── cleaner.spec.js
│   ├── clearing.spec.js
│   ├── fake-chrome.js
│   ├── manifest.spec.js
│   ├── options.spec.js
│   ├── site-utils.spec.js
│   ├── visual.spec.js
│   └── visual.spec.js-snapshots/
├── manifest.json
├── manifest-firefox.json
└── README.md
```

* `manifest.json`: extension metadata, permissions, service worker, toolbar action, and settings page for Chrome and Edge. The service worker uses ES modules.
* `manifest-firefox.json`: the Firefox-specific configuration. It adds the `contextualIdentities` permission so container cookies can be cleared.
* `src/background.js`: runs a clear on browser startup when turned on, handles **Clear Now** and **Clear Leftovers** requests from the settings page, and opens the settings page on installation and toolbar clicks. Clears are queued, so two never run at the same time.
* `src/cleaner.js`: removes unkept history entries, cookies, and site data, and records the result. History is read with `history.search()` one page at a time, newest first. Unkept entries are deleted, which lets the next search reach older entries. When a page holds only kept entries, its time range is split in half, so kept entries cannot hide older ones. Cookies are read from the default cookie store, every store with an open tab, and every Firefox container, including partitioned cookies. The sites seen along the way decide which site data `browsingData` clears.
* `src/site-utils.js`: normalizes and validates kept-site entries and decides whether a history URL or cookie domain belongs to a kept site.
* `options/`: the settings page for the keep list, the startup setting and its notice while it is off, **Clear Now**, **Clear Leftovers**, the last clear result, and the site access warning. It uses local browser extension APIs only and does not load external assets.
* `tests/`: Playwright tests. The `*-snapshots/` folders hold baseline screenshots of the settings page in Chromium, Firefox, and Firefox for Android; see [Screenshots](../README.md#screenshots) in the monorepo README.

## Permissions

* `browsingData`: clears local storage, IndexedDB, service workers, and cache of sites that are not kept.
* `cookies`: reads and removes cookies of sites that are not kept.
* `history`: reads and removes history entries of sites that are not kept.
* `storage`: stores the keep list, the startup setting, and the last clear result locally in the browser.
* `host_permissions` for `http://*/*` and `https://*/*`: lets the cookies API see and remove cookies for every site. Without it, cookies are skipped.
* `contextualIdentities` (Firefox only): lists Firefox containers so their cookies are cleared too.

## Privacy

The extension does not collect user data, send browsing history or cookies anywhere, use analytics or tracking, make network requests, use remote code, or load external JavaScript. It stores its settings locally in `chrome.storage.local`. History, cookies, and open tabs are read only to decide what to remove, and only inside the browser.

## Performance

The extension does no work while the browser is in use. It runs once at browser startup, when clearing is on, and when **Clear Now** or **Clear Leftovers** is clicked.

The first clear of a long browsing history can take several minutes, because each history entry is deleted individually; the settings page says so next to **Clear Now**. Later clears only have the previous session's entries to remove.

## Build

From the monorepo root, run:

```bash
./build.sh clear-browsing-data-except-kept-sites
```

This writes Chrome, Edge, and Firefox ZIP files to `dist/`. For requirements and details about the shared build process, see the [monorepo README](../README.md#build).

## Development Install

**Chrome and Edge:** open `chrome://extensions` or `edge://extensions`, enable Developer mode, choose "Load unpacked", and select this project directory.

**Firefox:** the extension directory itself loads as the Chromium version, so build the Firefox package first (see [Build](#build)). Open `about:debugging#/runtime/this-firefox`, choose "Load Temporary Add-on", and select `dist/clear-browsing-data-except-kept-sites-firefox-v<version>.zip`. A temporary add-on is removed when Firefox closes, so it never sees a browser startup. Use **Clear Now** to try it out.

## Known Limitations

* Clearing runs at browser startup, not when the browser closes, because browsers do not let extensions run on close.
* Tabs restored at startup can set new cookies while or after the clear runs. Those cookies remain until the next startup or **Clear Now**.
* Other site data, such as session storage, site permissions, and the Chrome file system API's files, is not cleared. Firefox cannot clear Cache Storage, the offline files that service workers save, by site, so it is not cleared there; use **Manage Data** in Firefox's privacy settings for it.
* If browser sync includes history, removed history entries may also be removed on your other devices.
* Private and incognito windows are cleared only when the extension is allowed to run in them. The browser discards their data when they close anyway.
* IPv6 addresses cannot be added to the keep list.
* Firefox for Android does not let extensions clear history, so only cookies and site data are cleared there, and site data only for sites found through cookies and open tabs. The settings page says so after each clear.

## License

This project is licensed under the [MIT License](../LICENSE).
