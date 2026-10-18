import "./extension-api.js";
import {
  KeptSites,
  SITE_ORIGINS,
  normalizeHost,
  sanitizeSites
} from "./site-utils.js";


const HISTORY_PAGE_SIZE = 1000;

const REMOVE_BATCH_SIZE = 50;

const IS_FIREFOX =
  extensionApi.runtime.getURL("")
    .startsWith("moz-extension:");

const DEFAULT_COOKIE_STORE_ID = IS_FIREFOX
  ? "firefox-default"
  : "0";


/*
 * The sites that are not kept, as one clear finds them in history,
 * cookies and open tabs. Their site data is cleared afterwards:
 * by origin in Chromium, by host in Firefox. The kept origins found
 * are what a leftovers clear spares.
 */
export class SeenSites {
  unkeptOrigins = new Set();

  unkeptHosts = new Set();

  keptOrigins = new Set();

  constructor(sites) {
    this.sites = sites;
    this.kept = new KeptSites(sites);
  }

  // Adds the site of an http or https URL; returns whether its host is kept.
  addUrl(value) {
    let url;

    try {
      url = new URL(value);
    } catch {
      return false;
    }

    const hostname = normalizeHost(url.hostname);

    if (!hostname) {
      return false;
    }

    if (!["http:", "https:"].includes(url.protocol)) {
      return this.kept.hasHost(hostname);
    }

    return this.addHost(hostname, url.origin);
  }

  // Cookies name a host but not its scheme or port.
  addCookieDomain(domain) {
    const host = normalizeHost(domain);

    if (host) {
      this.addHost(host);
    }
  }

  // A cookie kept only for a subdomain, as on parent.test, names no kept host.
  addKeptCookieDomain(domain) {
    const host = normalizeHost(domain);

    if (host && this.kept.hasHost(host)) {
      this.addHost(host);
    }
  }

  // Returns whether the host is kept.
  addHost(host, origin) {
    const hostname = normalizeHost(host);

    const origins = origin
      ? [origin]
      : [`http://${hostname}`, `https://${hostname}`];

    if (this.kept.hasHost(hostname)) {
      for (const keptOrigin of origins) {
        this.keptOrigins.add(keptOrigin);
      }

      return true;
    }

    this.unkeptHosts.add(hostname);

    for (const unkeptOrigin of origins) {
      this.unkeptOrigins.add(unkeptOrigin);
    }

    return false;
  }
}


async function removeInBatches(items, remove) {
  let removed = 0;

  for (
    let index = 0;
    index < items.length;
    index += REMOVE_BATCH_SIZE
  ) {
    const results =
      await Promise.all(
        items
          .slice(index, index + REMOVE_BATCH_SIZE)
          .map(remove)
      );

    removed += results
      .filter(Boolean)
      .length;
  }

  return removed;
}


/*
 * history.search() returns at most one page of the most recent
 * pages. Deleting the unkept ones lets the next search reach
 * older pages. A page made only of kept entries would hide
 * everything older, so that time range is split in half.
 */
async function clearHistoryRange(
  startTime,
  endTime,
  seen,
  attempted
) {
  let removed = 0;

  for (;;) {
    const items =
      await extensionApi.history.search({
        text: "",
        startTime,
        endTime,
        maxResults: HISTORY_PAGE_SIZE
      });

    const urls = items
      .map((item) => item.url)
      .filter((url) => {
        if (!url || attempted.has(url)) {
          return false;
        }

        return !seen.addUrl(url);
      });

    for (const url of urls) {
      attempted.add(url);
    }

    removed += await removeInBatches(
      urls,
      async (url) => {
        await extensionApi.history.deleteUrl({
          url
        });

        return true;
      }
    );

    if (items.length < HISTORY_PAGE_SIZE) {
      return removed;
    }

    if (urls.length > 0) {
      continue;
    }

    if (endTime - startTime <= 1) {
      return removed;
    }

    const middle =
      Math.floor((startTime + endTime) / 2);

    removed += await clearHistoryRange(
      middle,
      endTime,
      seen,
      attempted
    );

    removed += await clearHistoryRange(
      startTime,
      middle,
      seen,
      attempted
    );

    return removed;
  }
}


