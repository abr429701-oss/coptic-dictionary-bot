import cardManifest from "../data/cards.json" with { type: "json" };
import test from "node:test";
import assert from "node:assert/strict";
import worker, { UserStore } from "../src/index.js";
import { translateFieldValue, VALUE_TRANSLATIONS } from "../src/field-translations.js";
import records from "../data/dictionary.json" with { type: "json" };

// The real manifest lists whichever words have a card today; tests start from "no cards" and add their own.
for (const key of Object.keys(cardManifest)) delete cardManifest[key];

const token = "test-token";
const secret = "test-secret-should-be-long-enough";
const env = { TELEGRAM_BOT_TOKEN: token, WEBHOOK_SECRET: secret };
const firstMeaning = (value) => String(value ?? "").split(/[،,]/u)[0].trim();
const TEST_RECORD = records.find((record) => {
  const query = firstMeaning(record.translation_en);
  if (!query || query.length < 3) return false;
  const englishMatches = records.filter((other) => firstMeaning(other.translation_en) === query).length;
  const foreignMatch = records.some((other) => firstMeaning(other.translation_fr) === query || firstMeaning(other.translation_de) === query);
  return englishMatches === 1 && !foreignMatch;
}) ?? records.find((record) => record.translation_en);
const TEST_QUERY = String(TEST_RECORD?.translation_en ?? "see").split(/[،,]/u)[0].trim();
const TEST_COPTIC = String(TEST_RECORD?.coptic ?? "ⲁⲛⲁⲩ");
const JINKIM_RECORD = records.find((record) => String(record.coptic ?? "").includes("\u0300"));
const JINKIM_WORD = String(JINKIM_RECORD?.coptic ?? "ⲁⲧⲥ̀ϧⲁⲓ");
const JINKIM_PLAIN = JINKIM_WORD.replaceAll("\u0300", "");
const JINKIM_BACKTICK = JINKIM_WORD.replace("\u0300", "`");

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

test("/stats is not exposed to ordinary users", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  const response = await worker.fetch(updateRequest({ message: { text: "/stats", chat: { id: 7 } } }), env);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.chat_id, 7);
  assert.doesNotMatch(calls[0].payload.text, /عدد سجلات القاموس|إحصائيات القاموس/u);
});

test("admin dashboard shows statistics and management buttons", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "/admin", chat: { id: ADMIN }, from: { id: ADMIN } } }), kvEnv);
  const dashboard = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.ok(dashboard);
  assert.match(dashboard.text, /لوحة تحكم الأدمن/u);
  assert.match(dashboard.text, /كلمات القاموس/u);
  assert.match(JSON.stringify(dashboard.reply_markup), /مزامنة الأصوات/u);
  assert.match(JSON.stringify(dashboard.reply_markup), /مزامنة المستخدمين/u);
});

test("an exact word is shown directly, without a suggestions list", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  const response = await worker.fetch(updateRequest({ message: { text: "ⲁⲃⲏⲧ", chat: { id: 8 } } }), env);
  assert.equal(response.status, 200);
  const message = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.ok(message);
  assert.notEqual(message.text, "اختر من الاقتراحات التالية:");
  assert.match(message.text, /<b>الكلمة:<\/b> ⲁⲃⲏⲧ/u);
  assert.match(message.text, /<b>المعنى:<\/b> [^\n،]+\n/u);
});

test("a word that is not exact shows unique words starting with it as word-only buttons", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "ⲁⲃ", chat: { id: 18 } } }), env);
  const message = calls.find((call) => call.url.endsWith("/sendMessage")).payload;
  assert.equal(message.text, "اختر من الاقتراحات التالية:");
  const wordRows = message.reply_markup.inline_keyboard.filter((row) => row[0].callback_data.startsWith("w|"));
  const labels = wordRows.map((row) => row[0].text);
  assert.ok(labels.length > 1);
  assert.equal(new Set(labels).size, labels.length, "a suggestion is repeated");
  assert.ok(labels.every((label) => label.replaceAll("`", "").startsWith("ⲁⲃ")));
});

test("tapping a suggested word shows that word", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "ⲁⲃ", chat: { id: 19 } } }), env);
  const first = calls.find((call) => call.url.endsWith("/sendMessage")).payload.reply_markup.inline_keyboard[0][0];
  calls.length = 0;
  await worker.fetch(updateRequest({ callback_query: { id: "w1", data: first.callback_data, message: { message_id: 1, chat: { id: 19 }, text: "x" } } }), env);
  const text = calls.find((call) => call.url.endsWith("/sendMessage")).payload.text;
  assert.ok(text.startsWith("<b>الكلمة:</b> "));
  assert.ok(text.replaceAll("`", "").includes(first.text.replace(/\u2007/gu, "").replaceAll("`", "")));
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

test("admin records a real Telegram voice file word by word and search reuses it", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "/record", chat: { id: ADMIN }, from: { id: ADMIN } } }), kvEnv);
  const prompt = calls.find((call) => call.url.endsWith("/sendMessage")).payload.text;
  assert.match(prompt, /تسجيل نطق كلمة جديدة/u);
  const id = kvEnv.USERS.store.get(`user:${ADMIN}`).voiceRec.id;
  assert.ok(Number.isInteger(id));
  calls.length = 0;
  await worker.fetch(updateRequest({ message: { voice: { file_id: "telegram-voice-1", duration: 2 }, chat: { id: ADMIN }, from: { id: ADMIN } } }), kvEnv);
  assert.equal(kvEnv.USERS.store.get(`voiceid:${id}`).fileId, "telegram-voice-1");
  assert.match(calls.find((call) => call.url.endsWith("/sendMessage")).payload.text, /تم حفظ تسجيل/u);
});

test("recorded voice is sent as the original Telegram file instead of TTS", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = [];
  fakeTelegramApi(calls);
  const record = TEST_RECORD;
  assert.ok(record && Number.isInteger(record.id));
  kvEnv.USERS.store.set(`voiceid:${record.id}`, { fileId: "original-file-id" });
  await worker.fetch(updateRequest({ message: { text: TEST_QUERY, chat: { id: 11 }, from: { id: 11 } } }), kvEnv);
  const voice = calls.find((call) => call.url.endsWith("/sendVoice"));
  assert.ok(voice);
  assert.equal(voice.payload.voice, "original-file-id");
  assert.ok(!calls.some((call) => call.url.includes("translate_tts")));
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
  const response = await worker.fetch(updateRequest({ message: { text: TEST_QUERY, chat: { id: 11 } } }), env);
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
  const response = await worker.fetch(updateRequest({ message: { text: TEST_COPTIC, chat: { id: 12 } } }), env);
  assert.equal(response.status, 200);
  assert.ok(calls.some((call) => call.url.endsWith("/sendMessage")));
  assert.ok(!calls.some((call) => call.url.endsWith("/sendVoice")));
});

test("a single result shows only word, meaning, kind and origin with no heading", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: TEST_QUERY, chat: { id: 13 } } }), env);
  const text = calls.find((call) => call.url.endsWith("/sendMessage")).payload.text;
  assert.ok(text.startsWith("<b>Word:</b> "));
  assert.match(text, /<b>Meaning:<\/b> /u);
  assert.doesNotMatch(text, /القاموس القبطي|نتائج|الصفحة|اليونانية|النطق|التهجئة|الجنس|الإنجليزية|كلمات مرتبطة/u);
  assert.doesNotMatch(text, /No more meanings|No more meanings are available/u);
  assert.ok(calls.find((call) => call.url.endsWith("/sendMessage"))?.payload.reply_markup?.inline_keyboard?.[0]?.[0]?.text.trim() === "");
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
  assert.match(text, /<b>الكلمة:<\/b> كوبري\n/u);
  assert.match(text, /<b>المعنى:<\/b> ⲁⲃⲁⲑⲣⲁ\n/u);
  assert.doesNotMatch(text, /كلمات مرتبطة/u);
});

test("one or two letters show 10 tappable suggestions per page", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "ⲁⲃ", chat: { id: 15 } } }), env);
  const message = calls.find((call) => call.url.endsWith("/sendMessage")).payload;
  assert.equal(message.text, "اختر من الاقتراحات التالية:");
  const rows = message.reply_markup.inline_keyboard;
  const wordRows = rows.filter((row) => row[0].callback_data.startsWith("w|"));
  assert.equal(wordRows.length, 10);
  assert.ok(rows.at(-1).some((button) => button.callback_data.startsWith("p|1|")));
  assert.ok(!calls.some((call) => call.url.endsWith("/sendVoice")));
});

test("a one-letter exact word still shows suggestions instead of opening directly", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "ⲁ", chat: { id: 150 } } }), env);
  const message = calls.find((call) => call.url.endsWith("/sendMessage")).payload;
  assert.equal(message.text, "اختر من الاقتراحات التالية:");
  assert.ok(message.reply_markup.inline_keyboard.some((row) => row[0].callback_data.startsWith("w|")));
  assert.ok(!calls.some((call) => call.url.endsWith("/sendVoice")));
});

test("Arabic suggestions use Arabic labels instead of Coptic headwords", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "كو", chat: { id: 151 } } }), env);
  const message = calls.find((call) => call.url.endsWith("/sendMessage")).payload;
  assert.equal(message.text, "اختر من الاقتراحات التالية:");
  const labels = message.reply_markup.inline_keyboard
    .filter((row) => row[0].callback_data.startsWith("w|"))
    .map((row) => row[0].text);
  assert.ok(labels.length > 0);
  assert.ok(labels.every((label) => label.startsWith("كو")));
  assert.ok(labels.some((label) => /ك/u.test(label)));
  assert.ok(labels.every((label) => !/[\u2c80-\u2cff\u03e2-\u03ef]/u.test(label)));
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

