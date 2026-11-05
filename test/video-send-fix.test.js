import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore } from "../src/index.js";
import { MENUS_KEY, VIDEO_MENU_ID } from "../src/menu-builder.js";

// ---------------------------------------------------------------------------
// Regression tests for "tap a video lesson, get 'could not send this
// content'" (2026-11-05).
//
// Root cause (verified in src/menu-studio.js handleMedia): pick() detects
// whatever media arrives (photo/video/audio/document), but addButton was
// called with `kind: state.kind ?? file.kind` — the CHOSEN kind wins over
// the DETECTED kind, with no validation. So an admin who picks kind
// "video" and then sends the video "as a file" (Telegram delivers it as
// message.document) — or sends a photo — stores a document/photo file_id
// under kind "video", and every later sendVideo fails with 400
// ("Bad Request: wrong file identifier"), which handleMenuButton only
// surfaced as the generic "❌ تعذّر إرسال هذا المحتوى حاليًا." message.
// The same hole existed in the edit path: updateButton forces kind to stay
// unchanged while handleMedia replaced fileId, so re-sending the wrong
// media type could CORRUPT a previously working video button.
//
// The fake Telegram API below simulates the real Bot API: a sendVideo whose
// file_id came from another media type is rejected with 400
// "wrong file identifier"; a real video file_id is accepted.
// ---------------------------------------------------------------------------