export function clearHistory(
  sites,
  seen = new SeenSites(sites)
) {
  return clearHistoryRange(
    0,
    Date.now(),
    seen,
    new Set()
  );
}


async function getCookieStoreIds() {
  const storeIds = new Set([
    DEFAULT_COOKIE_STORE_ID
  ]);

  /*
   * getAllCookieStores() lists only the stores that
   * have an open tab, so the default store and the
   * Firefox containers are added explicitly.
   */
  const stores =
    await extensionApi.cookies.getAllCookieStores();

  for (const store of stores) {
    storeIds.add(store.id);
  }

  if (extensionApi.contextualIdentities) {
    // query() rejects when containers are turned off.
    const identities =
      await extensionApi.contextualIdentities
        .query({})
        .catch(() => []);

    for (const identity of identities) {
      storeIds.add(identity.cookieStoreId);
    }
  }

  return [...storeIds];
}


async function getAllCookies(storeId) {
  const details = {
    storeId,
    partitionKey: {}
  };

  if (IS_FIREFOX) {
    details.firstPartyDomain = null;
  }

  return extensionApi.cookies.getAll(details);
}


async function removeCookie(cookie) {
  const host =
    cookie.domain.replace(/^\./, "");

  const details = {
    url: `${cookie.secure ? "https" : "http"}://${host}${cookie.path}`,
    name: cookie.name,
    storeId: cookie.storeId
  };

  if (cookie.partitionKey) {
    details.partitionKey = cookie.partitionKey;
  }

  if (IS_FIREFOX) {
    details.firstPartyDomain =
      cookie.firstPartyDomain;
  }

  try {
    return Boolean(
      await extensionApi.cookies.remove(details)
    );
  } catch (error) {
    console.error(
      `[Clear Browsing Data] Could not remove cookie ${cookie.name} for ${cookie.domain}:`,
      error
    );

    return false;
  }
}


/*
 * A partitioned cookie, such as one a video embedded in another site
 * sets, is sent only under that site, so it is kept only when that
 * site is kept as well.
 */
function isKeptCookie(cookie, kept) {
  if (!kept.hasCookieDomain(cookie.domain)) {
    return false;
  }

  const topLevelSite =
    cookie.partitionKey?.topLevelSite;

  if (!topLevelSite) {
    return true;
  }

  let url;

  try {
    url = new URL(topLevelSite);
  } catch {
    return true;
  }

  return kept.hasCookieDomain(url.hostname);
}


export async function clearCookies(
  sites,
  seen = new SeenSites(sites)
) {
  let removed = 0;

  for (const storeId of await getCookieStoreIds()) {
    const cookies =
      await getAllCookies(storeId);

    const unkept = [];

    for (const cookie of cookies) {
      // The site a cookie is partitioned under was visited too.
      if (cookie.partitionKey?.topLevelSite) {
        seen.addUrl(cookie.partitionKey.topLevelSite);
      }

      if (isKeptCookie(cookie, seen.kept)) {
        seen.addKeptCookieDomain(cookie.domain);
      } else {
        seen.addCookieDomain(cookie.domain);
        unkept.push(cookie);
      }
    }

    removed += await removeInBatches(
      unkept,
      removeCookie
    );
  }

  return removed;
}


const STORAGE_TYPES = {
  indexedDB: true,
  localStorage: true
};

const CHROMIUM_SITE_DATA_TYPES = {
  ...STORAGE_TYPES,
  serviceWorkers: true,
  cache: true,
  cacheStorage: true
};


