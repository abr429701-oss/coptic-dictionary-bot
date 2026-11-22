// ❤️ reaction on the user's message when a word card is shown.
// A word card (search result, /random, word_ deep link, /wod) reacts on the
// USER's incoming message with setMessageReaction; anything else (help,
// no-result, suggestion lists) does not. Callback-triggered cards (picks,
// meaning steps, keyboard search, page turns) react too: the buttons carry
// the user's message id as a `~r<id>` suffix, because a callback query
// carries no user message id of its own. Buttons sent before the suffix
// existed have none and still work — they just don't react.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore } from "../src/index.js";
import records from "../data/dictionary.json" with { type: "json" };

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
const fakeOgg = () => new Response(new Uint8Array([79, 103, 103, 83, 1, 2, 3]), { headers: { "content-type": "audio/ogg" } });
const isGeneratedAudio = (url) => String(url).includes("raw.githubusercontent.com/abr429701-oss/coptic-dictionary-bot/audio/");

function fakeTelegramApi(calls) {
  globalThis.fetch = async (url, options = {}) => {
    if (isGeneratedAudio(url)) return fakeOgg();
    const body = options.body;
    const payload = !body ? null : typeof body === "string" ? JSON.parse(body) : Object.fromEntries(body.entries());
    calls.push({ url: String(url), options, payload });
    return Response.json({ ok: true, result: { message_id: 900 } });
  };
}

function fakeKv() {
  const store = new Map();
  const storage = {
    get: async (key) => store.get(key),
    put: async (key, value) => { store.set(key, value); },
    delete: async (key) => { store.delete(key); },
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
    object,
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

const reactionCalls = (calls) => calls.filter((call) => call.url.endsWith("/setMessageReaction"));
const heartReaction = (calls, chatId, messageId) => reactionCalls(calls).find((call) =>
  call.payload?.chat_id === chatId &&
  call.payload?.message_id === messageId &&
  Array.isArray(call.payload?.reaction) &&
  call.payload.reaction.some((r) => r?.type === "emoji" && r?.emoji === "❤️"));

// A word shown directly (single match): the card goes out and the user's
// message gets the ❤️ — after the card, never before it.
test("word reaction: an exact word search reacts ❤️ on the user's message", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  const response = await worker.fetch(updateRequest({ message: { message_id: 101, text: "ⲁⲃⲏⲧ", chat: { id: 8 } } }), env);
  assert.equal(response.status, 200);
  const cardIndex = calls.findIndex((call) => call.url.endsWith("/sendMessage") && String(call.payload?.text ?? "").includes("ⲁⲃⲏⲧ"));
  assert.ok(cardIndex >= 0, "the word card is sent");
  const reactionIndex = calls.findIndex((call) => call.url.endsWith("/setMessageReaction"));
  assert.ok(reactionIndex > cardIndex, "the reaction is sent after the card");
  assert.ok(heartReaction(calls, 8, 101), "the ❤️ targets the user's message 101 in chat 8");
});

test("word reaction: /random reacts ❤️ on the user's message", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { message_id: 202, text: "/random", chat: { id: 9 } } }), env);
  assert.ok(calls.some((call) => call.url.endsWith("/sendMessage") && String(call.payload?.text ?? "").includes("الكلمة:")), "a word card is sent");
  assert.ok(heartReaction(calls, 9, 202), "the ❤️ targets the user's /random message 202");
});

test("word reaction: a word_ deep link reacts ❤️ on the user's /start message", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = [];
  fakeTelegramApi(calls);
  const record = records.find((r) => String(r.coptic ?? "").replace(/\s*\([^)]*\)\s*/gu, "").trim() === "ⲁⲃⲏⲧ") ?? records[0];
  await worker.fetch(updateRequest({ message: { message_id: 303, text: `/start word_${record.id}`, chat: { id: 10 }, from: { id: 10 } } }), kvEnv);
  assert.ok(calls.some((call) => call.url.endsWith("/sendMessage") && String(call.payload?.text ?? "").includes("ⲁⲃⲏⲧ")), "the deep-linked word card is sent");
  assert.ok(heartReaction(calls, 10, 303), "the ❤️ targets the user's /start message 303");
});

test("word reaction: /wod reacts ❤️ on the user's message", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { message_id: 404, text: "/wod", chat: { id: 11 }, from: { id: 11 } } }), env);
  assert.ok(calls.some((call) => call.url.endsWith("/sendMessage") && String(call.payload?.text ?? "").includes("كلمة اليوم")), "the word-of-the-day message is sent");
  assert.ok(heartReaction(calls, 11, 404), "the ❤️ targets the user's /wod message 404");
});

test("word reaction: no reaction for a no-result search", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { message_id: 505, text: "zzzzqqq", chat: { id: 12 } } }), env);
  assert.ok(calls.some((call) => call.url.endsWith("/sendMessage")), "a reply is sent");
  assert.equal(reactionCalls(calls).length, 0, "no reaction on a no-result search");
});

