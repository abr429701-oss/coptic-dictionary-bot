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
const ADMIN = 813894692;
const OTHER = 777001;

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

function updateRequest(update) {
  return new Request("https://bot.test/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(update),
  });
}

function fakeTelegramApi(calls) {
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body;
    const payload = !body ? null : typeof body === "string" ? JSON.parse(body) : Object.fromEntries(body.entries());
    calls.push({ url: String(url), options, payload });
    return Response.json({ ok: true, result: { message_id: 900 } });
  };
}

async function say(kvEnv, userId, text) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text, chat: { id: userId, type: "private" }, from: { id: userId, first_name: "Tester" } } }), kvEnv);
  return calls;
}
const sent = (calls) => calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => String(c.payload?.text ?? ""));
const texts = (calls) => sent(calls).join("\n");

async function registeredUser(kvEnv, userId) {
  await say(kvEnv, userId, "/start");
  await say(kvEnv, userId, "اسم الاختبار");
}

test("translate dispatch: admin multi-word /translate answers with the sentence", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await registeredUser(kvEnv, ADMIN);
  const out = texts(await say(kvEnv, ADMIN, "/translate أنا أحب الله"));
  assert.equal(out, "Ϯⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
});

test("translate dispatch: bare /translate asks, then the sentence is translated", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await registeredUser(kvEnv, ADMIN);
  assert.match(texts(await say(kvEnv, ADMIN, "/translate")), /اكتب الجملة بالعربي/);
  const out = texts(await say(kvEnv, ADMIN, "هو يكتب الدرس"));
  assert.equal(out, "ϥ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  // one shot: the next word searches the dictionary again, it is not translated
  const after = texts(await say(kvEnv, ADMIN, "كتاب"));
  assert.doesNotMatch(after, /اكتب الجملة/);
});

test("translate dispatch: /cancel ends the awaiting state", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await registeredUser(kvEnv, ADMIN);
  await say(kvEnv, ADMIN, "/translate");
  assert.match(texts(await say(kvEnv, ADMIN, "/cancel")), /تم إلغاء الترجمة/);
});

test("translate dispatch: non-admin multi-word falls through to the word view", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await registeredUser(kvEnv, OTHER);
  const out = texts(await say(kvEnv, OTHER, "/translate أنا أحب الله"));
  assert.match(out, /لم أجد/);
});

test("translate dispatch: non-admin bare /translate is NOT the sentence flow", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await registeredUser(kvEnv, OTHER);
  const out = texts(await say(kvEnv, OTHER, "/translate"));
  assert.doesNotMatch(out, /اكتب الجملة بالعربي/);
});
