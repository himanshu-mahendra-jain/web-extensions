/*
 * Chrome and Edge clear a tab's badge and title when it loads a page,
 * so a tab turned on shows as off again by itself and nothing listens
 * to every page load. The Firefox package has badge-reset-firefox.js
 * in this file's place.
 */
export async function rememberEnabledTab() {}