test("multiple meanings are shown separately with a button for the next meaning", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const index = records.findIndex((item) => item.coptic === "ⲟⲩⲁⲓ");
  assert.ok(index >= 0);
  const firstCalls = [];
  fakeTelegramApi(firstCalls);
  await worker.fetch(updateRequest({ callback_query: {
    id: "meaning-1", data: `s|${index}|0`, message: { chat: { id: 74 }, message_id: 1, date: 1728000000 },
  } }), kvEnv);
  const first = firstCalls.find((call) => call.url.endsWith("/sendMessage")).payload;
  assert.match(first.text, /المعنى/u);
  assert.doesNotMatch(first.text, /هناك معنى آخر للكلمة التي بحثت بها/u);
  const next = first.reply_markup.inline_keyboard[0][0];
  assert.equal(next.text, "اعرض المزيد من الكلمات");

  const secondCalls = [];
  fakeTelegramApi(secondCalls);
  await worker.fetch(updateRequest({ callback_query: {
    id: "meaning-2", data: next.callback_data, message: { chat: { id: 74 }, message_id: 2, date: 1728000000 },
  } }), kvEnv);
  const second = secondCalls.find((call) => call.url.endsWith("/sendMessage")).payload;
  assert.match(second.text, /المعنى/u);
  assert.doesNotMatch(second.text, /،/u);
  assert.ok(!secondCalls.some((call) => call.url.endsWith("/sendVoice")), "the same word voice must not be sent again");
});

test("the next-meaning button shows every meaning exactly once and then stops", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const meaningLine = (text) => /<b>المعنى:<\/b> ([^\n]*)/u.exec(text)?.[1];
  const candidates = [];
  records.forEach((record, index) => {
    if (candidates.length < 40 && String(record.meaning ?? "").split(/[،,؛;\n]/u).filter((part) => part.trim()).length >= 2) candidates.push(index);
  });
  assert.ok(candidates.length > 5);
  let longest = 0;
  for (const index of candidates) {
    const shown = [];
    let finalText = "";
    let data = `s|${index}|0`;
    for (let tap = 0; tap < 40 && data; tap += 1) {
      const calls = [];
      fakeTelegramApi(calls);
      await worker.fetch(updateRequest({ callback_query: {
        id: `walk-${index}-${tap}`, data, message: { chat: { id: 90 }, message_id: tap + 1, date: 1728000000 },
      } }), kvEnv);
      const sent = calls.find((call) => call.url.endsWith("/sendMessage")).payload;
      finalText = sent.text;
      shown.push(meaningLine(sent.text));
    data = sent.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data;
    if (data === "e" || data === "noop") data = undefined;
    }
    assert.equal(data, undefined, `row ${index}: the terminal button callback leaked`);
    if (shown.length > 1) {
      assert.doesNotMatch(finalText, /انتهت المعاني|No more meanings|Plus de sens|Keine weiteren Bedeutungen/u);
    }
    assert.equal(new Set(shown).size, shown.length, `row ${index}: a meaning was shown twice: ${shown.join(" | ")}`);
    longest = Math.max(longest, shown.length);
  }
  assert.ok(longest >= 2);
});

test("Arabic search matches the word itself, never the inside of a longer word", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "غراب", chat: { id: 17 } } }), env);
  const text = calls.find((call) => call.url.endsWith("/sendMessage")).payload.text;
  assert.match(text, /<b>الكلمة:<\/b> غراب\n/u);
  assert.match(text, /<b>المعنى:<\/b> ⲁⲃⲱⲕ(\s|$)/u);
  assert.doesNotMatch(text, /الاستغراب/u);
});

test("Arabic search preserves the exact word typed, including ة, across meanings", async () => {
  const firstCalls = [];
  fakeTelegramApi(firstCalls);
  await worker.fetch(updateRequest({ message: { text: "قوة", chat: { id: 170 } } }), env);
  const first = firstCalls.find((call) => call.url.endsWith("/sendMessage")).payload;
  assert.match(first.text, /<b>الكلمة:<\/b> قوة\n/u);
  const next = first.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data;
  assert.ok(next);

  const secondCalls = [];
  fakeTelegramApi(secondCalls);
  await worker.fetch(updateRequest({ callback_query: { id: "strength-next", data: next, message: { chat: { id: 170 }, message_id: 1 } } }), env);
  const second = secondCalls.find((call) => call.url.endsWith("/sendMessage")).payload;
  assert.match(second.text, /<b>الكلمة:<\/b> قوة\n/u);
});

test("Arabic meaning chains send the new Coptic word voice for each step", async () => {
  const firstCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body;
    const payload = !body ? null : typeof body === "string" ? JSON.parse(body) : Object.fromEntries(body.entries());
    firstCalls.push({ url: String(url), options, payload });
    return String(url).includes("translate_tts")
      ? new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } })
      : Response.json({ ok: true, result: { message_id: 900 } });
  };
  await worker.fetch(updateRequest({ message: { text: "قوة", chat: { id: 171 } } }), env);
  const first = firstCalls.find((call) => call.url.endsWith("/sendMessage")).payload;
  const next = first.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data;
  assert.ok(next?.startsWith("x|"));

  const secondCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body;
    const payload = !body ? null : typeof body === "string" ? JSON.parse(body) : Object.fromEntries(body.entries());
    secondCalls.push({ url: String(url), options, payload });
    return String(url).includes("translate_tts")
      ? new Response(new Uint8Array([4, 5, 6]), { headers: { "content-type": "audio/mpeg" } })
      : Response.json({ ok: true, result: { message_id: 901 } });
  };
  await worker.fetch(updateRequest({ callback_query: { id: "arabic-voice-next", data: next, message: { chat: { id: 171 }, message_id: 1 } } }), env);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(secondCalls.some((call) => call.url.endsWith("/sendVoice")));
});

test("an unknown word gets the dictionary-under-development message", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "ظظظظظظظ", chat: { id: 21 } } }), env);
  const text = calls.find((call) => call.url.endsWith("/sendMessage")).payload.text;
  assert.match(text, /القاموس قيد التطوير/u);
});

test("several different Coptic words for one Arabic word are shown one after another", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const counts = new Map();
  for (const record of records) for (const part of String(record.meaning ?? "").split(/\s*[،,]\s*/u)) {
    const word = part.trim();
    if (word && !/\s/u.test(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const word = [...counts].filter(([, count]) => count >= 3 && count <= 8).map(([w]) => w).find((w) => /^[\u0621-\u064a]+$/u.test(w));
  assert.ok(word, "no test word found");
  const shown = [];
  let calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: word, chat: { id: 22 } } }), kvEnv);
  let sent = calls.find((call) => call.url.endsWith("/sendMessage")).payload;
  for (let tap = 0; tap < 80; tap += 1) {
    shown.push(sent.text.split("\n").slice(0, 2).join("|"));
    const data = sent.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data;
    if (!data || data === "e" || data === "noop") break;
    calls = [];
    fakeTelegramApi(calls);
    await worker.fetch(updateRequest({ callback_query: { id: `chain-${tap}`, data, message: { chat: { id: 22 }, message_id: tap + 1, date: 1728000000 } } }), kvEnv);
    sent = calls.find((call) => call.url.endsWith("/sendMessage")).payload;
  }
  assert.ok(shown.length >= 2);
  assert.equal(new Set(shown.map((entry) => entry.split("|")[0])).size, 1, `the searched word changed: ${shown.join(" / ")}`);
  assert.equal(new Set(shown.map((entry) => entry.split("|")[1])).size, shown.length, `a counterpart repeated: ${shown.join(" / ")}`);
  assert.doesNotMatch(sent.text, /انتهت المعاني|No more meanings|Plus de sens|Keine weiteren Bedeutungen/u);
  assert.equal(sent.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data, "noop");
});

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
  assert.ok(photo.photo instanceof Blob && photo.photo.size > 1000);
  assert.equal(photo.parse_mode, "HTML");
});

test("/start greets a returning user by the saved name with the photo", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set("user:22", { name: "بيشوي مجدي فرج" });
  const calls = await say(kvEnv, 22, "/start");
  const photo = calls.find((call) => call.url.endsWith("/sendPhoto")).payload;
  assert.match(photo.caption, /مرحبًا بك يا بيشوي مجدي فرج في القاموس الرقمي الناطق/u);
  assert.ok(!calls.some((call) => call.url.endsWith("/sendMessage")));
});

test("if the photo cannot be sent the welcome falls back to text", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set("user:23", { name: "أبانوب سمير حنا" });
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), payload: typeof options.body === "string" ? JSON.parse(options.body) : null });
    if (String(url).endsWith("/sendPhoto")) return Response.json({ ok: false, description: "bad url" }, { status: 400 });
    return Response.json({ ok: true, result: true });
  };
  await worker.fetch(updateRequest({ message: { text: "/start", chat: { id: 23 }, from: { id: 23 } } }), kvEnv);
  assert.match(calls.find((call) => call.url.endsWith("/sendMessage")).payload.text, /أبانوب سمير حنا/u);
});

const KB_USER = 31;

async function kbSay(kvEnv, text, messageId = 5) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({
    message: { message_id: messageId, text, chat: { id: KB_USER }, from: { id: KB_USER } },
  }), kvEnv);
  return calls;
}

const edits = (calls) => calls.filter((call) => call.url.endsWith("/editMessageText")).map((call) => call.payload);
const sent = (calls) => calls.filter((call) => call.url.endsWith("/sendMessage")).map((call) => call.payload);

