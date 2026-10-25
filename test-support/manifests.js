import fs from "node:fs";
import path from "node:path";

import { test, expect } from "@playwright/test";


// Keys that must be identical in manifest.json and manifest-firefox.json.
const SHARED_KEYS = [
  "manifest_version",
  "name",
  "version",
  "default_locale",
  "description",
  "homepage_url",
  "icons",
  "action",
  "content_scripts",
  "content_security_policy",
  "host_permissions",
  "optional_host_permissions",
  "options_page",
  "options_ui"
];


/*
 * No inline or remote scripts and no plugins, no <base> to redirect
 * relative URLs, and no form that navigates anywhere.
 */
const EXTENSION_PAGES_CSP =
  "script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";


// Action properties only Firefox reads, so manifest.json leaves them out.
const FIREFOX_ONLY_ACTION_KEYS = [
  "default_area"
];


function withoutFirefoxOnlyActionKeys(manifest) {
  if (!manifest.action) {
    return manifest;
  }

  const action = Object.fromEntries(
    Object.entries(manifest.action)
      .filter(([key]) => !FIREFOX_ONLY_ACTION_KEYS.includes(key))
  );

  return { ...manifest, action };
}


function readManifest(extensionPath, fileName) {
  return JSON.parse(
    fs.readFileSync(
      path.join(extensionPath, fileName),
      "utf8"
    )
  );
}


function referencedFiles(manifest) {
  return [
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    manifest.action?.default_popup,
    manifest.background?.service_worker,
    ...(manifest.background?.scripts ?? []),
    manifest.options_page,
    manifest.options_ui?.page,
    ...(manifest.content_scripts ?? []).flatMap((script) => {
      return [
        ...(script.js ?? []),
        ...(script.css ?? [])
      ];
    })
  ].filter(Boolean);
}


// build.sh packages src/x-firefox.js as src/x.js for Firefox.
function firefoxVariantOf(file) {
  return file.replace(/(\.[^./]+)$/, "-firefox$1");
}


/*
 * The package paths firefox-exclude.txt lists, read as build.sh reads
 * them: one per line, # starts a comment.
 */
function firefoxExcludes(extensionPath) {
  const listPath = path.join(extensionPath, "firefox-exclude.txt");

  if (!fs.existsSync(listPath)) {
    return [];
  }

  return fs.readFileSync(listPath, "utf8")
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim().replace(/\/+$/, ""))
    .filter(Boolean);
}


// Whether build.sh leaves this file out of the Firefox package.
function isExcluded(extensionPath, file) {
  const relative = path.relative(extensionPath, file);

  return firefoxExcludes(extensionPath).some((excluded) => {
    return relative === excluded || relative.startsWith(`${excluded}/`);
  });
}


// Scripts, stylesheets and images an HTML page loads by relative path.
function htmlReferences(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const firstGroup = (pattern) => [...html.matchAll(pattern)].map((match) => match[1]);

  return [
    ...firstGroup(/<script[^>]*\ssrc="([^"]+)"/g),
    ...firstGroup(/<link[^>]*\shref="([^"]+)"/g),
    ...firstGroup(/<img[^>]*\ssrc="([^"]+)"/g),
    // Each srcset candidate is a URL and its width or density.
    ...firstGroup(/<img[^>]*\ssrcset="([^"]+)"/g).flatMap((srcset) => {
      return srcset.split(",").map((candidate) => candidate.trim().split(/\s+/)[0]);
    })
  ]
    .filter((reference) => !/^[a-z]+:/i.test(reference))
    .map((reference) => {
      return path.join(path.dirname(htmlPath), reference);
    });
}


// Relative specifiers of the static imports and re-exports in a module.
function importSpecifiers(scriptPath) {
  const source = fs.readFileSync(scriptPath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  return [
    ...source.matchAll(
      /^\s*(?:import|export)\b[\w$\s{},*]*?\bfrom\s*["']([^"']+)["']/gm
    ),
    ...source.matchAll(/^\s*import\s*["']([^"']+)["']/gm)
  ]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith("."));
}


