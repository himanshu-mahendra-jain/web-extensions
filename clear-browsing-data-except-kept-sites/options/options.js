import "../src/extension-api.js";
import {
  andList,
  listOf,
  localizePage,
  plural,
  t,
  uiLanguage
} from "../src/i18n.js";
import {
  SITE_ORIGINS,
  parseSites,
  sanitizeSites
} from "../src/site-utils.js";


const form =
  document.getElementById("site-form");

const input =
  document.getElementById("site-input");

const list =
  document.getElementById("site-list");

const message =
  document.getElementById("message");

const emptyState =
  document.getElementById("empty-state");

const submitButton =
  form.querySelector(
    'button[type="submit"]'
  );

const accessWarning =
  document.getElementById("access-warning");

const grantButton =
  document.getElementById("grant-access");

const startupCheckbox =
  document.getElementById("clear-on-startup");

const clearButton =
  document.getElementById("clear-now");

const lastClearStatus =
  document.getElementById("last-clear");

const accessText =
  document.getElementById("access-text");

const clearingNotice =
  document.getElementById("clearing-off");

const clearingOffText =
  document.getElementById("clearing-off-text");

const intro =
  document.getElementById("intro");

const turnOnButton =
  document.getElementById("turn-on");

const confirmDialog =
  document.getElementById("confirm-dialog");

const confirmHeading =
  document.getElementById("confirm-heading");

const confirmWarning =
  document.getElementById("confirm-warning");

const confirmButton =
  document.getElementById("confirm-action");

const exportButton =
  document.getElementById("export-sites");

const importButton =
  document.getElementById("import-sites");

const importFile =
  document.getElementById("import-file");

const transferStatus =
  document.getElementById("transfer-status");

const leftoversSection =
  document.getElementById("leftovers");

const leftoversButton =
  document.getElementById("clear-leftovers");

const leftoversStatus =
  document.getElementById("leftovers-status");


/*
 * What a clear deletes. Firefox for Android has no history API, and
 * browsingData is missing when its permission was not granted.
 */
const CAN_CLEAR_HISTORY =
  Boolean(extensionApi.history);

const CAN_CLEAR_SITE_DATA =
  Boolean(extensionApi.browsingData);


// What a clear deletes, as the page names it in other messages.
function clearedData() {
  if (CAN_CLEAR_HISTORY && CAN_CLEAR_SITE_DATA) {
    return t("dataAll");
  }

  if (CAN_CLEAR_SITE_DATA) {
    return t("dataNoHistory");
  }

  return CAN_CLEAR_HISTORY
    ? t("dataNoSiteData")
    : t("dataCookies");
}


const CLEARED_DATA =
  clearedData();


// Firefox can clear site data only of the sites it names.
const CAN_CLEAR_LEFTOVERS =
  Boolean(extensionApi.browsingData) &&
  !extensionApi.runtime.getURL("").startsWith("moz-extension:");


const dateFormat =
  new Intl.DateTimeFormat(uiLanguage(), {
    dateStyle: "medium",
    timeStyle: "short"
  });


let operationInProgress = false;


function setMessage(text, type = "status") {
  message.textContent = text;
  message.classList.remove("error", "success");

  if (type === "error") {
    message.classList.add("error");
  } else if (type === "success") {
    message.classList.add("success");
  }
}


function setBusy(isBusy) {
  operationInProgress = isBusy;

  form.setAttribute(
    "aria-busy",
    String(isBusy)
  );

  list.setAttribute(
    "aria-busy",
    String(isBusy)
  );

  input.disabled = isBusy;
  submitButton.disabled = isBusy;

  for (
    const button of
    list.querySelectorAll("button")
  ) {
    button.disabled = isBusy;
  }
}


async function getSites() {
  const result =
    await extensionApi.storage.local.get(
      "keptSites"
    );

  return sanitizeSites(
    result.keptSites
  );
}