test("/keyboard sends an interactive Coptic keyboard with letters, shortcuts and controls", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = await kbSay(kvEnv, "/keyboard");
  const message = sent(calls)[0];
  assert.ok(Array.isArray(message.reply_markup.inline_keyboard));
  const labels = message.reply_markup.inline_keyboard.flat().map((button) => button.text);
  for (const key of ["ⲁ", "ⲱ", "ϣ", "ϧ", "ϯ", "◌̀", "مسافة", "⌫ حذف حرف", "🗑 مسح الكل", "🔎 ابحث الآن", "✖️ إغلاق", "⚡ ⲟⲩ"]) {
    assert.ok(labels.includes(key), key);
  }
  assert.equal(kvEnv.USERS.store.get("user:31").kb.msgId, 900);
});
async function kbTap(kvEnv, data, messageId = 900) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ callback_query: { id: `kb-${messageId}`, data, from: { id: KB_USER }, message: { chat: { id: KB_USER }, message_id: messageId } } }), kvEnv);
  return calls;
}
function kbData(calls, label) {
  return sent(calls)[0].reply_markup.inline_keyboard.flat().find((button) => button.text === label).callback_data;
}
test("tapping interactive keys edits one composition message and supports shortcuts", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const initial = await kbSay(kvEnv, "/keyboard");
  let calls = await kbTap(kvEnv, kbData(initial, "ⲁ"));
  assert.match(edits(calls)[0].text, /▸ ⲁ▏/u);
  calls = await kbTap(kvEnv, kbData(initial, "⚡ ⲟⲩ"));
  assert.match(edits(calls)[0].text, /▸ ⲁⲟⲩ▏/u);
  calls = await kbTap(kvEnv, kbData(initial, "⌫ حذف حرف"));
  assert.match(edits(calls)[0].text, /▸ ⲁ▏/u);
  calls = await kbTap(kvEnv, kbData(initial, "🗑 مسح الكل"));
  assert.match(edits(calls)[0].text, /▸ ▏/u);
});
test("🔎 ابحث الآن searches the collected word and resets the composition", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const initial = await kbSay(kvEnv, "/keyboard");
  for (const letter of "ⲁⲃⲁϫⲓⲛⲓ") await kbTap(kvEnv, kbData(initial, letter));
  const calls = await kbTap(kvEnv, kbData(initial, "🔎 ابحث الآن"));
  assert.ok(calls.some((call) => call.url.endsWith("/sendChatAction")));
  assert.ok(sent(calls).some((message) => /ⲁⲃⲁϫⲓⲛⲓ/u.test(message.text)));
  assert.ok(edits(calls).some((message) => /▸ ▏/u.test(message.text)));
  assert.equal(kvEnv.USERS.store.get("user:31").kb.word, "");
});
test("🔎 ابحث الآن with no letters asks for a word and does not search", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const initial = await kbSay(kvEnv, "/keyboard");
  const calls = await kbTap(kvEnv, kbData(initial, "🔎 ابحث الآن"));
  assert.match(edits(calls)[0].text, /اكتب كلمة أولًا/u);
  assert.ok(!calls.some((call) => call.url.endsWith("/sendChatAction")));
});
test("✖️ إغلاق ends the session and removes the inline keyboard", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const initial = await kbSay(kvEnv, "/keyboard");
  const calls = await kbTap(kvEnv, kbData(initial, "✖️ إغلاق"));
  assert.match(edits(calls)[0].text, /تم إغلاق الكيبورد/u);
  assert.equal(kvEnv.USERS.store.get("user:31").kb, undefined);
});
test("without a keyboard session a typed letter is a normal search, and a real word still searches during a session", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  let calls = await kbSay(kvEnv, "ⲁⲃ");
  assert.equal(sent(calls)[0].text, "اختر من الاقتراحات التالية:");
  await kbSay(kvEnv, "/keyboard");
  calls = await kbSay(kvEnv, TEST_QUERY);
  assert.match(sent(calls)[0].text, new RegExp(`<b>Word:</b> ${TEST_QUERY.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
  assert.match(sent(calls)[0].text, new RegExp(`<b>Meaning:</b> ${TEST_COPTIC.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
});

test("English, French and German translations search to the Coptic counterpart", async () => {
  for (const field of ["translation_en", "translation_fr", "translation_de"]) {
    const record = records.find((item) => String(item[field] ?? "").trim());
    assert.ok(record?.[field], `missing ${field}`);
    const calls = [];
    fakeTelegramApi(calls);
    await worker.fetch(updateRequest({ message: { text: record[field], chat: { id: 151 } } }), env);
    const message = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
    assert.ok(message);
    const labels = field === "translation_en" ? ["Word", "Meaning"] : field === "translation_fr" ? ["Mot", "Sens"] : ["Wort", "Bedeutung"];
    assert.ok(message.text.includes(`<b>${labels[0]}:</b> ${record[field]}`));
    assert.ok(message.text.includes(`<b>${labels[1]}:</b> ${record.coptic}`));
  }
});

test("search results localize the dictionary type and origin values in English, French and German", async () => {
  const expected = {
    translation_en: ["Part of speech:", "Origin:"],
    translation_fr: ["Nature:", "Origine:"],
    translation_de: ["Wortart:", "Herkunft:"],
  };
  for (const field of Object.keys(expected)) {
    const record = records.find((item) => item.kind === "اسم مذكر" && item.origin === "قبطي" && String(item[field] ?? "").trim());
    assert.ok(record, `missing test record for ${field}`);
    const query = firstMeaning(record[field]);
    const calls = [];
    fakeTelegramApi(calls);
    await worker.fetch(updateRequest({ message: { text: query, chat: { id: 159 } } }), env);
    const text = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload?.text ?? "";
    const language = field === "translation_en" ? "en" : field === "translation_fr" ? "fr" : "de";
    for (const fragment of expected[field]) assert.ok(text.includes(fragment), `${field} result missing ${fragment}`);
    assert.ok(text.includes(VALUE_TRANSLATIONS[language][record.kind]));
    assert.ok(text.includes(VALUE_TRANSLATIONS[language][record.origin]));
  }
});

test("every current type and origin value has English, French and German translations", () => {
  const values = new Set(records.flatMap((record) => [record.kind, record.origin]).map((value) => String(value ?? "").trim()).filter(Boolean));
  for (const value of values) {
    for (const language of ["en", "fr", "de"]) {
      const translated = translateFieldValue(value, language);
      assert.ok(translated, `missing ${language} translation for ${value}`);
      assert.doesNotMatch(translated, /[\u0600-\u06ff]/u, `Arabic remains in ${language} translation for ${value}`);
    }
  }
  assert.equal(translateFieldValue("يوناني", "en"), "Greek");
  assert.match(translateFieldValue("فعل، صيغة مصدرية مضافة حديثًا", "en"), /verb.*verbal-noun form.*additional grammatical detail/u);
  assert.doesNotMatch(translateFieldValue("فعل ، صيغة مصدرية مضافة حديثًا", "fr"), /[\u0600-\u06ff]/u);
});

test("Greek search is disabled", async () => {
  const record = records.find((item) => String(item.greek ?? "").trim());
  assert.ok(record?.greek, "dictionary fixture must contain a Greek value");
  const query = String(record.greek).split(/[،,]/u)[0].trim();
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: query, chat: { id: 567 }, from: { id: 567 } } }), env);
  const text = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload?.text ?? "";
  assert.doesNotMatch(text, /<b>Word:|<b>الكلمة:/u);
  assert.equal(text.includes(record.coptic), false);
  assert.match(text, /dictionary|القاموس/u);
});
test("a translation query does not match inside a longer phrase", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "moon", chat: { id: 152 } } }), env);
  const message = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.ok(message);
  assert.match(message.text, /<b>Word:<\/b> moon/u);
  assert.doesNotMatch(message.text, /new moons/u);
});

test("the next meaning button keeps English labels and caption", async () => {
  const calls = [];
  fakeTelegramApi(calls);
  const englishCandidate = records.find((record) => {
    const query = String(record.translation_en ?? "").split(/[،,]/u)[0].trim();
    return query && records.filter((other) => String(other.translation_en ?? "").split(/[،,]/u).map((part) => part.trim()).includes(query)).length > 1;
  });
  const englishQuery = String(englishCandidate?.translation_en ?? "see").split(/[،,]/u)[0].trim();
  await worker.fetch(updateRequest({ message: { text: englishQuery, chat: { id: 153 } } }), env);
  const first = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.match(first.text, /<b>Word:<\/b>/u);
  const next = first.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data;
  assert.match(next, /^x\|/u);
  calls.length = 0;
  await worker.fetch(updateRequest({ callback_query: { id: "english-next", data: next, message: { chat: { id: 153 }, message_id: 1 } } }), env);
  const second = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload;
  assert.match(second.text, /<b>Word:<\/b>/u);
  assert.match(second.text, /<b>Meaning:<\/b>/u);
});

test("Admin can search for a specific word and record it without changing user state", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "/record_choose", chat: { id: ADMIN }, from: { id: ADMIN } } }), kvEnv);
  await worker.fetch(updateRequest({ message: { text: "ⲁⲃ", chat: { id: ADMIN }, from: { id: ADMIN } } }), kvEnv);
  const suggestion = calls.find((call) => call.url.endsWith("/sendMessage") && call.payload.reply_markup)?.payload;
  const callbackData = suggestion.reply_markup.inline_keyboard[0][0].callback_data;
  assert.match(callbackData, /^vr\|/u);
  await worker.fetch(updateRequest({ callback_query: { id: "voice-pick", from: { id: ADMIN }, data: callbackData, message: { chat: { id: ADMIN }, message_id: 1 } } }), kvEnv);
  const chosen = kvEnv.USERS.store.get(`user:${ADMIN}`).voiceRec;
  assert.equal(chosen.mode, "chosen");
  calls.length = 0;
  await worker.fetch(updateRequest({ message: { voice: { file_id: "chosen-voice", duration: 2 }, chat: { id: ADMIN }, from: { id: ADMIN } } }), kvEnv);
  assert.equal(kvEnv.USERS.store.get(`voiceid:${chosen.id}`).fileId, "chosen-voice");
  assert.equal(kvEnv.USERS.store.get(`user:${ADMIN}`).voicePick, true);
});

