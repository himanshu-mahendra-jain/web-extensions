import "./extension-api.js";
import {
  rememberEnabledTab
} from "./badge-reset.js";
import { extensionName, t } from "./i18n.js";
import {
  getSiteOrigins,
  sanitizeSites
} from "./site-utils.js";


const AUTOMATIC_SCRIPT_ID =
  "automatic-sites";

// enable.js reads its announcement through extensionApi, so the browser's namespace comes first.
const ENABLE_SCRIPTS = [
  "src/extension-api.js",
  "src/enable.js"
];

const actions = new Map();

let syncQueue = Promise.resolve();


function reportError(context, error) {
  console.error(
    `[Enable Copy and Right Click] ${context}:`,
    error
  );
}


function queueAction(tabId) {
  const previous =
    actions.get(tabId) || Promise.resolve();

  const current = previous
    .catch((error) => {
      reportError(
        "Previous tab action failed",
        error
      );
    })
    .then(() => {
      return enableCopyAndRightClick(tabId);
    })
    .catch((error) => {
      reportError(
        `Could not enable tab ${tabId}`,
        error
      );
    })
    .finally(() => {
      if (actions.get(tabId) === current) {
        actions.delete(tabId);
      }
    });

  actions.set(tabId, current);
}


async function enableCopyAndRightClick(tabId) {
  let results;

  try {
    results = await extensionApi.scripting.executeScript({
      target: {
        tabId,
        allFrames: true
      },
      files: ENABLE_SCRIPTS
    });
  } catch (error) {
    reportError(
      `Could not enable all frames in tab ${tabId}`,
      error
    );

    results = await extensionApi.scripting.executeScript({
      target: {
        tabId
      },
      files: ENABLE_SCRIPTS
    });
  }

  // Chromium can lose the first click on a tab and inject nothing.
  // The badge then stays off, so the next click tries again.
  if (results.length === 0) {
    throw new Error(
      `The script reached no frame in tab ${tabId}`
    );
  }

  await extensionApi.action.setBadgeText({
    tabId,
    text: "ON"
  });

  await extensionApi.action.setTitle({
    tabId,
    title: t("actionTitleActive", extensionName())
  });

  await rememberEnabledTab(tabId);
}


function queueAutomaticSitesSync() {
  syncQueue = syncQueue
    .catch((error) => {
      reportError(
        "Previous automatic-site sync failed",
        error
      );
    })
    .then(syncAutomaticSites);

  return syncQueue;
}


async function getPermittedMatches(sites) {
  const permissionResults =
    await Promise.all(
      sites.map(async (site) => {
        const origins =
          getSiteOrigins(site);

        const permitted =
          await extensionApi.permissions.contains({
            origins
          });

        return permitted
          ? origins
          : [];
      })
    );

  return [
    ...new Set(
      permissionResults.flat()
    )
  ];
}


async function syncAutomaticSites() {
  const result =
    await extensionApi.storage.local.get(
      "automaticSites"
    );

  const sites =
    sanitizeSites(result.automaticSites);

  const matches =
    await getPermittedMatches(sites);

  const existing =
    await extensionApi.scripting
      .getRegisteredContentScripts({
        ids: [
          AUTOMATIC_SCRIPT_ID
        ]
      });

  const isRegistered =
    existing.length > 0;


  if (matches.length === 0) {
    if (isRegistered) {
      await extensionApi.scripting
        .unregisterContentScripts({
          ids: [
            AUTOMATIC_SCRIPT_ID
          ]
        });
    }

    return;
  }


  const script = {
    id: AUTOMATIC_SCRIPT_ID,
    matches,
    js: ENABLE_SCRIPTS,
    allFrames: true,
    runAt: "document_start"
  };


  if (isRegistered) {
    await extensionApi.scripting
      .updateContentScripts([
        script
      ]);

    return;
  }


  await extensionApi.scripting
    .registerContentScripts([
      script
    ]);
}


function requestSync() {
  queueAutomaticSitesSync()
    .catch((error) => {
      reportError(
        "Automatic-site sync failed",
        error
      );
    });
}


extensionApi.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) {
    queueAction(tab.id);
  }
});


// Firefox for Android has no keyboard shortcuts, and no commands API.
if (extensionApi.commands) {
  extensionApi.commands.onCommand.addListener(
    async (command) => {
      if (
        command !==
        "enable-copy-right-click"
      ) {
        return;
      }

      try {
        const [tab] =
          await extensionApi.tabs.query({
            active: true,
            currentWindow: true
          });

        if (tab?.id !== undefined) {
          queueAction(tab.id);
        }
      } catch (error) {
        reportError(
          "Keyboard command failed",
          error
        );
      }
    }
  );
}


extensionApi.runtime.onInstalled.addListener(
  requestSync
);


extensionApi.runtime.onStartup.addListener(
  requestSync
);


extensionApi.storage.onChanged.addListener(
  (changes, areaName) => {
    if (
      areaName === "local" &&
      changes.automaticSites
    ) {
      requestSync();
    }
  }
);


extensionApi.permissions.onAdded.addListener(
  requestSync
);


extensionApi.permissions.onRemoved.addListener(
  requestSync
);


extensionApi.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {
    if (
      message?.type !==
      "sync-automatic-sites"
    ) {
      return false;
    }

    queueAutomaticSitesSync()
      .then(() => {
        sendResponse({
          ok: true
        });
      })
      .catch((error) => {
        reportError(
          "Requested sync failed",
          error
        );

        sendResponse({
          ok: false
        });
      });

    return true;
  }
);
