import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore, createSendThrottle, resetVoiceFileIdCache, resetUsageCounter } from "../src/index.js";
import { resetAudioCaches } from "../src/neural-voice.js";
import records from "../data/dictionary.json" with { type: "json" };

test.beforeEach(() => { resetAudioCaches(); resetVoiceFileIdCache(); });

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
const env = { TELEGRAM_BOT_TOKEN: "tok", WEBHOOK_SECRET: secret, HUMAN_AUDIO: "on", VOICE_CAPTION: "on", ASSETS: fakeAssets };
const fakeOgg = () => new Response(new Uint8Array([79, 103, 103, 83, 1, 2, 3]), { headers: { "content-type": "audio/ogg" } });
const isGeneratedAudio = (url) => String(url).includes("raw.githubusercontent.com/abr429701-oss/coptic-dictionary-bot/audio/");
const firstMeaning = (value) => String(value ?? "").split(/[،,]/u)[0].trim();
const TEST_RECORD = records.find((record) => {
  const query = firstMeaning(record.english);
  if (!query || query.length < 3) return false;
  const englishMatches = records.filter((other) => firstMeaning(other.english) === query).length;
  const foreignMatch = records.some((other) => firstMeaning(other.translation_fr) === query || firstMeaning(other.translation_de) === query);
  return englishMatches === 1 && !foreignMatch;
}) ?? records.find((record) => record.english);
const TEST_QUERY = String(TEST_RECORD?.english ?? "see").split(/[،,]/u)[0].trim();

// Same fake DO as worker.test.js, except the object is built with an env
// that carries the USERS binding itself — the real DO's env does, and the
// poller runs handleUpdate with the DO's env, so getUser must work there.
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
    getAlarm: async () => alarms.at(-1) ?? null,
  };
  const kv = {
    store, alarms, object: null,
    idFromName: (name) => name,
    get: () => ({ fetch: (url, options) => kv.object.fetch(new Request(url, options)) }),
  };
  kv.object = new UserStore({ storage }, { ...env, USERS: kv });
  return kv;
}

// A Telegram fake that serves a getUpdates queue the way Telegram does:
// updates with update_id >= offset are returned; the caller's offset
// advance decides what comes back next time.
function fakePollTelegram(calls, queue, behavior = {}) {
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body;
    const payload = !body ? null : typeof body === "string" ? JSON.parse(body) : Object.fromEntries(body.entries());
    if (String(url).endsWith("/getUpdates")) {
      calls.push({ url: String(url), payload, kind: "getUpdates" });
      if (behavior.getUpdatesError) return Response.json(behavior.getUpdatesError);
      const offset = Number(payload?.offset ?? 0);
      const result = queue.filter((u) => u.update_id >= offset).slice(0, Number(payload?.limit ?? 100));
      return Response.json({ ok: true, result });
    }
    if (isGeneratedAudio(url)) return fakeOgg();
    if (behavior.throwForChatId != null && String(payload?.chat_id) === String(behavior.throwForChatId)) {
      throw new Error("temporary connection reset");
    }
    calls.push({ url: String(url), payload, kind: "send" });
    return Response.json({ ok: true, result: { message_id: 900 } });
  };
}

const msg = (update_id, chatId, text) => ({
  update_id,
  message: { message_id: update_id, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: "private" }, from: { id: chatId, first_name: `user ${chatId}` }, text },
});
const sendsTo = (calls, chatId) => calls.filter((c) => c.kind === "send" && String(c.payload?.chat_id) === String(chatId));
const enablePoller = async (kvEnv) => kvEnv.USERS.store.set("admin:features", { poller: true });

test("poller answers queued updates, advances the offset, and reschedules busy", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set("user:101", { name: "user 101" });
  kvEnv.USERS.store.set("user:102", { name: "user 102" });
  await enablePoller(kvEnv);
  const calls = [];
  const queue = [msg(1001, 101, TEST_QUERY), msg(1002, 102, "/start")];
  fakePollTelegram(calls, queue);
  await kvEnv.USERS.object.alarm();
  // 101 searched: a voice answer. 102 asked for /start: the bot already
  // knows them (seeded), so it answers with the main menu text.
  assert.ok(calls.some((c) => c.url.endsWith("/sendVoice") && String(c.payload?.chat_id) === "101"), "search gets a voice reply");
  assert.ok(sendsTo(calls, 102).length >= 1, "/start gets an answer");
  assert.equal(kvEnv.USERS.store.get("poll:offset"), 1003);
  // Busy batch -> next alarm in ~0.5s (the wait happens inside the long
  // poll, not between alarms).
  const wait = kvEnv.USERS.alarms.at(-1) - Date.now();
  assert.ok(wait >= 200 && wait <= 1000, `busy reschedule ~0.5s, got ${wait}ms`);
  // A second alarm finds nothing new: getUpdates is called again with the
  // advanced offset and returns nothing.
  const before = calls.filter((c) => c.kind === "getUpdates").length;
  await kvEnv.USERS.object.alarm();
  assert.equal(calls.filter((c) => c.kind === "getUpdates").length, before + 1);
  assert.equal(kvEnv.USERS.store.get("poll:offset"), 1003);
});