test("typing plain ⲉ finds headwords written with accented ὲ, and backticks are ignored", async () => {
  const withGrave = records.find((record) => /ὲ/u.test(record.coptic ?? ""));
  assert.ok(withGrave);
  const typed = withGrave.coptic.replace(/ὲ/gu, "ⲉ").replaceAll("`", "");
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: typed, chat: { id: 32 }, from: { id: 32 } } }), env);
  const message = calls.find((call) => call.url.endsWith("/sendMessage")).payload;
  assert.doesNotMatch(message.text, /لم أجد نتائج/u);
});

const ADMIN = 813894692;

async function asUser(kvEnv, id, message, extra = {}) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { chat: { id }, from: { id }, ...message }, ...extra }), kvEnv);
  return calls;
}

async function adminCallback(kvEnv, id, data) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({
    callback_query: { id: "bc1", data, from: { id }, message: { message_id: 600, chat: { id }, text: "x" } },
  }), kvEnv);
  return calls;
}

function seedUsers(kvEnv, ids) {
  for (const id of ids) kvEnv.USERS.store.set(`user:${id}`, { name: `user ${id}` });
}

test("only the admin can start a broadcast", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = await asUser(kvEnv, 555, { text: "/broadcast" });
  assert.doesNotMatch(sent(calls)[0].text, /أرسل الآن الرسالة/u);
  assert.equal(kvEnv.USERS.store.get(`user:${555}`)?.bc, undefined);
});

test("admin broadcast: prompt, capture any message, confirm, then deliver in batches with a report", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUsers(kvEnv, [101, 102, 103, ADMIN]);

  let calls = await asUser(kvEnv, ADMIN, { text: "/broadcast" });
  assert.match(sent(calls)[0].text, /أرسل الآن الرسالة/u);

  calls = await asUser(kvEnv, ADMIN, { message_id: 77, photo: [{ file_id: "p" }], caption: "إعلان" });
  const confirm = sent(calls)[0];
  assert.match(confirm.text, /إلى 3 مستخدم/u);
  assert.equal(confirm.reply_to_message_id, 77);
  assert.deepEqual(confirm.reply_markup.inline_keyboard[0].map((b) => b.callback_data), ["bc|go", "bc|no"]);

  calls = await adminCallback(kvEnv, ADMIN, "bc|go");
  assert.match(edits(calls)[0].text, /بدأ الإرسال إلى 3 مستخدم/u);
  assert.equal(kvEnv.USERS.alarms.length, 1);

  calls = [];
  fakeTelegramApi(calls);
  await kvEnv.USERS.object.alarm();
  const copies = calls.filter((call) => call.url.endsWith("/copyMessage")).map((call) => call.payload);
  assert.deepEqual(copies.map((c) => String(c.chat_id)).sort(), ["101", "102", "103"]);
  assert.ok(copies.every((c) => c.from_chat_id === ADMIN && c.message_id === 77));
  assert.match(sent(calls).at(-1).text, /اكتمل الإرسال[^]*وصلت إلى: 3/u);
  assert.equal(kvEnv.USERS.store.get("broadcast"), undefined);
});

test("broadcast marks blocked users, skips them next time, and backs off on rate limits", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUsers(kvEnv, [201, 202, 203]);
  await asUser(kvEnv, ADMIN, { text: "/broadcast" });
  await asUser(kvEnv, ADMIN, { message_id: 9, text: "مرحبا بالجميع" });
  await adminCallback(kvEnv, ADMIN, "bc|go");

  const calls = [];
  let limited = false;
  globalThis.fetch = async (url, options = {}) => {
    const payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), payload });
    if (String(url).endsWith("/copyMessage")) {
      if (payload.chat_id === "201") return Response.json({ ok: false, error_code: 403, description: "blocked" }, { status: 403 });
      if (payload.chat_id === "203" && !limited) {
        limited = true;
        return Response.json({ ok: false, error_code: 429, parameters: { retry_after: 3 } }, { status: 429 });
      }
    }
    return Response.json({ ok: true, result: { message_id: 1 } });
  };
  await kvEnv.USERS.object.alarm();
  assert.equal(kvEnv.USERS.store.get("user:201").blocked, true);
  assert.equal(kvEnv.USERS.store.get("broadcast").queue.length, 1);
  assert.ok(kvEnv.USERS.alarms.at(-1) - Date.now() >= 3000);

  await kvEnv.USERS.object.alarm();
  assert.equal(kvEnv.USERS.store.get("broadcast"), undefined);
  const report = calls.filter((call) => call.url.endsWith("/sendMessage")).at(-1).payload.text;
  assert.match(report, /وصلت إلى: 2[^]*تعذّر الإرسال: 1[^]*استُبعدت بسبب منع البوت \(403\): 1/u);

  await asUser(kvEnv, ADMIN, { text: "/broadcast" });
  const again = await asUser(kvEnv, ADMIN, { message_id: 10, text: "again" });
  assert.match(sent(again)[0].text, /إلى 2 مستخدم/u);
});

test("a quiz poll that cannot be copied is recreated for each recipient with its answer key", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUsers(kvEnv, [501]);
  await asUser(kvEnv, ADMIN, { text: "/broadcast" });
  const poll = {
    id: "poll-id",
    question: "ما معنى الكلمة؟",
    options: [{ text: "الأول" }, { text: "الثاني" }],
    is_anonymous: false,
    type: "quiz",
    allows_multiple_answers: false,
    correct_option_ids: [1],
    explanation: "الإجابة الثانية صحيحة",
  };
  const captured = await asUser(kvEnv, ADMIN, { message_id: 88, poll });
  assert.match(sent(captured)[0].text, /هل تريد التأكيد/u);
  await adminCallback(kvEnv, ADMIN, "bc|go");

  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), payload });
    if (String(url).endsWith("/copyMessage")) {
      return Response.json({ ok: false, error_code: 400, description: "Quiz poll cannot be copied" }, { status: 400 });
    }
    return Response.json({ ok: true, result: { message_id: 1 } });
  };

  await kvEnv.USERS.object.alarm();
  const sendPoll = calls.find((call) => call.url.endsWith("/sendPoll"))?.payload;
  assert.ok(sendPoll);
  assert.equal(String(sendPoll.chat_id), "501");
  assert.equal(sendPoll.question, poll.question);
  assert.deepEqual(sendPoll.options, [{ text: "الأول" }, { text: "الثاني" }]);
  assert.equal(sendPoll.type, "quiz");
  assert.deepEqual(sendPoll.correct_option_ids, [1]);
  assert.equal(kvEnv.USERS.store.get("broadcast"), undefined);
  assert.match(calls.find((call) => call.url.endsWith("/sendMessage"))?.payload.text, /وصلت إلى: 1/u);
});

test("a content-related 400 failure is reported but does not mark recipients as blocked", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUsers(kvEnv, [511]);
  await asUser(kvEnv, ADMIN, { text: "/broadcast" });
  await asUser(kvEnv, ADMIN, { message_id: 89, document: { file_id: "doc" } });
  await adminCallback(kvEnv, ADMIN, "bc|go");

  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), payload });
    return Response.json({ ok: false, error_code: 400, description: "Message can't be copied" }, { status: 400 });
  };
  await kvEnv.USERS.object.alarm();

  assert.notEqual(kvEnv.USERS.store.get("user:511").blocked, true);
  const report = calls.find((call) => call.url.endsWith("/sendMessage"))?.payload.text;
  assert.match(report, /تعذّر الإرسال: 1/u);
  assert.match(report, /Message can't be copied/u);
});

test("voice and document broadcasts use Telegram's type-preserving copy method", async () => {
  for (const payload of [
    { voice: { file_id: "voice-file" } },
    { document: { file_id: "document-file", file_name: "dictionary.pdf" } },
  ]) {
    const kvEnv = { ...env, USERS: fakeKv() };
    seedUsers(kvEnv, [521]);
    await asUser(kvEnv, ADMIN, { text: "/broadcast" });
    const captured = await asUser(kvEnv, ADMIN, { message_id: 90, ...payload });
    assert.match(sent(captured)[0].text, /هل تريد التأكيد/u);
    await adminCallback(kvEnv, ADMIN, "bc|go");

    const calls = [];
    fakeTelegramApi(calls);
    await kvEnv.USERS.object.alarm();
    const copy = calls.find((call) => call.url.endsWith("/copyMessage"))?.payload;
    assert.ok(copy);
    assert.equal(copy.chat_id, "521");
    assert.equal(copy.message_id, 90);
  }
});

