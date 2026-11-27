import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore } from "../src/index.js";
import {
  ORAL_RECORD_BUTTON,
  lessonHasOral,
  findOralLesson,
  oralLessonTitle,
  oralLessonCount,
  validateOralVoice,
  getOralAttendance,
  markOralAttendance,
  listOralAttendance,
  oralPromptText,
  oralAcceptedText,
  oralRejectedText,
  ORAL_ALREADY_TEXT,
  oralOwnListText,
  oralAdminListText,
} from "../src/oral-attendance.js";

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
const STUDENT = 111222333;

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
    object,
    idFromName: (name) => name,
    get: () => ({
      fetch: (url, options) => object.fetch(new Request(url, options)),
    }),
  };
}

// Minimal storeCall over a plain Map (get/put/listprefix only).
function mapStoreCall() {
  const store = new Map();
  const call = async (payload) => {
    if (payload.op === "get") return { value: store.get(payload.key) ?? null };
    if (payload.op === "put") { store.set(payload.key, payload.value); return { ok: true }; }
    if (payload.op === "listprefix") {
      const entries = [...store].filter(([k]) => k.startsWith(payload.key ?? "")).slice(0, payload.limit ?? 100);
      return { entries: entries.map(([key, value]) => ({ key, value })) };
    }
    throw new Error(`unsupported op ${payload.op}`);
  };
  return { store, call };
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
  await worker.fetch(updateRequest({ message: { text, chat: { id: userId, type: "private" }, from: { id: userId, first_name: "Test" } } }), envWithKv);
  return calls;
}

async function sendVoice(envWithKv, userId, voice) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { voice, chat: { id: userId, type: "private" }, from: { id: userId, first_name: "Test" } } }), envWithKv);
  return calls;
}

const sent = (calls) => calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => c.payload);

function seedStudent(kv, { lastLessonId = "m_learn_l1_03" } = {}) {
  kv.store.set(`user:${STUDENT}`, { name: "Test Student", registeredAt: "2026-11-28T00:00:00.000Z", lastLessonId });
}

// --- pure validation -------------------------------------------------------

test("validateOralVoice accepts a plausible recording, rejects the rest", () => {
  assert.deepEqual(validateOralVoice({ duration: 5, file_size: 5000 }), { ok: true });
  assert.deepEqual(validateOralVoice({ duration: 2, file_size: 1500 }), { ok: true });
  assert.deepEqual(validateOralVoice({ duration: 60 }), { ok: true }); // no file_size: still ok
  assert.deepEqual(validateOralVoice(null), { ok: false, reason: "missing" });
  assert.deepEqual(validateOralVoice({}), { ok: false, reason: "missing" });
  assert.deepEqual(validateOralVoice({ duration: 1, file_size: 3000 }), { ok: false, reason: "short" });
  assert.deepEqual(validateOralVoice({ duration: 61, file_size: 9000 }), { ok: false, reason: "long" });
  assert.deepEqual(validateOralVoice({ duration: 5, file_size: 200 }), { ok: false, reason: "tiny" });
});

test("oral lessons: 15 of 27 have a ورقة شفوي (L1 intro + all L2 have none)", () => {
  assert.equal(oralLessonCount(), 15);
  assert.equal(lessonHasOral(findOralLesson("m_learn_l1_03")), true);
  assert.equal(lessonHasOral(findOralLesson("m_learn_l1_02")), false);
  assert.equal(lessonHasOral(findOralLesson("m_learn_l2_01")), false);
  assert.equal(findOralLesson("m_learn_l9_99"), null);
  assert.match(oralLessonTitle("m_learn_l1_03"), /الدرس الاول/);
});

test("oral texts mention the 3 words and the oral paper", () => {
  assert.match(oralPromptText("الدرس الاول"), /3 كلمات/);
  assert.match(oralPromptText("الدرس الاول"), /ورقة الشفوي/);
  assert.match(oralAcceptedText("الدرس الاول"), /تم تسجيل حضورك/);
  assert.match(oralRejectedText("short"), /قصير/);
  assert.match(oralRejectedText("long"), /طويل/);
  assert.match(oralRejectedText("tiny"), /مش واضح/);
  assert.equal(ORAL_ALREADY_TEXT, "انت سجلت الدرس ده خلاص");
});

// --- storage ---------------------------------------------------------------

