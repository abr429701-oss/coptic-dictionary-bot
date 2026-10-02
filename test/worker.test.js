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

test("text search returns a match and pagination keyboard", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  const response = await worker.fetch(updateRequest({ message: { text: "ⲁ", chat: { id: 8 } } }), env);
  assert.equal(response.status, 200);
  const message = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.ok(message);
  assert.match(message.text, /نتائج البحث عن/u);
  assert.match(message.text, /ⲁ/u);
  assert.ok(message.reply_markup?.inline_keyboard?.[0]?.some((button) => button.callback_data === "p|1"));
});

test("callback pagination edits the result message for the next page", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  const response = await worker.fetch(updateRequest({
    callback_query: {
      id: "callback-1",
      data: "p|1",
      message: {
        message_id: 34,
        chat: { id: 9 },
        text: "📖 القاموس القبطي البحيري\n🔎 نتائج البحث عن: ⲁ\nالنتائج: 4 | الصفحة: 1/4\n\n1. ⲁ",
      },
    },
  }), env);
  assert.equal(response.status, 200);
  assert.ok(calls.some((call) => call.url.endsWith("/answerCallbackQuery")));
  const edit = calls.find((call) => call.url.endsWith("/editMessageText"))?.payload;
  assert.ok(edit);
  assert.equal(edit.chat_id, 9);
  assert.equal(edit.message_id, 34);
  assert.match(edit.text, /الصفحة:<\/b> 2\//u);
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
  const response = await worker.fetch(updateRequest({ message: { text: "ⲁ", chat: { id: 11 } } }), env);
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
  const response = await worker.fetch(updateRequest({ message: { text: "ⲁ", chat: { id: 12 } } }), env);
  assert.equal(response.status, 200);
  assert.ok(calls.some((call) => call.url.endsWith("/sendMessage")));
  assert.ok(!calls.some((call) => call.url.endsWith("/sendVoice")));
});

test("result shows only word, meaning, kind and origin", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "ⲁⲃⲏⲧ", chat: { id: 13 } } }), env);
  const text = calls.find((call) => call.url.endsWith("/sendMessage")).payload.text;
  assert.match(text, /<b>الكلمة:<\/b> /u);
  assert.match(text, /<b>المعنى:<\/b> /u);
  assert.match(text, /<b>النوع:<\/b> /u);
  assert.match(text, /<b>الأصل:<\/b> /u);
  assert.doesNotMatch(text, /اليونانية|النطق|التهجئة|الجنس|الإنجليزية/u);
});

test("searching a meaning shows only that meaning and lists the others as related", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "كوبري", chat: { id: 14 } } }), env);
  const text = calls.find((call) => call.url.endsWith("/sendMessage")).payload.text;
  assert.match(text, /<b>المعنى:<\/b> [^،\n]*كوبري[^،\n]*\n/u);
  assert.match(text, /كلمات مرتبطة:<\/b> /u);
});
