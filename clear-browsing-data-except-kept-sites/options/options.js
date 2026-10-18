import "../src/extension-api.js";
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
 * What a clear deletes, as the page names it. Firefox for Android
 * has no history API, and browsingData is missing when its
 * permission was not granted.
 */
const CLEARABLE = [
  ...(extensionApi.history ? ["history"] : []),
  "cookies",
  ...(extensionApi.browsingData ? ["site data"] : [])
];


function joinList(items) {
  return items.length > 1
    ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
    : items[0];
}


function capitalize(text) {
  return `${text[0].toUpperCase()}${text.slice(1)}`;
}


const CLEARED_DATA =
  joinList(CLEARABLE);


// Firefox can clear site data only of the sites it names.
const CAN_CLEAR_LEFTOVERS =
  Boolean(extensionApi.browsingData) &&
  !extensionApi.runtime.getURL("").startsWith("moz-extension:");


const dateFormat =
  new Intl.DateTimeFormat(undefined, {
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
    removeButton.textContent = "Remove";
    removeButton.disabled = operationInProgress;

    removeButton.setAttribute(
      "aria-label",
      `Remove ${site}`
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
            "The site could not be removed.",
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


function countSites(count) {
  return countText(count, "site", "sites");
}


// Says what happened to each site entered, in one message.
function describeEntries({ added, kept, invalid }) {
  const parts = [];

  if (added.length === 1) {
    parts.push(`${added[0]} kept.`);
  } else if (added.length > 1) {
    parts.push(`${countSites(added.length)} kept.`);
  }

  if (kept.length === 1) {
    parts.push(`${kept[0]} is already kept.`);
  } else if (kept.length > 1) {
    parts.push(`${countSites(kept.length)} are already kept.`);
  }

  if (invalid.length > 0) {
    parts.push(describeInvalid(invalid));
  }

  return parts.join(" ");
}


function describeInvalid(invalid) {
  return invalid.length === 1
    ? `${invalid[0]} is not a valid domain.`
    : `These are not valid domains: ${invalid.join(", ")}.`;
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
    `${site} removed. Its ${CLEARED_DATA} will be deleted at the next clear.`,
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
      `${file.name} is larger than 1 MB, so the kept sites were not changed.`,
      "error"
    );

    return;
  }

  const { sites, invalid } =
    parseSites(await file.text());

  if (sites.length === 0) {
    setTransferStatus(
      `${file.name} has no valid domains, so the kept sites were not changed.`,
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
      title: "Replace kept sites?",
      lines: [
        `The ${countSites(current.length)} you keep now will be replaced with the ${countSites(sites.length)} in ${file.name}.`,
        `${countSites(dropped.length)} will no longer be kept, and ${dropped.length === 1 ? "its" : "their"} ${CLEARED_DATA} will be deleted at the next clear.`
      ],
      action: "Replace Kept Sites"
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
      `${countSites(sites.length)} imported from ${file.name}.`,
      ...(invalid.length > 0 ? [describeInvalid(invalid)] : [])
    ].join(" "),
    invalid.length > 0 ? "error" : "success"
  );
}


// What is cleared without site access, which only cookies need.
const CLEARED_WITHOUT_ACCESS =
  CLEARABLE.filter((item) => item !== "cookies");

accessText.textContent =
  CLEARED_WITHOUT_ACCESS.length > 0
    ? `Without access to websites, the extension cannot delete cookies. ${capitalize(joinList(CLEARED_WITHOUT_ACCESS))} ${CLEARED_WITHOUT_ACCESS.length > 1 ? "are" : "is"} still cleared.`
    : "Without access to websites, the extension cannot delete cookies, so nothing is cleared.";

clearingOffText.textContent =
  `Nothing is deleted yet. Add the sites you want to stay signed in to, then turn clearing on. From then on, each time the browser starts, the ${CLEARED_DATA} of every other site are deleted.`;

intro.textContent =
  `These sites and their subdomains keep their ${CLEARED_DATA}, so you stay signed in. While clearing is on, every other site loses them each time the browser starts.`;

emptyState.textContent =
  `No sites are kept yet, so a clear deletes the ${CLEARED_DATA} of every site.`;

leftoversSection.hidden = !CAN_CLEAR_LEFTOVERS;


async function renderAccess() {
  const hasAccess =
    await extensionApi.permissions.contains({
      origins: SITE_ORIGINS
    });

  accessWarning.hidden = hasAccess;
}


function countText(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}


function renderLastClear(lastClear) {
  lastClearStatus.classList.remove("error");

  if (!lastClear) {
    lastClearStatus.textContent =
      "Nothing has been cleared yet.";

    return;
  }

  const when =
    dateFormat.format(new Date(lastClear.time));

  if (lastClear.failed) {
    lastClearStatus.classList.add("error");

    lastClearStatus.textContent =
      `Clearing on ${when} failed.`;

    return;
  }

  const removed = [];
  const skipped = [];

  // Firefox for Android lets extensions clear neither of these.
  const unsupported = [
    ...(lastClear.historySkipped ? ["history"] : []),
    ...(lastClear.siteDataSkipped ? ["site data"] : [])
  ];

  if (unsupported.length > 0) {
    const several = unsupported.length > 1;

    skipped.push(
      `${capitalize(joinList(unsupported))} ${several ? "were" : "was"} skipped because this browser does not let extensions clear ${several ? "them" : "it"}.`
    );
  }

  if (!lastClear.historySkipped) {
    removed.push(countText(
      lastClear.historyRemoved,
      "history entry",
      "history entries"
    ));
  }

  if (lastClear.cookiesSkipped) {
    skipped.push(
      "Cookies were skipped because site access is off."
    );
  } else {
    removed.push(countText(
      lastClear.cookiesRemoved,
      "cookie",
      "cookies"
    ));
  }

  const alsoCleared = lastClear.leftoversCleared
    ? ", along with the site data and cache of every site not kept"
    : lastClear.siteDataCleared
      ? ", along with site data and cache"
      : "";

  lastClearStatus.textContent = [
    `Last cleared ${when}: ${removed.join(" and ") || "nothing"} deleted${alsoCleared}.`,
    ...skipped
  ].join(" ");
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
    title: "Turn on clearing?",
    lines: [
      hasKeptSites
        ? `Each time the browser starts, ${CLEARED_DATA} will be deleted for every site except the ones you selected to keep. You will be signed out of all other sites.`
        : `You have not selected any sites to keep. Each time the browser starts, all ${CLEARED_DATA} will be deleted, and you will be signed out of every site.`,
      `Deleted ${CLEARED_DATA} cannot be recovered.`
    ],
    action: "Turn On Clearing"
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
          : "Enter a valid domain, such as example.com.",
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
          ? "The sites could not be added."
          : "The site could not be added.",
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
      "The kept sites could not be exported.",
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
      `The kept sites could not be imported from ${file.name}.`,
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
      title: "Clear everything now?",
      lines: [
        `You have not selected any sites to keep, so the ${CLEARED_DATA} of every site will be deleted now, and you will be signed out of every site.`,
        `Deleted ${CLEARED_DATA} cannot be recovered.`
      ],
      action: "Clear Everything"
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
      title: "Clear leftover site data?",
      lines: [
        hasKeptSites
          ? `The ${CLEARED_DATA} of every site you do not keep will be deleted now, including the site data of sites the extension no longer finds.`
          : `You have not selected any sites to keep, so the ${CLEARED_DATA} of every site will be deleted now, and you will be signed out of every site.`,
        ...(hasKeptSites
          ? ["A kept site keeps its site data only at the addresses the extension finds in history, cookies and open tabs. Any other subdomain or port of a kept site, such as one you have not visited for months or a local server on another port, loses its site data, and you may be signed out of it."]
          : []),
        `Deleted ${CLEARED_DATA} cannot be recovered.`
      ],
      action: "Clear Leftovers"
    }))
  ) {
    return;
  }

  leftoversStatus.classList.remove("error");
  leftoversStatus.textContent =
    "Clearing… This can take a few minutes.";

  const result =
    await requestClear("clear-leftovers");

  leftoversStatus.classList.toggle("error", Boolean(result.failed));
  leftoversStatus.textContent = result.failed
    ? "Clearing leftover site data failed."
    : "Leftover site data cleared.";
});


// Asks the background script for a clear, then shows how it went.
async function requestClear(type) {
  clearButton.disabled = true;
  leftoversButton.disabled = true;
  lastClearStatus.classList.remove("error");
  lastClearStatus.textContent =
    "Clearing… This can take a few minutes.";

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
    "The settings could not be loaded.",
    "error"
  );
});