test("temporary network failures retry the same recipient and keep the broadcast alive", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUsers(kvEnv, [531]);
  await asUser(kvEnv, ADMIN, { text: "/broadcast" });
  await asUser(kvEnv, ADMIN, { message_id: 91, text: "رسالة" });
  await adminCallback(kvEnv, ADMIN, "bc|go");

  let attempts = 0;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), payload });
    if (String(url).endsWith("/copyMessage") && attempts++ === 0) throw new Error("temporary connection reset");
    return Response.json({ ok: true, result: { message_id: 1 } });
  };
  await kvEnv.USERS.object.alarm();
  assert.deepEqual(kvEnv.USERS.store.get("broadcast").queue, ["531"]);
  assert.equal(kvEnv.USERS.store.get("broadcast").retryCount, 1);
  assert.ok(kvEnv.USERS.alarms.at(-1) > Date.now());

  await kvEnv.USERS.object.alarm();
  assert.equal(kvEnv.USERS.store.get("broadcast"), undefined);
  assert.equal(calls.filter((call) => call.url.endsWith("/copyMessage")).length, 2);
  assert.match(calls.find((call) => call.url.endsWith("/sendMessage"))?.payload.text, /وصلت إلى: 1/u);
});

test("cancel and non-admin confirmation do nothing harmful", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUsers(kvEnv, [301]);
  await asUser(kvEnv, ADMIN, { text: "/broadcast" });
  await asUser(kvEnv, ADMIN, { message_id: 5, text: "رسالة" });

  let calls = await adminCallback(kvEnv, 999, "bc|go");
  assert.ok(!calls.some((call) => call.url.endsWith("/editMessageText")));
  assert.equal(kvEnv.USERS.store.get("broadcast"), undefined);

  calls = await adminCallback(kvEnv, ADMIN, "bc|no");
  assert.match(edits(calls)[0].text, /تم إلغاء/u);
  assert.equal(kvEnv.USERS.store.get("broadcast"), undefined);
  assert.equal(kvEnv.USERS.alarms.length, 0);
});

test("anyone who messages the bot is registered so broadcasts can reach them", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await asUser(kvEnv, 401, { text: TEST_QUERY });
  assert.ok(kvEnv.USERS.store.get("user:401").firstSeen);
});

test("admin is told when a new user joins, once, with name, username and total", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const first = await asUser(kvEnv, 701, { text: TEST_QUERY, from: { id: 701, first_name: "مينا", last_name: "جرجس", username: "mina_g" } });
  assert.equal(first.notices.length, 1);
  assert.match(first.notices[0].text, /انضم مستخدم جديد/u);
  assert.match(first.notices[0].text, /مينا جرجس/u);
  assert.match(first.notices[0].text, /@mina_g/u);
  assert.match(first.notices[0].text, /<code>701<\/code>/u);
  assert.match(first.notices[0].text, /إجمالي المستخدمين: 1/u);

  const again = await asUser(kvEnv, 701, { text: TEST_QUERY, from: { id: 701, first_name: "مينا" } });
  assert.equal(again.notices, undefined);

  const second = await asUser(kvEnv, 702, { text: "/start", from: { id: 702, first_name: "بيشوي" } });
  assert.match(second.notices[0].text, /إجمالي المستخدمين: 2/u);
});

test("admin gets the registered name when a user completes registration; the admin's own messages announce nothing", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await asUser(kvEnv, 703, { text: "/start", from: { id: 703, first_name: "x" } });
  const done = await asUser(kvEnv, 703, { text: "أبانوب سمير حنا", from: { id: 703, first_name: "x" } });
  assert.match(done.notices[0].text, /أكمل التسجيل: <b>أبانوب سمير حنا<\/b>/u);

  const own = await asUser(kvEnv, ADMIN, { text: TEST_QUERY, from: { id: ADMIN, first_name: "owner" } });
  assert.equal(own.notices, undefined);
});

test("the dictionary writes the jinkim as a combining mark, never as a spaced backtick, and keeps phrase spaces", () => {
  const coptic = records.map((record) => String(record.coptic ?? ""));
  assert.equal(coptic.filter((word) => word.includes("`")).length, 0);
  assert.ok(coptic.includes(JINKIM_WORD));
  assert.ok(coptic.some((word) => /\S \S/u.test(word)));
  assert.equal(coptic.filter((word) => /\s{2,}|^\s|\s$/u.test(word)).length, 0);
});

test("searching without the jinkim, with a backtick, or with the combining mark finds the same word", async () => {
  for (const typed of [JINKIM_PLAIN, JINKIM_BACKTICK, JINKIM_WORD]) {
    const calls = [];
    fakeTelegramApi(calls);
    await worker.fetch(updateRequest({ message: { text: typed, chat: { id: 811 }, from: { id: 811 } } }), env);
    const text = sent(calls)[0].text;
    assert.doesNotMatch(text, /لم أجد نتائج/u, typed);
  }
});

test("the keyboard jinkim key puts one combining mark on the previous letter", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await kbSay(kvEnv, "/keyboard");
  let calls = await kbSay(kvEnv, "◌̀");
  assert.equal(edits(calls).length, 0);
  await kbSay(kvEnv, "ⲥ");
  calls = await kbSay(kvEnv, "◌̀");
  assert.match(edits(calls)[0].text, /▸ ⲥ\u0300▏/u);
  calls = await kbSay(kvEnv, "◌̀");
  assert.equal(edits(calls).length, 0);
});

test("every word has a permanent id; the same spelling shares one id and different spellings never do", () => {
  const byKey = new Map();
  for (const record of records) {
    const word = String(record.coptic ?? "").trim();
    if (!word) { assert.equal(record.id, undefined); continue; }
    assert.ok(Number.isInteger(record.id) && record.id > 0, word);
    const key = word.normalize("NFC").toLowerCase();
    if (byKey.has(key)) assert.equal(byKey.get(key), record.id, word);
    byKey.set(key, record.id);
  }
  assert.equal(new Set(byKey.values()).size, byKey.size);
});

test("old row-number recordings are moved to the word's id and keep working after rows move", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const index = records.indexOf(TEST_RECORD);
  const id = records[index].id;
  kvEnv.USERS.store.set(`voice:${index}`, { fileId: "legacy-file" });
  kvEnv.USERS.store.set("voice:cursor", 5);
  await kvEnv.USERS.object.migrateLegacyVoices();
  assert.equal(kvEnv.USERS.store.get(`voiceid:${id}`).fileId, "legacy-file");
  assert.equal(kvEnv.USERS.store.get(`voice:${index}`), undefined);
  assert.equal(kvEnv.USERS.store.get("voice:cursor"), undefined);
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: TEST_QUERY, chat: { id: 12 }, from: { id: 12 } } }), kvEnv);
  assert.equal(calls.find((call) => call.url.endsWith("/sendVoice"))?.payload.voice, "legacy-file");
});

// ---- Drive archive (Google Apps Script) ----
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbTESTID/exec";

function driveWorld({ scriptReply } = {}) {
  const calls = [];
  const state = { reply: scriptReply ?? ((body) => ({ ok: true, file_id: `drive-${body.id}`, url: `https://drive.example/${body.id}` })) };
  globalThis.fetch = async (url, options = {}) => {
    url = String(url);
    const body = typeof options.body === "string" ? JSON.parse(options.body) : null;
    calls.push({ url, payload: body });
    if (url.includes("/getFile")) return Response.json({ ok: true, result: { file_path: "voice/file_1.oga" } });
    if (url.includes("/file/bot")) return new Response(new Uint8Array([79, 103, 103, 83, 1, 2, 3, 4]));
    if (url.startsWith(SCRIPT_URL)) {
      const reply = state.reply(body);
      return typeof reply === "string" ? new Response(reply, { status: 200 }) : Response.json(reply);
    }
    return Response.json({ ok: true, result: { message_id: 1 } });
  };
  return { calls, state };
}

const adminSay = (kvEnv, message, ctx) =>
  worker.fetch(updateRequest({ message: { chat: { id: ADMIN }, from: { id: ADMIN }, ...message } }), kvEnv, ctx);

function driveEnv(extra = {}) {
  return { ...env, USERS: fakeKv(), APPS_SCRIPT_URL: SCRIPT_URL, ...extra };
}

test("a recording is uploaded to Drive with its permanent id and the link is remembered", async () => {
  const kvEnv = driveEnv();
  const { calls } = driveWorld();
  await adminSay(kvEnv, { text: "/record" });
  const id = kvEnv.USERS.store.get(`user:${ADMIN}`).voiceRec.id;
  await adminSay(kvEnv, { voice: { file_id: "TG-1", duration: 4 } });

  const post = calls.find((call) => call.url === SCRIPT_URL);
  assert.equal(post.payload.action, "upload");
  assert.equal(post.payload.by.id, String(ADMIN));
  assert.ok(post.payload.by.name.length > 0);
  assert.equal(post.payload.id, id);
  assert.equal(post.payload.file_id, "TG-1");
  assert.ok(post.payload.word.length > 0);
  assert.equal(post.payload.audio_base64, btoa(String.fromCharCode(79, 103, 103, 83, 1, 2, 3, 4)));
  assert.deepEqual(kvEnv.USERS.store.get(`voiceid:${id}`).drive.url, `https://drive.example/${id}`);
});

test("uploading runs after the reply when the platform provides waitUntil", async () => {
  const kvEnv = driveEnv();
  const { calls } = driveWorld();
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  await adminSay(kvEnv, { text: "/record" }, ctx);
  await adminSay(kvEnv, { voice: { file_id: "TG-2", duration: 1 } }, ctx);
  const id = [...kvEnv.USERS.store.keys()].find((key) => key.startsWith("voiceid:"));
  assert.ok(pending.length >= 1); // handed to the platform (plus the request counter's batched write)
  await Promise.all(pending);
  assert.ok(kvEnv.USERS.store.get(id).drive.url);
  assert.ok(calls.some((call) => call.url === SCRIPT_URL));
});

