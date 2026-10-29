/*
 * The extension's text in the browser's language, from
 * _locales/<language>/messages.json. A language without a
 * messages.json, or a message missing from it, falls back to English
 * (the manifest's default_locale).
 */
import "./extension-api.js";


// The browser's language, such as "en-US", for plurals, numbers, lists and dates.
export function uiLanguage() {
  return extensionApi.i18n.getUILanguage();
}


// The message called name, with substitutions for its $1 to $9.
export function t(name, ...substitutions) {
  return extensionApi.i18n.getMessage(name, substitutions.map(String));
}


/*
 * A message that counts: name_one, name_few, name_other and so on,
 * picked by the language's plural rules for count, with name_other as
 * the fallback. The count, written as the language writes numbers, is
 * $1; further substitutions follow it.
 */
export function plural(name, count, ...substitutions) {
  const category = new Intl.PluralRules(uiLanguage()).select(count);
  const number = new Intl.NumberFormat(uiLanguage()).format(count);

  return t(`${name}_${category}`, number, ...substitutions) ||
    t(`${name}_other`, number, ...substitutions);
}


// Two or more phrases joined by "and", as the language joins them.
export function andList(items) {
  return new Intl.ListFormat(uiLanguage(), { type: "conjunction" }).format(items);
}


// Names as a list, such as "intranet, nope", with the language's separator.
export function listOf(names) {
  return new Intl.ListFormat(uiLanguage(), { type: "unit", style: "short" }).format(names);
}


// The extension's name, which stays in English in every language.
export function extensionName() {
  return extensionApi.runtime.getManifest().name;
}


/*
 * Puts the messages into a page: data-i18n names the message for an
 * element's text, data-i18n-aria-label the one for that attribute. A
 * message may name the extension as $1. The page keeps its English
 * text in the HTML, so it reads the same before this runs.
 */
export function localizePage(root = document) {
  for (const element of root.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n, extensionName());
  }

  for (const element of root.querySelectorAll("[data-i18n-aria-label]")) {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel, extensionName()));
  }

  document.documentElement.lang = uiLanguage();
  document.documentElement.dir = t("@@bidi_dir") || "ltr";
}
