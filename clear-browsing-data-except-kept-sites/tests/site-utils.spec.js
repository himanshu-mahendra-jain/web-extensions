import { test, expect } from "@playwright/test";

import {
  KeptSites,
  SITE_ORIGINS,
  isValidSite,
  normalizeSite,
  parseSites,
  sanitizeSites
} from "../src/site-utils.js";


test.describe("normalizeSite", () => {
  for (const [input, site] of [
    ["example.com", "example.com"],
    ["  https://www.Example.COM/path?q=1  ", "example.com"],
    ["http://mail.example.co.uk:8080/", "mail.example.co.uk"],
    ["example.com.", "example.com"],
    ["localhost", "localhost"],
    ["http://localhost:3000/app", "localhost"],
    ["192.168.0.1", "192.168.0.1"],
    ["http://10.0.0.138/admin", "10.0.0.138"]
  ]) {
    test(`turns ${JSON.stringify(input)} into ${site}`, () => {
      expect(normalizeSite(input)).toBe(site);
    });
  }


  for (const input of ["", "   ", "intranet", "-bad.com", "exa mple.com"]) {
    test(`rejects ${JSON.stringify(input)}`, () => {
      expect(normalizeSite(input)).toBeNull();
    });
  }
});


test.describe("parseSites", () => {
  test("reads sites separated by commas, semicolons and new lines", () => {
    expect(parseSites("a.test, https://www.b.test/x;c.test\r\nd.test\n\n e.test ,")).toEqual({
      sites: ["a.test", "b.test", "c.test", "d.test", "e.test"],
      invalid: []
    });
  });


  test("lists each site once, in the order given", () => {
    expect(parseSites("b.test, a.test, www.b.test").sites).toEqual(["b.test", "a.test"]);
  });


  test("reports the entries that are not sites, as typed", () => {
    expect(parseSites("a.test, intranet , exa mple.com")).toEqual({
      sites: ["a.test"],
      invalid: ["intranet", "exa mple.com"]
    });
  });


  test("finds nothing in empty text", () => {
    expect(parseSites(" , \n ")).toEqual({ sites: [], invalid: [] });
  });
});


test("isValidSite accepts domains, localhost and IPv4 addresses only", () => {
  for (const site of ["example.com", "a-b.example.org", "localhost", "0.0.0.0", "255.255.255.255"]) {
    expect(isValidSite(site), site).toBe(true);
  }

  for (const site of [
    undefined,
    42,
    "",
    "com",
    "example.c",
    "256.1.1.1",
    "01.2.3.4",
    "1.2.3",
    "1.2.3.4.5",
    "[::1]",
    `${"a".repeat(64)}.com`
  ]) {
    expect(isValidSite(site), String(site)).toBe(false);
  }
});


test("sanitizeSites keeps valid sites once, sorted", () => {
  expect(
    sanitizeSites(["b.com", "localhost", "a.com", "b.com", "bad", null])
  ).toEqual(["a.com", "b.com", "localhost"]);

  expect(sanitizeSites(undefined)).toEqual([]);
});


test("SITE_ORIGINS covers every HTTP and HTTPS site", () => {
  expect(SITE_ORIGINS).toEqual(["http://*/*", "https://*/*"]);
});


test.describe("KeptSites.hasUrl", () => {
  const sites = ["example.com", "localhost"];

  const isKeptUrl = (url, keptSites) => new KeptSites(keptSites).hasUrl(url);


  test("keeps a kept site and its subdomains", () => {
    expect(isKeptUrl("https://example.com/inbox", sites)).toBe(true);
    expect(isKeptUrl("http://mail.example.com/", sites)).toBe(true);
    expect(isKeptUrl("https://a.b.example.com/x", sites)).toBe(true);
    expect(isKeptUrl("http://localhost:3000/", sites)).toBe(true);
  });


  test("does not keep look-alikes, parents or other sites", () => {
    expect(isKeptUrl("https://notexample.com/", sites)).toBe(false);
    expect(isKeptUrl("https://example.com.evil.net/", sites)).toBe(false);
    expect(isKeptUrl("https://com/", sites)).toBe(false);
    expect(isKeptUrl("https://other.org/", sites)).toBe(false);
  });


  test("does not keep URLs without a host", () => {
    expect(isKeptUrl("file:///home/user/example.com", sites)).toBe(false);
    expect(isKeptUrl("not a url", sites)).toBe(false);
    expect(isKeptUrl("https://example.com/", [])).toBe(false);
  });
});


test.describe("KeptSites.hasCookieDomain", () => {
  const sites = ["mail.example.com"];

  const isKeptCookieDomain = (domain, keptSites) => new KeptSites(keptSites).hasCookieDomain(domain);


  test("keeps cookies of the kept site and its subdomains", () => {
    expect(isKeptCookieDomain("mail.example.com", sites)).toBe(true);
    expect(isKeptCookieDomain(".mail.example.com", sites)).toBe(true);
    expect(isKeptCookieDomain("eu.mail.example.com", sites)).toBe(true);
  });


  test("keeps cookies of parent domains, which the kept site receives", () => {
    expect(isKeptCookieDomain(".example.com", sites)).toBe(true);
    expect(isKeptCookieDomain("example.com", sites)).toBe(true);
  });


  test("does not keep cookies of sibling or unrelated domains", () => {
    expect(isKeptCookieDomain("drive.example.com", sites)).toBe(false);
    expect(isKeptCookieDomain(".notmail.example.com", sites)).toBe(false);
    expect(isKeptCookieDomain(".other.com", sites)).toBe(false);
    expect(isKeptCookieDomain(".", sites)).toBe(false);
  });
});


test.describe("KeptSites.hasSubdomainOf", () => {
  test("names the domains a kept site is under, not the site or its subdomains", () => {
    const kept = new KeptSites(["mail.example.com", "localhost"]);

    expect(kept.hasSubdomainOf("example.com")).toBe(true);
    expect(kept.hasSubdomainOf("com")).toBe(true);
    expect(kept.hasSubdomainOf("mail.example.com")).toBe(false);
    expect(kept.hasSubdomainOf("eu.mail.example.com")).toBe(false);
    expect(kept.hasSubdomainOf("ample.com")).toBe(false);
    expect(kept.hasSubdomainOf("localhost")).toBe(false);
  });
});
