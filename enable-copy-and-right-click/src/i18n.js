/*
 * The extension's text in the browser's language, from
 * _locales/<language>/messages.json, for the settings page and the
 * background alike. A language without a messages.json, or a message
 * missing from it, falls back to English (the manifest's
 * default_locale).
 */
import "./extension-api.js";


// The message called name, with substitutions for its $1 to $9.
export function t(name, ...substitutions) {
  return extensionApi.i18n.getMessage(name, substitutions.map(String));
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

  document.documentElement.lang = extensionApi.i18n.getUILanguage();
  document.documentElement.dir = t("@@bidi_dir") || "ltr";
}