test("mark/get/list: attendance is per user + lesson, duplicate is idempotent", async () => {
  const { call } = mapStoreCall();
  const first = await markOralAttendance(call, STUDENT, "m_learn_l1_03", "Test Student");
  assert.equal(first.already, false);
  assert.equal(first.record.lessons["m_learn_l1_03"] !== undefined, true);
  const again = await markOralAttendance(call, STUDENT, "m_learn_l1_03", "Test Student");
  assert.equal(again.already, true);
  const second = await markOralAttendance(call, STUDENT, "m_learn_l1_04", "Test Student");
  assert.equal(second.already, false);
  const record = await getOralAttendance(call, STUDENT);
  assert.equal(Object.keys(record.lessons).length, 2);
  const entries = await listOralAttendance(call);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, `oral:att:${STUDENT}`);
  assert.equal(await getOralAttendance(call, 999), null);
});

test("own/admin list texts: student sees their lessons, admin sees everyone", async () => {
  const { call } = mapStoreCall();
  assert.match(oralOwnListText(null), /لسه ما سجلتش/);
  await markOralAttendance(call, STUDENT, "m_learn_l1_03", "Test Student");
  assert.match(oralOwnListText(await getOralAttendance(call, STUDENT)), /1 من 15/);
  assert.match(oralOwnListText(await getOralAttendance(call, STUDENT)), /الدرس الاول/);
  assert.match(oralAdminListText([]), /مفيش أي حضور/);
  const text = oralAdminListText(await listOralAttendance(call));
  assert.match(text, /Test Student/);
  assert.match(text, new RegExp(String(STUDENT)));
  assert.match(text, /1 درس/);
});

// --- end to end through the webhook ----------------------------------------

test("record button → prompt → voice → accepted, then duplicate is refused", async () => {
  const kv = fakeKv();
  const kvEnv = { ...env, USERS: kv };
  seedStudent(kv);

  const tapCalls = await say(kvEnv, STUDENT, ORAL_RECORD_BUTTON);
  assert.match(sent(tapCalls).map((p) => p.text).join("\n"), /3 كلمات/);
  const waiting = kv.store.get(`user:${STUDENT}`);
  assert.equal(waiting.oralAwaiting, "m_learn_l1_03");

  const voiceCalls = await sendVoice(kvEnv, STUDENT, { file_id: "voice1", duration: 5, file_size: 5000 });
  assert.match(sent(voiceCalls).map((p) => p.text).join("\n"), /تم تسجيل حضورك/);
  const after = kv.store.get(`user:${STUDENT}`);
  assert.equal(after.oralAwaiting, undefined);
  const record = kv.store.get(`oral:att:${STUDENT}`);
  assert.equal(record.lessons["m_learn_l1_03"] !== undefined, true);
  // The recording itself is never stored: no file_id anywhere in the record.
  assert.equal(JSON.stringify(record).includes("voice1"), false);

  const dupCalls = await say(kvEnv, STUDENT, ORAL_RECORD_BUTTON);
  assert.match(sent(dupCalls).map((p) => p.text).join("\n"), /انت سجلت الدرس ده خلاص/);
  assert.equal(Object.keys(kv.store.get(`oral:att:${STUDENT}`).lessons).length, 1);
});

test("too-short voice is rejected and the wait stays open for a retry", async () => {
  const kv = fakeKv();
  const kvEnv = { ...env, USERS: kv };
  seedStudent(kv);
  await say(kvEnv, STUDENT, ORAL_RECORD_BUTTON);

  const shortCalls = await sendVoice(kvEnv, STUDENT, { file_id: "voice2", duration: 1, file_size: 3000 });
  assert.match(sent(shortCalls).map((p) => p.text).join("\n"), /قصير/);
  assert.equal(kv.store.get(`user:${STUDENT}`).oralAwaiting, "m_learn_l1_03");
  assert.equal(kv.store.get(`oral:att:${STUDENT}`), undefined);

  const goodCalls = await sendVoice(kvEnv, STUDENT, { file_id: "voice3", duration: 4, file_size: 4000 });
  assert.match(sent(goodCalls).map((p) => p.text).join("\n"), /تم تسجيل حضورك/);
});

test("record button on a lesson without an oral paper answers plainly", async () => {
  const kv = fakeKv();
  const kvEnv = { ...env, USERS: kv };
  seedStudent(kv, { lastLessonId: "m_learn_l1_02" });
  const calls = await say(kvEnv, STUDENT, ORAL_RECORD_BUTTON);
  assert.match(sent(calls).map((p) => p.text).join("\n"), /مفيهوش ورقة شفوي/);
  assert.equal(kv.store.get(`user:${STUDENT}`).oralAwaiting, undefined);
});

