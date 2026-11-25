// ❤️ reaction on the user's message when a lesson or a learning-video
// button is tapped (user 2026-11-25 — same heart as the word cards).
// A lesson tap sends the whole lesson first (video step via sendVideo),
// then reacts ❤️ on the USER's tap message; the Previous/Next nav tap
// reacts on its own message too. A video button in the m_video menu
// reacts the same way. A lesson that is not ready yet, or a plain text
// button, sends its reply with no reaction.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore } from "../src/index.js";

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
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
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
const reactionCalls = (calls) => calls.filter((call) => call.url.endsWith("/setMessageReaction"));
const heartReaction = (calls, chatId, messageId) => reactionCalls(calls).find((call) =>
  call.payload?.chat_id === chatId &&
  call.payload?.message_id === messageId &&
  Array.isArray(call.payload?.reaction) &&
  call.payload.reaction.some((r) => r?.type === "emoji" && r?.emoji === "❤️"));
const LESSON_LABEL = "فيديو تعريفي عن اللغة القبطية";
function seedLevelMenu(kvEnv) {
  kvEnv.USERS.store.set("menus:v1", { menus: [
    { id: "m_learn_l1", title: "المستوى الأول", text: "المستوى الأول", parentId: null, buttons: [{ id: "b1", label: LESSON_LABEL, kind: "lesson", lessonId: "m_learn_l1_01" }] },
  ] });
}

test("lesson reaction: tapping a lesson sends the video, then reacts ❤️ on the tap", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 66, "مينا", { menuNav: "m_learn_l1" });
  seedLevelMenu(kvEnv);
  seedImportState(kvEnv, { "m_learn_l1_01:video": "test-lesson-video" });
  const calls = await say(kvEnv, 66, LESSON_LABEL, 101);
  const videoIndex = calls.findIndex((call) => call.url.endsWith("/sendVideo") && call.payload?.video === "test-lesson-video");
  assert.ok(videoIndex >= 0, "the lesson video is sent");
  const reactionIndex = calls.findIndex((call) => call.url.endsWith("/setMessageReaction"));
  assert.ok(reactionIndex > videoIndex, "the reaction is sent after the video");
  assert.ok(heartReaction(calls, 66, 101), "the ❤️ targets the user's lesson tap 101");
});

test("lesson reaction: tapping Next sends the sibling lesson, then reacts ❤️ on the nav tap", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 67, "مينا", { menuNav: "m_learn_l1", lastLessonId: "m_learn_l1_01" });
  seedLevelMenu(kvEnv);
  seedImportState(kvEnv, { "m_learn_l1_01:video": "test-lesson-video", "m_learn_l1_02:video": "test-next-video" });
  const calls = await say(kvEnv, 67, "التالي ⏭", 202);
  const videoIndex = calls.findIndex((call) => call.url.endsWith("/sendVideo") && call.payload?.video === "test-next-video");
  assert.ok(videoIndex >= 0, "the next lesson video is sent");
  const reactionIndex = calls.findIndex((call) => call.url.endsWith("/setMessageReaction"));
  assert.ok(reactionIndex > videoIndex, "the reaction is sent after the video");
  assert.ok(heartReaction(calls, 67, 202), "the ❤️ targets the user's Next tap 202");
});

test("lesson reaction: a video button in the m_video menu reacts ❤️ on the tap", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 68, "مينا", { menuNav: "m_video" });
  kvEnv.USERS.store.set("menus:v1", { menus: [
    { id: "m_video", title: "فيديوهات التعلم", text: "فيديوهات التعلم", parentId: null, buttons: [{ id: "vb1", label: "🎬 فيديو تجريبي", kind: "video", fileId: "test-mvideo-file", text: "" }] },
  ] });
  const calls = await say(kvEnv, 68, "🎬 فيديو تجريبي", 303);
  const videoIndex = calls.findIndex((call) => call.url.endsWith("/sendVideo") && call.payload?.video === "test-mvideo-file");
  assert.ok(videoIndex >= 0, "the menu video is sent");
  const reactionIndex = calls.findIndex((call) => call.url.endsWith("/setMessageReaction"));
  assert.ok(reactionIndex > videoIndex, "the reaction is sent after the video");
  assert.ok(heartReaction(calls, 68, 303), "the ❤️ targets the user's video tap 303");
});

test("lesson reaction: no reaction when the lesson is not ready yet", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 69, "مينا", { menuNav: "m_learn_l1" });
  seedLevelMenu(kvEnv);
  // No import state: the video item has no file_id, so the lesson is not ready.
  const calls = await say(kvEnv, 69, LESSON_LABEL, 404);
  assert.ok(calls.some((call) => call.url.endsWith("/sendMessage") && String(call.payload?.text ?? "").includes("ليس جاهزًا بعد")), "the not-ready reply is sent");
  assert.equal(reactionCalls(calls).length, 0, "no reaction when the lesson did not send");
});

test("lesson reaction: a plain text button sends its text with no reaction", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 70, "مينا", { menuNav: "m_learn_l1" });
  kvEnv.USERS.store.set("menus:v1", { menus: [
    { id: "m_learn_l1", title: "المستوى الأول", text: "المستوى الأول", parentId: null, buttons: [{ id: "tb1", label: "نص تجريبي", kind: "text", text: "أهلاً بك" }] },
  ] });
  const calls = await say(kvEnv, 70, "نص تجريبي", 505);
  assert.ok(calls.some((call) => call.url.endsWith("/sendMessage") && String(call.payload?.text ?? "").includes("أهلاً بك")), "the button text is sent");
  assert.equal(reactionCalls(calls).length, 0, "no reaction on a plain text button");
});