const token = "test-token";
const secret = "test-secret-should-be-long-enough";
const testRoot = fileURLToPath(new URL("..", import.meta.url));
const fakeAssets = {
  fetch: async (url) => {
    const pathname = new URL(url).pathname;
    if (!pathname.startsWith("/search-index/")) return new Response("Not found", { status: 404 });
    try {
      return new Response(readFileSync(resolve(testRoot, "public", pathname.slice(1))), { headers: { "content-type": "application/json" } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
};
const env = { TELEGRAM_BOT_TOKEN: token, WEBHOOK_SECRET: secret, ASSETS: fakeAssets, VOICE_CAPTION: "off" };

function fakeTelegramApi(calls) {
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body;
    const payload = !body ? null : typeof body === "string" ? JSON.parse(body) : Object.fromEntries(body.entries());
    const method = String(url).split("/").pop();
    let ok = true;
    let description = "";
    if (method === "sendMessage") {
      const rows = payload?.reply_markup?.inline_keyboard;
      if (Array.isArray(rows) && rows.length === 0) {
        ok = false; description = "Bad Request: can't parse inline keyboard";
      } else if (payload?.parse_mode === "HTML" && /<(?![a-zA-Z/])|&(?!amp;|lt;|gt;|quot;|#)/u.test(payload.text ?? "")) {
        ok = false; description = "Bad Request: can't parse entities";
      }
    }
    if (method === "sendVideo") {
      // A file_id that came from another media type is not a video file_id.
      const vid = String(payload?.video ?? "");
      if (vid.startsWith("doc-") || vid.startsWith("photo-") || vid.startsWith("audio-")) {
        ok = false; description = "Bad Request: wrong file identifier";
      }
    }
    // Only messages Telegram actually accepted count as "delivered".
    calls.push({ url: String(url), payload, ok });
    if (!ok) return Response.json({ ok: false, error_code: 400, description });
    return Response.json({ ok: true, result: { message_id: 900 } });
  };
}
function updateRequest(update) {
  return new Request("https://bot.test/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(update),
  });
}
function fakeKv() {
  const store = new Map();
  const storage = {
    get: async (key) => store.get(key),
    put: async (key, value) => { store.set(key, value); },
    delete: async (key) => store.delete(key),
    list: async ({ prefix = "", startAfter, limit } = {}) => {
      let entries = [...store].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      if (startAfter) entries = entries.filter(([key]) => key > startAfter);
      return new Map(limit ? entries.slice(0, limit) : entries);
    },
    setAlarm: async () => {},
  };
  const object = new UserStore({ storage }, env);
  return {
    store,
    idFromName: (name) => name,
    get: () => ({ fetch: (url, options) => object.fetch(new Request(url, options)) }),
  };
}
async function sendUpdate(kvEnv, update) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest(update), kvEnv);
  return calls;
}
const say = (kvEnv, userId, text) => sendUpdate(kvEnv, { message: { text, chat: { id: userId, type: "private" }, from: { id: userId } } });
const tap = (kvEnv, userId, data) => sendUpdate(kvEnv, { callback_query: { id: "cb1", data, from: { id: userId }, message: { message_id: 5, chat: { id: userId, type: "private" }, text: "x" } } });
const sendMedia = (kvEnv, userId, media) => sendUpdate(kvEnv, { message: { ...media, chat: { id: userId, type: "private" }, from: { id: userId } } });
const sent = (calls) => calls.filter((c) => c.url.endsWith("/sendMessage") && c.ok !== false).map((c) => c.payload);
const toChat = (calls, chatId) => sent(calls).filter((m) => String(m.chat_id) === String(chatId));
const anyText = (calls, chatId, re) => toChat(calls, chatId).some((m) => re.test(m.text ?? ""));
const seedMenus = (kvEnv, menus) => kvEnv.USERS.store.set(MENUS_KEY, { menus });
const seedUser = (kvEnv, userId, record) => kvEnv.USERS.store.set(`user:${userId}`, record);
const storedMenus = (kvEnv) => kvEnv.USERS.store.get(MENUS_KEY)?.menus ?? [];
const storedButton = (kvEnv, menuId, buttonId) => storedMenus(kvEnv).find((m) => m.id === menuId)?.buttons?.find((b) => b.id === buttonId);
const studioStep = (kvEnv, userId) => kvEnv.USERS.store.get(`user:${userId}`)?.menuStudio?.step;
const nowIso = () => new Date().toISOString();
const ADMIN = 813894692;
const USER = 51;

test("video-send-fix: sending a document for a video button saves nothing, then a real video works", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv, [{ id: VIDEO_MENU_ID, title: "🎬 دروس فيديو", text: "دروس", buttons: [] }]);
  seedUser(kvEnv, ADMIN, { name: "أدمن", registeredAt: nowIso(), firstSeen: nowIso(), lastSeen: nowIso(), menuStudio: { step: "media", menuId: VIDEO_MENU_ID, kind: "video", label: "درس تجريبي" } });

  // The admin picked kind "video" but sent the video "as a file": Telegram
  // delivers it as message.document.
  const mismatch = await sendMedia(kvEnv, ADMIN, { document: { file_id: "doc-file-1", file_unique_id: "doc-u1" } });
  assert.ok(anyText(mismatch, ADMIN, /وصل ملف/), "the mismatch message must name what arrived");
  assert.ok(anyText(mismatch, ADMIN, /نوعه فيديو/), "the mismatch message must name what the button needs");
  assert.equal(storedMenus(kvEnv).find((m) => m.id === VIDEO_MENU_ID)?.buttons?.length, 0, "no button may be created from a mismatched file");
  assert.equal(studioStep(kvEnv, ADMIN), "media", "the media step must stay active so the admin can resend correctly");

  // Resending the same lesson as a real video must now succeed.
  await sendMedia(kvEnv, ADMIN, { video: { file_id: "vid-good-1", file_unique_id: "vid-u1" } });
  const created = storedButton(kvEnv, VIDEO_MENU_ID, storedMenus(kvEnv).find((m) => m.id === VIDEO_MENU_ID)?.buttons?.[0]?.id);
  assert.ok(created, "a button must be created after a correct video");
  assert.equal(created.kind, "video", "the button kind must be video");
  assert.equal(created.fileId, "vid-good-1", "the button must hold the video file_id");
});

test("video-send-fix: editing a working video button with a photo does not corrupt it", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv, [{ id: VIDEO_MENU_ID, title: "🎬 دروس فيديو", text: "دروس", buttons: [
    { id: "b_1", label: "درس 1", kind: "video", fileId: "vid-good-1" },
  ] }]);
  seedUser(kvEnv, ADMIN, { name: "أدمن", registeredAt: nowIso(), firstSeen: nowIso(), lastSeen: nowIso(), menuStudio: { step: "media", menuId: VIDEO_MENU_ID, buttonId: "b_1", kind: "video" } });

  const mismatch = await sendMedia(kvEnv, ADMIN, { photo: [{ file_id: "photo-small", file_unique_id: "p-u1" }, { file_id: "photo-big", file_unique_id: "p-u2" }] });
  assert.ok(anyText(mismatch, ADMIN, /وصل صورة/), "the mismatch message must name what arrived");
  assert.ok(anyText(mismatch, ADMIN, /نوعه فيديو/), "the mismatch message must name what the button needs");
  assert.equal(storedButton(kvEnv, VIDEO_MENU_ID, "b_1")?.fileId, "vid-good-1", "the original video file_id must not be overwritten");
  assert.equal(storedButton(kvEnv, VIDEO_MENU_ID, "b_1")?.kind, "video", "the button kind must stay video");
  assert.equal(studioStep(kvEnv, ADMIN), "media", "the media step must stay active so the admin can resend correctly");

  // A correct video afterwards still replaces the file.
  await sendMedia(kvEnv, ADMIN, { video: { file_id: "vid-new-1", file_unique_id: "vid-u2" } });
  assert.equal(storedButton(kvEnv, VIDEO_MENU_ID, "b_1")?.fileId, "vid-new-1", "a correct video must still update the button");
});