test("a failed upload keeps the recording, warns the admin, and /syncdrive retries it", async () => {
  const kvEnv = driveEnv();
  const world = driveWorld({ scriptReply: () => ({ ok: false, error: "unauthorized" }) });
  await adminSay(kvEnv, { text: "/record" });
  await adminSay(kvEnv, { voice: { file_id: "TG-3", duration: 2 } });
  const key = [...kvEnv.USERS.store.keys()].find((item) => item.startsWith("voiceid:"));
  assert.equal(kvEnv.USERS.store.get(key).fileId, "TG-3");
  assert.equal(kvEnv.USERS.store.get(key).drive, undefined);
  const warning = world.calls.filter((call) => call.url.endsWith("/sendMessage")).map((call) => call.payload.text).find((text) => /تعذّر رفع/u.test(text));
  assert.match(warning, /unauthorized/u);

  world.state.reply = (body) => ({ ok: true, file_id: "drive-ok", url: `https://drive.example/${body.id}` });
  world.calls.length = 0;
  await adminSay(kvEnv, { text: "/syncdrive" });
  assert.ok(kvEnv.USERS.store.get(key).drive.url);
  const report = world.calls.filter((call) => call.url.endsWith("/sendMessage")).at(-1).payload.text;
  assert.match(report, /تم رفع 1/u);
  assert.match(report, /كل التسجيلات مرفوعة/u);
});

test("an HTML answer from Apps Script (wrong deployment) gives a clear reason", async () => {
  const kvEnv = driveEnv();
  const world = driveWorld({ scriptReply: () => "<!DOCTYPE html><html>Sign in</html>" });
  await adminSay(kvEnv, { text: "/record" });
  await adminSay(kvEnv, { voice: { file_id: "TG-4", duration: 2 } });
  const warning = world.calls.filter((call) => call.url.endsWith("/sendMessage")).map((call) => call.payload.text).find((text) => /تعذّر رفع/u.test(text));
  assert.match(warning, /New version/u);
});

test("without Drive settings nothing is uploaded and no warning is sent", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const world = driveWorld();
  await adminSay(kvEnv, { text: "/record" });
  await adminSay(kvEnv, { voice: { file_id: "TG-5", duration: 2 } });
  assert.ok(!world.calls.some((call) => call.url === SCRIPT_URL));
  assert.ok(!world.calls.some((call) => /تعذّر رفع/u.test(call.payload?.text ?? "")));
});

test("/setdrive needs only the link and rejects bad input", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const world = driveWorld({ scriptReply: () => ({ ok: true, folder: { name: "Coptic Dictionary Voices", url: "https://drive.example/f" }, sheet: { name: "Dictionary", tab: "Ban" } }) });
  await adminSay(kvEnv, { message_id: 321, text: `/setdrive ${SCRIPT_URL}` });
  assert.deepEqual(kvEnv.USERS.store.get("drive-config"), { url: SCRIPT_URL });
  assert.ok(world.calls.some((call) => call.url === SCRIPT_URL && call.payload.action === "ping"));
  const status = world.calls.filter((call) => call.url.endsWith("/sendMessage")).at(-1).payload.text;
  assert.match(status, /Coptic Dictionary Voices/u);

  const other = { ...env, USERS: fakeKv() };
  await adminSay(other, { message_id: 322, text: "/setdrive https://example.com/x" });
  assert.equal(other.USERS.store.get("drive-config"), undefined);
});

test("/setdrive overrides a stale APPS_SCRIPT_URL secret", async () => {
  const staleUrl = "https://script.google.com/macros/s/OLD_DEPLOYMENT/exec";
  const kvEnv = driveEnv({ APPS_SCRIPT_URL: staleUrl });
  const world = driveWorld();
  await adminSay(kvEnv, { message_id: 323, text: `/setdrive ${SCRIPT_URL}` });
  assert.deepEqual(kvEnv.USERS.store.get("drive-config"), { url: SCRIPT_URL });
  assert.ok(world.calls.some((call) => call.url === SCRIPT_URL && call.payload.action === "ping"));
  assert.ok(!world.calls.some((call) => call.url === staleUrl));
});

test("/setdrive reset removes the override and falls back to APPS_SCRIPT_URL", async () => {
  const kvEnv = driveEnv();
  kvEnv.USERS.store.set("drive-config", { url: "https://script.google.com/macros/s/OLD_DEPLOYMENT/exec" });
  const world = driveWorld();
  await adminSay(kvEnv, { message_id: 324, text: "/setdrive reset" });
  assert.equal(kvEnv.USERS.store.get("drive-config"), null);
  assert.ok(world.calls.some((call) => call.url === SCRIPT_URL && call.payload.action === "ping"));
});

test("/drive explains how to connect when nothing is configured, and only the admin can use these commands", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const world = driveWorld();
  await adminSay(kvEnv, { text: "/drive" });
  assert.match(world.calls.find((call) => call.url.endsWith("/sendMessage")).payload.text, /\/setdrive/u);

  const stranger = await asUser(kvEnv, 4242, { text: "/setdrive " + SCRIPT_URL + " x" });
  assert.equal(kvEnv.USERS.store.get("drive-config"), undefined);
  assert.ok(stranger.length >= 0);
});

// ---- User directory (Apps Script "User" tab) ----
test("a new user's name, username and id are sent to the User tab; a changed username is sent again", async () => {
  const kvEnv = driveEnv();
  const world = driveWorld();
  const from = { id: 5001, first_name: "مينا", last_name: "جرجس", username: "mina_g" };
  await worker.fetch(updateRequest({ message: { text: "/start", chat: { id: 5001, type: "private" }, from } }), kvEnv);
  const push = world.calls.find((call) => call.url === SCRIPT_URL && call.payload.action === "users");
  const row = push.payload.users[0];
  assert.deepEqual([row.id, row.name, row.username, row.registered_at], ["5001", "مينا جرجس", "mina_g", ""]);
  assert.ok(row.joined_at);

  world.calls.length = 0;
  await worker.fetch(updateRequest({ message: { text: "مرحبا", chat: { id: 5001, type: "private" }, from } }), kvEnv);
  assert.ok(!world.calls.some((call) => call.payload?.action === "users"));
  await worker.fetch(updateRequest({ message: { text: "مرحبا", chat: { id: 5001, type: "private" }, from: { ...from, username: "mina_new" } } }), kvEnv);
  assert.equal(world.calls.find((call) => call.payload?.action === "users").payload.users[0].username, "mina_new");
});

test("finishing registration sends the registered full name", async () => {
  const kvEnv = driveEnv();
  const world = driveWorld();
  const from = { id: 5002, first_name: "J", username: "j_user" };
  const say2 = (text) => worker.fetch(updateRequest({ message: { text, chat: { id: 5002, type: "private" }, from } }), kvEnv);
  await say2("/start");
  await say2("مينا جرجس بشرى");
  const pushes = world.calls.filter((call) => call.payload?.action === "users");
  assert.equal(pushes.at(-1).payload.users[0].name, "مينا جرجس بشرى");
  assert.ok(pushes.at(-1).payload.users[0].registered_at);
});

test("/syncusers pushes existing users in batches, reading old users' Telegram profile once", async () => {
  const kvEnv = driveEnv();
  const world = driveWorld();
  kvEnv.USERS.store.set("user:6001", { firstSeen: "2026-10-01T00:00:00Z", name: "بيشوي مجدي فرج" });
  kvEnv.USERS.store.set("user:6002", { firstSeen: "2026-10-02T00:00:00Z", tgName: "Mark", username: "mark" });
  const origin = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/getChat")) return Response.json({ ok: true, result: { first_name: "Bishoy", username: "bishoy_m" } });
    return origin(url, options);
  };
  await adminSay(kvEnv, { text: "/syncusers" });
  const push = world.calls.find((call) => call.payload?.action === "users");
  assert.deepEqual(push.payload.users.map((user) => [user.id, user.name, user.username]), [["6001", "بيشوي مجدي فرج", "bishoy_m"], ["6002", "Mark", "mark"]]);
  assert.equal(kvEnv.USERS.store.get("user:6001").username, "bishoy_m");
});

// ---- Inline mode ----
async function inline(query, id = "q1") {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ inline_query: { id, from: { id: 77 }, query, offset: "" } }), env);
  return calls.find((call) => call.url.endsWith("/answerInlineQuery"))?.payload;
}

test("inline: a word returns articles with the entry as the message to send", async () => {
  const answer = await inline("غراب");
  assert.equal(answer.inline_query_id, "q1");
  assert.ok(answer.results.length >= 1 && answer.results.length <= 20);
  const first = answer.results[0];
  assert.equal(first.type, "article");
  assert.ok(first.title && first.id.length <= 64);
  assert.match(first.input_message_content.message_text, /<b>الكلمة:<\/b> /u);
  assert.match(first.input_message_content.message_text, /<b>المعنى:<\/b> [^\n]*ⲁⲃⲱⲕ/u);
  assert.doesNotMatch(first.input_message_content.message_text, /الاستغراب/u);
  assert.equal(answer.is_personal, false);
  assert.ok(answer.cache_time >= 60);
});

test("inline: one or two letters list words that start with them; empty shows a tip", async () => {
  const short = await inline("ⲁⲃ", "q2");
  assert.ok(short.results.length > 1);
  assert.ok(short.results.every((item) => /^ⲁⲃ/u.test(item.title.replaceAll("`", "").toLowerCase()) || item.description));
  const empty = await inline("", "q3");
  assert.deepEqual(empty.results, []); // placeholder only, no list above the input
  const none = await inline("zzzzqqq", "q4");
  assert.deepEqual(none.results, []);
});

