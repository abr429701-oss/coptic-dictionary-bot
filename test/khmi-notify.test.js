import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore, parseCsv, describeKhmiDevice, khmiRowsFromCsv, checkKhmiNotifications } from "../src/index.js";

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

async function say(envWithKv, userId, text) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text, chat: { id: userId, type: "private" }, from: { id: userId } } }), envWithKv);
  return calls;
}
const sent = (calls) => calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => c.payload);

// Stub fetch for the KHMI check: the Google Sheet CSV for docs.google.com,
// a recorded ok for api.telegram.org, and a 404 for anything else.
function stubKhmiFetch(calls, csvText) {
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("docs.google.com")) return new Response(csvText, { headers: { "content-type": "text/csv" } });
    if (String(url).includes("api.telegram.org")) {
      const body = options.body;
      const payload = !body ? null : typeof body === "string" ? JSON.parse(body) : Object.fromEntries(body.entries());
      calls.push({ url: String(url), payload });
      return Response.json({ ok: true, result: { message_id: 900 } });
    }
    return new Response("Not found", { status: 404 });
  };
}

const CSV_HEADER = `"device_id","language"`;
const row = (id, lang = "ar") => `"${id}","${lang}"`;
const SAMSUNG_A16 = "samsung/a16nsxx/a16:16/BP2A.250605.031.A3/A165FXXU5CYK1:user/release-keys_aaa111";
const ANDROID_1 = "Android_qet1hmd9kng";
const HONOR_DNP = "HONOR/DNP-NX9/DNP-NX9:14/HONORDNP-NX9-user/release-keys_bbb222";
const csvOf = (ids) => [CSV_HEADER, ...ids.map((id) => row(id))].join("\n");

test("parseCsv: quoted commas, escaped quotes, CRLF, embedded newlines", () => {
  assert.deepEqual(parseCsv(`"a","b,c","d""e"\r\n"1","2","3"`), [["a", "b,c", 'd"e'], ["1", "2", "3"]]);
  assert.deepEqual(parseCsv(`"a","line1\nline2","c"\n"x","y","z"`), [["a", "line1\nline2", "c"], ["x", "y", "z"]]);
  assert.deepEqual(parseCsv("a,b,c\n1,2,3"), [["a", "b", "c"], ["1", "2", "3"]]);
  assert.deepEqual(parseCsv(""), []);
});

test("khmiRowsFromCsv: skips the header and empty device ids", () => {
  const rows = khmiRowsFromCsv([CSV_HEADER, row(SAMSUNG_A16), `"",""`, row(ANDROID_1, "en")].join("\n"));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, SAMSUNG_A16);
  assert.equal(rows[0].lang, "ar");
  assert.equal(rows[1].lang, "en");
});

test("describeKhmiDevice: fingerprints, generic ids, and fallbacks", () => {
  assert.equal(describeKhmiDevice(SAMSUNG_A16), "Samsung Galaxy A16");
  assert.equal(describeKhmiDevice("samsung/a73xqxx/a73xq:16/BP2A.250605.031.A3/A736BXXUAGYJ1:user/release-keys_bbb"), "Samsung Galaxy A73");
  assert.equal(describeKhmiDevice("samsung/a13vennxx/a13:15/TP1A.220624.014/A137FXXU3DWI1:user/release-keys_ccc"), "Samsung Galaxy A13");
  assert.equal(describeKhmiDevice("samsung/zzz/zzz:16/AAA/Z999ZXXU1AAA1:user/release-keys_ddd"), "Samsung Z999Z");
  assert.equal(describeKhmiDevice(HONOR_DNP), "HONOR DNP-NX9");
  assert.equal(describeKhmiDevice("POCO/peridot_global/peridot:14/POCOperidot-user/release-keys_eee"), "POCO peridot");
  assert.equal(describeKhmiDevice("Redmi/fire_global/fire:14/Redmifire-user/release-keys_fff"), "Redmi fire");
  assert.equal(describeKhmiDevice("HUAWEI/STK-L21M/STK-L21M:10/HUAWEISTK-user/release-keys_ggg"), "HUAWEI STK-L21M");
  assert.equal(describeKhmiDevice(ANDROID_1), "جهاز Android");
  assert.equal(describeKhmiDevice("iOS_wn9u8yx3u4"), "جهاز iPhone");
  assert.equal(describeKhmiDevice("Linux_abc123"), "جهاز كمبيوتر");
  assert.equal(describeKhmiDevice("Windows_xyz"), "جهاز كمبيوتر");
  assert.equal(describeKhmiDevice(""), "جهاز غير معروف");
  assert.equal(describeKhmiDevice("unknown_02wfal4m18y7"), "جهاز غير معروف");
});