test("video-send-fix: a user tapping a broken video button gets only the generic message", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv, [{ id: VIDEO_MENU_ID, title: "🎬 دروس فيديو", text: "دروس", buttons: [
    { id: "b_1", label: "درس مكسور", kind: "video", fileId: "doc-file-1" },
  ] }]);
  const calls = await tap(kvEnv, USER, `mb|btn|${VIDEO_MENU_ID}|b_1`);
  assert.ok(calls.some((c) => c.url.endsWith("/sendVideo") && c.payload?.video === "doc-file-1"), "sendVideo must be attempted with the stored file_id");
  assert.ok(anyText(calls, USER, /تعذّر إرسال هذا المحتوى/), "the user must get the generic error message");
  assert.ok(!anyText(calls, USER, /wrong file identifier/), "the user must not see Telegram's technical reason");
  assert.ok(!anyText(calls, USER, /سبب الرفض/), "the user must not see the admin diagnostic");
});

test("video-send-fix: an admin tapping the same broken button also sees Telegram's real reason", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv, [{ id: VIDEO_MENU_ID, title: "🎬 دروس فيديو", text: "دروس", buttons: [
    { id: "b_1", label: "درس مكسور", kind: "video", fileId: "doc-file-1" },
  ] }]);
  const calls = await tap(kvEnv, ADMIN, `mb|btn|${VIDEO_MENU_ID}|b_1`);
  assert.ok(anyText(calls, ADMIN, /تعذّر إرسال هذا المحتوى/), "the admin must still get the generic error message");
  assert.ok(anyText(calls, ADMIN, /wrong file identifier/), "the admin must see Telegram's real reason");
  assert.ok(anyText(calls, ADMIN, /سبب الرفض/), "the admin diagnostic must be labelled as the rejection reason");
});

test("video-send-fix: a valid video button tap sends the video with no error", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv, [{ id: VIDEO_MENU_ID, title: "🎬 دروس فيديو", text: "دروس", buttons: [
    { id: "b_1", label: "درس 1", kind: "video", fileId: "vid-good-1" },
  ] }]);
  const calls = await tap(kvEnv, USER, `mb|btn|${VIDEO_MENU_ID}|b_1`);
  assert.ok(calls.some((c) => c.url.endsWith("/sendVideo") && c.payload?.video === "vid-good-1" && c.ok !== false), "sendVideo must be called with the video file_id and accepted");
  assert.ok(!anyText(calls, USER, /تعذّر إرسال هذا المحتوى/), "no error message may appear for a working button");
  assert.ok(!anyText(calls, USER, /سبب الرفض/), "no admin diagnostic may appear for a working button");
});

test("video-send-fix: with no kind chosen, the detected kind is still used (old behaviour)", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv, [{ id: VIDEO_MENU_ID, title: "🎬 دروس فيديو", text: "دروس", buttons: [] }]);
  seedUser(kvEnv, ADMIN, { name: "أدمن", registeredAt: nowIso(), firstSeen: nowIso(), lastSeen: nowIso(), menuStudio: { step: "media", menuId: VIDEO_MENU_ID, label: "ملف عام" } });
  await sendMedia(kvEnv, ADMIN, { document: { file_id: "doc-file-2", file_unique_id: "doc-u2" } });
  const created = storedMenus(kvEnv).find((m) => m.id === VIDEO_MENU_ID)?.buttons?.[0];
  assert.ok(created, "a button must be created when no kind was chosen");
  assert.equal(created.kind, "document", "the detected kind must be used when no kind was chosen");
  assert.equal(created.fileId, "doc-file-2", "the button must hold the document file_id");
});