// ---- Daily request counter ----
test("every request is counted per UTC day, /usage reports it, and the admin is alerted at thresholds", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = [];
  fakeTelegramApi(calls);
  const today = new Date().toISOString().slice(0, 10);
  kvEnv.USERS.store.set(`usage:${today}`, 49995);
  for (let index = 0; index < 25; index += 1) {
    await worker.fetch(new Request("https://bot.example/health"), kvEnv);
  }
  await new Promise((resolve) => setTimeout(resolve, 20)); // the batched write runs in the background
  const counted = kvEnv.USERS.store.get(`usage:${today}`);
  assert.ok(counted > 49995 && counted <= 50050, `counted ${counted}`);
  const alert = calls.map((call) => call.payload?.text ?? "").find((text) => /تنبيه الاستخدام/u.test(text));
  assert.ok(alert, "expected the 50% alert");
  assert.match(alert, /50,0\d\d|49,9\d\d|50,/u);

  calls.length = 0;
  await adminSay(kvEnv, { text: "/usage" });
  const report = calls.find((call) => call.url.endsWith("/sendMessage")).payload.text;
  assert.match(report, /طلبات البوت اليوم/u);
  assert.match(report, /من 100,000/u);
  assert.match(report, /المتبقي/u);
  assert.match(report, /بتوقيت القاهرة/u);
});

test("only the admin can read /usage", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = await say(kvEnv, 4242, "/usage");
  assert.ok(!calls.some((call) => /طلبات البوت اليوم/u.test(call.payload?.text ?? "")));
});

test("inline: a recorded word is offered as its voice without a caption", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = [];
  fakeTelegramApi(calls);
  const record = records.find((item) => item.coptic === "ⲁⲃⲱⲕ");
  kvEnv.USERS.store.set(`voiceid:${record.id}`, { fileId: "VOICE-FILE-1" });
  await worker.fetch(updateRequest({ inline_query: { id: "v1", from: { id: 77 }, query: "ⲁⲃⲱⲕ", offset: "" } }), kvEnv);
  const answer = calls.find((call) => call.url.endsWith("/answerInlineQuery")).payload;
  const voice = answer.results.find((item) => item.type === "voice");
  assert.equal(voice.voice_file_id, "VOICE-FILE-1");
  assert.equal(voice.caption, undefined);
  assert.equal(voice.parse_mode, "HTML");
  assert.ok(voice.title.startsWith("🔊"));
  assert.ok(answer.results.some((item) => item.type === "article") || answer.results.length === 1);
});

test("inline: if Telegram rejects a stored recording, the answer is repeated as text only", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const payload = typeof options.body === "string" ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), payload });
    if (String(url).endsWith("/answerInlineQuery") && payload.results.some((item) => item.type === "voice")) {
      return Response.json({ ok: false, description: "wrong file identifier" });
    }
    return Response.json({ ok: true, result: true });
  };
  const record = records.find((item) => item.coptic === "ⲁⲃⲱⲕ");
  kvEnv.USERS.store.set(`voiceid:${record.id}`, { fileId: "BAD" });
  await worker.fetch(updateRequest({ inline_query: { id: "v2", from: { id: 77 }, query: "ⲁⲃⲱⲕ", offset: "" } }), kvEnv);
  const answers = calls.filter((call) => call.url.endsWith("/answerInlineQuery"));
  assert.equal(answers.length, 2);
  assert.ok(answers[1].payload.results.every((item) => item.type === "article"));
});

test("inline: words without a recording become audio results when Google speech works", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const payload = typeof options.body === "string" ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), payload });
    if (String(url).includes("translate_tts")) {
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    }
    return Response.json({ ok: true, result: true });
  };
  // A fresh module instance, so the cached "speech is down" state from other tests does not leak in.
  const fresh = (await import(`../src/index.js?speech=${Date.now()}`)).default;
  await fresh.fetch(updateRequest({ inline_query: { id: "a1", from: { id: 77 }, query: "ⲁⲃⲏⲧ", offset: "" } }), env);
  const answer = calls.find((call) => call.url.endsWith("/answerInlineQuery")).payload;
  const audio = answer.results.find((item) => item.type === "audio");
  assert.ok(audio, "expected an audio result");
  assert.match(audio.audio_url, /^https:\/\/bot\.test\/tts\/\d+\.mp3$/u);
  assert.equal(audio.caption, undefined);
});

test("the /tts endpoint serves generated speech and only for dictionary entries", async () => {
  let speechUrl = "";
  globalThis.fetch = async (url) => {
    speechUrl = String(url);
    return speechUrl.includes("translate_tts")
      ? new Response(new Uint8Array([9, 9, 9, 9]), { headers: { "content-type": "audio/mpeg" } })
      : Response.json({ ok: true });
  };
  const index = records.findIndex((record) => String(record.pronunciation || record.english || "").trim());
  const ok = await worker.fetch(new Request(`https://bot.test/tts/${index}.mp3`), env);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "audio/mpeg");
  assert.equal((await ok.arrayBuffer()).byteLength, 4);
  assert.match(speechUrl, /ttsspeed=0\.5/u);
  const spoken = decodeURIComponent(new URL(speechUrl).searchParams.get("q"));
  const word = String(records[index].pronunciation || records[index].english).trim();
  assert.equal(spoken, `${word}, ${word}, ${word}`);
  const missing = await worker.fetch(new Request("https://bot.test/tts/99999999.mp3"), env);
  assert.equal(missing.status, 404);
});

test("TTS uses the sheet IPA pronunciation for precise Coptic pronunciation", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(new Uint8Array([7]), { headers: { "content-type": "audio/mpeg" } });
  };
  const candidates = records.map((record, index) => ({ record, index })).filter(({ record }) => record.greek && record.pronunciation).slice(0, 2);
  for (const { record, index } of candidates) {
    await worker.fetch(new Request(`https://bot.test/tts/${index}.mp3`), env);
    const spoken = new URL(calls.at(-1)).searchParams.get("q");
    assert.ok(spoken);
    assert.match(spoken, /, /u);
    assert.equal(spoken, `${spoken.split(", ").slice(0, -2).join(", ")}, ${spoken.split(", ").at(-2)}, ${spoken.split(", ").at(-1)}`);
  }
});

test("/botinfo (admin) reports inline support, webhook updates and Google speech", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const payload = typeof options.body === "string" ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), payload });
    if (String(url).endsWith("/getMe")) return Response.json({ ok: true, result: { username: "Uploade33_bot", supports_inline_queries: true } });
    if (String(url).endsWith("/getWebhookInfo")) return Response.json({ ok: true, result: { allowed_updates: ["message", "inline_query"], pending_update_count: 0 } });
    if (String(url).includes("translate_tts")) return new Response("blocked", { status: 403 });
    return Response.json({ ok: true, result: true });
  };
  const kvEnv = { ...env, USERS: fakeKv() };
  await adminSay(kvEnv, { text: "/botinfo" });
  const text = calls.filter((call) => call.url.endsWith("/sendMessage")).at(-1).payload.text;
  assert.match(text, /Uploade33_bot/u);
  assert.match(text, /inline\): مفعّل/u);
  assert.match(text, /يستقبل inline: نعم/u);
  assert.match(text, /لا يعمل/u);
});

// ---- Word cards ----
function photoWorld({ photoOk = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const payload = typeof options.body === "string" ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), payload });
    if (String(url).endsWith("/sendPhoto")) {
      return photoOk
        ? Response.json({ ok: true, result: { photo: [{ file_id: "SMALL" }, { file_id: "PHOTO-FILE-1" }] } })
        : Response.json({ ok: false, description: "wrong file" });
    }
    return Response.json({ ok: true, result: true });
  };
  return calls;
}

test("a word with a card is sent as text and voice without a card photo", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const record = records.find((item) => item.coptic === "ⲁⲃⲱⲕ");
  cardManifest[String(record.id)] = "hash0001";
  try {
    const calls = photoWorld();
    await worker.fetch(updateRequest({ message: { text: "ⲁⲃⲱⲕ", chat: { id: 70 } } }), kvEnv);
    const textIndex = calls.findIndex((call) => call.url.endsWith("/sendMessage") && /<b>الكلمة/u.test(call.payload?.text ?? ""));
    const photos = calls.filter((call) => call.url.endsWith("/sendPhoto"));
    assert.ok(textIndex >= 0);
    assert.equal(photos.length, 0);

    const again = photoWorld();
    await worker.fetch(updateRequest({ message: { text: "ⲁⲃⲱⲕ", chat: { id: 70 } } }), kvEnv);
    assert.equal(again.filter((call) => call.url.endsWith("/sendPhoto")).length, 0);

    cardManifest[String(record.id)] = "hash0002"; // the card was redrawn: the old file id must not be used
    const redrawn = photoWorld();
    await worker.fetch(updateRequest({ message: { text: "ⲁⲃⲱⲕ", chat: { id: 70 } } }), kvEnv);
    assert.equal(redrawn.filter((call) => call.url.endsWith("/sendPhoto")).length, 0);
  } finally {
    delete cardManifest[String(record.id)];
  }
});

test("if the card cannot be sent the entry still arrives as text; words without a card are unchanged", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const record = records.find((item) => item.coptic === "ⲁⲃⲱⲕ");
  cardManifest[String(record.id)] = "hash0003";
  try {
    const calls = photoWorld({ photoOk: false });
    await worker.fetch(updateRequest({ message: { text: "ⲁⲃⲱⲕ", chat: { id: 71 } } }), kvEnv);
    assert.ok(calls.some((call) => call.url.endsWith("/sendMessage") && /<b>الكلمة:<\/b> ⲁⲃⲱⲕ/u.test(call.payload.text)));
  } finally {
    delete cardManifest[String(record.id)];
  }
  const plain = photoWorld();
  await worker.fetch(updateRequest({ message: { text: "ⲁⲃⲱⲕ", chat: { id: 72 } } }), kvEnv);
  assert.ok(!plain.some((call) => call.url.endsWith("/sendPhoto")));
  assert.ok(plain.some((call) => call.url.endsWith("/sendMessage")));
});

