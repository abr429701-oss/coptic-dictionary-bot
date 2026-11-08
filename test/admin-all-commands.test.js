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
async function adminCallback(kvEnv, id, data) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({
    callback_query: { id: "ac1", data, from: { id }, message: { message_id: 600, chat: { id }, text: "x" } },
  }), kvEnv);
  return calls;
}
const ALL_COMMANDS_COUNT = 333;

test("admin-all-commands: the /admin dashboard carries a كل الأوامر button", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = await say(kvEnv, ADMIN, "/admin");
  const dashboard = sent(calls).find((p) => String(p.text ?? "").includes("لوحة تحكم الأدمن"));
  assert.ok(dashboard, "/admin must show the admin dashboard");
  const buttons = (dashboard.reply_markup?.inline_keyboard ?? []).flat();
  const all = buttons.find((b) => b.callback_data === "ad|allcommands");
  assert.ok(all, "the dashboard must have a كل الأوامر button");
  assert.equal(all.text, "📋 كل الأوامر");
});

test("admin-all-commands: tapping كل الأوامر lists every bot command exactly once", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = await adminCallback(kvEnv, ADMIN, "ad|allcommands");
  const texts = sent(calls).map((p) => String(p.text ?? ""));
  assert.ok(texts.length >= 2, "the full list spans several messages");
  assert.ok(texts[0].includes(`كل أوامر البوت (${ALL_COMMANDS_COUNT})`), "the first message states the full count");
  const names = texts.flatMap((t) => [...t.matchAll(/^\/([a-z0-9_]+) — /gmu)].map((m) => m[1]));
  assert.equal(names.length, ALL_COMMANDS_COUNT, `the list must contain exactly ${ALL_COMMANDS_COUNT} commands`);
  assert.equal(new Set(names).size, names.length, "no command may appear twice");
  for (const name of ["livemon", "conversations", "menuadmin", "hidebutton", "showbutton", "broadcast", "errors", "usage", "backup", "analytics", "auditlog", "quiz", "fav", "flashcards", "importlearn", "record", "apanel", "retention", "ops", "subscribe", "hangman", "donate", "setwodtest", "card_hide", "voice_delete_all", "liveusers", "start", "menu", "admin"]) {
    assert.ok(names.includes(name), `the list must include /${name}`);
  }
  for (const t of texts) assert.ok(t.length <= 4000, "every chunk fits in one Telegram message");
});

test("admin-all-commands: a non-admin gets nothing from the كل الأوامر button", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = await adminCallback(kvEnv, 57, "ad|allcommands");
  assert.equal(sent(calls).length, 0, "the full list is admin-only");
});
