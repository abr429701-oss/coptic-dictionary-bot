import test from "node:test";
import assert from "node:assert/strict";
import worker, { UserStore } from "../src/index.js";
import records from "../data/dictionary.json" with { type: "json" };

const token = "test-token";
const secret = "test-secret-should-be-long-enough";
const env = { TELEGRAM_BOT_TOKEN: token, WEBHOOK_SECRET: secret };

function fakeTelegramApi(calls) {
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body;
    const payload = !body ? null : typeof body === "string" ? JSON.parse(body) : Object.fromEntries(body.entries());
    calls.push({ url: String(url), options, payload });
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
  const alarms = [];
  const storage = {
    get: async (key) => store.get(key),
    put: async (key, value) => { store.set(key, value); },
    delete: async (key) => store.delete(key),
    list: async ({ prefix = "" } = {}) => new Map([...store].filter(([key]) => key.startsWith(prefix))),
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

test("/keyboard sends a reply keyboard (not inline) with letters and controls", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = await kbSay(kvEnv, "/keyboard");
  const message = sent(calls)[0];
  assert.equal(message.reply_markup.inline_keyboard, undefined);
  assert.equal(message.reply_markup.resize_keyboard, true);
  const labels = message.reply_markup.keyboard.flat().map((button) => button.text);
  for (const key of ["ⲁ", "ⲱ", "ϣ", "ϧ", "ϯ", "`", "␣ مسافة", "⌫ حذف", "🗑 مسح", "🔎 بحث", "✖️ إغلاق"]) {
    assert.ok(labels.includes(key), key);
  }
  assert.equal(kvEnv.USERS.store.get("user:31").kb.msgId, 900);
});

test("tapping keys collects the word, deletes the tap and edits one message", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await kbSay(kvEnv, "/keyboard");
  let calls = await kbSay(kvEnv, "ⲁ", 11);
  assert.ok(calls.some((call) => call.url.endsWith("/deleteMessage") && call.payload.message_id === 11));
  assert.equal(edits(calls)[0].message_id, 900);
  assert.match(edits(calls)[0].text, /▸ ⲁ▏/u);
  assert.equal(sent(calls).length, 0);

  calls = await kbSay(kvEnv, "ϣ", 12);
  assert.match(edits(calls)[0].text, /▸ ⲁϣ▏/u);
  calls = await kbSay(kvEnv, "␣ مسافة", 13);
  assert.match(edits(calls)[0].text, /▸ ⲁϣ ▏/u);
  calls = await kbSay(kvEnv, "ⲃ", 14);
  assert.match(edits(calls)[0].text, /▸ ⲁϣ ⲃ▏/u);
  calls = await kbSay(kvEnv, "⌫ حذف", 15);
  assert.match(edits(calls)[0].text, /▸ ⲁϣ ▏/u);
  calls = await kbSay(kvEnv, "🗑 مسح", 16);
  assert.match(edits(calls)[0].text, /▸ ▏/u);
});

test("🔎 بحث searches the collected word then opens a fresh composition message", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await kbSay(kvEnv, "/keyboard");
  for (const letter of "ⲁⲃⲁϫⲓⲛⲓ") await kbSay(kvEnv, letter);
  const calls = await kbSay(kvEnv, "🔎 بحث", 40);
  assert.ok(calls.some((call) => call.url.endsWith("/sendChatAction")));
  const messages = sent(calls);
  assert.match(messages[0].text, /ⲁⲃⲁϫⲓⲛⲓ/u);
  assert.match(messages.at(-1).text, /▸ ▏/u);
  assert.equal(kvEnv.USERS.store.get("user:31").kb.word, "");
});

test("🔎 بحث with no letters asks for a word and does not search", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await kbSay(kvEnv, "/keyboard");
  const calls = await kbSay(kvEnv, "🔎 بحث");
  assert.match(sent(calls)[0].text, /اكتب كلمة أولًا/u);
  assert.ok(!calls.some((call) => call.url.endsWith("/sendChatAction")));
});

test("✖️ إغلاق ends the session and removes the keyboard", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await kbSay(kvEnv, "/keyboard");
  const calls = await kbSay(kvEnv, "✖️ إغلاق");
  assert.equal(sent(calls)[0].reply_markup.remove_keyboard, true);
  assert.equal(kvEnv.USERS.store.get("user:31").kb, undefined);
});

test("without a keyboard session a typed letter is a normal search, and a real word still searches during a session", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  let calls = await kbSay(kvEnv, "ⲁⲃ");
  assert.equal(sent(calls)[0].text, "اختر من الاقتراحات التالية:");
  await kbSay(kvEnv, "/keyboard");
  calls = await kbSay(kvEnv, "abagini");
  assert.match(sent(calls)[0].text, /ⲁⲃⲁϫⲓⲛⲓ/u);
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
  assert.match(report, /وصلت إلى: 2[^]*لم تصل[^]*: 1/u);

  await asUser(kvEnv, ADMIN, { text: "/broadcast" });
  const again = await asUser(kvEnv, ADMIN, { message_id: 10, text: "again" });
  assert.match(sent(again)[0].text, /إلى 2 مستخدم/u);
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
  await asUser(kvEnv, 401, { text: "abagini" });
  assert.ok(kvEnv.USERS.store.get("user:401").firstSeen);
});