test("admin can hide a card until showing it or recording a new voice", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const record = records.find((item) => item.coptic === "ⲁⲃⲱⲕ");
  cardManifest[String(record.id)] = "hash-hide";
  try {
    await worker.fetch(updateRequest({ message: { text: `/card_hide ${record.coptic}`, chat: { id: ADMIN }, from: { id: ADMIN } } }), kvEnv);
    assert.equal(kvEnv.USERS.store.get(`card-disabled:${record.id}`), true);
    const hidden = photoWorld();
    await worker.fetch(updateRequest({ message: { text: record.coptic, chat: { id: 73 } } }), kvEnv);
    assert.equal(hidden.filter((call) => call.url.endsWith("/sendPhoto")).length, 0);

    const shown = photoWorld();
    await worker.fetch(updateRequest({ message: { text: `/card_show ${record.coptic}`, chat: { id: ADMIN }, from: { id: ADMIN } } }), kvEnv);
    assert.equal(kvEnv.USERS.store.get(`card-disabled:${record.id}`), undefined);
    assert.equal(shown.filter((call) => call.url.endsWith("/sendPhoto")).length, 0);

    await worker.fetch(updateRequest({ message: { text: `/card_hide ${record.coptic}`, chat: { id: ADMIN }, from: { id: ADMIN } } }), kvEnv);
    kvEnv.USERS.store.set(`user:${ADMIN}`, { voiceRec: { id: record.id, mode: "chosen" } });
    photoWorld();
    await worker.fetch(updateRequest({ message: { voice: { file_id: "new-voice", duration: 2 }, chat: { id: ADMIN }, from: { id: ADMIN } } }), kvEnv);
    assert.equal(kvEnv.USERS.store.get(`card-disabled:${record.id}`), undefined);
  } finally {
    delete cardManifest[String(record.id)];
  }
});

test("the card renderer produces the single supplied card layout", async () => {
  const { cardSvg, renderCard } = await import("../scripts/card.mjs");
  assert.match(cardSvg({ word: "ⲁ", meaning: "صورة", typeLabel: "", origin: "", qrText: "" }), /Ⲭⲏⲙⲓ/u);
  assert.match(cardSvg({ word: "ⲁ", meaning: "صورة، معنى طويل", typeLabel: "", origin: "", qrText: "", language: "en" }), /MEANING/u);
  const png = renderCard({ word: "ⲙⲟⲣⲫⲏ", meaning: "صورة", typeLabel: "مؤنثة", origin: "يونانية", qrText: "https://t.me/Uploade33_bot", dateText: "4/10/2026 — 25 توت 1743" });
  assert.equal(Buffer.from(png).subarray(1, 4).toString(), "PNG");
  assert.equal(Buffer.from(png).readUInt32BE(16), 907);
  assert.equal(Buffer.from(png).readUInt32BE(20), 1280);
  const { cardData } = await import("../scripts/render_cards.mjs");
  const data = cardData([{ coptic: "ⲁ", meaning: "أ، ب", gender: "", kind: "اسم", origin: "قبطية" }, { coptic: "ⲁ", meaning: "ب، ج", gender: "مذكرة", kind: "", origin: "" }], "");
  assert.deepEqual([data.meaning, data.typeLabel, data.origin], ["أ، ب، ج", "مذكرة", "قبطية"]);
  assert.equal(data.qrText, "https://t.me/Uploade33_bot");
});

// ---- voice caption: "<meaning>. <Coptic word>. <origin>. <gender>." ----
const sonIndex = records.findIndex((record) => record.coptic === "ⲥⲟⲛ" && /^أخ، شقيق/u.test(record.meaning ?? ""));

function pickWorld(kvEnv, { speech = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    url = String(url);
    const body = options.body;
    const payload = !body ? null : typeof body === "string" ? JSON.parse(body) : Object.fromEntries(body.entries());
    calls.push({ url, payload });
    if (url.includes("translate_tts")) {
      return speech
        ? new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } })
        : new Response("blocked", { status: 403 });
    }
    return Response.json({ ok: true, result: { message_id: 900 } });
  };
  return calls;
}

const pick = (kvEnv, data, chatId = 951) => worker.fetch(updateRequest({
  callback_query: { id: "p1", data, from: { id: chatId }, message: { message_id: 5, chat: { id: chatId }, text: "x" } },
}), kvEnv);

test("voice messages have no caption", async () => {
  assert.ok(sonIndex >= 0);
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = pickWorld(kvEnv);
  await pick(kvEnv, `s|${sonIndex}|1`);
  assert.equal(calls.find((call) => call.url.endsWith("/sendVoice")).payload.caption, undefined);

  calls.length = 0;
  await pick(kvEnv, `s|${sonIndex}|0`);
  assert.equal(calls.find((call) => call.url.endsWith("/sendVoice")).payload.caption, undefined);
});

test("a Coptic search sends a Voice without a caption", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = pickWorld(kvEnv);
  await pick(kvEnv, `s|${sonIndex}`);
  assert.equal(calls.find((call) => call.url.endsWith("/sendVoice")).payload.caption, undefined);
});

test("the recorded voice from the admin also has no caption", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set(`voiceid:${records[sonIndex].id}`, { fileId: "ADMIN-VOICE" });
  const calls = pickWorld(kvEnv);
  await pick(kvEnv, `s|${sonIndex}|1`);
  const voice = calls.find((call) => call.url.endsWith("/sendVoice")).payload;
  assert.equal(voice.voice, "ADMIN-VOICE");
  assert.equal(voice.caption, undefined);
});

test("voice payload stays free of captions", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const index = records.findIndex((record) => record.coptic && record.meaning && !record.gender && record.origin);
  assert.ok(index >= 0);
  const calls = pickWorld(kvEnv);
  await pick(kvEnv, `s|${index}`);
  assert.equal(calls.find((call) => call.url.endsWith("/sendVoice")).payload.caption, undefined);
});

test("the entry text has no Gregorian or Coptic date lines", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = pickWorld(kvEnv);
  await worker.fetch(updateRequest({ message: { text: "ⲁⲃⲁϫⲓⲛⲓ", chat: { id: 961 }, from: { id: 961 }, date: 1790000000 } }), kvEnv);
  await pick(kvEnv, `s|${sonIndex}|1`, 961);
  const texts = calls.map((call) => String(call.payload?.text ?? call.payload?.caption ?? ""));
  assert.ok(texts.some((text) => text.includes("<b>الكلمة:</b>")));
  for (const text of texts) assert.doesNotMatch(text, /التاريخ الميلادي|التاريخ القبطي/u);
});

test("admin can delete a recorded voice and the word returns to the generated voice", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const record = records.find((item) => item.coptic === "ⲁⲃⲱⲕ");
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("api.telegram.org")) {
      let payload = {};
      try { payload = JSON.parse(options?.body ?? "{}"); } catch { /* form data */ }
      calls.push({ url: String(url), payload });
      return Response.json({ ok: true, result: {} });
    }
    return new Response("", { status: 404 });
  };
  try {
    // Nothing saved yet: the admin is told the word already uses the generated voice.
    await worker.fetch(updateRequest({ message: { text: `/voice_delete ${record.coptic}`, chat: { id: ADMIN }, from: { id: ADMIN } } }), kvEnv);
    assert.match(calls.at(-1).payload.text, /لا يوجد تسجيل/u);

    kvEnv.USERS.store.set(`voiceid:${record.id}`, { fileId: "my-recording" });
    await worker.fetch(updateRequest({ message: { text: `/voice_delete ${record.coptic}`, chat: { id: ADMIN }, from: { id: ADMIN } } }), kvEnv);
    const ask = calls.at(-1).payload;
    assert.equal(ask.reply_markup.inline_keyboard[0][0].callback_data, `vd|${record.id}`);
    assert.ok(kvEnv.USERS.store.has(`voiceid:${record.id}`), "nothing is deleted before confirming");

    // A non-admin tapping the button changes nothing.
    await worker.fetch(updateRequest({ callback_query: { id: "c0", data: `vd|${record.id}`, from: { id: 555 }, message: { chat: { id: 555 }, message_id: 1 } } }), kvEnv);
    assert.ok(kvEnv.USERS.store.has(`voiceid:${record.id}`));

    // Cancel keeps it, confirm removes it.
    await worker.fetch(updateRequest({ callback_query: { id: "c1", data: "vd|x", from: { id: ADMIN }, message: { chat: { id: ADMIN }, message_id: 2 } } }), kvEnv);
    assert.ok(kvEnv.USERS.store.has(`voiceid:${record.id}`));
    await worker.fetch(updateRequest({ callback_query: { id: "c2", data: `vd|${record.id}`, from: { id: ADMIN }, message: { chat: { id: ADMIN }, message_id: 3 } } }), kvEnv);
    assert.equal(kvEnv.USERS.store.has(`voiceid:${record.id}`), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("recordings are not sent to an archive group", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text: "/record", chat: { id: ADMIN }, from: { id: ADMIN } } }), kvEnv);
  calls.length = 0;
  await worker.fetch(updateRequest({ message: { voice: { file_id: "direct-voice", duration: 3 }, chat: { id: ADMIN }, from: { id: ADMIN } } }), kvEnv);
  assert.equal(calls.some((call) => call.url.endsWith("/sendVoice")), false);
});
