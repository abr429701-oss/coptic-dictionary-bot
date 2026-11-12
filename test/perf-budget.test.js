import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore } from "../src/index.js";
import { resetAudioCaches } from "../src/neural-voice.js";

// G0 — Durable Object budget harness (Phase B perf work).
//
// Every storeCall is one DO RPC: it goes through env.USERS.get(...).fetch,
// so wrapping that fetch counts DO requests exactly. Each scenario below
// runs one simulated Telegram update against a fresh KV store and asserts
// a DO-request budget. The budgets here are the MEASURED baseline on the
// pre-fix code (see t.diagnostic output); groups G1–G3 tighten them as
// the waste they measure is removed. A budget regression fails the suite.
//
// Measured baseline (warm config caches, fresh user id):
// - plain search: 7 DO calls after G5 (9 with cold voice memory: the
//   warm-up search caches the word's file_id in isolate memory). G0
//   measured 21 pre-G1, G1 brought it to 14, G2 to 12, G3 to 8.
//   Remaining: historyAppend x1 + convAppend x1 (the atomic flush ops)
//   + register x1 + drive-config x1 + menus:v1 x1 + pro:support:flow x1
//   (first update on a fresh store; warm in production within TTL) +
//   getUser x1. A repeat message from the same user within 60 s costs 1
//   less (registeredCache hit skips the register op); a repeat search
//   for the same word costs only 3 (the two flushes + getUser) — the
//   voice path reads nothing from the DO once its file_ids are memoized.
// - /start: 7. noop callback: 0. inline query: 1. new user: 7 (9 with
//   cold voice memory). second search: 3.
//
// Rules that keep the numbers deterministic:
// - one fresh user id per scenario (rate-limit buckets are module-level and
//   shared across this file — reusing an id would rate-limit later tests),
// - a warm-up update first (module-level config caches start cold),
// - resetAudioCaches before each test (voice file_id memory must not leak).

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
// Production-like env: voice+caption in a single message (wrangler vars).
const env = { TELEGRAM_BOT_TOKEN: token, WEBHOOK_SECRET: secret, ASSETS: fakeAssets, VOICE_CAPTION: "on" };
const fakeOgg = () => new Response(new Uint8Array([79, 103, 103, 83, 1, 2, 3]), { headers: { "content-type": "audio/ogg" } });
const isGeneratedAudio = (url) => String(url).includes("raw.githubusercontent.com/abr429701-oss/coptic-dictionary-bot/audio/");

function fakeTelegramApi(calls) {
  globalThis.fetch = async (url, options = {}) => {
    if (isGeneratedAudio(url)) return fakeOgg();
    const body = options.body;
    const payload = !body ? null : typeof body === "string" ? JSON.parse(body) : Object.fromEntries(body.entries());
    calls.push({ url: String(url), options, payload });
    // Production Telegram returns the uploaded voice's file_id, which the
    // bot then caches (memory + DO) so the word is uploaded once. The fake
    // must return one too, or every search would re-read the file_id keys.
    return Response.json({ ok: true, result: { message_id: 900, voice: { file_id: "fake-voice-file-id" } } });
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
  const listCalls = [];
  const storage = {
    get: async (key) => store.get(key),
    put: async (key, value) => { store.set(key, value); },
    delete: async (key) => store.delete(key),
    list: async ({ prefix = "", startAfter, limit } = {}) => {
      listCalls.push(prefix);
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
    listCalls,
    object,
    idFromName: (name) => name,
    get: () => ({
      fetch: (url, options) => object.fetch(new Request(url, options)),
    }),
  };
}

// Wraps a fakeKv so every DO stub fetch is counted. One wrapped fetch call
// is exactly one billed DO request, whatever op runs inside it.
function countingKv() {
  const kv = fakeKv();
  const counts = { total: 0, byOp: new Map(), byKey: new Map() };
  const rawGet = kv.get.bind(kv);
  kv.get = (...args) => {
    const stub = rawGet(...args);
    const rawFetch = stub.fetch.bind(stub);
    return {
      fetch: async (url, options) => {
        counts.total += 1;
        try {
          const payload = JSON.parse(String(options?.body ?? "{}"));
          if (payload.op) counts.byOp.set(payload.op, (counts.byOp.get(payload.op) ?? 0) + 1);
          if (payload.key) counts.byKey.set(payload.key, (counts.byKey.get(payload.key) ?? 0) + 1);
        } catch { /* non-JSON DO call: counted in total only */ }
        return rawFetch(url, options);
      },
    };
  };
  return { kv, counts };
}

const resetCounts = (counts) => { counts.total = 0; counts.byOp.clear(); counts.byKey.clear(); };
const summary = (counts) => `DO=${counts.total} {${[...counts.byOp.entries()].map(([op, n]) => `${op}:${n}`).join(", ")}} keys=[${[...counts.byKey.entries()].map(([k, n]) => `${k}:${n}`).join(", ")}]`;

const NAMED_USER = (id) => ({
  name: "مينا", username: "mina", firstSeen: new Date().toISOString(),
  registeredAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
});

async function runText(kv, userId, text) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text, chat: { id: userId, type: "private" }, from: { id: userId, first_name: "مينا" } } }), { ...env, USERS: kv });
  return calls;
}

