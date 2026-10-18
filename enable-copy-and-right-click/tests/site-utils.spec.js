import { test, expect } from "@playwright/test";

import {
  getSiteOrigins,
  isValidSite,
  normalizeSite,
  sanitizeSites
} from "../src/site-utils.js";


test.describe("normalizeSite", () => {
  for (const [input, site] of [
    ["example.com", "example.com"],
    ["  https://www.Example.COM/path?q=1  ", "example.com"],
    ["http://sub.example.co.uk:8080/", "sub.example.co.uk"],
    ["ftp://Example.com", "example.com"],
    ["user:pw@example.com", "example.com"],
    ["example.com.", "example.com"],
    ["www.www.example.com", "www.example.com"],
    ["www2.example.com", "www2.example.com"],
    ["例え.jp", "xn--r8jz45g.jp"]
  ]) {
    test(`turns ${JSON.stringify(input)} into ${site}`, () => {
      expect(normalizeSite(input)).toBe(site);
    });
  }


  for (const input of [
    "",
    "   ",
    "localhost",
    "192.168.0.1",
    "-bad.com",
    "exa mple.com",
    "example.c0m"
  ]) {
    test(`rejects ${JSON.stringify(input)}`, () => {
      expect(normalizeSite(input)).toBeNull();
    });
  }
});


test.describe("isValidSite", () => {
  test("accepts lowercase domain names", () => {
    expect(isValidSite("example.com")).toBe(true);
    expect(isValidSite("a-b.example.org")).toBe(true);
  });


  test("rejects anything that is not a domain name", () => {
    for (const value of [
      undefined,
      null,
      42,
      "",
      "com",
      "example.c",
      "example..com",
      "exam_ple.com",
      "example-.com",
      `${"a".repeat(64)}.com`,
      `${"a.".repeat(126)}com`
    ]) {
      expect(isValidSite(value), String(value)).toBe(false);
    }
  });
});


test("sanitizeSites keeps valid sites once, sorted", () => {
  expect(
    sanitizeSites(["b.com", "a.com", "b.com", "bad", 42, null])
  ).toEqual(["a.com", "b.com"]);

  expect(sanitizeSites(undefined)).toEqual([]);
  expect(sanitizeSites("a.com")).toEqual([]);
});


test("getSiteOrigins covers the site and its subdomains over HTTP and HTTPS", () => {
  expect(getSiteOrigins("example.com")).toEqual([
    "http://example.com/*",
    "https://example.com/*",
    "http://*.example.com/*",
    "https://*.example.com/*"
  ]);

  expect(getSiteOrigins("not a site")).toEqual([]);
});