test("poller does nothing while the flag is off", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = [];
  fakePollTelegram(calls, [msg(1001, 101, TEST_QUERY)]);
  await kvEnv.USERS.object.alarm();
  assert.equal(calls.filter((c) => c.kind === "getUpdates").length, 0);
  assert.equal(kvEnv.USERS.alarms.length, 0);
  assert.equal(kvEnv.USERS.store.get("poll:offset"), undefined);
});

test("poller uses the direct storage path: zero binding calls", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set("user:101", { name: "user 101" });
  await enablePoller(kvEnv);
  let bindingCalls = 0;
  const rawGet = kvEnv.USERS.get;
  kvEnv.USERS.get = (...args) => { bindingCalls += 1; return rawGet(...args); };
  const calls = [];
  fakePollTelegram(calls, [msg(1001, 101, TEST_QUERY)]);
  await kvEnv.USERS.object.alarm();
  assert.ok(calls.some((c) => c.url.endsWith("/sendVoice")), "search answered");
  assert.equal(bindingCalls, 0, "no stub.fetch round trip: chat costs zero DO requests");
});

test("a poison update is skipped, the rest are answered, and the offset still advances", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set("user:102", { name: "user 102" });
  await enablePoller(kvEnv);
  const calls = [];
  // 201 is a brand-new user whose every send throws; 102 searches fine.
  const queue = [msg(1001, 201, "/start"), msg(1002, 102, TEST_QUERY)];
  fakePollTelegram(calls, queue, { throwForChatId: 201 });
  await kvEnv.USERS.object.alarm();
  assert.equal(sendsTo(calls, 201).length, 0, "poison user got nothing");
  assert.ok(calls.some((c) => c.url.endsWith("/sendVoice") && String(c.payload?.chat_id) === "102"), "healthy user still answered");
  assert.equal(kvEnv.USERS.store.get("poll:offset"), 1003);
});

test("getUpdates 409 (webhook still set) makes the poller idle instead of spinning", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await enablePoller(kvEnv);
  const calls = [];
  fakePollTelegram(calls, [], { getUpdatesError: { ok: false, error_code: 409, description: "Conflict: terminated by other getUpdates request" } });
  await kvEnv.USERS.object.alarm();
  assert.equal(calls.filter((c) => c.kind === "send").length, 0);
  const wait = kvEnv.USERS.alarms.at(-1) - Date.now();
  assert.ok(wait >= 4000 && wait <= 6000, `idle reschedule ~5s, got ${wait}ms`);
  assert.equal(kvEnv.USERS.store.get("poll:offset"), undefined);
});

test("usage: answering 50 messages in one alarm counts 1 request, not 50", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  for (let i = 0; i < 50; i += 1) kvEnv.USERS.store.set(`user:${1000 + i}`, { name: `user ${1000 + i}` });
  await enablePoller(kvEnv);
  resetUsageCounter();
  const calls = [];
  // 50 messages across 50 chats in a single getUpdates batch (one alarm),
  // then 20 empty alarms: 21 alarms total, 50 messages answered.
  const queue = Array.from({ length: 50 }, (_, i) => msg(1001 + i, 1000 + i, TEST_QUERY));
  fakePollTelegram(calls, queue);
  await kvEnv.USERS.object.alarm();
  assert.equal(kvEnv.USERS.store.get("poll:offset"), 1051, "all 50 messages processed");
  for (let i = 0; i < 20; i += 1) await kvEnv.USERS.object.alarm();
  const res = await kvEnv.USERS.object.fetch(new Request("https://user-store/", {
    method: "POST",
    body: JSON.stringify({ op: "usageReport", limit: 8 }),
  }));
  const report = await res.json();
  const today = new Date().toISOString().slice(0, 10);
  const row = report.days.find((d) => d.day === today);
  // 2026-11-14: /usage kept climbing per message because processPollUpdate
  // counted every answer as a request. Now one alarm = one counted
  // request, however many messages it answered.
  assert.equal(row?.count, 21, `21 alarms = 21 counted requests, got ${row?.count}`);
});

test("pollkick starts the alarm loop only when no alarm is pending", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const kick = async () => {
    const res = await kvEnv.USERS.object.fetch(new Request("https://user-store/", {
      method: "POST",
      body: JSON.stringify({ op: "pollkick" }),
    }));
    return res.json();
  };
  // 2026-11-14: the cutover went silent because nothing ever kicked the
  // loop — no alarm was pending when the flag was enabled.
  assert.deepEqual(await kick(), { kicked: true });
  assert.equal(kvEnv.USERS.alarms.length, 1);
  assert.deepEqual(await kick(), { kicked: false });
  assert.equal(kvEnv.USERS.alarms.length, 1, "a second kick must not stack alarms");
});

