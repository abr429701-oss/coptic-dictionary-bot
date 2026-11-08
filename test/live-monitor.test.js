import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore } from "../src/index.js";
const token = "test-token";
const secret = "test-secret-should-be-long-enough";
const testRoot = fileURLToPath(new URL("..", import.meta.url));
const fakeAssets = {
  fetch: async (url) => {
    const pathname = new URL(url).pathname;
    if (!pathname.startsWith("/search-index/")) return new Response("Not found", { status: 404 });
    try {
      const bytes = readFileSync(resolve(testRoot, "public", pathname.slice(1)));
      return new Response(bytes, { headers: { "content-type": "application/json" } });
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
    const isNotice = String(url).endsWith("/sendMessage") && String(payload?.chat_id) === "813894692" &&
      /^(🆕|✅ أكمل التسجيل)/u.test(payload?.text ?? "");
    if (isNotice) (calls.notices ??= []).push(payload);
    else calls.push({ url: String(url), options, payload });
    return Response.json({ ok: true, result: { message_id: 900 } });
  };
}
function updateRequest(update, headers = {}) {
  return new Request("https://bot.test/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
      ...headers,
    },
    body: JSON.stringify(update),
  });
}
function fakeKv() {
  const store = new Map();
  const alarms = [];
  const storage = {
    get: async (key) => store.get(key),
    put: async (key, value) => { store.set(key, value); },
    delete: async (key) => store.delete(key),
    list: async ({ prefix = "", startAfter, limit } = {}) => {
      let entries = [...store].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      if (startAfter) entries = entries.filter(([key]) => key > startAfter);
      return new Map(limit ? entries.slice(0, limit) : entries);
    },
    setAlarm: async (when) => { alarms.push(when); },
  };
  const object = new UserStore({ storage }, env);
  return {
    store,
    alarms,
    object,
    idFromName: (name) => name,
    get: () => ({
      fetch: (url, options) => object.fetch(new Request(url, options)),
    }),
  };
}
async function say(envWithKv, userId, text, firstName) {
  const calls = [];
  fakeTelegramApi(calls);
  const from = { id: userId };
  if (firstName) from.first_name = firstName;
  await worker.fetch(updateRequest({ message: { text, chat: { id: userId, type: "private" }, from } }), envWithKv);
  return calls;
}
async function sayPhoto(envWithKv, userId, caption, firstName) {
  const calls = [];
  fakeTelegramApi(calls);
  const from = { id: userId };
  if (firstName) from.first_name = firstName;
  await worker.fetch(updateRequest({ message: { photo: [{ file_id: "P", file_unique_id: "UP" }], caption, chat: { id: userId, type: "private" }, from } }), envWithKv);
  return calls;
}
const ADMIN = 813894692;
const sent = (calls) => calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => c.payload);
const toAdmin = (calls) => sent(calls).filter((p) => p.chat_id === ADMIN);
const nowIso = () => new Date().toISOString();
function seedUser(kvEnv, id, name) {
  kvEnv.USERS.store.set(`user:${id}`, { name, registeredAt: nowIso(), firstSeen: nowIso(), lastSeen: nowIso() });
}

// The live-monitor flag is cached in module memory (same as maintenance),
// so tests run in definition order: the default-off test first, then the
// toggle test (on, then off in one session), then the rest (flag off).
test("live-monitor: live forwarding is off by default", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 52, "مينا");
  const calls = await say(kvEnv, 52, "رسالة بدون مراقبة 222", "مينا");
  assert.ok(!toAdmin(calls).some((p) => String(p.text ?? "").includes("رسالة بدون مراقبة 222")), "no live forward reaches the admin while the monitor is off");
});

test("live-monitor: a user's message is logged and shown by /userchat", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 51, "مينا");
  await say(kvEnv, 51, "كلمة تجريبية للمراقبة 111", "مينا");
  const calls = await say(kvEnv, ADMIN, "/userchat 51");
  const report = toAdmin(calls).find((p) => String(p.text ?? "").includes("كلمة تجريبية للمراقبة 111"));
  assert.ok(report, "/userchat shows the user's logged message");
  assert.match(String(report.text), /💬.*51/u, "report names the user id");
});