async function renderSites() {
  const sites =
    await getSites();

  emptyState.hidden = sites.length > 0;
  list.hidden = sites.length === 0;
  exportButton.disabled = sites.length === 0;

  const fragment =
    document.createDocumentFragment();

  sites.forEach((site, index) => {
    const item =
      document.createElement("li");

    const label =
      document.createElement("span");

    const removeButton =
      document.createElement("button");

    label.textContent = site;

    removeButton.type = "button";
    removeButton.textContent = t("remove");
    removeButton.disabled = operationInProgress;

    removeButton.setAttribute(
      "aria-label",
      t("removeSite", site)
    );

    removeButton.addEventListener(
      "click",
      async () => {
        if (operationInProgress) {
          return;
        }

        setMessage("");
        setBusy(true);

        try {
          await removeSite(site);
        } catch (error) {
          console.error(error);

          setMessage(
            t("removeFailed"),
            "error"
          );

          return;
        } finally {
          setBusy(false);
        }

        // Only now are the buttons and the field enabled again.
        focusAfterRemoval(index);
      }
    );

    item.append(
      label,
      removeButton
    );

    fragment.appendChild(item);
  });

  list.replaceChildren(fragment);
}


// Says what happened to each site entered, in one message.
function describeEntries({ added, kept, invalid }) {
  const parts = [];

  if (added.length === 1) {
    parts.push(t("siteKept", added[0]));
  } else if (added.length > 1) {
    parts.push(plural("sitesKept", added.length));
  }

  if (kept.length === 1) {
    parts.push(t("siteAlreadyKept", kept[0]));
  } else if (kept.length > 1) {
    parts.push(plural("sitesAlreadyKept", kept.length));
  }

  if (invalid.length > 0) {
    parts.push(describeInvalid(invalid));
  }

  return parts.join(" ");
}


function describeInvalid(invalid) {
  return invalid.length === 1
    ? t("invalidDomain", invalid[0])
    : t("invalidDomains", listOf(invalid));
}


async function addSites(entered, invalid) {
  const sites =
    await getSites();

  const added = entered.filter(
    (site) => !sites.includes(site)
  );

  if (added.length > 0) {
    await extensionApi.storage.local.set({
      keptSites: [...sites, ...added].sort()
    });
  }

  // Only the entries that could not be kept stay, to be corrected.
  input.value = invalid.join(", ");

  if (invalid.length > 0) {
    input.setAttribute("aria-invalid", "true");
  }

  setMessage(
    describeEntries({
      added,
      kept: entered.filter(
        (site) => sites.includes(site)
      ),
      invalid
    }),
    invalid.length > 0
      ? "error"
      : added.length > 0
        ? "success"
        : "status"
  );

  await renderSites();
}


async function removeSite(site) {
  const sites =
    await getSites();

  await extensionApi.storage.local.set({
    keptSites: sites.filter(
      (item) => item !== site
    )
  });

  setMessage(
    t("siteRemoved", site, CLEARED_DATA),
    "success"
  );

  await renderSites();
}


// Focus the Remove button that took the removed one's place.
function focusAfterRemoval(index) {
  const remainingButtons =
    list.querySelectorAll("button");

  if (remainingButtons.length > 0) {
    const targetButton =
      remainingButtons[index] ||
      remainingButtons[remainingButtons.length - 1];

    targetButton?.focus();
  } else {
    input.focus();
  }
}


function setTransferStatus(text, type = "status") {
  transferStatus.textContent = text;
  transferStatus.classList.toggle("error", type === "error");
  transferStatus.classList.toggle("success", type === "success");
}


