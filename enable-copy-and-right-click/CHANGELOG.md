# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.3] - 2026-10-29

### New Features

* The extension now speaks your browser's language. It is translated into every language the Chrome Web Store supports and falls back to English for any other.
* The Automatic Sites page and its messages, the announcement screen readers hear, the toolbar button's tooltip and the keyboard shortcut's name are all translated. The page is laid out right to left in Arabic, Hebrew and Persian. The badge on the toolbar button still reads `ON`.

## [1.0.2] - 2026-10-17

### Changes

* Works on GooglebookOS, with the same Alt+C keyboard shortcut as on ChromeOS.
* The toolbar shows ON only when the extension could reach the page.
* Firefox needs version 153 or later, on the desktop and on Android.

### Bug Fixes

* Firefox for Android fixes.
* A site that cannot be enabled automatically is no longer left on the automatic sites list.
* The settings page keeps keyboard focus after you remove the last automatic site.
* Screen readers announce that copy and right click are enabled.