test("/feature poller on schedules the first alarm (the kick)", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set("user:813894692", { name: "admin" });
  globalThis.fetch = async (url, options = {}) => {
    if (isGeneratedAudio(url)) return fakeOgg();
    return Response.json({ ok: true, result: { message_id: 900 } });
  };
  const req = new Request("https://bot.test/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(msg(1001, 813894692, "/feature poller on")),
  });
  const res = await worker.fetch(req, kvEnv);
  assert.equal(res.status, 200);
  assert.equal(kvEnv.USERS.store.get("admin:features")?.poller, true);
  assert.ok(kvEnv.USERS.alarms.length >= 1, "enabling the poller must schedule an alarm");
});

test("poller long-polls: getUpdates waits 50s and an empty poll reschedules fast", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await enablePoller(kvEnv);
  const calls = [];
  fakePollTelegram(calls, []);
  await kvEnv.USERS.object.alarm();
  const getUpdates = calls.filter((c) => c.kind === "getUpdates");
  assert.equal(getUpdates.length, 1);
  assert.equal(getUpdates[0].payload?.timeout, 50, "long polling: Telegram holds the request until a message arrives");
  const wait = kvEnv.USERS.alarms.at(-1) - Date.now();
  assert.ok(wait >= 200 && wait <= 1000, `empty long poll reschedules fast (~0.5s), got ${wait}ms`);
});

test("poller skips the long poll while a broadcast is active, so batches drain fast", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await enablePoller(kvEnv);
  // A broadcast job waiting for its next batch: broadcastStep returns its
  // remaining wait without touching the job, so pollStep still sees it.
  kvEnv.USERS.store.set("broadcast", { queue: [], total: 0, sent: 0, nextAt: Date.now() + 60000 });
  const calls = [];
  fakePollTelegram(calls, []);
  await kvEnv.USERS.object.alarm();
  const getUpdates = calls.filter((c) => c.kind === "getUpdates");
  assert.equal(getUpdates.length, 1);
  assert.equal(getUpdates[0].payload?.timeout, 0, "no 50s wait between broadcast batches");
});

test("alarm() reschedules at the idle cadence after a throwing step", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await enablePoller(kvEnv);
  kvEnv.USERS.object.pollStep = async () => { throw new Error("boom"); };
  await kvEnv.USERS.object.alarm();
  assert.equal(kvEnv.USERS.alarms.length, 1);
  const wait = kvEnv.USERS.alarms.at(-1) - Date.now();
  assert.ok(wait >= 4000 && wait <= 6000, `error backoff ~5s after a crash, got ${wait}ms`);
});

test("pollStats op reports the poller state", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set("user:101", { name: "user 101" });
  await enablePoller(kvEnv);
  const calls = [];
  fakePollTelegram(calls, [msg(1001, 101, TEST_QUERY)]);
  await kvEnv.USERS.object.alarm();
  const res = await kvEnv.USERS.object.fetch(new Request("https://user-store/", {
    method: "POST",
    body: JSON.stringify({ op: "pollStats" }),
  }));
  const stats = await res.json();
  assert.equal(stats.enabled, true);
  assert.equal(stats.offset, 1002);
  assert.ok(stats.processed >= 1);
  assert.ok(stats.lastRun > 0);
});

test("send throttle: same chat waits, different chats do not", async () => {
  const throttle = createSendThrottle();
  const t0 = Date.now();
  await throttle.take(111);
  await throttle.take(111);
  const sameChatMs = Date.now() - t0;
  assert.ok(sameChatMs >= 300, `same chat paced, only ${sameChatMs}ms`);
  const t1 = Date.now();
  await throttle.take(222);
  await throttle.take(333);
  const diffChatMs = Date.now() - t1;
  assert.ok(diffChatMs < 300, `different chats not held back, took ${diffChatMs}ms`);
});

test("webhook still works after the poller refactor (no regression)", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set("user:101", { name: "user 101" });
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    if (isGeneratedAudio(url)) return fakeOgg();
    const body = options.body;
    const payload = !body ? null : typeof body === "string" ? JSON.parse(body) : Object.fromEntries(body.entries());
    calls.push({ url: String(url), payload });
    return Response.json({ ok: true, result: { message_id: 900 } });
  };
  const req = new Request("https://bot.test/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(msg(1001, 101, TEST_QUERY)),
  });
  const res = await worker.fetch(req, kvEnv);
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.url.endsWith("/sendVoice")), "webhook search still answers with voice");
});
