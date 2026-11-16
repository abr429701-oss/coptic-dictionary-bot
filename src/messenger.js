// src/messenger.js
//
// Facebook Messenger webhook transport (2026-11-16) — core loop only:
// webhook intake + dictionary search + voice. Learn, exams, certificates
// and get-code are NOT built here; they come later.
//
// This module knows nothing about the Telegram bot's internals: it verifies
// Meta's signature, shapes Messenger payloads, and calls the Send API. The
// search plan (which record, which card, which voice) is injected by
// src/index.js as `planFor` callbacks, so this file stays independently
// testable and imports nothing from index.js (no import cycle).
//
// Rules carried over from the WhatsApp port (hard-won, do not re-litigate):
// - Quick replies are a supplement only: the full text list is always sent.
// - Text goes first, voice second, as two separate messages: an audio
//   message cannot carry the word card.
// - Secrets (App Secret, Page Token, verify token) are never logged.

export const MESSENGER_SEND_URL = "https://graph.facebook.com/v21.0/me/messages";
export const MESSENGER_PICK_PREFIX = "pick|";
export const MESSENGER_QUICK_REPLY_MAX = 13; // Meta's limit per message
export const MESSENGER_QUICK_REPLY_TITLE_MAX = 20; // Meta's limit, in characters

// -----------------------------------------------------------------------------
// Signature verification (X-Hub-Signature-256)
// -----------------------------------------------------------------------------

async function hmacSha256Hex(secret, data) {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

// True only when `signatureHeader` ("sha256=<hex>") is the HMAC-SHA256 of
// `rawBody` under `appSecret`. False for a missing/malformed header or
// secret — the caller 403s on false.
export async function verifyMessengerSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || typeof signatureHeader !== "string") return false;
  const match = /^sha256=([0-9a-fA-F]{64})$/u.exec(signatureHeader.trim());
  if (!match) return false;
  let expected;
  try {
    expected = await hmacSha256Hex(appSecret, rawBody);
  } catch {
    return false;
  }
  return timingSafeEqualHex(expected, match[1].toLowerCase());
}

// -----------------------------------------------------------------------------
// Payload shaping
// -----------------------------------------------------------------------------

// The Telegram word card is HTML (<b>Label:</b> value). Messenger takes
// plain text; bold becomes WhatsApp-style *bold*, the only markup Messenger
// renders as emphasis in plain text.
export function plainTextCard(html) {
  return String(html ?? "")
    .replace(/<b>(.*?)<\/b>/gu, "*$1*")
    .replace(/<[^>]*>/gu, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

// Meta caps a quick-reply title at 20 characters. Truncate by code point
// (not UTF-16 unit) so a Coptic or emoji title is never split mid-character.
export function truncateQuickReplyTitle(title) {
  const chars = Array.from(String(title ?? "").trim());
  return chars.length <= MESSENGER_QUICK_REPLY_TITLE_MAX
    ? chars.join("")
    : chars.slice(0, MESSENGER_QUICK_REPLY_TITLE_MAX).join("");
}

// items: [{ title, payload }]. Caps at 13 replies (Meta's limit); empty
// titles/payloads are dropped. Payloads are the caller's responsibility to
// keep under Meta's 1000-character limit ("pick|<index>" is a few chars).
export function buildQuickReplies(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && String(item.title ?? "").trim() && String(item.payload ?? ""))
    .slice(0, MESSENGER_QUICK_REPLY_MAX)
    .map((item) => ({
      content_type: "text",
      title: truncateQuickReplyTitle(item.title),
      payload: String(item.payload),
    }));
}

export function messengerTextMessage(text, quickReplies = []) {
  const message = { text: String(text ?? "") };
  if (Array.isArray(quickReplies) && quickReplies.length) {
    message.quick_replies = quickReplies;
  }
  return message;
}

// Audio is sent by public URL (the prebuilt file on the GitHub `audio`
// branch); is_reusable lets Meta cache it instead of re-fetching per user.
export function messengerAudioMessage(audioUrl) {
  return {
    attachment: {
      type: "audio",
      payload: { url: String(audioUrl), is_reusable: true },
    },
  };
}

// -----------------------------------------------------------------------------
// Send API
// -----------------------------------------------------------------------------

// POST https://graph.facebook.com/v21.0/me/messages with the Page token.
// Returns { ok, messageId } on success, { ok: false, error } otherwise.
// The token is never logged; failures log only the HTTP status and Meta's
// error message (which contains no secret).
export async function sendMessengerMessage(env, recipientId, message, fetchImpl = globalThis.fetch) {
  const token = env?.MESSENGER_PAGE_TOKEN;
  if (!token) return { ok: false, error: "missing-page-token" };
  let response;
  try {
    response = await fetchImpl(MESSENGER_SEND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        recipient: { id: String(recipientId) },
        message,
        messaging_type: "RESPONSE",
      }),
    });
  } catch (error) {
    console.error("Messenger send failed (network)", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "network" };
  }
  let result = null;
  try {
    result = await response.json();
  } catch {
    /* Meta answers JSON; a non-JSON body is a failure */
  }
  if (!response.ok || !result?.message_id) {
    console.error("Messenger send failed", response.status, result?.error?.message ?? "unknown");
    return { ok: false, error: result?.error?.message ?? `http-${response.status}` };
  }
  return { ok: true, messageId: result.message_id, recipientId: result.recipient_id ?? String(recipientId) };
}

// -----------------------------------------------------------------------------
// Event handling
// -----------------------------------------------------------------------------

// One messaging event. planFor.text(query) / planFor.pick(recordIndex) return
// a plan { texts: [{ text, quickReplies }], voiceUrl } or null to stay
// silent. Texts go out in order first, then the voice attachment (text
// before voice — the WhatsApp port's proven order). Returns true when at
// least one message was sent.
export async function handleMessengerMessaging(env, event, planFor, fetchImpl = globalThis.fetch) {
  const message = event?.message;
  if (!message || message.is_echo) return false;
  const senderId = event?.sender?.id;
  if (!senderId) return false;
  let plan = null;
  try {
    const payload = message.quick_reply?.payload;
    if (typeof payload === "string" && payload.startsWith(MESSENGER_PICK_PREFIX)) {
      const index = Number(payload.slice(MESSENGER_PICK_PREFIX.length));
      plan = Number.isInteger(index) && index >= 0 ? await planFor.pick(index) : null;
    } else if (typeof message.text === "string" && message.text.trim()) {
      plan = await planFor.text(message.text);
    }
  } catch (error) {
    console.error("Messenger plan failed", error instanceof Error ? error.message : "unknown");
    return false;
  }
  if (!plan) return false;
  let sent = false;
  for (const item of plan.texts ?? []) {
    const result = await sendMessengerMessage(env, senderId, messengerTextMessage(item.text, item.quickReplies), fetchImpl);
    if (result.ok) sent = true;
  }
  if (plan.voiceUrl) {
    const result = await sendMessengerMessage(env, senderId, messengerAudioMessage(plan.voiceUrl), fetchImpl);
    if (result.ok) sent = true;
  }
  return sent;
}

// The whole webhook body: every entry's messaging events, in order. One bad
// event never kills the batch.
export async function handleMessengerWebhookBody(env, body, planFor, fetchImpl = globalThis.fetch) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const events = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const event of events) {
      try {
        await handleMessengerMessaging(env, event, planFor, fetchImpl);
      } catch (error) {
        console.error("Messenger event failed", error instanceof Error ? error.message : "unknown");
      }
    }
  }
}
