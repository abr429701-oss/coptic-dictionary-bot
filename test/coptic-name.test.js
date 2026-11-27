import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore } from "../src/index.js";
import { transliterateNameToCoptic, copticNameReply, normalizeArabicWord } from "../src/coptic-name.js";

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

// A registered user (name gate passed) so commands reach the feature dispatch.
async function registeredUser(kvEnv, userId) {
  await say(kvEnv, userId, "/start");
  await say(kvEnv, userId, "اسم الاختبار");
}

// ---------------------------------------------------------------------------
// Pure transliteration
// ---------------------------------------------------------------------------

test("coptic-name: curated names are spelled correctly (Arabic + English)", () => {
  assert.equal(transliterateNameToCoptic("ابرام"), "Ⲁⲃⲣⲁⲙ");
  assert.equal(transliterateNameToCoptic("Ebram"), "Ⲁⲃⲣⲁⲙ");
  assert.equal(transliterateNameToCoptic("مينا"), "Ⲙⲏⲛⲁ");
  assert.equal(transliterateNameToCoptic("Mina"), "Ⲙⲏⲛⲁ");
  assert.equal(transliterateNameToCoptic("كيرلس"), "Ⲕⲩⲣⲓⲗⲗⲟⲥ");
  assert.equal(transliterateNameToCoptic("Kerolos"), "Ⲕⲩⲣⲓⲗⲗⲟⲥ");
  assert.equal(transliterateNameToCoptic("شنودة"), "Ϣⲉⲛⲟⲩϯⲁ");
  assert.equal(transliterateNameToCoptic("Shenouda"), "Ϣⲉⲛⲟⲩϯⲁ");
  assert.equal(transliterateNameToCoptic("محمد"), "Ⲙⲟϩⲁⲙⲙⲁⲇ");
  assert.equal(transliterateNameToCoptic("Mohammed"), "Ⲙⲟϩⲁⲙⲙⲁⲇ");
  assert.equal(transliterateNameToCoptic("مريم"), "Ⲙⲁⲣⲓⲁ");
  assert.equal(transliterateNameToCoptic("عمر"), "Ⲟⲙⲁⲣ");
  assert.equal(transliterateNameToCoptic("كرستين"), "Ⲭⲣⲓⲥⲧⲓⲛⲏ");
  assert.equal(transliterateNameToCoptic("عبدالله"), "ⲀⲃⲇⲀⲗⲗⲁϩ");
  assert.equal(transliterateNameToCoptic("عبدالرحمن"), "ⲀⲃⲇⲀⲗⲣⲁϩⲙⲁⲛ");
  assert.equal(transliterateNameToCoptic("عماد"), "Ⲉⲙⲁⲇ");
  assert.equal(transliterateNameToCoptic("باسم"), "ⲃⲁⲥⲓⲙ");
  assert.equal(transliterateNameToCoptic("جورج"), "Ⲅⲉⲱⲣⲅⲓⲟⲥ");
  assert.equal(transliterateNameToCoptic("George"), "Ⲅⲉⲱⲣⲅⲓⲟⲥ");
  assert.equal(transliterateNameToCoptic("فاطمة"), "Ⲫⲁϯⲙⲁ");
  assert.equal(transliterateNameToCoptic("عبد الله"), "Ⲁⲃⲇ Ⲁⲗⲗⲁϩ");
});

test("coptic-name: fallback transliteration is readable for unknown names", () => {
  assert.equal(transliterateNameToCoptic("سالم"), "Ⲥⲁⲗⲁⲙ");
  assert.equal(transliterateNameToCoptic("كريم"), "Ⲕⲁⲣⲓⲙ");
  assert.equal(transliterateNameToCoptic("منى"), "Ⲙⲁⲛⲁ");
  assert.equal(transliterateNameToCoptic("شادي"), "Ϣⲁⲇⲓ");
  assert.equal(transliterateNameToCoptic("Shady"), "Ϣⲁⲇⲓ");
  assert.equal(transliterateNameToCoptic("ابرام مرزق"), "Ⲁⲃⲣⲁⲙ Ⲙⲁⲣⲁⲍⲁⲕ");
});

