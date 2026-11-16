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
//   message cannot carry the word card. The voice goes out 3× with 700ms
//   gaps (Telegram's rule), the repeats reusing Meta's attachment_id.
// - A list's quick replies live on the Page's LATEST message, so the list
//   (with its quick replies) is always the last message of its turn:
//   nothing is ever sent after a list in the same turn.
// - Secrets (App Secret, Page Token, verify token) are never logged.

export const MESSENGER_SEND_URL = "https://graph.facebook.com/v21.0/me/messages";
export const MESSENGER_PICK_PREFIX = "pick|";
export const MESSENGER_QUICK_REPLY_MAX = 13; // Meta's limit per message
export const MESSENGER_QUICK_REPLY_TITLE_MAX = 20; // Meta's limit, in characters
// Telegram plays the word 3× with 700ms gaps (one repeated OGG); Messenger
// has no in-message repeat, so the audio message itself goes out 3×.
export const MESSENGER_VOICE_REPEATS = 3;
export const MESSENGER_VOICE_REPEAT_GAP_MS = 700;
// A send slower than this gets ONE warn line (diagnosis, not noise): the
// user reports the voice arriving very late, and a slow audio send is
// Meta fetching the file from GitHub raw on every send.
export const MESSENGER_SLOW_SEND_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// Generic media attachment by public URL (lesson photo/video from R2):
// the same shape as the audio message, with the caller's attachment type.
export function messengerAttachmentMessage(type, url) {
  const safeType = ["image", "video", "audio"].includes(type) ? type : "image";
  return {
    attachment: {
      type: safeType,
      payload: { url: String(url), is_reusable: true },
    },
  };
}

// Audio by Meta's reusable attachment id (returned when a send used
// is_reusable): sending by id never makes Meta re-fetch the file.
export function messengerAudioIdMessage(attachmentId) {
  return {
    attachment: {
      type: "audio",
      payload: { attachment_id: String(attachmentId) },
    },
  };
}

// -----------------------------------------------------------------------------
// Send API
// -----------------------------------------------------------------------------

// POST https://graph.facebook.com/v21.0/me/messages with the Page token.
// Returns { ok, messageId, attachmentId } on success, { ok: false, error }
// otherwise. attachmentId is Meta's reusable id for the sent asset (only
// present when the send used is_reusable); the caller reuses it so Meta
// does not re-fetch the file. The token is never logged; failures log only
// the HTTP status and Meta's error message (which contains no secret).
// A send slower than MESSENGER_SLOW_SEND_MS logs one warn line with its
// duration — the voice-delay diagnostic — and nothing else.
export async function sendMessengerMessage(env, recipientId, message, fetchImpl = globalThis.fetch) {
  const token = env?.MESSENGER_PAGE_TOKEN;
  if (!token) return { ok: false, error: "missing-page-token" };
  let response;
  const started = Date.now();
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
  const elapsedMs = Date.now() - started;
  if (elapsedMs > MESSENGER_SLOW_SEND_MS) {
    console.warn(`Messenger slow send (${elapsedMs}ms, ${message?.attachment?.type ?? "text"})`);
  }
  return { ok: true, messageId: result.message_id, attachmentId: result.attachment_id ?? null, recipientId: result.recipient_id ?? String(recipientId) };
}

// Typing indicator ("يكتب..."): POST sender_action typing_on / typing_off
// to the same Send API endpoint. The user sees "typing..." while the plan
// is computed (dictionary search, Sheets lookups) — Telegram shows it,
// Messenger must too. A missing token or a failed send never blocks the
// reply: the indicator is best effort, the message is the contract. Meta
// answers a sender action with { recipient_id } and no message_id.
export async function sendMessengerSenderAction(env, recipientId, action, fetchImpl = globalThis.fetch) {
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
        sender_action: action,
        messaging_type: "RESPONSE",
      }),
    });
  } catch (error) {
    console.error("Messenger sender action failed (network)", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "network" };
  }
  let result = null;
  try {
    result = await response.json();
  } catch {
    /* Meta answers JSON; a non-JSON body is a failure */
  }
  if (!response.ok || !result?.recipient_id) {
    console.error("Messenger sender action failed", response.status, result?.error?.message ?? "unknown");
    return { ok: false, error: result?.error?.message ?? `http-${response.status}` };
  }
  return { ok: true, recipientId: result.recipient_id };
}