async function runCallback(kv, userId, data) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ callback_query: { id: `cb-${userId}`, from: { id: userId }, message: { chat: { id: userId, type: "private" }, message_id: 1 }, data } }), { ...env, USERS: kv });
  return calls;
}

async function runInline(kv, userId, query) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ inline_query: { id: `iq-${userId}`, from: { id: userId }, query } }), { ...env, USERS: kv });
  return calls;
}

test.beforeEach(() => resetAudioCaches());

// Warm-up: pays the cold-start costs (config caches, search index) so the
// scenarios below measure the warm steady state, like production traffic.
test("perf-budget: warm-up (not asserted)", async () => {
  const { kv, counts } = countingKv();
  kv.store.set("user:9001", NAMED_USER(9001));
  await runText(kv, 9001, "ⲫⲱⲥ");
  void counts;
});

test("perf-budget: plain search from a named user (voice on)", async (t) => {
  const { kv, counts } = countingKv();
  kv.store.set("user:9101", NAMED_USER(9101));
  resetCounts(counts);
  const calls = await runText(kv, 9101, "ⲫⲱⲥ");
  t.diagnostic(`plain search: ${summary(counts)}`);
  assert.ok(calls.some((c) => c.url.endsWith("/sendVoice")), "the search must still send its voice");
  assert.ok(counts.total <= 9, `plain search must stay within its DO budget, got ${summary(counts)}`);
});

// G2 regression: one search must read the user record exactly once
// (getUser memo), not 3 times as before.
test("perf-budget: one search reads the user record once (getUser memo)", async (t) => {
  const { kv, counts } = countingKv();
  kv.store.set("user:9107", NAMED_USER(9107));
  resetCounts(counts);
  const calls = await runText(kv, 9107, "ⲫⲱⲥ");
  t.diagnostic(`memo search: ${summary(counts)}`);
  assert.ok(calls.some((c) => c.url.endsWith("/sendVoice")), "the search must still send its voice");
  assert.equal(counts.byKey.get("user:9107") ?? 0, 1, "one search must read the user record exactly once");
});

// G3 regression: one search persists its OWN history + conversation in
// the same update (track-then-flush), under per-user keys, with no
// global history:snapshot traffic anymore.
test("perf-budget: one search persists its own history in the same update", async (t) => {
  const { kv, counts } = countingKv();
  kv.store.set("user:9108", NAMED_USER(9108));
  resetCounts(counts);
  await runText(kv, 9108, "ⲫⲱⲥ");
  t.diagnostic(`g3 search: ${summary(counts)}`);
  const history = kv.store.get("history:9108");
  assert.ok(Array.isArray(history) && history.some((e) => e.q === "ⲫⲱⲥ"), "the search must be in history:9108 after its own update");
  const conv = kv.store.get("conv:9108");
  assert.ok(Array.isArray(conv) && conv.length >= 1, "the message must be in conv:9108 after its own update");
  assert.equal(kv.store.get("history:snapshot"), undefined, "the old global history:snapshot must not be written anymore");
  assert.equal(counts.byKey.get("history:snapshot") ?? 0, 0, "no history:snapshot traffic anymore");
});

// G4 regression: registering a new user must not list all users — the
// durable users:total counter replaces the full scan (the first
// registration on a fresh store seeds it with one list; later ones must
// not list at all).
test("perf-budget: registering a new user does not list all users", async (t) => {
  const { kv, counts } = countingKv();
  await runText(kv, 9201, "ⲫⲱⲥ");
  assert.equal(kv.store.get("users:total"), 1, "the counter starts at 1 after the first registration");
  const listsBefore = kv.listCalls.length;
  await runText(kv, 9202, "ⲫⲱⲥ");
  assert.equal(kv.store.get("users:total"), 2, "the counter increments without a list");
  const newLists = kv.listCalls.slice(listsBefore);
  assert.ok(!newLists.includes("user:"), `the second registration must not list users, got lists: ${newLists.join(",") || "none"}`);
});

