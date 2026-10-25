/**
 * The extension's text in the browser's language, from _locales/<language>/messages.json,
 * for the popup and the background alike. A language without a messages.json, or a message
 * missing from it, falls back to English (the manifest's default_locale).
 */

// The browser's language, such as "en-US", for plurals, numbers and lists.
export function uiLanguage() {
  return chrome.i18n.getUILanguage();
}

/** The message called name, with substitutions for its $1 to $9 (placeholders name them). */
export function t(name, ...substitutions) {
  return chrome.i18n.getMessage(name, substitutions.map(String));
}

/**
 * A message that counts: name_one, name_few, name_other and so on, picked by the
 * language's plural rules for count, with name_other as the fallback. The count, written
 * as the language writes numbers, is $1; further substitutions follow it.
 */
export function plural(name, count, ...substitutions) {
  const category = new Intl.PluralRules(uiLanguage()).select(count);
  const number = new Intl.NumberFormat(uiLanguage()).format(count);
  return t(`${name}_${category}`, number, ...substitutions) || t(`${name}_other`, number, ...substitutions);
}

/** Names as a list, such as "Pixel 8, Galaxy S24". */
export function listOf(names) {
  return new Intl.ListFormat(uiLanguage(), { type: "unit", style: "short" }).format(names);
}

/** Names joined by "and", such as "Pixel 8 and Galaxy S24". */
export function andList(names) {
  return new Intl.ListFormat(uiLanguage(), { type: "conjunction" }).format(names);
}

/**
 * Puts the messages into a page: data-i18n names the message for an element's text,
 * data-i18n-title and data-i18n-aria-label the ones for those attributes. The page keeps
 * its English text in the HTML, so it reads the same before this runs.
 */
export function localizePage(root = document) {
  for (const element of root.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of root.querySelectorAll("[data-i18n-title]")) {
    element.title = t(element.dataset.i18nTitle);
  }
  for (const element of root.querySelectorAll("[data-i18n-aria-label]")) {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  }
  document.documentElement.lang = uiLanguage();
  document.documentElement.dir = t("@@bidi_dir") || "ltr";
}