/*
 * The file a package ships under this name, or undefined. Like
 * build.sh, Firefox gets x-firefox.js as x.js, no package contains
 * the -firefox file under its own name, and Firefox leaves out what
 * firefox-exclude.txt lists.
 */
function shippedFile(extensionPath, file, firefox) {
  if (
    /-firefox\.[^./]+$/.test(file) ||
    (firefox && isExcluded(extensionPath, file))
  ) {
    return undefined;
  }

  return (firefox ? [firefoxVariantOf(file), file] : [file])
    .find((candidate) => fs.existsSync(candidate));
}


/*
 * Every file one package loads that it does not ship: the files the
 * manifest names, what its HTML pages load, and what its scripts
 * import, followed to any depth.
 */
function missingFiles(extensionPath, manifest, firefox) {
  const missing = [];
  const visited = new Set();
  const pending = referencedFiles(manifest).map((file) => {
    return {
      file: path.join(extensionPath, file),
      source: "the manifest"
    };
  });

  while (pending.length > 0) {
    const { file, source } = pending.pop();

    if (visited.has(file)) {
      continue;
    }

    visited.add(file);

    const shipped = shippedFile(extensionPath, file, firefox);

    if (!shipped) {
      missing.push(
        `${path.relative(extensionPath, file)} is missing, `
        + `loaded by ${source}`
      );
      continue;
    }

    const loadedBy = path.relative(extensionPath, shipped);
    let references = [];

    if (shipped.endsWith(".html")) {
      references = htmlReferences(shipped);
    } else if (/\.m?js$/.test(shipped)) {
      references = importSpecifiers(shipped).map((specifier) => {
        return path.join(path.dirname(shipped), specifier);
      });
    }

    for (const reference of references) {
      pending.push({ file: reference, source: loadedBy });
    }
  }

  return missing;
}


