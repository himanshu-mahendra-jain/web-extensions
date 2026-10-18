// Host permissions the cookies API needs to see and remove every cookie.
export const SITE_ORIGINS = [
  "http://*/*",
  "https://*/*"
];


export function normalizeSite(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`
    );

    let hostname = url.hostname
      .toLowerCase()
      .replace(/\.$/, "");

    if (hostname.startsWith("www.")) {
      hostname = hostname.slice(4);
    }

    return isValidSite(hostname)
      ? hostname
      : null;
  } catch {
    return null;
  }
}


function isIpv4Address(site) {
  const parts = site.split(".");

  return (
    parts.length === 4 &&
    parts.every((part) => {
      return (
        /^(?:0|[1-9][0-9]{0,2})$/.test(part) &&
        Number(part) <= 255
      );
    })
  );
}


/*
 * Reads the sites in text separated by commas, semicolons or
 * new lines, as typed in the field or read from an imported
 * file. Spaces do not separate sites, so a typo such as
 * "exa mple.com" is reported instead of keeping "mple.com".
 */
export function parseSites(text) {
  const sites = [];
  const invalid = [];

  for (const entry of text.split(/[,;\r\n]+/)) {
    const trimmed = entry.trim();

    if (!trimmed) {
      continue;
    }

    const site = normalizeSite(trimmed);

    if (!site) {
      invalid.push(trimmed);
    } else if (!sites.includes(site)) {
      sites.push(site);
    }
  }

  return { sites, invalid };
}


export function isValidSite(site) {
  if (
    typeof site !== "string" ||
    site.length === 0 ||
    site.length > 253
  ) {
    return false;
  }

  /*
   * Local development servers and router admin pages
   * keep their logins in cookies too.
   */
  if (
    site === "localhost" ||
    isIpv4Address(site)
  ) {
    return true;
  }

  if (!site.includes(".")) {
    return false;
  }

  const labels = site.split(".");
  const topLevelDomain =
    labels[labels.length - 1];

  if (!/^[a-z]{2,63}$/i.test(topLevelDomain)) {
    return false;
  }

  return labels.every((label) => {
    if (
      label.length === 0 ||
      label.length > 63
    ) {
      return false;
    }

    return (
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i
        .test(label)
    );
  });
}


export function sanitizeSites(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value.filter(isValidSite)
    )
  ].sort();
}


export function normalizeHost(host) {
  return host
    .toLowerCase()
    .replace(/^\./, "")
    .replace(/\.$/, "");
}


// The domains a host is under, itself first: a.example.com, example.com, com.
function* hostAndParents(hostname) {
  for (
    let index = 0;
    index !== -1;
    index = hostname.indexOf(".", index) + 1 || -1
  ) {
    yield hostname.slice(index);
  }
}


/*
 * The kept sites, for the many lookups of one clear. A host is looked
 * up by the domains it is under, so a lookup costs one Set check per
 * label of the host, however many sites are kept.
 */
export class KeptSites {
  #sites;

  // Every domain a kept site is under, as example.com for mail.example.com.
  #parents = new Set();

  constructor(sites) {
    this.#sites = new Set(sites);

    for (const site of sites) {
      for (const domain of hostAndParents(site)) {
        if (domain !== site) {
          this.#parents.add(domain);
        }
      }
    }
  }

  // A host is kept when it is a kept site or one of its subdomains.
  hasHost(hostname) {
    for (const domain of hostAndParents(hostname)) {
      if (this.#sites.has(domain)) {
        return true;
      }
    }

    return false;
  }

  // Whether a kept site is a subdomain of host, as mail.example.com is of example.com.
  hasSubdomainOf(host) {
    return this.#parents.has(host);
  }

  /*
   * A history entry, and a site's local storage, IndexedDB and
   * cache, are kept when their host is a kept host.
   */
  hasUrl(url) {
    let hostname;

    try {
      hostname = normalizeHost(
        new URL(url).hostname
      );
    } catch {
      return false;
    }

    return hostname !== "" && this.hasHost(hostname);
  }

  /*
   * A cookie is kept when it belongs to a kept site, one of
   * its subdomains, or a parent domain. Parent-domain cookies,
   * such as .example.com for a kept mail.example.com, are sent
   * to the kept site and often hold its login.
   */
  hasCookieDomain(domain) {
    const hostname =
      normalizeHost(domain);

    return (
      hostname !== "" &&
      (this.hasHost(hostname) || this.#parents.has(hostname))
    );
  }
}
