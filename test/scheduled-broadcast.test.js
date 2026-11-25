import test from "node:test";
import assert from "node:assert/strict";
import worker, { UserStore, parseScheduleTime, formatCairoDateTime } from "../src/index.js";

// Fixed "now": 2026-11-25 18:00 UTC = 20:00 Cairo (EET, UTC+2, no DST in Nov).
const NOW = Date.UTC(2026, 10, 25, 18, 0, 0);

test("parseScheduleTime: relative forms (Arabic + Western digits)", () => {
  assert.equal(parseScheduleTime("بعد ساعتين", NOW).ms, NOW + 2 * 60 * 60 * 1000);
  assert.equal(parseScheduleTime("بعد ساعة", NOW).ms, NOW + 60 * 60 * 1000);
  assert.equal(parseScheduleTime("بعد 30 دقيقة", NOW).ms, NOW + 30 * 60 * 1000);
  assert.equal(parseScheduleTime("بعد ٣٠ دقيقة", NOW).ms, NOW + 30 * 60 * 1000);
  assert.equal(parseScheduleTime("بعد 3 أيام", NOW).ms, NOW + 3 * 24 * 60 * 60 * 1000);
  assert.equal(parseScheduleTime("بعد يومين", NOW).ms, NOW + 2 * 24 * 60 * 60 * 1000);
  assert.equal(parseScheduleTime("بعد أسبوع", NOW).ms, NOW + 7 * 24 * 60 * 60 * 1000);
  assert.equal(parseScheduleTime("بعد 5 دقائق", NOW).ms, NOW + 5 * 60 * 1000);
});

test("parseScheduleTime: absolute Cairo times", () => {
  // 26/11 08:00 Cairo = 06:00 UTC.
  assert.equal(parseScheduleTime("26/11 08:00", NOW).ms, Date.UTC(2026, 10, 26, 6, 0));
  assert.equal(parseScheduleTime("26/11/2026 08:00", NOW).ms, Date.UTC(2026, 10, 26, 6, 0));
  // بكرة 08:00 Cairo = 26 Nov 06:00 UTC (NOW is 25 Nov 20:00 Cairo).
  assert.equal(parseScheduleTime("بكرة 08:00", NOW).ms, Date.UTC(2026, 10, 26, 6, 0));
  // النهاردة 21:00 Cairo = 19:00 UTC today.
  assert.equal(parseScheduleTime("النهاردة 21:00", NOW).ms, Date.UTC(2026, 10, 25, 19, 0));
  // Round-trip through the formatter.
  assert.equal(formatCairoDateTime(Date.UTC(2026, 10, 26, 6, 0)), "26/11/2026 08:00");
});

test("parseScheduleTime: rejects garbage, past times and far-future times", () => {
  assert.equal(parseScheduleTime("بعد شوية", NOW).ok, false);
  assert.equal(parseScheduleTime("أمس", NOW).ok, false);
  assert.equal(parseScheduleTime("26/11 25:00", NOW).ok, false);
  assert.equal(parseScheduleTime("النهاردة 20:00", NOW).ok, false, "exactly now is not >1 min ahead");
  assert.equal(parseScheduleTime("النهاردة 19:00", NOW).ok, false, "past time today");
  assert.equal(parseScheduleTime("26/11/2030 08:00", NOW).ok, false, "over a year out");
  assert.equal(parseScheduleTime("", NOW).ok, false);
});