// The file a module's first import statement names, or undefined.
function firstImport(scriptPath) {
  const source = fs.readFileSync(scriptPath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const match = source.match(/^\s*import\b[^"']*["']([^"']+)["']/m);

  return match ? path.join(path.dirname(scriptPath), match[1]) : undefined;
}


// The scripts in src/ and options/ that call extensionApi, apart from its own files.
function extensionApiCallers(extensionPath) {
  return ["src", "options"]
    .flatMap((folder) => {
      const directory = path.join(extensionPath, folder);

      return fs.existsSync(directory)
        ? fs.readdirSync(directory, { recursive: true }).map((file) => path.join(directory, file))
        : [];
    })
    .filter((file) => {
      return file.endsWith(".js") &&
        !/extension-api(?:-firefox)?\.js$/.test(file) &&
        /\bextensionApi\./.test(fs.readFileSync(file, "utf8"));
    });
}


function sortedPermissions(manifest, leaveOut) {
  return (manifest.permissions ?? [])
    .filter((permission) => !leaveOut.includes(permission))
    .sort();
}


// The locales in _locales/, each a directory with its messages.json.
function locales(extensionPath) {
  const directory = path.join(extensionPath, "_locales");

  return fs.existsSync(directory) ? fs.readdirSync(directory) : [];
}


function readMessages(extensionPath, locale) {
  return JSON.parse(
    fs.readFileSync(path.join(extensionPath, "_locales", locale, "messages.json"), "utf8")
  );
}


// The $NAME$ placeholders a message uses, lowercase and sorted.
function placeholdersOf(entry) {
  return [...entry.message.matchAll(/\$([\w@]+)\$/g)]
    .map((match) => match[1].toLowerCase())
    .sort();
}


/*
 * Checks an extension's _locales/ against its manifest: a default
 * locale that exists, every __MSG_name__ the manifest uses defined
 * there, every placeholder a message uses declared, and no other
 * locale with a message or placeholder the default locale lacks.
 * Browsers refuse to load an extension that breaks the first two.
 */
function testLocales(extensionPath, manifestFiles) {
  test("_locales and default_locale go together", () => {
    for (const file of manifestFiles) {
      const manifest = readManifest(extensionPath, file);

      expect(Boolean(manifest.default_locale), file).toBe(locales(extensionPath).length > 0);

      if (manifest.default_locale) {
        expect(locales(extensionPath), file).toContain(manifest.default_locale);
      }
    }
  });


  test("every message the manifest names is in the default locale", () => {
    for (const file of manifestFiles) {
      const text = fs.readFileSync(path.join(extensionPath, file), "utf8");
      const names = [...text.matchAll(/__MSG_(\w+)__/g)].map((match) => match[1]);

      if (names.length === 0) {
        continue;
      }

      const { default_locale: locale } = JSON.parse(text);
      const defined = Object.keys(readMessages(extensionPath, locale)).map((name) => name.toLowerCase());

      expect(names.filter((name) => !defined.includes(name.toLowerCase())), file).toEqual([]);
    }
  });


  test("every message declares the placeholders it uses", () => {
    for (const locale of locales(extensionPath)) {
      for (const [name, entry] of Object.entries(readMessages(extensionPath, locale))) {
        const declared = Object.keys(entry.placeholders ?? {}).map((key) => key.toLowerCase()).sort();

        expect([...new Set(placeholdersOf(entry))], `${locale}: ${name}`).toEqual(declared);
      }
    }
  });


  test("other locales translate only the default locale's messages", () => {
    const [file] = manifestFiles;
    const { default_locale: defaultLocale } = readManifest(extensionPath, file);

    if (!defaultLocale) {
      return;
    }

    const base = readMessages(extensionPath, defaultLocale);

    for (const locale of locales(extensionPath).filter((name) => name !== defaultLocale)) {
      for (const [name, entry] of Object.entries(readMessages(extensionPath, locale))) {
        // A language's own plural forms, such as name_few, count from name_other.
        const original = base[name] ?? base[name.replace(/_(?:zero|one|two|few|many)$/, "_other")];

        expect(original, `${locale}: ${name}`).toBeDefined();
        expect(placeholdersOf(entry), `${locale}: ${name}`).toEqual(placeholdersOf(original));
      }
    }
  });
}


/*
 * Checks the two manifests of an extension against each other and
 * against the files on disk, so a version bump or a renamed file
 * cannot reach only one browser. With firefox: false the extension
 * ships for Chrome and Edge only, and must have no Firefox manifest.
 */
export function testManifests(
  extensionPath,
  {
    firefox: shipsForFirefox = true,
    chromiumOnlyPermissions = [],
    firefoxOnlyPermissions = []
  } = {}
) {
  test.describe(`${path.basename(extensionPath)} manifests`, () => {
    let chromium;

    test.beforeAll(() => {
      chromium = readManifest(extensionPath, "manifest.json");
    });


    test("the Chromium manifest describes a Manifest V3 extension", () => {
      expect(chromium.manifest_version).toBe(3);
      expect(chromium.version).toMatch(/^\d+(\.\d+){0,3}$/);
    });


    test("background runs as a Chromium service worker", () => {
      expect(chromium.background.service_worker).toBeTruthy();
      expect(chromium.background.scripts).toBeUndefined();
    });


    test("the Chromium manifest declares the oldest Chrome it runs in", () => {
      expect(chromium.minimum_chrome_version).toMatch(/^\d+$/);

      // Only Firefox reads browser_specific_settings.
      expect(chromium.browser_specific_settings).toBeUndefined();
    });


    test("extension pages run only the package's own scripts", () => {
      expect(chromium.content_security_policy).toEqual({
        extension_pages: EXTENSION_PAGES_CSP
      });
    });


    test("the Chromium manifest links to the source repository", () => {
      expect(chromium.homepage_url).toMatch(/^https:\/\//);
    });


    test("every file the Chromium package loads exists", () => {
      expect(missingFiles(extensionPath, chromium, false))
        .toEqual([]);
    });


    testLocales(
      extensionPath,
      shipsForFirefox ? ["manifest.json", "manifest-firefox.json"] : ["manifest.json"]
    );


    if (!shipsForFirefox) {
      test("there is no Firefox package", () => {
        for (const file of ["manifest-firefox.json", "firefox-exclude.txt"]) {
          expect(fs.existsSync(path.join(extensionPath, file)), file).toBe(false);
        }
      });

      return;
    }


    let firefox;

    test.beforeAll(() => {
      firefox = readManifest(extensionPath, "manifest-firefox.json");
    });


    test("Chromium and Firefox describe the same extension", () => {
      const firefoxShared = withoutFirefoxOnlyActionKeys(firefox);

      for (const key of SHARED_KEYS) {
        expect(firefoxShared[key], key).toEqual(chromium[key]);
      }
    });


    test("both list the same permissions apart from browser-only ones", () => {
      expect(
        sortedPermissions(firefox, firefoxOnlyPermissions)
      ).toEqual(
        sortedPermissions(chromium, chromiumOnlyPermissions)
      );
    });


    test("both define the same keyboard commands", () => {
      const describeCommands = (manifest) => {
        return Object.fromEntries(
          Object.entries(manifest.commands ?? {})
            .map(([name, command]) => {
              return [name, command.description];
            })
        );
      };

      expect(describeCommands(firefox))
        .toEqual(describeCommands(chromium));
    });


    test("background runs as a Firefox script", () => {
      expect(firefox.background.scripts).toEqual([
        chromium.background.service_worker
      ]);
      expect(firefox.background.service_worker).toBeUndefined();

      expect(firefox.background.type)
        .toBe(chromium.background.type);
    });


    test("Firefox manifest has an add-on ID", () => {
      expect(firefox.browser_specific_settings?.gecko?.id)
        .toMatch(/^[^@\s]+@[^@\s]+$/);
    });


    // Without gecko_android, AMO lists the extension for desktop only.
    test("Firefox manifest marks the extension as Android-compatible", () => {
      expect(firefox.browser_specific_settings?.gecko_android)
        .toEqual(expect.any(Object));
    });


    test("Firefox manifest declares the oldest Firefox it runs in", () => {
      const { gecko, gecko_android } = firefox.browser_specific_settings;

      expect(gecko.strict_min_version).toMatch(/^\d+\.0$/);
      expect(gecko_android?.strict_min_version).toMatch(/^\d+\.0$/);

      // data_collection_permissions, which AMO requires, needs Firefox 140.
      expect(gecko.data_collection_permissions).toEqual(expect.any(Object));
      expect(Number.parseFloat(gecko.strict_min_version))
        .toBeGreaterThanOrEqual(140);

      // Only Chromium reads minimum_chrome_version.
      expect(firefox.minimum_chrome_version).toBeUndefined();
    });


    // Firefox shows developer.url on the add-on page instead of homepage_url.
    test("Firefox manifest links to the source repository", () => {
      expect(firefox.developer?.url).toBe(chromium.homepage_url);
      expect(firefox.developer?.name).toBeTruthy();
    });


    test("every file the Firefox package loads exists", () => {
      expect(missingFiles(extensionPath, firefox, true))
        .toEqual([]);
    });


    /*
     * Each package calls its browser's namespace through extensionApi:
     * chrome from src/extension-api.js, browser from the Firefox variant.
     * A content script lists the file before itself; a module imports
     * it first, so it is set before the module's own code runs.
     */
    test("every script that calls extensionApi loads extension-api.js first", () => {
      const api = path.join(extensionPath, "src", "extension-api.js");

      expect(fs.existsSync(api)).toBe(true);
      expect(fs.existsSync(firefoxVariantOf(api))).toBe(true);

      const scriptLists = (chromium.content_scripts ?? []).map((script) => {
        return (script.js ?? []).map((file) => path.join(extensionPath, file));
      });

      const late = extensionApiCallers(extensionPath).filter((file) => {
        const lists = scriptLists.filter((list) => list.includes(file));

        return lists.length > 0
          ? lists.some((list) => !list.slice(0, list.indexOf(file)).includes(api))
          : firstImport(file) !== api;
      });

      expect(late.map((file) => path.relative(extensionPath, file))).toEqual([]);
    });


    // build.sh stops on a listed path the package does not contain.
    test("every path firefox-exclude.txt lists exists", () => {
      // A package path holds the file or, in Firefox, its -firefox variant.
      const missing = firefoxExcludes(extensionPath).filter((excluded) => {
        const file = path.join(extensionPath, excluded);

        return !fs.existsSync(file) && !fs.existsSync(firefoxVariantOf(file));
      });

      expect(missing).toEqual([]);
    });
  });
}