/*
 * Clears the local storage, IndexedDB, service workers and cache
 * of the sites found that are not kept. Only those are named, so
 * no subdomain of a kept site is ever touched, seen or not; a site
 * that is not kept and never found keeps its data. Firefox clears
 * the whole cache, since it cannot clear cache by site.
 */
export async function clearSiteData(seen) {
  if (IS_FIREFOX) {
    const hosts = [...seen.unkeptHosts];

    // Firefox clears the service workers of a host's subdomains with it.
    const workerHosts = hosts.filter(
      (host) => !seen.kept.hasSubdomainOf(host)
    );

    if (hosts.length > 0) {
      await extensionApi.browsingData.remove(
        { hostnames: hosts },
        STORAGE_TYPES
      );
    }

    if (workerHosts.length > 0) {
      await extensionApi.browsingData.remove(
        { hostnames: workerHosts },
        { serviceWorkers: true }
      );
    }

    await extensionApi.browsingData.removeCache({});

    return;
  }

  if (seen.unkeptOrigins.size === 0) {
    return;
  }

  await extensionApi.browsingData.remove(
    { origins: [...seen.unkeptOrigins] },
    CHROMIUM_SITE_DATA_TYPES
  );
}


/*
 * Clears the site data of every site except the kept ones, found or
 * not, in Chromium. A kept origin is spared only when this clear
 * found it, or it is a kept site itself, so a kept subdomain that
 * nothing names loses its data. Firefox cannot clear all but some.
 */
export async function clearLeftoverSiteData(seen) {
  const keptOrigins = new Set(seen.keptOrigins);

  for (const site of seen.sites) {
    keptOrigins.add(`http://${site}`);
    keptOrigins.add(`https://${site}`);
  }

  await extensionApi.browsingData.remove(
    keptOrigins.size > 0
      ? { excludeOrigins: [...keptOrigins] }
      : {},
    CHROMIUM_SITE_DATA_TYPES
  );
}


// Tabs restored at startup may be on sites history lacks.
async function addOpenTabs(seen) {
  const tabs = await extensionApi.tabs.query({});

  for (const tab of tabs) {
    if (tab.url) {
      seen.addUrl(tab.url);
    }
  }
}


export function hasSiteAccess() {
  return extensionApi.permissions.contains({
    origins: SITE_ORIGINS
  });
}


/*
 * With leftovers, Chromium clears the site data of every site that is
 * not kept, including those no longer found anywhere.
 */
export async function clearUnkeptData({ leftovers = false } = {}) {
  const { keptSites } =
    await extensionApi.storage.local.get(
      "keptSites"
    );

  const sites =
    sanitizeSites(keptSites);

  const result = {
    time: Date.now(),
    historyRemoved: 0,
    historySkipped: false,
    cookiesRemoved: 0,
    cookiesSkipped: false,
    siteDataCleared: false,
    siteDataSkipped: false,
    leftoversCleared: false,
    failed: false
  };

  const seen = new SeenSites(sites);

  try {
    // Firefox for Android has no history API.
    if (extensionApi.history) {
      result.historyRemoved =
        await clearHistory(sites, seen);
    } else {
      result.historySkipped = true;
    }

    /*
     * Without site access cookies.getAll() returns
     * nothing, so the run would look successful
     * while clearing no cookies.
     */
    if (await hasSiteAccess()) {
      result.cookiesRemoved =
        await clearCookies(sites, seen);
    } else {
      result.cookiesSkipped = true;
    }

    // Missing when the browsingData permission was not granted.
    if (extensionApi.browsingData) {
      await addOpenTabs(seen);

      if (leftovers && !IS_FIREFOX) {
        await clearLeftoverSiteData(seen);

        result.leftoversCleared = true;
      } else {
        await clearSiteData(seen);
      }

      result.siteDataCleared = true;
    } else {
      result.siteDataSkipped = true;
    }
  } catch (error) {
    result.failed = true;

    throw error;
  } finally {
    await extensionApi.storage.local.set({
      lastClear: result
    });
  }

  return result;
}