test("/cancel clears the oral wait", async () => {
  const kv = fakeKv();
  const kvEnv = { ...env, USERS: kv };
  seedStudent(kv);
  await say(kvEnv, STUDENT, ORAL_RECORD_BUTTON);
  assert.equal(kv.store.get(`user:${STUDENT}`).oralAwaiting, "m_learn_l1_03");
  const calls = await say(kvEnv, STUDENT, "/cancel");
  assert.match(sent(calls).map((p) => p.text).join("\n"), /تم إلغاء تسجيل الشفوي/);
  assert.equal(kv.store.get(`user:${STUDENT}`).oralAwaiting, undefined);
});

test("/attendance: student sees only their own list, admin sees everyone", async () => {
  const kv = fakeKv();
  const kvEnv = { ...env, USERS: kv };
  seedStudent(kv);
  await say(kvEnv, STUDENT, ORAL_RECORD_BUTTON);
  await sendVoice(kvEnv, STUDENT, { file_id: "voice4", duration: 6, file_size: 6000 });

  const mineCalls = await say(kvEnv, STUDENT, "/attendance");
  const mine = sent(mineCalls).map((p) => p.text).join("\n");
  assert.match(mine, /1 من 15/);
  assert.match(mine, /الدرس الاول/);

  const adminCalls = await say(kvEnv, ADMIN, "/attendance");
  const adminText = sent(adminCalls).map((p) => p.text).join("\n");
  assert.match(adminText, /Test Student/);
  assert.match(adminText, /1 درس/);
  assert.match(adminText, /الدرس الاول/);
});

test("/attendance for a student with no recordings says so", async () => {
  const kv = fakeKv();
  const kvEnv = { ...env, USERS: kv };
  seedStudent(kv);
  const calls = await say(kvEnv, STUDENT, "/attendance");
  assert.match(sent(calls).map((p) => p.text).join("\n"), /لسه ما سجلتش/);
});

// --- oral vs dictionary-word recording: the two voice flows must never
// share one incoming voice message (live bug 2026-11-28: an admin mid
// /record session tapped "سجّل الشفوي" and the voice was swallowed by
// /record, replying "تم حفظ تسجيل الكلمة") -------------------------------

function seedAdmin(kv, extra = {}) {
  kv.store.set(`user:${ADMIN}`, { name: "Admin Test", registeredAt: "2026-11-28T00:00:00.000Z", lastLessonId: "m_learn_l1_03", ...extra });
}

test("oral wait wins over a stale /record session: the voice marks attendance, not a word", async () => {
  const kv = fakeKv();
  const kvEnv = { ...env, USERS: kv };
  seedAdmin(kv, { voiceRec: { id: 25318, mode: "sequential" } });

  const tapCalls = await say(kvEnv, ADMIN, ORAL_RECORD_BUTTON);
  assert.match(sent(tapCalls).map((p) => p.text).join("\n"), /3 كلمات/);
  const waiting = kv.store.get(`user:${ADMIN}`);
  assert.equal(waiting.oralAwaiting, "m_learn_l1_03");
  // Tapping the oral button cancels the pending word-recording session.
  assert.equal(waiting.voiceRec, undefined);
  assert.equal(waiting.voicePick, undefined);

  const voiceCalls = await sendVoice(kvEnv, ADMIN, { file_id: "voice-oral", duration: 5, file_size: 5000 });
  const texts = sent(voiceCalls).map((p) => p.text).join("\n");
  assert.match(texts, /تم تسجيل حضورك/);
  assert.doesNotMatch(texts, /تم حفظ تسجيل/);
  assert.equal(kv.store.get(`oral:att:${ADMIN}`).lessons["m_learn_l1_03"] !== undefined, true);
  assert.equal(JSON.stringify(kv.store.get(`oral:att:${ADMIN}`)).includes("voice-oral"), false);
});

test("a stale oral wait does not steal a dictionary-word recording", async () => {
  const kv = fakeKv();
  const kvEnv = { ...env, USERS: kv };
  // Admin left an oral wait open, then starts /record: the oral wait ends.
  seedAdmin(kv, { oralAwaiting: "m_learn_l1_03" });
  await say(kvEnv, ADMIN, "/record");
  assert.equal(kv.store.get(`user:${ADMIN}`).oralAwaiting, undefined);
});

test("/uploadaudio cancels a stale oral wait", async () => {
  const kv = fakeKv();
  const kvEnv = { ...env, USERS: kv };
  seedAdmin(kv, { oralAwaiting: "m_learn_l1_03" });
  await say(kvEnv, ADMIN, "/uploadaudio testword");
  const after = kv.store.get(`user:${ADMIN}`);
  assert.equal(after.oralAwaiting, undefined);
  assert.equal(after.adminFlow?.kind, "uploadaudio");
});