// Multipart photo upload (a ready certificate arrives as bytes, not a URL):
// POST the same Send API endpoint with recipient + message as JSON fields
// and the bytes as `filedata`. Meta answers the same { message_id } shape.
// Returns { ok, messageId } on success, { ok: false, error } otherwise.
export async function sendMessengerPhotoBytes(env, recipientId, photoBytes, fetchImpl = globalThis.fetch) {
  const token = env?.MESSENGER_PAGE_TOKEN;
  if (!token) return { ok: false, error: "missing-page-token" };
  const bytes = photoBytes?.bytes;
  if (!bytes || (typeof bytes === "object" && "length" in bytes && bytes.length === 0)) {
    return { ok: false, error: "missing-bytes" };
  }
  const form = new FormData();
  form.append("recipient", JSON.stringify({ id: String(recipientId) }));
  form.append("message", JSON.stringify({ attachment: { type: "image", payload: {} } }));
  form.append(
    "filedata",
    new Blob([bytes], { type: photoBytes.contentType || "image/png" }),
    photoBytes.fileName || "image.png",
  );
  let response;
  const started = Date.now();
  try {
    response = await fetchImpl(MESSENGER_SEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  } catch (error) {
    console.error("Messenger photo send failed (network)", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "network" };
  }
  let result = null;
  try {
    result = await response.json();
  } catch {
    /* Meta answers JSON; a non-JSON body is a failure */
  }
  if (!response.ok || !result?.message_id) {
    console.error("Messenger photo send failed", response.status, result?.error?.message ?? "unknown");
    return { ok: false, error: result?.error?.message ?? `http-${response.status}` };
  }
  const elapsedMs = Date.now() - started;
  if (elapsedMs > MESSENGER_SLOW_SEND_MS) {
    console.warn(`Messenger slow send (${elapsedMs}ms, image-upload)`);
  }
  return { ok: true, messageId: result.message_id, recipientId: result.recipient_id ?? String(recipientId) };
}

// -----------------------------------------------------------------------------
// Event handling
// -----------------------------------------------------------------------------

// One messaging event. planFor.text(query, senderId) /
// planFor.pick(indexOrPayload, senderId) return a plan
// { texts: [{ text, quickReplies }], voiceUrl, attachments?, photoBytes?, task? }
// or null to stay silent. planFor.pick receives a record index for a
// `pick|<index>` quick reply, or the raw payload string for a parity quick
// reply (`learn|...` / `cert|...` / `admin|...`) — the owning agent routes
// by prefix. planFor.executeTask?.(task, senderId, fetchImpl) runs a plan's
// side effect (broadcast, DM, import job) after the reply is sent; the
// transport never invents a task.
// Send order per plan: typing_on first (the user sees "يكتب..." while the
// plan is computed), then attachments (lesson media by URL), then a
// photo upload, then the texts in order, then the voice attachment, sent
// MESSENGER_VOICE_REPEATS times with MESSENGER_VOICE_REPEAT_GAP_MS gaps
// (text before voice — the WhatsApp port's proven order; the 3× repeat is
// Telegram's rule, where one repeated OGG plays 3×). The first voice send
// is by URL; when Meta returns a reusable attachment_id for it, the
// repeats send by id so Meta does not re-fetch the file from GitHub twice
// more. A failed voice send never blocks the remaining repeats. The last
// text carries the quick replies, and nothing is ever sent after it in the
// same turn — except the voice, so a plan must not combine quick replies
// with a voice (no current plan does: word cards carry no replies, menus
// carry no voice). Returns true when at least one message was sent.
export async function handleMessengerMessaging(env, event, planFor, fetchImpl = globalThis.fetch) {
  const message = event?.message;
  if (!message || message.is_echo) return false;
  const senderId = event?.sender?.id;
  if (!senderId) return false;
  // The user sees "يكتب..." while the plan is computed — Telegram shows it,
  // Messenger must too. A failed indicator never blocks the reply; when
  // nothing is sent at all, turn it off again so no stale indicator lingers.
  // (The first real message turns it off automatically.)
  await sendMessengerSenderAction(env, senderId, "typing_on", fetchImpl);
  let plan = null;
  try {
    const payload = message.quick_reply?.payload;
    if (typeof payload === "string" && payload.startsWith(MESSENGER_PICK_PREFIX)) {
      const index = Number(payload.slice(MESSENGER_PICK_PREFIX.length));
      plan = Number.isInteger(index) && index >= 0 ? await planFor.pick(index, senderId) : null;
    } else if (typeof payload === "string" && payload) {
      // A parity quick reply: route the raw payload to the owning agent.
      plan = await planFor.pick(payload, senderId);
    } else if (typeof message.text === "string" && message.text.trim()) {
      plan = await planFor.text(message.text, senderId);
    }
  } catch (error) {
    console.error("Messenger plan failed", error instanceof Error ? error.message : "unknown");
    await sendMessengerSenderAction(env, senderId, "typing_off", fetchImpl);
    return false;
  }
  if (!plan) {
    await sendMessengerSenderAction(env, senderId, "typing_off", fetchImpl);
    return false;
  }
  let sent = false;
  for (const attachment of plan.attachments ?? []) {
    if (!attachment?.url) continue;
    const result = await sendMessengerMessage(env, senderId, messengerAttachmentMessage(attachment.type ?? "image", attachment.url), fetchImpl);
    if (result.ok) sent = true;
  }
  if (plan.photoBytes) {
    const result = await sendMessengerPhotoBytes(env, senderId, plan.photoBytes, fetchImpl);
    if (result.ok) sent = true;
  }
  for (const item of plan.texts ?? []) {
    const result = await sendMessengerMessage(env, senderId, messengerTextMessage(item.text, item.quickReplies), fetchImpl);
    if (result.ok) sent = true;
  }
  if (plan.voiceUrl) {
    let attachmentId = null;
    for (let attempt = 0; attempt < MESSENGER_VOICE_REPEATS; attempt += 1) {
      if (attempt > 0) await sleep(MESSENGER_VOICE_REPEAT_GAP_MS);
      const audioMessage = attachmentId
        ? messengerAudioIdMessage(attachmentId)
        : messengerAudioMessage(plan.voiceUrl);
      const result = await sendMessengerMessage(env, senderId, audioMessage, fetchImpl);
      if (result.ok) {
        sent = true;
        if (result.attachmentId) attachmentId = result.attachmentId;
      }
    }
  }
  if (plan.task && typeof planFor.executeTask === "function") {
    try {
      await planFor.executeTask(plan.task, senderId, fetchImpl);
    } catch (error) {
      console.error("Messenger task failed", error instanceof Error ? error.message : "unknown");
    }
  }
  if (!sent) await sendMessengerSenderAction(env, senderId, "typing_off", fetchImpl);
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
