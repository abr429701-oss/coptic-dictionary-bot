// Lesson display restructure (user 2026-11-28): tapping a lesson sends
// ONLY the video; the oral paper, the exam link, the L2 summary photo
// and the L2 exercise text arrive on demand from the "🗣 الشفوي" /
// "📝 الامتحان الإلكتروني" / "🖼 ملخص الدرس" / "📝 التدريب"
// reply-keyboard buttons. The lesson-list keyboard stays visible, and
// the admin-only "🎙 سجّل الشفوي" record button is untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore } from "../src/index.js";
import { ORAL_RECORD_BUTTON } from "../src/oral-attendance.js";

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
const env = { TELEGRAM_BOT_TOKEN: "test" + "-token", WEBHOOK_SECRET: secret, ASSETS: fakeAssets };
const ADMIN = 813894692;
const STUDENT = 66;

function fakeTelegramApi(calls) {
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body;
    const payload = !body ? null : typeof body === "string" ? JSON.parse(body) : Object.fromEntries(body.entries());
    calls.push({ url: String(url), options, payload });
    return Response.json({ ok: true, result: { message_id: 900 } });
  };
}
function updateRequest(update) {
  return new Request("https://bot.test/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
    },
    body: JSON.stringify(update),
  });
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
async function say(envWithKv, userId, text, messageId) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { message_id: messageId, text, chat: { id: userId, type: "private" }, from: { id: userId, first_name: "Tester" } } }), envWithKv);
  return calls;
}
const nowIso = () => new Date().toISOString();
function seedUser(kvEnv, id, name, extra = {}) {
  kvEnv.USERS.store.set(`user:${id}`, { name, registeredAt: nowIso(), firstSeen: nowIso(), lastSeen: nowIso(), ...extra });
}
function seedImportState(kvEnv, doneKeys) {
  const items = {};
  for (const [key, fileId] of Object.entries(doneKeys)) {
    items[key] = { status: "done", fileId, fileUniqueId: `u-${key}`, driveId: `drive-${key}`, error: "", at: nowIso() };
  }
  kvEnv.USERS.store.set("learn-import:v1", { version: 1, stateVersion: 2, startedAt: null, updatedAt: nowIso(), items, manifestHash: "", importRunningSince: "" });
}
function seedMenu(kvEnv, menuId, buttons) {
  kvEnv.USERS.store.set("menus:v1", { menus: [{ id: menuId, title: menuId, text: menuId, parentId: null, buttons }] });
}

const L1_03_LABEL = "الدرس الاول"; // m_learn_l1_03: video + oral + exam
const L1_03_EXAM = "1Gts_xgdk3-g7elOTmSXtpouZMvFVLwdQ4fleO3usLYg";
const L1_02_LABEL = "مقدمة عن حروف اللغة القبطية"; // m_learn_l1_02: video only
const L2_03_LABEL = "الدرس الثالث"; // m_learn_l2_03: video + summary + exam, no oral
const L2_03_EXAM = "1hU9u45-62silHgZiehAneS0W7Ud6v-kpdEn9KkYYG78";
const L2_02_LABEL = "الدرس الثاني"; // m_learn_l2_02: video + summary + exercise, no exam
const L2_06_LABEL = "الدرس السادس"; // m_learn_l2_06: video + summary + exercise + exam
const L2_06_EXAM = "1ZABUJwB07YtSWAWwpbMFWKfAc8krqlomf3bP-MNFDyY";

function seedL2(kvEnv, userId, lessonId, label, doneKeys) {
  seedUser(kvEnv, userId, "Tester", { menuNav: "m_learn_l2" });
  seedMenu(kvEnv, "m_learn_l2", [{ id: `b-${lessonId}`, label, kind: "lesson", lessonId }]);
  seedImportState(kvEnv, doneKeys);
}

const videos = (calls) => calls.filter((c) => c.url.endsWith("/sendVideo"));
const photos = (calls) => calls.filter((c) => c.url.endsWith("/sendPhoto"));
const messages = (calls) => calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => c.payload);
const keyboardRows = (call) => call.payload?.reply_markup?.keyboard ?? [];
const keyboardHas = (call, label) => keyboardRows(call).some((row) => row.some((b) => b.text === label));
const keyboardHasRow = (call, ...labels) => keyboardRows(call).some((row) => labels.every((l) => row.some((b) => b.text === l)));

