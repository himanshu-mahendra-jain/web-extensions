/*
 * The extension APIs, which Chrome and Edge name chrome. The Firefox
 * package has extension-api-firefox.js in this file's place, so each
 * package calls its browser's own namespace. A plain script: content
 * scripts list it before their own, and modules import it first.
 */
globalThis.extensionApi = chrome;
