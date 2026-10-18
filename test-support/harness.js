import fs from "node:fs";
import path from "node:path";


export const ORIGIN = "http://extension.test";

const CONTENT_TYPES = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};


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