test("live-monitor: a photo with a caption is logged too", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 54, "مينا");
  await sayPhoto(kvEnv, 54, "صورة تجريبية 888", "مينا");
  const calls = await say(kvEnv, ADMIN, "/userchat 54");
  const report = toAdmin(calls).find((p) => String(p.text ?? "").includes("صورة تجريبية 888"));
  assert.ok(report, "/userchat shows the photo caption");
});

test("live-monitor: /livemon turns the live feed on, then off again", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 53, "كيرلس");
  const onCalls = await say(kvEnv, ADMIN, "/livemon");
  assert.ok(toAdmin(onCalls).some((p) => /تم تشغيل المراقبة المباشرة/u.test(String(p.text ?? ""))), "toggle on is confirmed");
  const liveCalls = await say(kvEnv, 53, "رسالة مباشرة 333", "كيرلس");
  const forward = toAdmin(liveCalls).find((p) => String(p.text ?? "").includes("رسالة مباشرة 333"));
  assert.ok(forward, "the admin receives the message live once the monitor is on");
  assert.match(String(forward.text), /كيرلس/u, "forward names the sender");
  assert.match(String(forward.text), /53/u, "forward names the sender id");
  assert.equal(forward.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data, "replyto|53", "forward carries a quick-reply button");
  const offCalls = await say(kvEnv, ADMIN, "/livemon");
  assert.ok(toAdmin(offCalls).some((p) => /تم إيقاف المراقبة المباشرة/u.test(String(p.text ?? ""))), "toggle off is confirmed");
  const quietCalls = await say(kvEnv, 53, "رسالة بعد الإيقاف 444", "كيرلس");
  assert.ok(!toAdmin(quietCalls).some((p) => String(p.text ?? "").includes("رسالة بعد الإيقاف 444")), "no forward reaches the admin after the monitor is off");
});

test("live-monitor: /conversations lists recently active users", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 55, "مريم");
  await say(kvEnv, 55, "سؤال من مريم 555", "مريم");
  const calls = await say(kvEnv, ADMIN, "/conversations");
  const report = toAdmin(calls).find((p) => String(p.text ?? "").includes("مريم"));
  assert.ok(report, "/conversations lists the active user");
  assert.match(String(report.text), /55/u, "report names the user id");
  assert.match(String(report.text), /\/userchat <id>/u, "report tells the admin how to open the chat");
});

test("live-monitor: a non-admin cannot toggle the live feed", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 56, "مينا");
  seedUser(kvEnv, 57, "مريم");
  await say(kvEnv, 56, "/livemon");
  const calls = await say(kvEnv, 57, "رسالة بعد محاولة غير أدمن 666", "مريم");
  assert.ok(!toAdmin(calls).some((p) => String(p.text ?? "").includes("رسالة بعد محاولة غير أدمن 666")), "no forward: a non-admin /livemon must not enable the monitor");
});

test("live-monitor: the admin's own messages are not logged or forwarded", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = await say(kvEnv, ADMIN, "رسالة أدمن تجريبية 777");
  assert.ok(!toAdmin(calls).some((p) => String(p.text ?? "").includes("رسالة أدمن تجريبية 777")), "the admin's own message is not forwarded to themself");
  const reportCalls = await say(kvEnv, ADMIN, "/userchat 813894692");
  assert.ok(toAdmin(reportCalls).some((p) => /لا توجد رسائل محفوظة/u.test(String(p.text ?? ""))), "the admin has no logged conversation of their own");
});

test("live-monitor: /userchat without an id explains the usage", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = await say(kvEnv, ADMIN, "/userchat");
  assert.ok(toAdmin(calls).some((p) => /\/userchat <id>/u.test(String(p.text ?? ""))), "usage hint is shown");
});
