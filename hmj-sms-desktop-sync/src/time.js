import { t, uiLanguage } from "./i18n.js";

/*
 * How long ago a timestamp was, in the browser's language: "Just now" under a minute, then
 * as Intl writes it short, such as "5m ago", "2h ago" or "3d ago" in English.
 */
export function formatTimeAgo(timestamp) {
  if (!timestamp) return "";
  const secs = Math.floor((Date.now() - timestamp) / 1000);
  // Intl says "now" for zero, so the first minute keeps its own message.
  if (secs < 60) return t("justNow");
  const format = new Intl.RelativeTimeFormat(uiLanguage(), { style: "narrow", numeric: "auto" });
  const mins = Math.floor(secs / 60);
  if (mins < 60) return format.format(-mins, "minute");
  const hours = Math.floor(mins / 60);
  if (hours < 24) return format.format(-hours, "hour");
  return format.format(-Math.floor(hours / 24), "day");
}

// The full local date and time of a timestamp, such as "Jan 15, 2026, 9:30 AM".
export function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat(uiLanguage(), { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}