test("checkKhmiNotifications: first run stores the baseline silently", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  const kvEnv = { ...env, USERS: fakeKv() };
  try {
    stubKhmiFetch(calls, csvOf([SAMSUNG_A16, ANDROID_1]));
    const result = await checkKhmiNotifications(kvEnv);
    assert.equal(result.ok, true);
    assert.equal(result.firstRun, true);
    assert.equal(result.count, 2);
    assert.deepEqual(result.newDevices, []);
    assert.equal(calls.length, 0, "no Telegram message on the first run");
  } finally { globalThis.fetch = realFetch; }
});

test("checkKhmiNotifications: no change sends nothing; a new device alerts the admin", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  const kvEnv = { ...env, USERS: fakeKv() };
  try {
    stubKhmiFetch(calls, csvOf([SAMSUNG_A16, ANDROID_1]));
    await checkKhmiNotifications(kvEnv);
    assert.equal(calls.length, 0);

    stubKhmiFetch(calls, csvOf([SAMSUNG_A16, ANDROID_1]));
    const same = await checkKhmiNotifications(kvEnv);
    assert.equal(same.ok, true);
    assert.deepEqual(same.newDevices, []);
    assert.equal(calls.length, 0, "no message when nothing changed");

    stubKhmiFetch(calls, csvOf([SAMSUNG_A16, ANDROID_1, HONOR_DNP]));
    const added = await checkKhmiNotifications(kvEnv);
    assert.equal(added.ok, true);
    assert.equal(added.count, 3);
    assert.equal(added.newDevices.length, 1);
    assert.equal(added.newDevices[0].name, "HONOR DNP-NX9");
    assert.equal(calls.length, 1, "exactly one admin message");
    assert.equal(calls[0].payload.chat_id, "813894692");
    assert.match(calls[0].payload.text, /العدد زاد من 2 لـ 3 \(\+1\)/u);
    assert.match(calls[0].payload.text, /HONOR DNP-NX9/u);

    // The same rows again: the alert must not repeat.
    stubKhmiFetch(calls, csvOf([SAMSUNG_A16, ANDROID_1, HONOR_DNP]));
    await checkKhmiNotifications(kvEnv);
    assert.equal(calls.length, 1, "no repeat alert for already-seen rows");
  } finally { globalThis.fetch = realFetch; }
});

test("checkKhmiNotifications: a duplicate row of one device alerts once, not twice", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  const kvEnv = { ...env, USERS: fakeKv() };
  try {
    stubKhmiFetch(calls, csvOf([SAMSUNG_A16]));
    await checkKhmiNotifications(kvEnv);
    stubKhmiFetch(calls, csvOf([SAMSUNG_A16, ANDROID_1, ANDROID_1]));
    const result = await checkKhmiNotifications(kvEnv);
    assert.equal(result.ok, true);
    assert.equal(result.count, 3);
    assert.equal(result.newDevices.length, 1, "the same device twice is one new device");
    assert.equal(calls.length, 1);
    assert.match(calls[0].payload.text, /العدد زاد من 1 لـ 3 \(\+2\)/u);
  } finally { globalThis.fetch = realFetch; }
});

test("checkKhmiNotifications: empty sheet and suspicious drops never notify or wipe state", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  const kvEnv = { ...env, USERS: fakeKv() };
  try {
    const hundred = Array.from({ length: 100 }, (_, i) => `Android_seed${String(i).padStart(3, "0")}`);
    stubKhmiFetch(calls, csvOf(hundred));
    const first = await checkKhmiNotifications(kvEnv);
    assert.equal(first.ok, true);
    assert.equal(first.count, 100);

    stubKhmiFetch(calls, CSV_HEADER + "\n");
    const empty = await checkKhmiNotifications(kvEnv);
    assert.equal(empty.ok, false);
    assert.equal(empty.reason, "empty-sheet");
    assert.equal(calls.length, 0);

    stubKhmiFetch(calls, csvOf(hundred.slice(0, 10)));
    const drop = await checkKhmiNotifications(kvEnv);
    assert.equal(drop.ok, false);
    assert.equal(drop.reason, "suspicious-drop");
    assert.equal(calls.length, 0, "a 90% drop must not alert");

    // The baseline survived: the same 100 rows again send nothing.
    stubKhmiFetch(calls, csvOf(hundred));
    await checkKhmiNotifications(kvEnv);
    assert.equal(calls.length, 0);
  } finally { globalThis.fetch = realFetch; }
});

test("/khmi: before the first check it says the watch has not started; after, it shows the count", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const before = await say(kvEnv, ADMIN, "/khmi");
  const beforeText = sent(before).map((p) => p.text).join("\n");
  assert.match(beforeText, /لم يبدأ الفحص بعد/u);

  const realFetch = globalThis.fetch;
  const calls = [];
  try {
    stubKhmiFetch(calls, csvOf([SAMSUNG_A16, ANDROID_1]));
    await checkKhmiNotifications(kvEnv);
  } finally { globalThis.fetch = realFetch; }
  const after = await say(kvEnv, ADMIN, "/khmi");
  const afterText = sent(after).map((p) => p.text).join("\n");
  assert.match(afterText, /العدد الحالي: 2 جهاز/u);
  assert.match(afterText, /آخر فحص:/u);
});
