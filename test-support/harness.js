import fs from "node:fs";
import path from "node:path";


export const ORIGIN = "http://extension.test";

const CONTENT_TYPES = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};


/*
 * The messages of an extension's default locale, from
 * _locales/<default_locale>/messages.json, or {} for an extension
 * without default_locale.
 */
export function defaultLocaleMessages(extensionPath) {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, "manifest.json"), "utf8"));

  if (!manifest.default_locale) {
    return {};
  }

  return JSON.parse(fs.readFileSync(
    path.join(extensionPath, "_locales", manifest.default_locale, "messages.json"),
    "utf8"
  ));
}


/*
 * Runs in the page. Sets window.fakeI18n to an i18n API that answers
 * from messages, as the browser does for its UI language when the
 * extension has no messages of that language: getMessage() fills
 * $NAME$ placeholders and $1 to $9 from the substitutions, turns $$
 * into $, and answers "" for a message it does not have. direction is
 * what @@bidi_dir answers, "rtl" as for Arabic, Hebrew or Persian.
 */
export function installFakeI18n({ messages, direction = "ltr" }) {
  const predefined = { "@@bidi_dir": direction, "@@ui_locale": "en" };

  window.fakeI18n = {
    getUILanguage: () => navigator.language,

    getMessage: (name, substitutions = []) => {
      if (name in predefined) {
        return predefined[name];
      }

      const entry = messages[name];

      if (!entry) {
        return "";
      }

      const values = [].concat(substitutions).map(String);
      const placeholders = Object.fromEntries(
        Object.entries(entry.placeholders ?? {}).map(([key, { content }]) => [key.toLowerCase(), content])
      );

      return entry.message
        .replace(/\$([\w@]+)\$/g, (match, key) => placeholders[key.toLowerCase()] ?? match)
        .replace(/\$(\$|[1-9])/g, (match, which) => (which === "$" ? "$" : values[which - 1] ?? ""));
    }
  };
}


/*
 * Serves an extension's files at http://extension.test/ in page, as one
 * browser's package holds them, so its pages and scripts can run as an
 * ordinary page against fake extension APIs; / is an empty page. With
 * firefox, x-firefox.js is served as x.js, as build.sh packages it, and
 * no package serves a -firefox file under its own name.
 */
export async function routeExtensionFiles(page, extensionPath, { firefox = false } = {}) {
  await page.route(`${ORIGIN}/**`, (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);

    if (pathname === "/") {
      return route.fulfill({ contentType: "text/html", body: "<!DOCTYPE html><body></body>" });
    }

    const file = path.join(extensionPath, pathname);
    const variant = file.replace(/(\.[^./]+)$/, "-firefox$1");
    const served = firefox && fs.existsSync(variant) ? variant : file;

    if (
      !served.startsWith(extensionPath + path.sep) ||
      /-firefox\.[^./]+$/.test(pathname) ||
      !fs.existsSync(served)
    ) {
      return route.fulfill({ status: 404, body: "" });
    }

    return route.fulfill({
      contentType: CONTENT_TYPES[path.extname(served)] ?? "application/octet-stream",
      body: fs.readFileSync(served)
    });
  });
}
