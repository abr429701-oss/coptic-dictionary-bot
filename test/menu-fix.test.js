import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore } from "../src/index.js";
import { MENUS_KEY, VIDEO_MENU_ID } from "../src/menu-builder.js";

// ---------------------------------------------------------------------------
// Regression tests for the "tap a menu button, get NOTHING" bug (2026-11-05).
//
// Root causes (verified in src/index.js):
//  1. openMenu() sent reply_markup {inline_keyboard: []} when a menu had no
//     visible buttons (empty video menu, or all buttons admin-only for a
//     normal user). Telegram rejects an empty inline keyboard with 400 and
//     telegram() only logs the error, so the user saw nothing.
//  2. Menu/button text is sent with parse_mode "HTML" straight from
//     admin-entered content; a stray "<" or "&" makes Telegram reject the
//     whole message, again silently.
// The fake Telegram API below simulates the real Bot API: it rejects an
// empty inline keyboard and malformed HTML with 400, and accepts the rest.
// Every menu tap must still produce a visible message for the user.
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

// Telegram Bot API behaviour, simulated: empty inline keyboards and bad HTML
// are 400s; everything else succeeds.
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
const sent = (calls) => calls.filter((c) => c.url.endsWith("/sendMessage") && c.ok !== false).map((c) => c.payload);
const attempted = (calls) => calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => c.payload);
const toChat = (calls, chatId) => sent(calls).filter((m) => String(m.chat_id) === String(chatId));
const anyText = (calls, chatId, re) => toChat(calls, chatId).some((m) => re.test(m.text ?? ""));
const seedMenus = (kvEnv, menus) => kvEnv.USERS.store.set(MENUS_KEY, { menus });
const seedUser = (kvEnv, userId, record) => kvEnv.USERS.store.set(`user:${userId}`, record);
const nowIso = () => new Date().toISOString();
const ADMIN = 813894692;
const USER = 51;

test("menu-fix: opening an empty menu (inline path) still delivers a message", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv, [{ id: "m_empty", title: "قائمة فارغة", text: "نص القائمة الفارغة", buttons: [] }]);
  const calls = await tap(kvEnv, USER, "mb|open|m_empty");
  assert.ok(anyText(calls, USER, /نص القائمة الفارغة/), "the menu text must reach the user");
  assert.ok(anyText(calls, USER, /لا توجد أزرار/), "an empty-state line must be shown");
  // No sendMessage attempt may carry an empty inline keyboard.
  assert.ok(!attempted(calls).some((m) => Array.isArray(m.reply_markup?.inline_keyboard) && m.reply_markup.inline_keyboard.length === 0),
    "an empty inline keyboard must never be sent");
});

test("menu-fix: video menu with no lessons shows the empty text", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  // No video menu stored yet: /videolessons creates it lazily, with no buttons.
  const calls = await say(kvEnv, USER, "/videolessons");
  assert.ok(anyText(calls, USER, /لا توجد دروس فيديو/), "the empty video-lessons text must reach the user");
  assert.ok(!attempted(calls).some((m) => Array.isArray(m.reply_markup?.inline_keyboard) && m.reply_markup.inline_keyboard.length === 0),
    "an empty inline keyboard must never be sent");
});

test("menu-fix: a menu whose buttons are all admin-only still answers a normal user", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv, [{ id: VIDEO_MENU_ID, title: "🎬 دروس فيديو", text: "🎬 <b>دروس فيديو</b>\n\nاختر درسًا لمشاهدته:", buttons: [
    { id: "b_1", label: "درس سري", kind: "video", fileId: "file-1", adminOnly: true },
  ] }]);
  const calls = await say(kvEnv, USER, "/videolessons");
  assert.ok(anyText(calls, USER, /دروس فيديو/), "the menu must answer a normal user even when every button is admin-only");
  assert.ok(!attempted(calls).some((m) => Array.isArray(m.reply_markup?.inline_keyboard) && m.reply_markup.inline_keyboard.length === 0),
    "an empty inline keyboard must never be sent");
  assert.ok(!JSON.stringify(toChat(calls, USER)).includes("درس سري"), "the admin-only button must stay hidden");
});

test("menu-fix: menu text containing '<' and '&' still delivers", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv, [{ id: "m_bad", title: "قائمة", text: "دروس < مهمة & مفيدة", buttons: [
    { id: "b_1", label: "نص", kind: "text", text: "أهلًا" },
  ] }]);
  const calls = await say(kvEnv, USER, "/start menu_m_bad");
  assert.ok(anyText(calls, USER, /دروس < مهمة & مفيدة/), "the raw menu text must reach the user even when its HTML is invalid");
});

test("menu-fix: a text button whose content has '<' still delivers", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv, [{ id: "m_bad", title: "قائمة", text: "t", buttons: [
    { id: "b_1", label: "نص", kind: "text", text: "5 < 6 & 7 > 2" },
  ] }]);
  const calls = await tap(kvEnv, USER, "mb|btn|m_bad|b_1");
  assert.ok(anyText(calls, USER, /5 < 6 & 7 > 2/), "button text must reach the user even when its HTML is invalid");
});

test("menu-fix: admin in studio 'main' step tapping a root menu title still opens the menu", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv, [{ id: "m_root", title: "الرئيسية", text: "نص الرئيسية", buttons: [
    { id: "b_1", label: "نص", kind: "text", text: "محتوى الزر" },
  ] }]);
  seedUser(kvEnv, ADMIN, { name: "أدمن", registeredAt: nowIso(), firstSeen: nowIso(), lastSeen: nowIso(), menuStudio: { step: "main" } });
  const calls = await say(kvEnv, ADMIN, "الرئيسية");
  assert.ok(anyText(calls, ADMIN, /نص الرئيسية/), "the studio must not swallow a root-menu tap in the main step");
});

test("menu-fix: admin in studio 'menus' step tapping a button label of the current nav menu runs it", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv, [{ id: "m_root", title: "الرئيسية", text: "نص الرئيسية", buttons: [
    { id: "b_1", label: "نص", kind: "text", text: "محتوى الزر" },
  ] }]);
  seedUser(kvEnv, ADMIN, { name: "أدمن", registeredAt: nowIso(), firstSeen: nowIso(), lastSeen: nowIso(), menuStudio: { step: "menus" }, menuNav: "m_root" });
  const calls = await say(kvEnv, ADMIN, "نص");
  assert.ok(anyText(calls, ADMIN, /محتوى الزر/), "the studio must not swallow a nav-menu button tap in the menus step");
});
