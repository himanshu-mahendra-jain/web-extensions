import "./extension-api.js";
import {
  clearUnkeptData
} from "./cleaner.js";


let clearQueue = Promise.resolve();


function reportError(context, error) {
  console.error(
    `[Clear Browsing Data] ${context}:`,
    error
  );
}


/*
 * Runs one clear after any clear already in progress, so two
 * runs never delete from the same lists at the same time.
 */
function queueClear(options) {
  // The caller of the run before reports its failure.
  const run = clearQueue
    .catch(() => {})
    .then(() => clearUnkeptData(options));

  clearQueue = run;

  return run;
}


async function clearOnStartup() {
  const { clearOnStartup } =
    await extensionApi.storage.local.get(
      "clearOnStartup"
    );

  /*
   * Off until turned on on the settings page, so installing
   * the extension never clears anything by itself.
   */
  if (clearOnStartup !== true) {
    return;
  }

  await queueClear();
}


extensionApi.runtime.onStartup.addListener(() => {
  clearOnStartup().catch((error) => {
    reportError(
      "Startup clear failed",
      error
    );
  });
});


extensionApi.runtime.onInstalled.addListener(
  ({ reason }) => {
    if (reason !== "install") {
      return;
    }

    // Ask for the keep list before the first startup clear.
    extensionApi.runtime.openOptionsPage()
      .catch((error) => {
        reportError(
          "Could not open the settings page",
          error
        );
      });
  }
);


extensionApi.action.onClicked.addListener(() => {
  extensionApi.runtime.openOptionsPage()
    .catch((error) => {
      reportError(
        "Could not open the settings page",
        error
      );
    });
});


extensionApi.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {
    if (
      !["clear-now", "clear-leftovers"]
        .includes(message?.type)
    ) {
      return false;
    }

    queueClear({
      leftovers: message.type === "clear-leftovers"
    })
      .then((result) => {
        sendResponse({
          ok: true,
          result
        });
      })
      .catch((error) => {
        reportError(
          "Clear now failed",
          error
        );

        sendResponse({
          ok: false
        });
      });

    return true;
  }
);