test("word reaction: no reaction for /help", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { message_id: 606, text: "/help", chat: { id: 13 } } }), env);
  assert.ok(calls.some((call) => call.url.endsWith("/sendMessage")), "the help text is sent");
  assert.equal(reactionCalls(calls).length, 0, "no reaction on /help");
});

test("word reaction: a suggestion list gets no reaction", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { message_id: 707, text: "ⲁⲃ", chat: { id: 18 } } }), env);
  const list = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.equal(list?.text, "اختر من الاقتراحات التالية:", "a suggestion list is shown, not a card");
  assert.equal(reactionCalls(calls).length, 0, "no reaction on a suggestion list");
});

test("word reaction: a suggestion pick reacts ❤️ on the user's original message", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { message_id: 808, text: "ⲁⲃ", chat: { id: 19 } } }), env);
  const first = calls.find((call) => call.url.endsWith("/sendMessage")).payload.reply_markup.inline_keyboard[0][0];
  assert.ok(String(first.callback_data ?? "").includes("~r808"), "the pick button carries the user's message id");
  assert.equal(reactionCalls(calls).length, 0, "no reaction on the suggestion list");
  calls.length = 0;
  await worker.fetch(updateRequest({ callback_query: { id: "w1", data: first.callback_data, from: { id: 19 }, message: { message_id: 1, chat: { id: 19 }, text: "x" } } }), env);
  const card = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.ok(card && String(card.text ?? "").startsWith("<b>الكلمة:</b> "), "tapping the suggestion shows the word card");
  assert.ok(heartReaction(calls, 19, 808), "the ❤️ targets the user's original message 808");
});

test("word reaction: an old-format pick (no ~r suffix) shows the card but does not react", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { message_id: 909, text: "ⲁⲃ", chat: { id: 20 } } }), env);
  const first = calls.find((call) => call.url.endsWith("/sendMessage")).payload.reply_markup.inline_keyboard[0][0];
  const oldData = String(first.callback_data ?? "").replace(/~r\d+$/u, "");
  assert.ok(!oldData.includes("~r"), "stripped to the old format");
  calls.length = 0;
  await worker.fetch(updateRequest({ callback_query: { id: "w2", data: oldData, from: { id: 20 }, message: { message_id: 1, chat: { id: 20 }, text: "x" } } }), env);
  const card = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.ok(card && String(card.text ?? "").startsWith("<b>الكلمة:</b> "), "the old button still shows the word card");
  assert.equal(reactionCalls(calls).length, 0, "no reaction without the suffix: old buttons keep working");
});

test("word reaction: a did-you-mean pick reacts ❤️ on the user's message", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { message_id: 1010, text: "ⲁⲃⲏⲧⲧ", chat: { id: 21 } } }), env);
  const list = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.ok(String(list?.text ?? "").includes("هل تقصد"), "a did-you-mean list is shown");
  const first = list.reply_markup.inline_keyboard[0][0];
  assert.ok(String(first.callback_data ?? "").startsWith("s|"), "the button is an s| pick");
  assert.ok(String(first.callback_data ?? "").includes("~r1010"), "the pick button carries the user's message id");
  calls.length = 0;
  await worker.fetch(updateRequest({ callback_query: { id: "w3", data: first.callback_data, from: { id: 21 }, message: { message_id: 1, chat: { id: 21 }, text: "x" } } }), env);
  const card = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.ok(card && String(card.text ?? "").startsWith("<b>الكلمة:</b> "), "tapping the suggestion shows the word card");
  assert.ok(heartReaction(calls, 21, 1010), "the ❤️ targets the user's message 1010");
});

test("word reaction: tapping 'next meaning' (x|) reacts ❤️ on the user's message", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  // ⲁⲅⲁⲡⲏⲧⲟⲥ resolves to a card with a next-meaning (x|) button in the
  // current data. ("ماء" used to; the 2026-11-22 data change — 388 words
  // removed — made it show a suggestions list instead of a card.)
  await worker.fetch(updateRequest({ message: { message_id: 1111, text: "ⲁⲅⲁⲡⲏⲧⲟⲥ", chat: { id: 22 } } }), env);
  const card = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.ok(card && String(card.text ?? "").startsWith("<b>الكلمة:</b> "), "the word card is shown");
  assert.ok(heartReaction(calls, 22, 1111), "the card itself reacts on the user's message");
  const more = card.reply_markup.inline_keyboard.flat().find((b) => String(b.callback_data ?? "").startsWith("x|"));
  assert.ok(more, "the card has a next-meaning button");
  assert.ok(String(more.callback_data ?? "").includes("~r1111"), "the next-meaning button carries the user's message id");
  calls.length = 0;
  await worker.fetch(updateRequest({ callback_query: { id: "w4", data: more.callback_data, from: { id: 22 }, message: { message_id: 2, chat: { id: 22 }, text: "x" } } }), env);
  const next = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.ok(next && String(next.text ?? "").startsWith("<b>الكلمة:</b> "), "tapping it shows the next meaning");
  assert.ok(heartReaction(calls, 22, 1111), "the next meaning also reacts on the user's message");
});