// Saves the kept sites as a text file, one per line.
async function exportSites() {
  const sites =
    await getSites();

  const url = URL.createObjectURL(
    new Blob([`${sites.join("\n")}\n`], {
      type: "text/plain"
    })
  );

  const link =
    document.createElement("a");

  link.href = url;
  link.download = "kept-sites.txt";
  link.click();

  // The download may start after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}


// A list of kept sites takes a few kilobytes; a larger file is not one.
const MAX_IMPORT_BYTES = 1024 * 1024;


/*
 * Replaces the kept sites with the ones in the file. Sites that
 * are kept now and missing from the file would be cleared, so
 * that is confirmed first. A file over 1 MB is refused unread.
 */
async function importSites(file) {
  if (file.size > MAX_IMPORT_BYTES) {
    setTransferStatus(
      t("fileTooLarge", file.name),
      "error"
    );

    return;
  }

  const { sites, invalid } =
    parseSites(await file.text());

  if (sites.length === 0) {
    setTransferStatus(
      t("fileNoDomains", file.name),
      "error"
    );

    return;
  }

  const current =
    await getSites();

  const dropped = current.filter(
    (site) => !sites.includes(site)
  );

  if (
    dropped.length > 0 &&
    !(await confirmDanger({
      title: t("replaceTitle"),
      lines: [
        t(
          "replaceText",
          plural("siteCount", current.length),
          plural("siteCount", sites.length),
          file.name
        ),
        plural("importDropped", dropped.length, CLEARED_DATA)
      ],
      action: t("replaceAction")
    }))
  ) {
    return;
  }

  await extensionApi.storage.local.set({
    keptSites: [...sites].sort()
  });

  await renderSites();

  setTransferStatus(
    [
      plural("sitesImported", sites.length, file.name),
      ...(invalid.length > 0 ? [describeInvalid(invalid)] : [])
    ].join(" "),
    invalid.length > 0 ? "error" : "success"
  );
}


// What is cleared without site access, which only cookies need.
function accessWarningText() {
  if (CAN_CLEAR_HISTORY && CAN_CLEAR_SITE_DATA) {
    return t("accessHistorySiteData");
  }

  if (CAN_CLEAR_HISTORY) {
    return t("accessHistory");
  }

  return CAN_CLEAR_SITE_DATA
    ? t("accessSiteData")
    : t("accessNothing");
}


localizePage();

accessText.textContent =
  accessWarningText();

clearingOffText.textContent =
  t("clearingOffText", CLEARED_DATA);

intro.textContent =
  t("intro", CLEARED_DATA);

emptyState.textContent =
  t("noSites", CLEARED_DATA);

leftoversSection.hidden = !CAN_CLEAR_LEFTOVERS;


async function renderAccess() {
  const hasAccess =
    await extensionApi.permissions.contains({
      origins: SITE_ORIGINS
    });

  accessWarning.hidden = hasAccess;
}


// Says what the browser did not let the extension clear.
function unsupportedText({ historySkipped, siteDataSkipped }) {
  if (historySkipped && siteDataSkipped) {
    return t("skippedHistorySiteData");
  }

  if (historySkipped) {
    return t("skippedHistory");
  }

  return siteDataSkipped
    ? t("skippedSiteData")
    : "";
}


function renderLastClear(lastClear) {
  lastClearStatus.classList.remove("error");

  if (!lastClear) {
    lastClearStatus.textContent =
      t("nothingClearedYet");

    return;
  }

  const when =
    dateFormat.format(new Date(lastClear.time));

  if (lastClear.failed) {
    lastClearStatus.classList.add("error");

    lastClearStatus.textContent =
      t("clearFailed", when);

    return;
  }

  const removed = [];

  // Firefox for Android lets extensions clear neither of these.
  const skipped = [
    unsupportedText(lastClear)
  ];

  if (!lastClear.historySkipped) {
    removed.push(plural(
      "historyEntries",
      lastClear.historyRemoved
    ));
  }

  if (lastClear.cookiesSkipped) {
    skipped.push(
      t("cookiesSkipped")
    );
  } else {
    removed.push(plural(
      "cookieCount",
      lastClear.cookiesRemoved
    ));
  }

  const what = removed.length > 0
    ? andList(removed)
    : t("nothing");

  const summary = lastClear.leftoversCleared
    ? t("lastClearedLeftovers", when, what)
    : lastClear.siteDataCleared
      ? t("lastClearedSiteData", when, what)
      : t("lastCleared", when, what);

  lastClearStatus.textContent = [
    summary,
    ...skipped
  ].filter(Boolean).join(" ");
}


async function renderSettings() {
  const {
    clearOnStartup,
    lastClear
  } = await extensionApi.storage.local.get([
    "clearOnStartup",
    "lastClear"
  ]);

  renderClearOnStartup(
    clearOnStartup === true
  );

  renderLastClear(lastClear);
}


// Clearing on startup is off until turned on here.
function renderClearOnStartup(isOn) {
  startupCheckbox.checked = isOn;
  clearingNotice.hidden = isOn;
}


// Answers the dialog that is open, or did not hear its close event yet.
let settleConfirm = () => {};

/*
 * Shows a warning and resolves true only when the user confirms.
 * Cancel has the focus, and Escape closes the dialog without a
 * value, so neither confirms by accident. The last line is bold.
 */
function confirmDanger({ title, lines, action }) {
  // The close event is queued, so the last dialog's can still be on its way.
  settleConfirm();

  confirmHeading.textContent = title;
  confirmButton.textContent = action;

  confirmWarning.replaceChildren(
    ...lines.map((line) => {
      const paragraph =
        document.createElement("p");

      paragraph.textContent = line;

      return paragraph;
    })
  );

  confirmDialog.returnValue = "";
  confirmDialog.showModal();

  return new Promise((resolve) => {
    const onClose = () => {
      // An open dialog got the last one's close event.
      if (!confirmDialog.open) {
        settleConfirm();
      }
    };

    settleConfirm = () => {
      confirmDialog.removeEventListener("close", onClose);
      settleConfirm = () => {};
      resolve(confirmDialog.returnValue === "confirm");
    };

    confirmDialog.addEventListener("close", onClose);
  });
}


function confirmTurnOn(hasKeptSites) {
  return confirmDanger({
    title: t("turnOnTitle"),
    lines: [
      hasKeptSites
        ? t("turnOnKept", CLEARED_DATA)
        : t("turnOnNone", CLEARED_DATA),
      t("cannotRecover", CLEARED_DATA)
    ],
    action: t("turnOnClearing")
  });
}


async function setClearOnStartup(isOn) {
  if (
    isOn &&
    !(await confirmTurnOn(
      (await getSites()).length > 0
    ))
  ) {
    renderClearOnStartup(false);

    return;
  }

  await extensionApi.storage.local.set({
    clearOnStartup: isOn
  });

  renderClearOnStartup(isOn);
}


function changeClearOnStartup(isOn) {
  setClearOnStartup(isOn).catch((error) => {
    console.error(error);

    renderClearOnStartup(!isOn);
  });
}


input.addEventListener("input", () => {
  if (input.getAttribute("aria-invalid") === "true") {
    input.removeAttribute("aria-invalid");

    if (message.classList.contains("error")) {
      setMessage("");
    }
  }
});


form.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    if (operationInProgress) {
      return;
    }

    setMessage("");

    const { sites, invalid } =
      parseSites(input.value);

    if (sites.length === 0) {
      input.setAttribute(
        "aria-invalid",
        "true"
      );

      setMessage(
        invalid.length > 1
          ? describeInvalid(invalid)
          : t("enterValidDomain"),
        "error"
      );

      input.focus();

      return;
    }

    input.removeAttribute("aria-invalid");

    setBusy(true);

    try {
      await addSites(sites, invalid);
    } catch (error) {
      console.error(error);

      setMessage(
        sites.length > 1
          ? t("addSitesFailed")
          : t("addSiteFailed"),
        "error"
      );
    } finally {
      setBusy(false);
      input.focus();
    }
  }
);