test("coptic-name: English fallback matches the Android app's map exactly", () => {
  // Same results as NameInCopticScreen.tsx in coptic-dictionary-mobile.
  assert.equal(transliterateNameToCoptic("Waleed"), "Ⲱⲁⲗⲉⲉⲇ");
  assert.equal(transliterateNameToCoptic("Cecilia"), "Ⲥⲉⲥⲓⲗⲓⲁ");
  assert.equal(transliterateNameToCoptic("Christine"), "Ⲭⲣⲓⲥⲧⲓⲛⲏ");
  assert.equal(transliterateNameToCoptic("Khaled"), "Ϧⲁⲗⲉⲇ");
  assert.equal(transliterateNameToCoptic("Philip"), "Ⲫⲓⲗⲓⲡⲡⲟⲥ");
});

test("coptic-name: invalid input returns null", () => {
  assert.equal(transliterateNameToCoptic("12345"), null);
  assert.equal(transliterateNameToCoptic(""), null);
  assert.equal(transliterateNameToCoptic("   "), null);
  assert.equal(transliterateNameToCoptic("a"), null);
  assert.equal(transliterateNameToCoptic("!!!"), null);
});

test("coptic-name: reply text uses the exact requested wording", () => {
  assert.equal(copticNameReply("ابرام"), "كتابة اسمك بالقبطية: Ⲁⲃⲣⲁⲙ");
  assert.equal(copticNameReply("12345"), null);
});

test("coptic-name: Arabic normalization unifies hamza/ta-marbuta/alef-maqsura", () => {
  assert.equal(normalizeArabicWord("أحمد"), "احمد");
  assert.equal(normalizeArabicWord("فاطمة"), "فاطمه");
  assert.equal(normalizeArabicWord("موسى"), "موسي");
  assert.equal(transliterateNameToCoptic("أحمد"), "Ⲁϩⲙⲁⲇ");
});

// ---------------------------------------------------------------------------
// Flow through the worker
// ---------------------------------------------------------------------------

test("coptic-name: /copticname asks for the name, then answers in Coptic", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const userId = 424242;
  await registeredUser(kvEnv, userId);
  const ask = await say(kvEnv, userId, "/copticname");
  assert.match(texts(ask), /اكتب اسمك بالعربي أو بالإنجليزي/);
  const reply = await say(kvEnv, userId, "ابرام");
  assert.ok(sent(reply).some((t) => t === "كتابة اسمك بالقبطية: Ⲁⲃⲣⲁⲙ"), "the reply is exactly the requested wording");
});

test("coptic-name: /copticname <name> answers at once, in English too", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const userId = 424243;
  await registeredUser(kvEnv, userId);
  const reply = await say(kvEnv, userId, "/copticname Shenouda");
  assert.ok(sent(reply).some((t) => t === "كتابة اسمك بالقبطية: Ϣⲉⲛⲟⲩϯⲁ"));
});

test("coptic-name: an invalid name keeps the flow open until a valid one", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const userId = 424244;
  await registeredUser(kvEnv, userId);
  await say(kvEnv, userId, "/copticname");
  const bad = await say(kvEnv, userId, "12345");
  assert.match(texts(bad), /اكتب اسم صحيح/);
  const good = await say(kvEnv, userId, "مينا");
  assert.ok(sent(good).some((t) => t === "كتابة اسمك بالقبطية: Ⲙⲏⲛⲁ"));
});

test("coptic-name: /cancel leaves the flow", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const userId = 424245;
  await registeredUser(kvEnv, userId);
  await say(kvEnv, userId, "/copticname");
  const cancel = await say(kvEnv, userId, "/cancel");
  assert.match(texts(cancel), /تم إلغاء كتابة الاسم بالقبطية/);
  // After cancelling, a plain name goes to the dictionary search, not the flow.
  const after = await say(kvEnv, userId, "ابرام");
  assert.ok(!sent(after).some((t) => t.startsWith("كتابة اسمك بالقبطية:")), "the flow is gone after /cancel");
});

test("coptic-name: /copticname is listed in the commands list after registration", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const userId = 424246;
  await say(kvEnv, userId, "/start");
  const done = await say(kvEnv, userId, "اسم الاختبار");
  assert.ok(sent(done).some((t) => t.includes("/copticname — اكتب اسمك بالحروف القبطية")));
});