test("word reaction: a next-meaning (n|) step reacts ❤️ on the user's message", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { message_id: 1212, text: "ⲁⲃⲏⲧⲧ", chat: { id: 23 } } }), env);
  const first = calls.find((call) => call.url.endsWith("/sendMessage")).payload.reply_markup.inline_keyboard[0][0];
  calls.length = 0;
  await worker.fetch(updateRequest({ callback_query: { id: "w5", data: first.callback_data, from: { id: 23 }, message: { message_id: 1, chat: { id: 23 }, text: "x" } } }), env);
  const card = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.ok(card && String(card.text ?? "").startsWith("<b>الكلمة:</b> "), "the picked word card is shown");
  assert.ok(heartReaction(calls, 23, 1212), "the pick reacts on the user's message");
  const more = card.reply_markup.inline_keyboard.flat().find((b) => String(b.callback_data ?? "").startsWith("n|"));
  assert.ok(more, "the card has an n| next-meaning button");
  assert.ok(String(more.callback_data ?? "").includes("~r1212"), "the n| button carries the user's message id");
  calls.length = 0;
  await worker.fetch(updateRequest({ callback_query: { id: "w6", data: more.callback_data, from: { id: 23 }, message: { message_id: 2, chat: { id: 23 }, text: "x" } } }), env);
  const next = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.ok(next && String(next.text ?? "").startsWith("<b>الكلمة:</b> "), "tapping it shows the next meaning");
  assert.ok(heartReaction(calls, 23, 1212), "the next meaning also reacts on the user's message");
});

test("word reaction: a Coptic-keyboard search reacts ❤️ on the user's /keyboard message", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { message_id: 1313, text: "/keyboard", chat: { id: 24 } } }), env);
  const kb = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  const go = kb.reply_markup.inline_keyboard.flat().find((b) => String(b.callback_data ?? "").startsWith("kb|go"));
  assert.ok(go, "the keyboard has a search button");
  assert.ok(String(go.callback_data ?? "").includes("~r1313"), "the search button carries the user's message id");
  calls.length = 0;
  const kbText = "⌨️ لوحة المفاتيح القبطية\nاضغط على الحروف لتكوين الكلمة، ثم اضغط ✅ بحث.\n\nالكلمة: ⲁⲃⲏⲧ\n\n⌫ حذف آخر حرف • 🗑 مسح الكلمة • ❌ إغلاق";
  await worker.fetch(updateRequest({ callback_query: { id: "w7", data: go.callback_data, from: { id: 24 }, message: { message_id: 900, chat: { id: 24 }, text: kbText } } }), env);
  const card = calls.find((call) => call.url.endsWith("/sendMessage") && String(call.payload?.text ?? "").startsWith("<b>الكلمة:</b> "))?.payload;
  assert.ok(card, "the keyboard search shows the word card");
  assert.ok(heartReaction(calls, 24, 1313), "the ❤️ targets the user's /keyboard message 1313");
});

test("word reaction: a page turn keeps the reaction id, and a pick on the next page reacts", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { message_id: 1414, text: "ⲙⲁ", chat: { id: 25 } } }), env);
  const list = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  const next = list.reply_markup.inline_keyboard.flat().find((b) => String(b.callback_data ?? "").startsWith("p|"));
  assert.ok(next, "the list has a next-page button");
  assert.ok(String(next.callback_data ?? "").includes("~r1414"), "the page button carries the user's message id");
  calls.length = 0;
  await worker.fetch(updateRequest({ callback_query: { id: "w8", data: next.callback_data, from: { id: 25 }, message: { message_id: 1, chat: { id: 25 }, text: "x" } } }), env);
  const edit = calls.find((call) => call.url.endsWith("/editMessageText"))?.payload;
  assert.ok(edit, "the page turn re-renders the list");
  const pick2 = edit.reply_markup.inline_keyboard.flat().find((b) => String(b.callback_data ?? "").startsWith("w|"));
  assert.ok(pick2, "the next page has word buttons");
  assert.ok(String(pick2.callback_data ?? "").includes("~r1414"), "the next page's buttons still carry the user's message id");
  calls.length = 0;
  await worker.fetch(updateRequest({ callback_query: { id: "w9", data: pick2.callback_data, from: { id: 25 }, message: { message_id: 1, chat: { id: 25 }, text: "x" } } }), env);
  const card = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.ok(card && String(card.text ?? "").startsWith("<b>الكلمة:</b> "), "tapping a word on the next page shows its card");
  assert.ok(heartReaction(calls, 25, 1414), "the ❤️ targets the user's original message 1414");
});