grantButton.addEventListener("click", () => {
  /*
   * permissions.request() must start directly inside the
   * click handler, before the first await. Firefox rejects
   * it once the user gesture is gone.
   */
  extensionApi.permissions.request({
    origins: SITE_ORIGINS
  })
    .then(renderAccess)
    .catch((error) => {
      console.error(error);
    });
});


startupCheckbox.addEventListener("change", () => {
  changeClearOnStartup(startupCheckbox.checked);
});


turnOnButton.addEventListener("click", () => {
  changeClearOnStartup(true);
});


exportButton.addEventListener("click", () => {
  setTransferStatus("");

  exportSites().catch((error) => {
    console.error(error);

    setTransferStatus(
      t("exportFailed"),
      "error"
    );
  });
});


importButton.addEventListener("click", () => {
  importFile.click();
});


importFile.addEventListener("change", () => {
  const [file] = importFile.files;

  // The same file can be chosen again after this.
  importFile.value = "";

  if (!file) {
    return;
  }

  setTransferStatus("");

  importSites(file).catch((error) => {
    console.error(error);

    setTransferStatus(
      t("importFailed", file.name),
      "error"
    );
  });
});


clearButton.addEventListener("click", async () => {
  const sites =
    await getSites();

  if (
    sites.length === 0 &&
    !(await confirmDanger({
      title: t("clearEverythingTitle"),
      lines: [
        t("clearEverythingText", CLEARED_DATA),
        t("cannotRecover", CLEARED_DATA)
      ],
      action: t("clearEverything")
    }))
  ) {
    return;
  }

  await requestClear("clear-now");
});


