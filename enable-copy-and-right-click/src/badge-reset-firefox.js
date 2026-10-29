import "./extension-api.js";
import { extensionName } from "./i18n.js";


/*
 * Firefox for Android keeps a tab's badge and title when it loads a
 * page. The tabs turned on are kept in session storage, which outlives
 * a stopped background page, and only they are reset when they load
 * one. Desktop Firefox, like Chrome and Edge, clears both by itself
 * (see badge-reset.js), so there page loads are not listened to and
 * do not wake the background page. The user agent is read at once,
 * since a listener added after an await would not wake it either.
 */
const KEEPS_BADGES = navigator.userAgent.includes("Android");


function keyOf(tabId) {
  return `enabledTab:${tabId}`;
}


export async function rememberEnabledTab(tabId) {
  if (!KEEPS_BADGES) {
    return;
  }

  await extensionApi.storage.session.set({
    [keyOf(tabId)]: true
  });
}


async function resetIfEnabled(tabId) {
  const key = keyOf(tabId);
  const stored = await extensionApi.storage.session.get(key);

  if (!stored[key]) {
    return;
  }

  await extensionApi.storage.session.remove(key);

  await extensionApi.action.setBadgeText({
    tabId,
    text: ""
  });

  await extensionApi.action.setTitle({
    tabId,
    title: extensionName()
  });
}


if (KEEPS_BADGES) {
  extensionApi.tabs.onUpdated.addListener(onUpdated);
}


function onUpdated(tabId, changeInfo) {
  if (changeInfo.status !== "loading") {
    return;
  }

  resetIfEnabled(tabId).catch((error) => {
    console.error(
      "[Enable Copy and Right Click] Could not reset the badge:",
      error
    );
  });
}
