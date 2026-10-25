import path from "node:path";

import { test as base, expect } from "../../test-support/extension.js";


export { expect };


export const ENDPOINT = "https://fcm.googleapis.com/fcm/send/test-token";


/*
 * A v2 pairing code from the fake subscription: its endpoint and keys,
 * the 65-byte public and 32-byte private VAPID key in base64url, and the
 * browser's and the system's names.
 */
export const PAIRING_CODE_PATTERN = new RegExp(
  `^sms_pair:v2\\|${RegExp.escape(ENDPOINT)}(-\\d+)?\\|test-p256dh\\|test-auth\\|` +
  "[\\w-]{87}\\|[\\w-]{43}\\|Chrome \\((ChromeOS|Android|Linux|Mac|Windows|Desktop)\\)$"
);


/*
 * Whether a pairing code's VAPID keys are one pair, proven as the phone
 * proves it: a signature by the private key that the public key verifies.
 */
export function keysMatch(serviceWorker, publicKey, privateKey) {
  return serviceWorker.evaluate(async ([publicText, privateText]) => {
    const fromBase64Url = (text) => {
      return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    };
    const toBase64Url = (bytes) => {
      return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };

    const raw = fromBase64Url(publicText);
    const algorithm = { name: "ECDSA", namedCurve: "P-256" };
    const signing = { name: "ECDSA", hash: "SHA-256" };
    const probe = new TextEncoder().encode("hmj-sms-pairing");

    const privateKey = await crypto.subtle.importKey("jwk", {
      kty: "EC",
      crv: "P-256",
      x: toBase64Url(raw.slice(1, 33)),
      y: toBase64Url(raw.slice(33, 65)),
      d: privateText
    }, algorithm, false, ["sign"]);
    const publicKey = await crypto.subtle.importKey("raw", raw, algorithm, false, ["verify"]);

    const signature = await crypto.subtle.sign(signing, privateKey, probe);

    return raw.length === 65 && raw[0] === 4 &&
      fromBase64Url(privateText).length === 32 &&
      crypto.subtle.verify(signing, publicKey, signature, probe);
  }, [publicKey, privateKey]);
}


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
   * never settles. This fakes the worker's PushManager the way Chrome
   * behaves: one subscription at a time, which subscribe() returns again
   * for the same key and refuses to replace with another key until it is
   * ended. The first subscription's endpoint is ENDPOINT, the next ones
   * ENDPOINT-2 and on. self.pushSubscriptions counts those made and ended.
   */
  fakeSubscription: async ({ serviceWorker }, use) => {
    await use(() => {
      return serviceWorker.evaluate((endpoint) => {
        const toBase64Url = (bytes) => {
          return btoa(String.fromCharCode(...new Uint8Array(bytes)))
            .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        };

        let current = null;

        self.pushSubscriptions = { made: 0, ended: 0 };

        PushManager.prototype.getSubscription = async () => current;

        PushManager.prototype.subscribe = async ({ applicationServerKey }) => {
          const key = new Uint8Array(applicationServerKey).buffer;

          if (current) {
            if (toBase64Url(current.options.applicationServerKey) === toBase64Url(key)) {
              return current;
            }

            throw new DOMException("A subscription with a different key exists.", "InvalidStateError");
          }

          self.pushSubscriptions.made++;

          const address = self.pushSubscriptions.made === 1
            ? endpoint
            : `${endpoint}-${self.pushSubscriptions.made}`;

          const subscription = {
            endpoint: address,
            options: { userVisibleOnly: true, applicationServerKey: key },
            toJSON: () => ({
              endpoint: address,
              keys: { p256dh: "test-p256dh", auth: "test-auth" }
            }),
            unsubscribe: async () => {
              if (current === subscription) {
                current = null;
                self.pushSubscriptions.ended++;
              }

              return true;
            }
          };

          current = subscription;

          return subscription;
        };
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