function seedL1(kvEnv, userId, extra = {}) {
  seedUser(kvEnv, userId, "Tester", { menuNav: "m_learn_l1", ...extra });
  seedMenu(kvEnv, "m_learn_l1", [
    { id: "b-l1-03", label: L1_03_LABEL, kind: "lesson", lessonId: "m_learn_l1_03" },
    { id: "b-l1-02", label: L1_02_LABEL, kind: "lesson", lessonId: "m_learn_l1_02" },
  ]);
  seedImportState(kvEnv, { "m_learn_l1_03:video": "vid-l1-03", "m_learn_l1_03:oral": "photo-l1-03-oral", "m_learn_l1_02:video": "vid-l1-02" });
}

test("lesson tap sends ONLY the video; keyboard has both item buttons, no record button for a student", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedL1(kvEnv, STUDENT);
  const calls = await say(kvEnv, STUDENT, L1_03_LABEL, 101);
  assert.equal(videos(calls).length, 1, "exactly one video is sent");
  assert.equal(videos(calls)[0].payload?.video, "vid-l1-03");
  assert.equal(photos(calls).length, 0, "the oral photo is NOT auto-sent");
  assert.ok(!messages(calls).some((m) => String(m.text ?? "").includes("docs.google.com/forms")), "the exam link is NOT auto-sent");
  const videoCall = videos(calls)[0];
  assert.ok(keyboardHasRow(videoCall, "🗣 الشفوي", "📝 الامتحان الإلكتروني"), "both item buttons are on the keyboard");
  assert.ok(!keyboardHas(videoCall, ORAL_RECORD_BUTTON), "the admin-only record button stays hidden from students");
  assert.ok(keyboardHas(videoCall, L1_03_LABEL), "the lesson list stays visible");
});

test("oral button sends the lesson's oral photo with the lesson keyboard", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedL1(kvEnv, STUDENT);
  await say(kvEnv, STUDENT, L1_03_LABEL, 101);
  const calls = await say(kvEnv, STUDENT, "🗣 الشفوي", 102);
  assert.equal(photos(calls).length, 1, "the oral photo is sent on demand");
  assert.equal(photos(calls)[0].payload?.photo, "photo-l1-03-oral");
  assert.equal(photos(calls)[0].payload?.caption, L1_03_LABEL);
  assert.ok(keyboardHas(photos(calls)[0], L1_03_LABEL), "the lesson keyboard is re-attached");
  assert.ok(keyboardHas(photos(calls)[0], "📝 الامتحان الإلكتروني"), "the exam button stays on the keyboard");
});

test("exam button sends the lesson's exam link with no preview", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedL1(kvEnv, STUDENT);
  await say(kvEnv, STUDENT, L1_03_LABEL, 101);
  const calls = await say(kvEnv, STUDENT, "📝 الامتحان الإلكتروني", 102);
  const exam = messages(calls).find((m) => String(m.text ?? "").includes(L1_03_EXAM));
  assert.ok(exam, "the exam link is sent on demand");
  assert.ok(String(exam.text).startsWith("📝 الامتحان الإلكتروني:"), "the exam message keeps the manifest label");
  assert.equal(exam.disable_web_page_preview, true, "no link preview");
  const examCall = calls.find((c) => c.url.endsWith("/sendMessage") && String(c.payload?.text ?? "").includes(L1_03_EXAM));
  assert.ok(keyboardHas(examCall, "🗣 الشفوي"), "the lesson keyboard is re-attached");
});

test("lesson without oral or exam shows neither button", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedL1(kvEnv, STUDENT);
  const calls = await say(kvEnv, STUDENT, L1_02_LABEL, 101);
  assert.equal(videos(calls).length, 1, "the video is still sent");
  const videoCall = videos(calls)[0];
  assert.ok(!keyboardHas(videoCall, "🗣 الشفوي"), "no oral button without an oral item");
  assert.ok(!keyboardHas(videoCall, "📝 الامتحان الإلكتروني"), "no exam button without an exam item");
});