// --- DO alarm-loop behaviour: a minimal fake DO, same shape as poller.test.js ---
const env = { TELEGRAM_BOT_TOKEN: "tok", WEBHOOK_SECRET: "test-secret-should-be-long-enough", VOICE_CAPTION: "on" };
function fakeKv() {
  const store = new Map();
  const alarms = [];
  const storage = {
    get: async (key) => store.get(key),
    put: async (key, value) => { store.set(key, value); },
    delete: async (key) => { store.delete(key); },
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
const ADMIN_CHAT = 813894692;
const dueJob = (overrides = {}) => ({
  id: "abc123", sendAt: NOW - 1000, fromChat: ADMIN_CHAT, messageId: 555,
  poll: null, adminChat: ADMIN_CHAT, label: "رسالة تجريبية", createdAt: NOW - 60000, ...overrides,
});

test.beforeEach(() => {
  globalThis.fetch = async () => Response.json({ ok: true, result: { message_id: 1 } });
});

test("broadcastStep starts a due scheduled broadcast and removes it from the queue", async () => {
  const kv = fakeKv();
  kv.store.set("user:101", { name: "u101" });
  kv.store.set("user:102", { name: "u102" });
  kv.store.set("user:103", { name: "u103" });
  kv.store.set("broadcast:scheduled", [dueJob()]);
  const delay = await kv.object.broadcastStep();
  assert.equal(delay, 100, "next alarm sends the first batch");
  const job = kv.store.get("broadcast");
  assert.ok(job, "broadcast job created");
  assert.equal(job.total, 3);
  assert.deepEqual([...job.queue].sort(), ["101", "102", "103"]);
  assert.equal(job.fromChat, ADMIN_CHAT);
  assert.equal(job.messageId, 555);
  assert.deepEqual(kv.store.get("broadcast:scheduled"), [], "started job leaves the queue");
});

test("broadcastStep waits for a not-yet-due job and reports the delay until it is due", async () => {
  const kv = fakeKv();
  kv.store.set("user:101", { name: "u101" });
  kv.store.set("broadcast:scheduled", [dueJob({ id: "later1", sendAt: Date.now() + 3600_000 })]);
  const before = Date.now();
  const delay = await kv.object.broadcastStep();
  assert.ok(delay >= 3600_000 - (Date.now() - before) - 1000 && delay <= 3600_000, `delay ~1h, got ${delay}ms`);
  assert.equal(kv.store.get("broadcast"), undefined, "nothing started early");
  assert.equal(kv.store.get("broadcast:scheduled").length, 1, "job stays queued");
});

test("a due scheduled broadcast waits while another broadcast is running (queue-after-current)", async () => {
  const kv = fakeKv();
  kv.store.set("user:101", { name: "u101" });
  // Active job parked on its next batch (nextAt in the future): the step
  // returns the retry delay without touching the scheduled queue.
  kv.store.set("broadcast", { queue: ["101"], total: 1, sent: 0, failed: 0, nextAt: Date.now() + 60000, fromChat: ADMIN_CHAT, messageId: 1, adminChat: ADMIN_CHAT });
  kv.store.set("broadcast:scheduled", [dueJob()]);
  const delay = await kv.object.broadcastStep();
  assert.ok(delay > 0 && delay <= 60000, `retry delay, got ${delay}ms`);
  assert.equal(kv.store.get("broadcast:scheduled").length, 1, "due job stays queued behind the running broadcast");
  assert.equal(kv.store.get("broadcast").messageId, 1, "running job untouched");
});

test("due jobs start earliest-first (FIFO by sendAt)", async () => {
  const kv = fakeKv();
  kv.store.set("user:101", { name: "u101" });
  kv.store.set("broadcast:scheduled", [
    dueJob({ id: "second", sendAt: NOW - 500, messageId: 556, label: "الثانية" }),
    dueJob({ id: "first", sendAt: NOW - 5000, messageId: 554, label: "الأولى" }),
  ]);
  await kv.object.broadcastStep();
  assert.equal(kv.store.get("broadcast").messageId, 554, "earliest sendAt starts first");
  assert.deepEqual(kv.store.get("broadcast:scheduled").map((j) => j.id), ["second"]);
});

test("a due job with no recipients is dropped and the admin is told", async () => {
  const kv = fakeKv();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push(JSON.parse(String(options.body)));
    return Response.json({ ok: true, result: { message_id: 1 } });
  };
  kv.store.set("broadcast:scheduled", [dueJob()]);
  const delay = await kv.object.broadcastStep();
  assert.equal(delay, null, "nothing to send, no wake needed");
  assert.equal(kv.store.get("broadcast"), undefined);
  assert.deepEqual(kv.store.get("broadcast:scheduled"), [], "job dropped, not retried forever");
  assert.ok(calls.some((b) => String(b.text ?? "").includes("لا يوجد مستخدمون")), "admin notified");
});
