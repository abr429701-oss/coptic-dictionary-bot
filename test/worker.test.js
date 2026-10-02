import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import records from "../data/dictionary.json" with { type: "json" };

const token = "test-token";
const secret = "test-secret-should-be-long-enough";
const env = { TELEGRAM_BOT_TOKEN: token, WEBHOOK_SECRET: secret };

function fakeTelegramApi(calls) {
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options, payload: options.body ? JSON.parse(options.body) : null });
    return Response.json({ ok: true, result: true });
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

test("health endpoint is public and returns ready", async () => {
  const response = await worker.fetch(new Request("https://bot.test/health"), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /ready/u);
});

test("rejects webhook calls with an invalid secret", async () => {
  const response = await worker.fetch(updateRequest({ message: { text: "/start", chat: { id: 7 } } }, {
    "x-telegram-bot-api-secret-token": "wrong",
  }), env);
  assert.equal(response.status, 403);
});

test("/stats returns the number of dictionary records", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  const response = await worker.fetch(updateRequest({ message: { text: "/stats", chat: { id: 7 } } }), env);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.chat_id, 7);
  assert.ok(calls[0].payload.text.includes(records.length.toLocaleString("en-US")));
});

test("several matches show only the suggestions title and word-only buttons", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  const response = await worker.fetch(updateRequest({ message: { text: "ⲁⲃⲏⲧ", chat: { id: 8 } } }), env);
  assert.equal(response.status, 200);
  const message = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.ok(message);
  assert.equal(message.text, "اختر من الاقتراحات التالية:");
  for (const row of message.reply_markup.inline_keyboard) {
    for (const button of row) assert.doesNotMatch(button.text, /—/u);
  }
});

test("callback pagination edits the suggestions message using the query in the callback data", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  const response = await worker.fetch(updateRequest({
    callback_query: {
      id: "callback-1",
      data: "p|1|ⲁ",
      message: { message_id: 34, chat: { id: 9 }, text: "اختر من الاقتراحات التالية:" },
    },
  }), env);
  assert.equal(response.status, 200);
  assert.ok(calls.some((call) => call.url.endsWith("/answerCallbackQuery")));
  const edit = calls.find((call) => call.url.endsWith("/editMessageText"))?.payload;
  assert.ok(edit);
  assert.equal(edit.chat_id, 9);
  assert.equal(edit.message_id, 34);
  assert.equal(edit.text, "اختر من الاقتراحات التالية:");
  assert.ok(edit.reply_markup.inline_keyboard.length > 0);
});

test("search sends a pronunciation voice message after the result", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("translate_tts")) {
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    }
    return Response.json({ ok: true, result: true });
  };
  const response = await worker.fetch(updateRequest({ message: { text: "abagini", chat: { id: 11 } } }), env);
  assert.equal(response.status, 200);
  assert.ok(calls.some((call) => call.url.endsWith("/sendMessage")));
  const voice = calls.find((call) => call.url.endsWith("/sendVoice"));
  assert.ok(voice);
  assert.equal(voice.options.body.get("chat_id"), "11");
});

test("a failing TTS service does not break the text result", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("translate_tts")) return new Response("blocked", { status: 403 });
    return Response.json({ ok: true, result: true });
  };
  const response = await worker.fetch(updateRequest({ message: { text: "abagini", chat: { id: 12 } } }), env);
  assert.equal(response.status, 200);
  assert.ok(calls.some((call) => call.url.endsWith("/sendMessage")));
  assert.ok(!calls.some((call) => call.url.endsWith("/sendVoice")));
});

test("a single result shows only word, meaning, kind and origin with no heading", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "abagini", chat: { id: 13 } } }), env);
  const text = calls.find((call) => call.url.endsWith("/sendMessage")).payload.text;
  assert.ok(text.startsWith("<b>الكلمة:</b> "));
  assert.match(text, /<b>المعنى:<\/b> /u);
  assert.doesNotMatch(text, /القاموس القبطي|نتائج|الصفحة|اليونانية|النطق|التهجئة|الجنس|الإنجليزية|كلمات مرتبطة/u);
});

test("tapping a suggestion from an Arabic search shows only the searched meaning", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "كوبري", chat: { id: 14 } } }), env);
  const first = calls.find((call) => call.url.endsWith("/sendMessage")).payload;
  const single = first.text.startsWith("<b>");
  const text = single ? first.text : await (async () => {
    const data = first.reply_markup.inline_keyboard[0][0].callback_data;
    calls.length = 0;
    await worker.fetch(updateRequest({ callback_query: { id: "c", data, message: { message_id: 1, chat: { id: 14 }, text: "x" } } }), env);
    return calls.find((call) => call.url.endsWith("/sendMessage")).payload.text;
  })();
  assert.match(text, /<b>المعنى:<\/b> [^،\n]*كوبري[^،\n]*\n/u);
  assert.doesNotMatch(text, /كلمات مرتبطة/u);
});