test("L2 lesson: exam button appears, oral button does not; summary is not auto-sent", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, STUDENT, "Tester", { menuNav: "m_learn_l2" });
  seedMenu(kvEnv, "m_learn_l2", [{ id: "b-l2-03", label: L2_03_LABEL, kind: "lesson", lessonId: "m_learn_l2_03" }]);
  seedImportState(kvEnv, { "m_learn_l2_03:video": "vid-l2-03", "m_learn_l2_03:summary": "photo-l2-03-summary" });
  const calls = await say(kvEnv, STUDENT, L2_03_LABEL, 101);
  assert.equal(videos(calls).length, 1, "only the video is sent");
  assert.equal(photos(calls).length, 0, "the summary photo is NOT auto-sent with the video");
  const videoCall = videos(calls)[0];
  assert.ok(keyboardHas(videoCall, "📝 الامتحان الإلكتروني"), "the exam button appears where an exam item exists");
  assert.ok(!keyboardHas(videoCall, "🗣 الشفوي"), "no oral button in L2 (no oral items there)");
  const examCalls = await say(kvEnv, STUDENT, "📝 الامتحان الإلكتروني", 102);
  assert.ok(messages(examCalls).some((m) => String(m.text ?? "").includes(L2_03_EXAM)), "the L2 exam link is sent on demand");
});

test("item buttons on a lesson without that item answer plainly", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedL1(kvEnv, STUDENT, { lastLessonId: "m_learn_l1_02" });
  const oralCalls = await say(kvEnv, STUDENT, "🗣 الشفوي", 101);
  assert.ok(messages(oralCalls).some((m) => String(m.text ?? "").includes("مفيهوش ورقة شفوي")), "no oral item → plain reply");
  assert.equal(photos(oralCalls).length, 0, "no photo is sent");
  const examCalls = await say(kvEnv, STUDENT, "📝 الامتحان الإلكتروني", 102);
  assert.ok(messages(examCalls).some((m) => String(m.text ?? "").includes("مفيهوش امتحان إلكتروني")), "no exam item → plain reply");
});

test("oral button when the photo is not imported answers plainly", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, STUDENT, "Tester", { menuNav: "m_learn_l1", lastLessonId: "m_learn_l1_03" });
  seedMenu(kvEnv, "m_learn_l1", [{ id: "b-l1-03", label: L1_03_LABEL, kind: "lesson", lessonId: "m_learn_l1_03" }]);
  seedImportState(kvEnv, { "m_learn_l1_03:video": "vid-l1-03" }); // oral not imported
  const calls = await say(kvEnv, STUDENT, "🗣 الشفوي", 101);
  assert.ok(messages(calls).some((m) => String(m.text ?? "").includes("لسه مش جاهزة")), "unready oral photo → plain reply");
  assert.equal(photos(calls).length, 0, "no photo is sent");
});

test("admin still sees the record button and the record flow still works", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedL1(kvEnv, ADMIN);
  const calls = await say(kvEnv, ADMIN, L1_03_LABEL, 101);
  const videoCall = videos(calls)[0];
  assert.ok(keyboardHas(videoCall, ORAL_RECORD_BUTTON), "the admin sees the record button");
  assert.ok(keyboardHasRow(videoCall, "🗣 الشفوي", "📝 الامتحان الإلكتروني"), "the admin also sees both item buttons");
  const recordCalls = await say(kvEnv, ADMIN, ORAL_RECORD_BUTTON, 102);
  assert.match(messages(recordCalls).map((m) => m.text).join("\n"), /3 كلمات/, "the record flow still opens");
  assert.equal(kvEnv.USERS.store.get(`user:${ADMIN}`).oralAwaiting, "m_learn_l1_03");
});

test("L2 lesson tap: video only; keyboard has summary + exercise, no oral, no exam", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedL2(kvEnv, STUDENT, "m_learn_l2_02", L2_02_LABEL, { "m_learn_l2_02:video": "vid-l2-02", "m_learn_l2_02:summary": "photo-l2-02-summary" });
  const calls = await say(kvEnv, STUDENT, L2_02_LABEL, 101);
  assert.equal(videos(calls).length, 1, "only the video is sent");
  assert.equal(photos(calls).length, 0, "the summary photo is NOT auto-sent");
  assert.ok(!messages(calls).some((m) => String(m.text ?? "").includes("التدريب الأول")), "the exercise text is NOT auto-sent");
  const videoCall = videos(calls)[0];
  assert.ok(keyboardHasRow(videoCall, "🖼 ملخص الدرس", "📝 التدريب"), "both new buttons are on the keyboard");
  assert.ok(!keyboardHas(videoCall, "🗣 الشفوي"), "no oral button in L2");
  assert.ok(!keyboardHas(videoCall, "📝 الامتحان الإلكتروني"), "no exam button without an exam item");
});

