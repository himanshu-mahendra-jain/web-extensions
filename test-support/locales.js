import fs from "node:fs";
import path from "node:path";

import { test, expect } from "@playwright/test";


/*
 * The languages the Chrome Web Store lists an extension in, as
 * _locales/ names them. An extension that is translated ships them all.
 */
export const STORE_LOCALES = [
  "am", "ar", "bg", "bn", "ca", "cs", "da", "de", "el", "en", "es", "es_419", "et",
  "fa", "fi", "fil", "fr", "gu", "he", "hi", "hr", "hu", "id", "it", "ja", "kn",
  "ko", "lt", "lv", "ml", "mr", "ms", "nl", "no", "pl", "pt_BR", "pt_PT", "ro",
  "ru", "sk", "sl", "sr", "sv", "sw", "ta", "te", "th", "tr", "uk", "vi", "zh_CN",
  "zh_TW"
];


const PLURAL = /_(?:zero|one|two|few|many|other)$/;


function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}


// The .js and .html files under src/ and options/, Firefox variants included.
function sourceFiles(extensionPath) {
  return ["src", "options"]
    .map((directory) => path.join(extensionPath, directory))
    .filter((directory) => fs.existsSync(directory))
    .flatMap((directory) => {
      return fs.readdirSync(directory)
        .filter((file) => /\.(?:js|html)$/.test(file))
        .map((file) => fs.readFileSync(path.join(directory, file), "utf8"));
    });
}


// Text as a browser shows it: entities read and runs of white space as one space.
function shownText(html) {
  return html
    .replace(/&rarr;/g, "→")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}


// A message as the browser fills it with the extension's name as $1.
function filled(entry, name) {
  if (!entry) {
    return undefined;
  }

  const placeholders = Object.fromEntries(
    Object.entries(entry.placeholders ?? {}).map(([key, { content }]) => [key.toLowerCase(), content])
  );

  return entry.message
    .replace(/\$([\w@]+)\$/g, (match, key) => placeholders[key.toLowerCase()] ?? match)
    .replace(/\$(\$|1)/g, (match, which) => (which === "$" ? "$" : name));
}


// The _locales/ name of a language as Intl names it, such as es-419 for es_419.
function intlLocale(locale) {
  return locale.replace(/_/g, "-");
}


/*
 * Checks that an extension's code, its English messages and the
 * English its pages hold until i18n.js runs stay in step, and that
 * every Chrome Web Store language translates every message. pages are
 * the HTML files, relative to the extension, whose elements name
 * messages with data-i18n, data-i18n-title and data-i18n-aria-label;
 * each page's title names the extension. shortNames are parts of the
 * extension's name that no message in any language may hold either, so
 * the name stays in English everywhere.
 */
