import "../src/extension-api.js";
import { localizePage, t } from "../src/i18n.js";
import {
  getSiteOrigins,
  normalizeSite,
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
      "automaticSites"
    );

  return sanitizeSites(
    result.automaticSites
  );
}


function originMatchesSite(origin, site) {
  const match =
    origin.toLowerCase().match(
      /^[a-z*]+:\/\/(?:\*\.)?([^/]+)/
    );

  if (!match) {
    return false;
  }

  const hostname =
    match[1].replace(/\.$/, "");

  return (
    hostname === site ||
    hostname.endsWith(`.${site}`)
  );
}


async function getCurrentSiteOrigins(site) {
  const permissions =
    await extensionApi.permissions.getAll();

  return (permissions.origins || [])
    .filter((origin) => {
      return originMatchesSite(
        origin,
        site
      );
    });
}


async function hasSitePermission(site) {
  const origins =
    await getCurrentSiteOrigins(site);

  return origins.length > 0;
}


async function removeSitePermissions(site) {
  const origins =
    await getCurrentSiteOrigins(site);

  if (origins.length === 0) {
    return;
  }

  const removed =
    await extensionApi.permissions.remove({
      origins
    });

  if (
    !removed ||
    await hasSitePermission(site)
  ) {
    throw new Error(
      "Site permission could not be removed."
    );
  }
}


async function requestSync() {
  const response =
    await extensionApi.runtime.sendMessage({
      type: "sync-automatic-sites"
    });

  if (!response?.ok) {
    throw new Error(
      "Automatic-site synchronization failed."
    );
  }
}


async function renderSites() {
  const sites =
    await getSites();

  if (sites.length === 0) {
    list.replaceChildren();
    list.hidden = true;

    if (emptyState) {
      emptyState.hidden = false;
    }

    return;
  }

  if (emptyState) {
    emptyState.hidden = true;
  }

  list.hidden = false;

  // One call for all the sites, however many there are.
  const { origins = [] } =
    await extensionApi.permissions.getAll();

  const entries =
    sites.map((site) => ({
      site,
      hasPermission:
        origins.some((origin) => {
          return originMatchesSite(
            origin,
            site
          );
        })
    }));


  const fragment =
    document.createDocumentFragment();


  entries.forEach(
    (
      {
        site,
        hasPermission
      },
      index
    ) => {
      const item =
        document.createElement("li");

      const label =
        document.createElement("span");

      const removeButton =
        document.createElement("button");


      label.textContent = hasPermission
        ? site
        : t("permissionRemoved", site);


      removeButton.type = "button";
      removeButton.textContent = t("remove");

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
    }
  );


  list.replaceChildren(fragment);
}


async function addSite(
  site,
  hadPermission,
  granted
) {
  if (!granted) {
    setMessage(
      t("permissionNotGranted"),
      "error"
    );

    return;
  }


  const sites =
    await getSites();


  if (sites.includes(site)) {
    if (hadPermission) {
      setMessage(
        t("siteAlreadyEnabled"),
        "status"
      );

      return;
    }


    try {
      await requestSync();
    } catch (error) {
      await takeBackPermission(site);

      throw error;
    }

    input.removeAttribute("aria-invalid");

    setMessage(
      t("siteReEnabled", site),
      "success"
    );

    await renderSites();

    return;
  }


  const updatedSites =
    [...sites, site].sort();

  let stored = false;


  // A site that is not fully added is not kept at all.
  try {
    await extensionApi.storage.local.set({
      automaticSites: updatedSites
    });

    stored = true;

    await requestSync();
  } catch (error) {
    if (stored) {
      await extensionApi.storage.local.set({
        automaticSites: sites
      }).catch((rollbackError) => {
        console.error(
          "Site list rollback failed:",
          rollbackError
        );
      });
    }

    await takeBackPermission(site);

    throw error;
  }


  input.value = "";
  input.removeAttribute("aria-invalid");

  setMessage(
    t("siteAdded", site),
    "success"
  );

  await renderSites();
}


// Undoes the permission request of a site that could not be added.
async function takeBackPermission(site) {
  await extensionApi.permissions.remove({
    origins: getSiteOrigins(site)
  }).catch((rollbackError) => {
    console.error(
      "Permission rollback failed:",
      rollbackError
    );
  });
}


async function removeSite(site) {
  const sites =
    await getSites();

  const updatedSites =
    sites.filter(
      (item) => item !== site
    );


  await extensionApi.storage.local.set({
    automaticSites: updatedSites
  });

  await requestSync();


  try {
    await removeSitePermissions(site);
  } catch (error) {
    await extensionApi.storage.local.set({
      automaticSites: sites
    });

    await requestSync().catch((syncError) => {
      console.error(
        "Permission rollback sync failed:",
        syncError
      );
    });

    throw error;
  }


  setMessage(
    t("siteRemoved", site),
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

    const site =
      normalizeSite(input.value);


    if (!site) {
      input.setAttribute(
        "aria-invalid",
        "true"
      );

      setMessage(
        t("invalidDomain"),
        "error"
      );

      input.focus();

      return;
    }

    input.removeAttribute("aria-invalid");


    const origins =
      getSiteOrigins(site);


    /*
     * These calls must start directly inside the
     * user-input handler, before the first await.
     *
     * Firefox requires permissions.request() to be
     * initiated while the user gesture is still active.
     */
    const permissionCheck =
      extensionApi.permissions.contains({
        origins
      });

    const permissionRequest =
      extensionApi.permissions.request({
        origins
      });


    setBusy(true);


    try {
      const [
        hadPermission,
        granted
      ] = await Promise.all([
        permissionCheck,
        permissionRequest
      ]);


      await addSite(
        site,
        hadPermission,
        granted
      );
    } catch (error) {
      console.error(error);

      setMessage(
        t("addFailed"),
        "error"
      );
    } finally {
      setBusy(false);
    }
  }
);


localizePage();

renderSites().catch((error) => {
  console.error(error);

  setMessage(
    t("loadFailed"),
    "error"
  );
});