test("summary button sends the lesson's summary photo with the lesson keyboard", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedL2(kvEnv, STUDENT, "m_learn_l2_02", L2_02_LABEL, { "m_learn_l2_02:video": "vid-l2-02", "m_learn_l2_02:summary": "photo-l2-02-summary" });
  await say(kvEnv, STUDENT, L2_02_LABEL, 101);
  const calls = await say(kvEnv, STUDENT, "🖼 ملخص الدرس", 102);
  assert.equal(photos(calls).length, 1, "the summary photo is sent on demand");
  assert.equal(photos(calls)[0].payload?.photo, "photo-l2-02-summary");
  assert.equal(photos(calls)[0].payload?.caption, L2_02_LABEL);
  assert.ok(keyboardHas(photos(calls)[0], L2_02_LABEL), "the lesson keyboard is re-attached");
  assert.ok(keyboardHas(photos(calls)[0], "📝 التدريب"), "the exercise button stays on the keyboard");
});

test("exercise button sends the lesson's exercise text", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedL2(kvEnv, STUDENT, "m_learn_l2_02", L2_02_LABEL, { "m_learn_l2_02:video": "vid-l2-02", "m_learn_l2_02:summary": "photo-l2-02-summary" });
  await say(kvEnv, STUDENT, L2_02_LABEL, 101);
  const calls = await say(kvEnv, STUDENT, "📝 التدريب", 102);
  const exercise = messages(calls).find((m) => String(m.text ?? "").includes("التدريب الأول على الدرس الأول والثاني"));
  assert.ok(exercise, "the exercise text is sent on demand");
  assert.ok(!String(exercise.text).includes("docs.google.com/forms"), "the exercise is not the exam link");
  const exerciseCall = calls.find((c) => c.url.endsWith("/sendMessage") && String(c.payload?.text ?? "").includes("التدريب الأول"));
  assert.ok(keyboardHas(exerciseCall, "🖼 ملخص الدرس"), "the lesson keyboard is re-attached");
});

test("summary/exercise buttons on a lesson without them answer plainly", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedL1(kvEnv, STUDENT, { lastLessonId: "m_learn_l1_02" });
  const summaryCalls = await say(kvEnv, STUDENT, "🖼 ملخص الدرس", 101);
  assert.ok(messages(summaryCalls).some((m) => String(m.text ?? "").includes("مفيهوش ملخص")), "no summary item → plain reply");
  assert.equal(photos(summaryCalls).length, 0, "no photo is sent");
  const exerciseCalls = await say(kvEnv, STUDENT, "📝 التدريب", 102);
  assert.ok(messages(exerciseCalls).some((m) => String(m.text ?? "").includes("مفيهوش تدريب")), "no exercise item → plain reply");
});

test("summary button when the photo is not imported answers plainly", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, STUDENT, "Tester", { menuNav: "m_learn_l2", lastLessonId: "m_learn_l2_02" });
  seedMenu(kvEnv, "m_learn_l2", [{ id: "b-l2-02", label: L2_02_LABEL, kind: "lesson", lessonId: "m_learn_l2_02" }]);
  seedImportState(kvEnv, { "m_learn_l2_02:video": "vid-l2-02" }); // summary not imported
  const calls = await say(kvEnv, STUDENT, "🖼 ملخص الدرس", 101);
  assert.ok(messages(calls).some((m) => String(m.text ?? "").includes("لسه مش جاهز")), "unready summary photo → plain reply");
  assert.equal(photos(calls).length, 0, "no photo is sent");
});

test("exercise and exam labels never confuse each other (lesson with both)", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedL2(kvEnv, STUDENT, "m_learn_l2_06", L2_06_LABEL, { "m_learn_l2_06:video": "vid-l2-06", "m_learn_l2_06:summary": "photo-l2-06-summary" });
  await say(kvEnv, STUDENT, L2_06_LABEL, 101);
  const exerciseCalls = await say(kvEnv, STUDENT, "📝 التدريب", 102);
  assert.ok(messages(exerciseCalls).some((m) => String(m.text ?? "").includes("التدريب الثالث على الدرس الخامس والسادس")), "exercise button sends the exercise text");
  assert.ok(!messages(exerciseCalls).some((m) => String(m.text ?? "").includes(L2_06_EXAM)), "exercise button does NOT send the exam link");
  const examCalls = await say(kvEnv, STUDENT, "📝 الامتحان الإلكتروني", 103);
  assert.ok(messages(examCalls).some((m) => String(m.text ?? "").includes(L2_06_EXAM)), "exam button sends the exam link");
  assert.ok(!messages(examCalls).some((m) => String(m.text ?? "").includes("التدريب الثالث")), "exam button does NOT send the exercise text");
});