test("one or two letters show 10 tappable suggestions per page", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "ⲁⲃ", chat: { id: 15 } } }), env);
  const message = calls.find((call) => call.url.endsWith("/sendMessage")).payload;
  assert.equal(message.text, "اختر من الاقتراحات التالية:");
  const rows = message.reply_markup.inline_keyboard;
  const wordRows = rows.filter((row) => row[0].callback_data.startsWith("s|"));
  assert.equal(wordRows.length, 10);
  assert.ok(rows.at(-1).some((button) => button.callback_data.startsWith("p|1|")));
  assert.ok(!calls.some((call) => call.url.endsWith("/sendVoice")));
});

test("tapping a suggestion sends the entry without a heading", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({
    callback_query: { id: "c2", data: "s|3", message: { message_id: 5, chat: { id: 16 }, text: "x" } },
  }), env);
  const message = calls.find((call) => call.url.endsWith("/sendMessage")).payload;
  assert.equal(message.chat_id, 16);
  assert.ok(message.text.startsWith("<b>الكلمة:</b> "));
});

test("Arabic search matches whole words only, never inside a longer word", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "غراب", chat: { id: 17 } } }), env);
  const message = calls.find((call) => call.url.endsWith("/sendMessage")).payload;
  assert.equal(message.text, "اختر من الاقتراحات التالية:");
  const data = message.reply_markup.inline_keyboard[0][0].callback_data;
  calls.length = 0;
  await worker.fetch(updateRequest({ callback_query: { id: "c", data, message: { message_id: 1, chat: { id: 17 }, text: "x" } } }), env);
  const text = calls.find((call) => call.url.endsWith("/sendMessage")).payload.text;
  assert.match(text, /<b>المعنى:<\/b> [^\n]*غراب/u);
  assert.doesNotMatch(text, /الاستغراب/u);
});

function fakeKv() {
  const store = new Map();
  return { store, get: async (key) => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); } };
}

async function say(envWithKv, userId, text) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text, chat: { id: userId }, from: { id: userId } } }), envWithKv);
  return calls;
}

test("/start asks a new user for a three-part name, then welcomes with a photo", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  let calls = await say(kvEnv, 21, "/start");
  const ask = calls.find((call) => call.url.endsWith("/sendMessage")).payload.text;
  assert.equal(ask, "مرحبًا بك! يبدو أنك تستخدم البوت لأول مرة, الرجاء إدخال اسمك ثلاثي للبدء في استخدام القاموس القبطي الناطق");

  calls = await say(kvEnv, 21, "مينا");
  assert.match(calls.find((call) => call.url.endsWith("/sendMessage")).payload.text, /ثلاثيًا/u);
  assert.ok(!calls.some((call) => call.url.endsWith("/sendPhoto")));

  calls = await say(kvEnv, 21, "مينا جرجس بشرى");
  const photo = calls.find((call) => call.url.endsWith("/sendPhoto")).payload;
  assert.equal(photo.caption, "مرحبًا بك يا مينا جرجس بشرى في القاموس الرقمي الناطق للغة القبطية, تفضل الان بكتابة أي كلمة للبحث عنها");
  assert.ok(photo.photo.startsWith("https://"));
});

test("/start greets a returning user by the saved name with the photo", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set("user:22", JSON.stringify({ name: "بيشوي مجدي فرج" }));
  const calls = await say(kvEnv, 22, "/start");
  const photo = calls.find((call) => call.url.endsWith("/sendPhoto")).payload;
  assert.match(photo.caption, /مرحبًا بك يا بيشوي مجدي فرج في القاموس الرقمي الناطق/u);
  assert.ok(!calls.some((call) => call.url.endsWith("/sendMessage")));
});

test("if the photo cannot be sent the welcome falls back to text", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set("user:23", JSON.stringify({ name: "أبانوب سمير حنا" }));
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), payload: options.body ? JSON.parse(options.body) : null });
    if (String(url).endsWith("/sendPhoto")) return Response.json({ ok: false, description: "bad url" }, { status: 400 });
    return Response.json({ ok: true, result: true });
  };
  await worker.fetch(updateRequest({ message: { text: "/start", chat: { id: 23 }, from: { id: 23 } } }), kvEnv);
  assert.match(calls.find((call) => call.url.endsWith("/sendMessage")).payload.text, /أبانوب سمير حنا/u);
});
