import fs from "node:fs";
import path from "node:path";

import { test, expect } from "@playwright/test";


/*
 * The popup and the background take their text from
 * _locales/en/messages.json through src/i18n.js. These checks keep the
 * two in step: every message the code asks for exists, every message
 * is used, and the English the popup's HTML holds until i18n.js runs
 * is the message itself, so nothing changes when it does.
 */
const EXTENSION_PATH = path.resolve(__dirname, "..");

const MESSAGES = JSON.parse(
  fs.readFileSync(path.join(EXTENSION_PATH, "_locales", "en", "messages.json"), "utf8")
);

const SOURCES = fs.readdirSync(path.join(EXTENSION_PATH, "src"))
  .filter((file) => /\.(?:js|html)$/.test(file))
  .map((file) => fs.readFileSync(path.join(EXTENSION_PATH, "src", file), "utf8"));

const MANIFEST = fs.readFileSync(path.join(EXTENSION_PATH, "manifest.json"), "utf8");

const POPUP = fs.readFileSync(path.join(EXTENSION_PATH, "src", "popup.html"), "utf8");

const PLURAL = /_(?:zero|one|two|few|many|other)$/;


// The first argument of each call to name with a string literal, such as t("x").
function literalArguments(name) {
  return SOURCES.flatMap((source) => {
    return [...source.matchAll(new RegExp(`\\b${name}\\(\\s*"(\\w+)"`, "g"))].map((match) => match[1]);
  });
}


// Text as a browser shows it: entities read and runs of white space as one space.
function shownText(html) {
  return html.replace(/&rarr;/g, "→").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}


test("every message the code asks for exists", () => {
  const asked = [
    ...literalArguments("t"),
    ...[...POPUP.matchAll(/\sdata-i18n(?:-[\w-]+)?="(\w+)"/g)].map((match) => match[1])
  ];
  const counted = literalArguments("plural");

  expect(asked.filter((name) => !MESSAGES[name])).toEqual([]);
  // English needs a form for one and one for any other count.
  expect(counted.filter((name) => !MESSAGES[`${name}_one`] || !MESSAGES[`${name}_other`])).toEqual([]);
});


test("the extension's name is never translated", () => {
  const { name, action } = JSON.parse(MANIFEST);
  const named = Object.entries(MESSAGES)
    .filter(([, entry]) => entry.message.includes(name) || entry.message.includes("SMS Desktop Sync"))
    .map(([key]) => key);

  expect(name).not.toMatch(/__MSG_/);
  expect(action.default_title).toBe(name);
  expect(POPUP).toContain(`<title>${name}</title>`);
  expect(named).toEqual([]);
});


test("every message is used", () => {
  const unused = Object.keys(MESSAGES).filter((name) => {
    const named = name.replace(PLURAL, "");

    return !MANIFEST.includes(`__MSG_${name}__`) &&
      !SOURCES.some((source) => source.includes(`"${named}"`));
  });

  expect(unused).toEqual([]);
});


test("the popup's HTML holds each message's English text", () => {
  const differences = [];
  const compare = (name, html) => {
    if (shownText(html) !== MESSAGES[name]?.message) {
      differences.push(`${name}: ${shownText(html)}`);
    }
  };

  for (const [, , name, text] of POPUP.matchAll(/<(\w+)\b[^>]*\sdata-i18n="(\w+)"[^>]*>([^<]*)<\/\1>/g)) {
    compare(name, text);
  }

  for (const [attribute, key] of [["title", "title"], ["aria-label", "aria-label"]]) {
    const pattern = new RegExp(`<[^>]*\\s${attribute}="([^"]*)"[^>]*\\sdata-i18n-${key}="(\\w+)"[^>]*>`, "g");

    for (const [, text, name] of POPUP.matchAll(pattern)) {
      compare(name, text);
    }
  }

  expect(differences).toEqual([]);
  // Every element named a message, so none was missed by the patterns above.
  expect(POPUP.match(/\sdata-i18n="/g).length).toBe(
    [...POPUP.matchAll(/<(\w+)\b[^>]*\sdata-i18n="(\w+)"[^>]*>([^<]*)<\/\1>/g)].length
  );
});