// G5 regression: a repeat search for a word with no admin recording must
// not re-read the recorded-voice key (negative voice memo).
test("perf-budget: repeat search skips the recorded-voice check (voice memo)", async (t) => {
  const { kv, counts } = countingKv();
  kv.store.set("user:9109", NAMED_USER(9109));
  await runText(kv, 9109, "ⲫⲱⲥ");
  resetCounts(counts);
  const calls = await runText(kv, 9109, "ⲫⲱⲥ");
  t.diagnostic(`repeat search: ${summary(counts)}`);
  assert.ok(calls.some((c) => c.url.endsWith("/sendVoice")), "the repeat search must still send its voice");
  assert.equal(counts.byKey.get("voiceid:9251") ?? 0, 0, "the repeat search must not re-read the recorded-voice key");
});

// G7 regression: /health (which runs adminStats) must scan the voiceid:
// prefix exactly once — the old op listed it twice. /health is
// admin-only, so this runs as the default admin (813894692).
test("perf-budget: /health lists the voice prefix once (adminStats dedupe)", async (t) => {
  const { kv, counts } = countingKv();
  kv.store.set("user:813894692", NAMED_USER(813894692));
  kv.store.set("voiceid:9251", { fileId: "v1" });
  kv.store.set("voiceid:9252", { fileId: "v2", drive: { url: "https://drive.example/1" } });
  const calls = await runText(kv, 813894692, "/health");
  assert.ok(calls.some((c) => c.url.endsWith("/sendMessage") && String(c.payload?.text ?? "").includes("فحص صحة البوت")), "/health must still send its report");
  assert.equal(kv.listCalls.filter((p) => p === "voiceid:").length, 1, `voiceid: must be listed once, got ${kv.listCalls.join(",")}`);
  t.diagnostic(`/health: ${summary(counts)} lists=[${kv.listCalls.join(",")}]`);
});

test("perf-budget: /start from a named user", async (t) => {
  const { kv, counts } = countingKv();
  kv.store.set("user:9102", NAMED_USER(9102));
  resetCounts(counts);
  const calls = await runText(kv, 9102, "/start");
  t.diagnostic(`/start: ${summary(counts)}`);
  assert.ok(calls.some((c) => c.url.endsWith("/sendMessage")), "/start must still answer");
  assert.ok(counts.total <= 9, `/start must stay within its DO budget, got ${summary(counts)}`);
});

// G1 regression: cachedDoGet must cache null settings. A second search
// from the same user on the same isolate must not re-read any of the
// null-fallback config keys (wod/alerts/ratelimit/lockdown/verifygate).
test("perf-budget: a second plain search re-reads no null-config keys", async (t) => {
  const { kv, counts } = countingKv();
  kv.store.set("user:9106", NAMED_USER(9106));
  await runText(kv, 9106, "ⲫⲱⲥ"); // warms the caches + the register cache
  resetCounts(counts);
  const calls = await runText(kv, 9106, "ⲫⲱⲥ");
  t.diagnostic(`second search: ${summary(counts)}`);
  assert.ok(calls.some((c) => c.url.endsWith("/sendVoice")), "the second search must still send its voice");
  for (const key of ["wod:config", "alerts:config", "ratelimit:max", "lockdown", "verifygate"]) {
    assert.equal(counts.byKey.get(key) ?? 0, 0, `${key} must be served from cache on a second search`);
  }
  assert.ok(counts.total <= 5, `second search must stay within its DO budget, got ${summary(counts)}`);
});

test("perf-budget: noop callback costs zero DO requests", async (t) => {
  const { kv, counts } = countingKv();
  kv.store.set("user:9103", NAMED_USER(9103));
  resetCounts(counts);
  await runCallback(kv, 9103, "noop");
  t.diagnostic(`noop callback: ${summary(counts)}`);
  assert.equal(counts.total, 0, `a noop callback must not touch the DO, got ${summary(counts)}`);
});

test("perf-budget: inline query", async (t) => {
  const { kv, counts } = countingKv();
  resetCounts(counts);
  await runInline(kv, 9104, "ⲫⲱⲥ");
  t.diagnostic(`inline query: ${summary(counts)}`);
  assert.ok(counts.total <= 5, `an inline query must stay within its DO budget, got ${summary(counts)}`);
});

test("perf-budget: first message from a brand-new user (register path)", async (t) => {
  const { kv, counts } = countingKv();
  resetCounts(counts);
  const calls = await runText(kv, 9105, "ⲫⲱⲥ");
  t.diagnostic(`new user: ${summary(counts)}`);
  assert.ok(calls.some((c) => c.url.endsWith("/sendMessage")), "a new user must still get the name prompt");
  assert.ok(counts.total <= 9, `a new user's first message must stay within its DO budget, got ${summary(counts)}`);
});
