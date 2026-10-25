# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-10-26

### New Features

* Pairing uses the HMJ SMS app's v2 pairing code: the extension makes its own VAPID key pair and puts it in the QR code, so only phones that scanned it can send to this browser. Pair again with the new QR code.
* Several phones can be linked. Click a phone's name in the popup to list them and unlink one; its messages are then ignored, with one quiet notice that counts them.
* **Unlink All Phones** in the popup's menu makes a new pairing code, so no phone can reach this browser any more, and removes the stored messages.
* MMS show as "New MMS from", or "Alice in group with Bob, Carol", with the subject and a line naming the attachments, once the HMJ SMS app sends them.
* The popup and notifications are in the browser's language: every language the Chrome Web Store supports, with English as the fallback. Right-to-left languages such as Arabic, Hebrew and Persian lay the popup out from the right, while messages, senders and phone names keep their own direction.
* When the browser ends the push subscription the phones send to, such as after months without a message, the popup says so, clears the list of phones and shows a new QR code to scan on each phone. It also says when the browser has turned off the extension's notifications, as messages are then stored but not shown.

### Changes

* The settings page is gone: its Unlink, Clear Messages and Copy Code moved into the popup, and the phone sends the test notification when it pairs.
* A warning next to the QR code says the pairing code holds the keys to your link.
* Edge is named Edge, not Chrome, in the pairing code.
* The pairing code names ChromeOS and Android, which it called Desktop and Linux.
* A click on the notice about an unlinked phone opens the toolbar popup, or a window only when the browser has none to open it in.
* Chrome or Edge 127 or later is needed.
* The popup has new colours built on the icon's purple, larger text and stronger contrast in light and dark mode, and shows the extension's own icon beside its title. Its text follows the browser's font size setting.
* Copying from a notification no longer keeps a hidden page, and the memory it uses, open for the rest of the browser session.
* Times in the popup, such as "5m ago", are written as the browser's language writes them, count on while the popup is open, and show the full date and time when pointed at. Asking the system for more contrast gives the popup stronger borders.
* Only a notification with an OTP still to copy stays on screen until you close it. Other messages leave the screen on their own, and the popup keeps them all.

### Bug Fixes

* A dense pairing QR code no longer has uneven modules that phones could fail to read, at any display scaling.
* Messages from two linked phones no longer drop or replace each other when the phones happen to number them alike or send at the same moment: each is stored and gets its own notification.
* A new OTP's **Copy OTP** button is no longer hidden in a collapsed stack under earlier notifications, as on ChromeOS and Linux: a new OTP closes the extension's earlier notifications, so it is alone on screen.
* When the pairing code cannot be made, the popup says why under the QR code instead of showing nothing.

## [1.0.0] - 2026-10-17

### New Features

* Initial Release.
