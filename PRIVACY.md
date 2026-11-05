# Privacy Policy for Browser Extensions

**Last Updated:** November 4, 2026  
**Developer:** Himanshu Mahendra Jain  
**Repository:** [https://github.com/himanshu-mahendra-jain/web-extensions](https://github.com/himanshu-mahendra-jain/web-extensions)

---

## Overview

This Privacy Policy applies to the following browser extensions developed and maintained by **Himanshu Mahendra Jain** (available on the Chrome Web Store, Microsoft Edge Add-ons, and Mozilla Firefox Add-ons):

1. **Change Video Playback Speed**
2. **Clear Browsing Data Except Kept Sites**
3. **Enable Copy and Right Click**
4. **HMJ SMS Desktop Sync**
5. **Three Finger Tap to Close Tab**

**Core Commitment:** We believe your privacy is fundamental. **None of these extensions collect, track, transmit, sell, or share any personal data, browsing activity, or telemetry.** All operations are performed strictly locally within your browser or via encrypted peer-to-browser protocols with zero developer-owned or intermediary tracking servers.

---

## 1. Information Collection and Usage

### A. Data Collection: None
* **No Personal or Sensitive User Data Collected:** We do not collect names, email addresses, phone numbers, IP addresses, location data, passwords, browsing habits, or personal credentials.
* **No Analytics or Telemetry:** None of the extensions contain Google Analytics, tracking pixels, telemetry probes, or third-party diagnostic SDKs.
* **No Remote Code Execution:** All code runs directly from the locally installed extension package. In strict accordance with Chrome Web Store and browser add-on security policies, no remote scripts, external CDNs, or unreviewed dynamic scripts are loaded or executed.
* **No External Developer Servers:** The developer maintains no database, analytics, or tracking servers. Your data is never transmitted to the developer or any commercial third party.
* **No Human Access:** No human (including the developer or any third party) accesses, reads, inspects, or reviews your messages, OTPs, browsing history, cookies, or extension settings.

---

## 2. Extension-Specific Data Handling and Permissions

Each extension uses only the minimum browser permissions strictly required to deliver its intended function.

### 1. Change Video Playback Speed
* **What it does:** Adjusts playback speed of `<video>` and `<audio>` elements across tabs using keyboard shortcuts or toolbar icon clicks.
* **Permissions used:** `activeTab`, `scripting`.
* **Data handling:**
  * Runs transient scripts only when manually invoked by the user on the active tab.
  * Does **not** read or store browsing history, media URLs, page text, or cookies.
  * No persistent storage is used (`chrome.storage` is not requested).

### 2. Clear Browsing Data Except Kept Sites
* **What it does:** Clears cookies, cache, and browsing history upon browser startup or manual trigger, preserving only sites on your keep list.
* **Permissions used:** `browsingData`, `cookies`, `history`, `storage`, `contextualIdentities` (Firefox). Host permissions for `http://*/*` and `https://*/*`.
* **Data handling:**
  * **Keep List & Settings:** Stored purely locally on your device in `chrome.storage.local`.
  * **History & Cookies:** Read locally solely to determine whether an entry belongs to a kept domain. Unkept entries are deleted.
  * **No Transmission:** Your browsing history, cookie contents, and keep list never leave your browser.

### 3. Enable Copy and Right Click
* **What it does:** Re-enables text selection, copy/cut events, and context menus on websites that disable them.
* **Permissions used:** `activeTab`, `scripting`, `storage`, optional per-site host permissions.
* **Data handling:**
  * When triggered manually, it uses `activeTab` to temporarily inject interaction unblocking scripts into the active page.
  * When user chooses automatic activation for specific domains, the list of domains is stored locally in `chrome.storage.local`.
  * Does not read, collect, copy, or transmit webpage content, typed inputs, or clipboard content.

### 4. HMJ SMS Desktop Sync
* **What it does:** Provides end-to-end encrypted notification and OTP synchronization from your Android phone to your desktop browser.
* **Permissions used:** `storage`, `notifications`, `clipboardWrite`, `offscreen`.
* **Data handling:**
  * **Serverless Architecture:** Operates with zero middleman servers.
  * **End-to-End Encryption:** Messages are encrypted directly on your Android phone using standard VAPID Web Push encryption (RFC 8291 / RFC 8292 with `aes128gcm` and ES256 JWT) and delivered through the browser vendor's official push service (e.g., Google Firebase Cloud Messaging for Chrome, Microsoft WNS/MPNS for Edge). The push service acts purely as an encrypted blind conduit and cannot decrypt or read your messages.
  * **Local Storage Only:** Pairing keys, linked device names, and recent messages are saved only on your local device in `chrome.storage.local`. Messages are automatically deleted after 24 hours (maximum 100 messages retained).
  * **Clipboard:** The `clipboardWrite` permission is used strictly to copy verification codes (OTPs) or message text when you explicitly click the notification or notification button.
  * Users can clear all cached messages or revoke pairing keys instantly via the extension's popup menu ("Clear Messages" or "Unlink All Phones").

### 5. Three Finger Tap to Close Tab
* **What it does:** Closes the current browser tab when a middle-click or touchpad three-finger tap is detected.
* **Permissions used:** None.
* **Data handling:**
  * A lightweight content script listens for middle-click / touchpad tap events on webpages.
  * Does **not** inspect, log, or record page text, URLs, form inputs, or browsing activity.
  * No data is stored or transmitted anywhere.

---

## 3. Third-Party Services

* **Browser Vendor Web Push (HMJ SMS Desktop Sync only):** Uses standard Web Push services provided by your browser platform (Google FCM, Microsoft Push Notification Service). Data transmitted through these services is encrypted end-to-end (`aes128gcm`) before leaving your mobile phone and can only be decrypted by your local browser extension instance using its private VAPID key.
* **External Links:** Extension listings or settings may include external links to GitHub, official browser web stores, or demonstration videos. These external sites are governed by their respective privacy policies.

---

## 4. User Access, Controls, and Data Deletion

In accordance with user control standards (including Microsoft Edge Add-ons Policy 1.5.2):

* **Accessing Your Information:**
  * Because we do not operate remote servers, any configuration data or transient content is stored locally on your device.
  * You can view and inspect your saved data at any time directly through each extension's user interface:
    * **Clear Browsing Data Except Kept Sites:** View and export your keep list in the extension Settings/Options page.
    * **Enable Copy and Right Click:** View your automatic domain list in the Options page.
    * **HMJ SMS Desktop Sync:** View paired devices and recent synced messages directly in the toolbar popup.
    * **Change Video Playback Speed & Three Finger Tap to Close Tab:** No data or preferences are stored; there is no stored information to inspect.
* **User Controls Over Data:**
  * You have total control over all locally stored data. You can add, edit, or remove entries at will.
  * *HMJ SMS Desktop Sync* allows you to unlink individual phones, unlink all phones (regenerating your keys), or clear all stored messages instantly via the popup menu.
* **Data Deletion:**
  * You can purge all data and preferences at any time by clearing your browser data or uninstalling the extension.
  * Uninstalling an extension immediately deletes all associated `chrome.storage` data from your local browser profile.

---

## 5. Children's Privacy

These extensions do not knowingly collect or solicit any personal information from children under the age of 13 (or under 16 where applicable by regional law), in full compliance with the Children’s Online Privacy Protection Act (COPPA) and equivalent regulations.

---

## 6. Limited Use and Store Policy Compliance

* **Store Policy Adherence:** The use of information received from browser APIs adheres strictly to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/user-data-policy/), the [Microsoft Edge Add-ons Developer Policies (Section 1.5)](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies#15-personal-information), and the [Mozilla Add-on Policies](https://extensionworkshop.com/documentation/publish/add-on-policies/) regarding Data Disclosure, Collection, and Management.
* **Single-Purpose Restriction:** All data access and local processing are strictly limited to providing and improving each extension's single, user-facing purpose as prominently described in its web store listing.
* **Strict Prohibition on Selling or Transferring Data:** We do not sell, rent, trade, or transfer any user data, personal information, or browsing metadata to third parties, data brokers, advertising networks, or information resellers.
* **No Advertising or Monetization:** User data is never used or transferred for serving advertisements, personalized marketing, retargeting, or evaluating creditworthiness/lending eligibility.
* **Secure Data Transmission:** Where networking is involved for standard push notifications (*HMJ SMS Desktop Sync*), data is encrypted end-to-end using modern cryptography (`aes128gcm` RFC 8291 / RFC 8292) before transmission across the browser vendor's push service (satisfying Microsoft Edge Policy 1.5.5 and Mozilla secure transmission rules).

---

## 7. Compliance with Global Regulations (GDPR & CCPA/CPRA)

Because these extensions do not collect, process, sell, or transfer any personal data:
* **No personal data is retained or processed by the developer.**
* Users have native, total control over all local preferences stored on their personal hardware.
* There is no data sharing, selling, profiling, or cross-site tracking.

---

## 8. Changes to This Privacy Policy

This policy may be updated occasionally to reflect new features, updated extension versions, or changes to store policies. The updated policy will always be published at this repository with an updated "Last Updated" date.

---

## 9. Contact Information

If you have any questions, feedback, or concerns regarding this Privacy Policy or the security of these extensions, please open an issue on GitHub:

* **GitHub Repository:** [https://github.com/himanshu-mahendra-jain/web-extensions](https://github.com/himanshu-mahendra-jain/web-extensions)
* **Author / Developer:** Himanshu Mahendra Jain
