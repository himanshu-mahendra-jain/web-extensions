/**
 * How a message reads in a notification and in the popup: its title, its text with the MMS
 * subject, and a line naming its attachments, and how long it is kept. Shared by sms-core.js
 * and popup.js.
 */

import { listOf, plural, t } from "./i18n.js";

// How long a message is kept and shown: 24 hours.
export const MAX_MESSAGE_AGE_MS = 24 * 60 * 60 * 1000;

// Attachment kinds the phone names, in the order the attachment line lists them.
export const ATTACHMENT_KINDS = ["image", "video", "audio", "contact", "file"];

// Each kind's icon, the message for one, and the message that counts several.
const ATTACHMENT_WORDS = {
  image: ["📷", "photo", "photos"],
  video: ["🎬", "video", "videos"],
  audio: ["🎵", "audio", "audioClips"],
  contact: ["👤", "contact", "contacts"],
  file: ["📎", "file", "files"]
};

// Group members a title names before it counts the rest.
const NAMED_GROUP_MEMBERS = 3;

/** The attachments counted by kind, such as "📷 2 photos · 🎬 Video", or "" without any. */
export function attachmentSummary(attachments) {
  if (!Array.isArray(attachments)) return "";
  return ATTACHMENT_KINDS
    .map((kind) => [kind, attachments.filter((item) => item === kind).length])
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => {
      const [icon, one, many] = ATTACHMENT_WORDS[kind];
      return `${icon} ${count === 1 ? t(one) : plural(many, count)}`;
    })
    .join(" · ");
}

/** The other members of a group message, such as "Bob, Carol +2". */
export function groupNames(group) {
  const named = listOf(group.slice(0, NAMED_GROUP_MEMBERS));
  const more = group.length - NAMED_GROUP_MEMBERS;
  return more > 0 ? t("groupNamesMore", named, more) : named;
}

/** What a message says: its subject and its text, each once. */
export function messageText(sms) {
  const subject = sms.subject || "";
  const body = sms.body || "";
  if (!subject || subject === body) return body;
  return body ? `${subject}\n${body}` : subject;
}

/** The notification title after its badges: who sent it, and to which group. */
export function messageTitle(sms) {
  const sender = sms.sender || t("unknownSender");
  if (Array.isArray(sms.group) && sms.group.length > 0) {
    return t("groupTitle", sender, groupNames(sms.group));
  }
  return t(sms.kind === "mms" ? "newMmsFrom" : "newSmsFrom", sender);
}

/** The notification text: the subject before the text, then the attachment line. */
export function notificationText(sms) {
  const subject = sms.subject || "";
  const body = sms.body || "";
  const text = subject && body && subject !== body ? `${subject} — ${body}` : subject || body;
  return [text, attachmentSummary(sms.attachments)].filter(Boolean).join("\n");
}