export function testLocales(extensionPath, { pages = [], shortNames = [] } = {}) {
  const messagesOf = (locale) => {
    return readJson(path.join(extensionPath, "_locales", locale, "messages.json"));
  };

  test.describe(`${path.basename(extensionPath)} locales`, () => {
    const manifests = ["manifest.json", "manifest-firefox.json"]
      .filter((file) => fs.existsSync(path.join(extensionPath, file)));
    const manifestTexts = manifests.map((file) => fs.readFileSync(path.join(extensionPath, file), "utf8"));
    const { name } = JSON.parse(manifestTexts[0]);
    const messages = messagesOf("en");
    const sources = sourceFiles(extensionPath);
    const html = Object.fromEntries(pages.map((page) => {
      return [page, fs.readFileSync(path.join(extensionPath, page), "utf8")];
    }));

    // The first argument of each call to one of names with a string literal, such as t("x").
    const literalArguments = (...names) => {
      return sources.flatMap((source) => {
        return [...source.matchAll(new RegExp(`\\b(?:${names.join("|")})\\(\\s*["'](\\w+)["']`, "g"))]
          .map((match) => match[1]);
      });
    };


    test("every message the code asks for exists", () => {
      const asked = [
        ...literalArguments("t", "getMessage"),
        ...Object.values(html).flatMap((page) => {
          return [...page.matchAll(/\sdata-i18n(?:-[\w-]+)?="(\w+)"/g)].map((match) => match[1]);
        })
      ];
      const counted = literalArguments("plural");

      expect(asked.filter((key) => !messages[key])).toEqual([]);
      // English needs a form for one and one for any other count.
      expect(counted.filter((key) => !messages[`${key}_one`] || !messages[`${key}_other`])).toEqual([]);
    });


    test("the extension's name is never translated", () => {
      // No language's message holds the name: messages that name it take it as $1.
      const named = fs.readdirSync(path.join(extensionPath, "_locales")).flatMap((locale) => {
        return Object.entries(messagesOf(locale))
          .filter(([, entry]) => [name, ...shortNames].some((text) => entry.message.includes(text)))
          .map(([key]) => `${locale}: ${key}`);
      });

      expect(name).not.toMatch(/__MSG_/);

      for (const text of manifestTexts) {
        expect(JSON.parse(text).action.default_title).toBe(name);
      }

      expect(named).toEqual([]);
    });


    test("every message is used", () => {
      const unused = Object.keys(messages).filter((key) => {
        const named = key.replace(PLURAL, "");

        return !manifestTexts.some((text) => text.includes(`__MSG_${key}__`)) &&
          !sources.some((source) => source.includes(`"${named}"`) || source.includes(`'${named}'`));
      });

      expect(unused).toEqual([]);
    });


    test("the pages' HTML holds each message's English text", () => {
      const elementPattern = /<(\w+)\b[^>]*\sdata-i18n="(\w+)"[^>]*>([^<]*)<\/\1>/g;
      const differences = [];
      const compare = (page, key, text) => {
        if (shownText(text) !== filled(messages[key], name)) {
          differences.push(`${page}: ${key}: ${shownText(text)}`);
        }
      };

      for (const [page, text] of Object.entries(html)) {
        for (const [, , key, content] of text.matchAll(elementPattern)) {
          compare(page, key, content);
        }

        for (const attribute of ["title", "aria-label"]) {
          const pattern = new RegExp(`<[^>]*\\s${attribute}="([^"]*)"[^>]*\\sdata-i18n-${attribute}="(\\w+)"[^>]*>`, "g");

          for (const [, content, key] of text.matchAll(pattern)) {
            compare(page, key, content);
          }
        }

        // Every element that names a message holds only text, so none was missed above.
        expect((text.match(/\sdata-i18n="/g) ?? []).length, page).toBe([...text.matchAll(elementPattern)].length);

        // The browser tab names the extension, whether the title is a message or not.
        expect(shownText(text.match(/<title[^>]*>([^<]*)<\/title>/)?.[1] ?? ""), page).toContain(name);
      }

      expect(differences).toEqual([]);
    });


    test("every Chrome Web Store language translates every message", () => {
      const singular = Object.keys(messages).filter((key) => !PLURAL.test(key));
      const counted = [...new Set(Object.keys(messages).filter((key) => PLURAL.test(key)).map((key) => key.replace(PLURAL, "")))];
      const problems = [];

      for (const locale of STORE_LOCALES) {
        const file = path.join(extensionPath, "_locales", locale, "messages.json");

        if (!fs.existsSync(file)) {
          problems.push(`${locale}: no messages.json`);
          continue;
        }

        const translated = messagesOf(locale);
        // The plural forms the language picks for counts up to 1,000; plural() falls back
        // to name_other for the rest, such as Spanish's form for a million.
        const rules = new Intl.PluralRules(intlLocale(locale));
        const needed = [...new Set(Array.from({ length: 1001 }, (_, count) => rules.select(count)))].sort();
        const allowed = new Set([...rules.resolvedOptions().pluralCategories, "one", "other"]);

        for (const key of singular.filter((key) => !translated[key]?.message)) {
          problems.push(`${locale}: ${key} is missing`);
        }

        // Each counting message has the forms the language needs, and only forms it has.
        for (const key of counted) {
          const forms = Object.keys(translated)
            .filter((other) => PLURAL.test(other) && other.replace(PLURAL, "") === key)
            .map((other) => other.slice(key.length + 1));
          const missing = needed.filter((form) => !forms.includes(form));
          const extra = forms.filter((form) => !allowed.has(form));

          if (missing.length > 0 || extra.length > 0) {
            problems.push(`${locale}: ${key} lacks [${missing.join(", ")}], has extra [${extra.join(", ")}]`);
          }
        }
      }

      expect(problems).toEqual([]);
    });


    test("every language's description fits the 132 characters Chrome allows", () => {
      const described = JSON.parse(manifestTexts[0]).description.match(/^__MSG_(\w+)__$/)?.[1];
      const tooLong = fs.readdirSync(path.join(extensionPath, "_locales"))
        .filter((locale) => [...(messagesOf(locale)[described]?.message ?? "")].length > 132);

      expect(described).toBeTruthy();
      expect(tooLong).toEqual([]);
    });


    test("the extension ships only Chrome Web Store languages", () => {
      const shipped = fs.readdirSync(path.join(extensionPath, "_locales"));

      expect(shipped.filter((locale) => !STORE_LOCALES.includes(locale))).toEqual([]);
    });
  });
}
