/*
 * The extension's text in the browser's language, from
 * _locales/<language>/messages.json. A language without a
 * messages.json, or a message missing from it, falls back to English
 * (the manifest's default_locale).
 */
import "./extension-api.js";


// The browser's language, such as "en-US", for numbers.
export function uiLanguage() {
  return extensionApi.i18n.getUILanguage();
}


// The message called name, with substitutions for its $1 to $9.
export function t(name, ...substitutions) {
  return extensionApi.i18n.getMessage(name, substitutions.map(String));
}


/*
 * What the on-page indicator says for speed, in the browser's language
 * and number format: shown, such as "1.5x"; spoken, for screen
 * readers; and the lang and dir of that text.
 */
export function speedLabels(speed) {
  const number = new Intl.NumberFormat(uiLanguage()).format(speed);

  return {
    shown: t("speedShown", number),
    spoken: t("speedSpoken", number),
    lang: uiLanguage(),
    dir: t("@@bidi_dir") || "ltr"
  };
}
