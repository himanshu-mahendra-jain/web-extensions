import path from "node:path";

import { test as base, expect } from "../../test-support/extension.js";


export { expect };


export const ENDPOINT = "https://fcm.googleapis.com/fcm/send/test-token";


export const test = base.extend({
  extensionPath: [path.resolve(__dirname, ".."), { option: true }],


  /*
   * Delivers a real Web Push message to the extension's service worker.
   * Chromium drops pushes sent before the worker is activated, which
   * happens just after install, so this waits for activation first.
   */
  push: async ({ context, page, extensionId }, use) => {
    const origin = `chrome-extension://${extensionId}/`;
    const session = await context.newCDPSession(page);

    const registration = new Promise((resolve) => {
      session.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
        const activated = versions.find((version) => {
          return version.status === "activated" &&
            version.scriptURL.startsWith(origin);
        });

        if (activated) resolve(activated.registrationId);
      });
    });

    await session.send("ServiceWorker.enable");

    const registrationId = await registration;

    await use((data) => {
      return session.send("ServiceWorker.deliverPushMessage", {
        origin,
        registrationId,
        data: typeof data === "string" ? data : JSON.stringify(data)
      });
    });
  },


  /*
   * Headless Chromium has no push service, so pushManager.subscribe()
   * never settles. This fakes an existing subscription instead.
   */
  fakeSubscription: async ({ serviceWorker }, use) => {
    await use(() => {
      return serviceWorker.evaluate((endpoint) => {
        PushManager.prototype.getSubscription = async () => ({
          endpoint,
          toJSON: () => ({
            endpoint,
            keys: { p256dh: "test-p256dh", auth: "test-auth" }
          })
        });
      }, ENDPOINT);
    });
  }
});


export function getStorage(serviceWorker, key) {
  return serviceWorker.evaluate(async (name) => {
    return (await chrome.storage.local.get(name))[name];
  }, key);
}


export function setStorage(serviceWorker, items) {
  return serviceWorker.evaluate((values) => chrome.storage.local.set(values), items);
}


export function shownNotifications(serviceWorker) {
  return serviceWorker.evaluate(async () => {
    return (await self.registration.getNotifications()).map((notification) => ({
      title: notification.title,
      body: notification.body,
      actions: notification.actions.map((action) => [action.action, action.title])
    }));
  });
}


export function minutesAgo(minutes) {
  return Date.now() - minutes * 60 * 1000;
}