leftoversButton.addEventListener("click", async () => {
  const hasKeptSites =
    (await getSites()).length > 0;

  if (
    !(await confirmDanger({
      title: t("leftoversTitle"),
      lines: [
        hasKeptSites
          ? t("leftoversKept", CLEARED_DATA)
          : t("clearEverythingText", CLEARED_DATA),
        ...(hasKeptSites
          ? [t("leftoversSubdomains")]
          : []),
        t("cannotRecover", CLEARED_DATA)
      ],
      action: t("clearLeftovers")
    }))
  ) {
    return;
  }

  leftoversStatus.classList.remove("error");
  leftoversStatus.textContent =
    t("clearing");

  const result =
    await requestClear("clear-leftovers");

  leftoversStatus.classList.toggle("error", Boolean(result.failed));
  leftoversStatus.textContent = result.failed
    ? t("leftoversFailed")
    : t("leftoversCleared");
});


// Asks the background script for a clear, then shows how it went.
async function requestClear(type) {
  clearButton.disabled = true;
  leftoversButton.disabled = true;
  lastClearStatus.classList.remove("error");
  lastClearStatus.textContent =
    t("clearing");

  let result;

  try {
    const response =
      await extensionApi.runtime.sendMessage({ type });

    result = response?.ok
      ? response.result
      : { time: Date.now(), failed: true };
  } catch (error) {
    console.error(error);

    result = {
      time: Date.now(),
      failed: true
    };
  }

  renderLastClear(result);

  clearButton.disabled = false;
  leftoversButton.disabled = false;

  return result;
}


extensionApi.storage.onChanged.addListener(
  (changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes.keptSites) {
      renderSites().catch((error) => {
        console.error(error);
      });
    }

    if (changes.clearOnStartup) {
      renderClearOnStartup(
        changes.clearOnStartup.newValue === true
      );
    }

    if (
      changes.lastClear &&
      !clearButton.disabled
    ) {
      renderLastClear(
        changes.lastClear.newValue
      );
    }
  }
);


extensionApi.permissions.onAdded.addListener(renderAccess);

extensionApi.permissions.onRemoved.addListener(renderAccess);


Promise.all([
  renderSites(),
  renderAccess(),
  renderSettings()
]).catch((error) => {
  console.error(error);

  setMessage(
    t("loadFailed"),
    "error"
  );
});
