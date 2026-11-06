import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore } from "../src/index.js";
import { MENUS_KEY, VIDEO_MENU_ID, normalizeMenus } from "../src/menu-builder.js";
import { LEARN_LEVELS, LEARN_MANIFEST_VERSION } from "../src/learn-manifest.js";
import {
  LEARN_IMPORT_KEY,
  LEARN_BATCH_SIZE,
  learnUploadItems,
  learnItemKey,
  learnButtonId,
  learnLessonButtonId,
  emptyImportState,
  normalizeImportState,
  importProgress,
  nextImportBatch,
  buildLearnMenus,
  mergeMenus,
  downloadDriveFile,
  uploadLearnFile,
  parseImportLearnArg,
  learnProgressText,
  driveDownloadUrl,
} from "../src/learn-import.js";

// ---------------------------------------------------------------------------
// Bulk "learn" lessons importer (2026-11-06).
//
// Frozen manifest (27 lessons from the learn tab) -> Drive download once ->
// Telegram upload once (file_id stored) -> level/lesson menus. A button is
// never created without a valid file_id; one /importlearn run processes a
// small batch and the admin re-runs it until done.
// ---------------------------------------------------------------------------

const token = "test-token";
const secret = "test-secret-should-be-long-enough";
const testRoot = fileURLToPath(new URL("..", import.meta.url));
const fakeAssets = {
  fetch: async (url) => {
    const pathname = new URL(url).pathname;
    if (!pathname.startsWith("/search-index/")) return new Response("Not found", { status: 404 });
    try {
      return new Response(readFileSync(resolve(testRoot, "public", pathname.slice(1))), { headers: { "content-type": "application/json" } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
};
const env = { TELEGRAM_BOT_TOKEN: token, WEBHOOK_SECRET: secret, ASSETS: fakeAssets, VOICE_CAPTION: "off" };
const ADMIN = 813894692;

// Fetch stub: Drive downloads return fake bytes; Telegram uploads return
// fake file_ids and record every call. `failDriveIds` makes selected Drive
// downloads fail (HTML error page) to test failure + retry.
function makeFetchStub(calls, failDriveIds = new Set()) {
  const driveKind = new Map(learnUploadItems().map((item) => [item.driveId, item.kind]));
  let n = 0;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.includes("drive.usercontent.google.com")) {
      const id = new URL(u).searchParams.get("id");
      if (failDriveIds.has(id)) {
        return new Response("<html>error</html>", { status: 404, headers: { "content-type": "text/html" } });
      }
      const kind = driveKind.get(id) ?? "video";
      calls.push({ url: u, kind: "drive", driveId: id });
      return new Response(new Uint8Array([1, 2, 3, 4]).buffer, {
        status: 200,
        headers: { "content-type": kind === "video" ? "video/mp4" : "image/jpeg" },
      });
    }
    if (u.includes("api.telegram.org")) {
      const method = u.split("/").pop();
      const body = options.body;
      let fileName = "";
      if (body && typeof body.entries === "function") {
        for (const [, v] of body.entries()) {
          if (v && typeof v === "object" && "name" in v) fileName = v.name;
        }
      }
      calls.push({ url: u, method, fileName });
      n += 1;
      if (method === "sendVideo") {
        return Response.json({ ok: true, result: { message_id: 1000 + n, video: { file_id: `VID_${n}`, file_unique_id: `UVID_${n}` } } });
      }
      if (method === "sendPhoto") {
        return Response.json({ ok: true, result: { message_id: 1000 + n, photo: [{ file_id: "SMALL", file_unique_id: "US" }, { file_id: `PHOTO_${n}`, file_unique_id: `UPHOTO_${n}` }] } });
      }
      if (method === "deleteMessage") return Response.json({ ok: true, result: true });
      if (method === "sendMessage") return Response.json({ ok: true, result: { message_id: 900 } });
      return Response.json({ ok: true, result: {} });
    }
    return new Response("Not found", { status: 404 });
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
    idFromName: (name) => name,
    get: () => ({ fetch: (url, options) => object.fetch(new Request(url, options)) }),
  };
}
const storedMenus = (kvEnv) => kvEnv.USERS.store.get(MENUS_KEY)?.menus ?? [];
const storedState = (kvEnv) => kvEnv.USERS.store.get(LEARN_IMPORT_KEY);
const seedMenus = (kvEnv) => {
  kvEnv.USERS.store.set(MENUS_KEY, { menus: [
    { id: VIDEO_MENU_ID, title: "🎬 دروس فيديو", text: "🎬 دروس فيديو", parentId: null, buttons: [{ id: "b_old", label: "درس قديم", kind: "video", fileId: "OLD_VID", fileUniqueId: "U_OLD", fileKind: "video", text: "" }] },
    { id: "m_custom", title: "قائمة مخصصة", text: "قائمة مخصصة", parentId: null, buttons: [{ id: "b_txt", label: "نص", kind: "text", text: "hello" }] },
  ] });
};

// The worker sends progress via telegram sendMessage with a JSON body; the
// stub above only records the method, so message text is captured by a
// second stub that keeps the parsed payload. It replaces makeFetchStub's
// Telegram branch for the worker-level tests.
function makeMessageStub(calls, failDriveIds = new Set()) {
  const driveKind = new Map(learnUploadItems().map((item) => [item.driveId, item.kind]));
  let n = 0;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.includes("drive.usercontent.google.com")) {
      const id = new URL(u).searchParams.get("id");
      if (failDriveIds.has(id)) {
        return new Response("<html>error</html>", { status: 404, headers: { "content-type": "text/html" } });
      }
      const kind = driveKind.get(id) ?? "video";
      calls.push({ url: u, kind: "drive", driveId: id });
      return new Response(new Uint8Array([1, 2, 3, 4]).buffer, {
        status: 200,
        headers: { "content-type": kind === "video" ? "video/mp4" : "image/jpeg" },
      });
    }
    if (u.includes("api.telegram.org")) {
      const method = u.split("/").pop();
      const body = options.body;
      let payload = null;
      let fileName = "";
      if (body && typeof body.entries === "function") {
        payload = {};
        for (const [k, v] of body.entries()) {
          payload[k] = v;
          if (v && typeof v === "object" && "name" in v) fileName = v.name;
        }
      } else if (typeof body === "string") {
        try { payload = JSON.parse(body); } catch { payload = null; }
      }
      calls.push({ url: u, method, payload, fileName });
      n += 1;
      if (method === "sendVideo") {
        return Response.json({ ok: true, result: { message_id: 1000 + n, video: { file_id: `VID_${n}`, file_unique_id: `UVID_${n}` } } });
      }
      if (method === "sendPhoto") {
        return Response.json({ ok: true, result: { message_id: 1000 + n, photo: [{ file_id: "SMALL", file_unique_id: "US" }, { file_id: `PHOTO_${n}`, file_unique_id: `UPHOTO_${n}` }] } });
      }
      if (method === "deleteMessage") return Response.json({ ok: true, result: true });
      if (method === "sendMessage") return Response.json({ ok: true, result: { message_id: 900 } });
      return Response.json({ ok: true, result: {} });
    }
    return new Response("Not found", { status: 404 });
  };
}
async function sendUpdateMsg(kvEnv, update, failDriveIds = new Set()) {
  const calls = [];
  makeMessageStub(calls, failDriveIds);
  await worker.fetch(updateRequest(update), kvEnv);
  return calls;
}
const sayMsg = (kvEnv, userId, text, failDriveIds) => sendUpdateMsg(kvEnv, { message: { text, chat: { id: userId, type: "private" }, from: { id: userId } } }, failDriveIds);
const messageTexts = (calls) => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload?.text ?? ""));
const anyMessage = (calls, re) => messageTexts(calls).some((t) => re.test(t));

// ---------------------------------------------------------------------------
// Manifest (frozen snapshot of the learn tab)
// ---------------------------------------------------------------------------

test("learn-import: manifest has 27 lessons with the right items, H ignored", () => {
  assert.equal(LEARN_MANIFEST_VERSION, 1);
  assert.equal(LEARN_LEVELS.length, 2);
  assert.equal(LEARN_LEVELS[0].id, "m_learn_l1");
  assert.equal(LEARN_LEVELS[0].title, "المستوى الأول");
  assert.equal(LEARN_LEVELS[0].lessons.length, 17);
  assert.equal(LEARN_LEVELS[1].id, "m_learn_l2");
  assert.equal(LEARN_LEVELS[1].lessons.length, 10);
  const items = LEARN_LEVELS.flatMap((level) => level.lessons.flatMap((lesson) => lesson.items));
  assert.equal(items.filter((i) => i.kind === "video").length, 27);
  assert.equal(items.filter((i) => i.kind === "photo").length, 23);
  assert.equal(items.filter((i) => i.kind === "url").length, 12);
  assert.equal(items.filter((i) => i.kind === "text").length, 4);
  // Level-2 column E is exercise TEXT (user-confirmed), not photo links.
  for (const lesson of LEARN_LEVELS[1].lessons) {
    for (const item of lesson.items.filter((i) => i.key === "exercise")) {
      assert.equal(item.kind, "text");
      assert.ok(item.text.length > 400);
      assert.ok(!/^https?:\/\//u.test(item.text));
    }
  }
  // No item carries anything from column H (ignored entirely): lesson and
  // item objects have exactly the expected keys, nothing H-derived.
  for (const level of LEARN_LEVELS) {
    assert.deepEqual(Object.keys(level), ["id", "title", "lessons"]);
    for (const lesson of level.lessons) {
      assert.deepEqual(Object.keys(lesson), ["id", "title", "items"]);
      for (const item of lesson.items) {
        for (const k of Object.keys(item)) assert.ok(["key", "kind", "driveId", "label", "text", "url"].includes(k), `unexpected item key ${k}`);
        assert.ok(["video", "oral", "exercise", "exam", "summary"].includes(item.key));
      }
    }
  }
  // Every lesson has a video; every label fits the 40-char limit.
  for (const level of LEARN_LEVELS) {
    for (const lesson of level.lessons) {
      assert.ok(lesson.items.some((i) => i.kind === "video"), lesson.id);
      assert.ok(lesson.title.length <= 40);
      for (const item of lesson.items) assert.ok(item.label.length <= 40);
    }
  }
});

test("learn-import: upload items and deterministic ids", () => {
  const items = learnUploadItems();
  assert.equal(items.length, 50);
  assert.equal(items.filter((i) => i.kind === "video").length, 27);
  assert.equal(items.filter((i) => i.kind === "photo").length, 23);
  assert.equal(new Set(items.map((i) => i.key)).size, 50);
  assert.equal(learnItemKey("m_learn_l1_03", "video"), "m_learn_l1_03:video");
  assert.equal(learnButtonId("m_learn_l1_03", "video"), "b_learn_l1_03_video");
  assert.equal(learnLessonButtonId("m_learn_l1_03"), "b_learn_l1_03");
  const allIds = [
    ...LEARN_LEVELS.map((l) => l.id),
    ...LEARN_LEVELS.flatMap((l) => l.lessons.map((x) => x.id)),
    ...LEARN_LEVELS.flatMap((l) => l.lessons.flatMap((x) => x.items.map((i) => learnButtonId(x.id, i.key)))),
    ...LEARN_LEVELS.flatMap((l) => l.lessons.map((x) => learnLessonButtonId(x.id))),
  ];
  assert.equal(new Set(allIds).size, allIds.length);
  assert.ok(allIds.every((id) => id.length <= 40));
  assert.ok(driveDownloadUrl("ABC123").includes("ABC123"));
});

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

test("learn-import: state normalizes garbage and batch skips done, retries failed", () => {
  const items = learnUploadItems();
  const state = normalizeImportState({
    version: 99,
    items: {
      [items[0].key]: { status: "done", fileId: "F1", fileUniqueId: "U1" },
      [items[1].key]: { status: "failed", error: "boom" },
      [items[2].key]: { status: "weird" },
      "bogus:key": { status: "done", fileId: "X" },
      [items[3].key]: null,
    },
  });
  assert.equal(state.items[items[0].key].status, "done");
  assert.equal(state.items[items[0].key].fileId, "F1");
  assert.equal(state.items[items[1].key].status, "failed");
  assert.equal(state.items[items[2].key].status, "pending");
  assert.equal(state.items["bogus:key"], undefined);
  assert.equal(state.items[items[3].key], undefined);
  // Batch of 3: failed item 1 is retried first, then pending items 2 and 3.
  const batch = nextImportBatch(state, items, LEARN_BATCH_SIZE);
  assert.deepEqual(batch.map((b) => b.key), [items[1].key, items[2].key, items[3].key]);
  const progress = importProgress(state, items);
  assert.deepEqual(progress, { total: 50, done: 1, failed: 1, pending: 48, complete: false });
  assert.equal(parseImportLearnArg("/importlearn"), "run");
  assert.equal(parseImportLearnArg("/importlearn status"), "status");
  assert.equal(parseImportLearnArg("/importlearn reset"), "reset");
  assert.equal(parseImportLearnArg("/importlearn blah"), "usage");
  assert.match(learnProgressText(progress), /1\/50/);
});

// ---------------------------------------------------------------------------
// Menu building
// ---------------------------------------------------------------------------

test("learn-import: empty state builds no menus, partial state builds only complete lessons", () => {
  // Empty state: nothing is ready, so no learn menu exists yet. A lesson
  // appears only once ALL its items are ready; no half-built lessons are
  // shown to users while the import is still running.
  let { menus, counts } = buildLearnMenus(LEARN_LEVELS, emptyImportState());
  assert.deepEqual(menus, []);
  assert.deepEqual(counts, { levels: 0, lessons: 0, buttons: 0 });

  // Partial state: the first 10 upload items done (L1 lessons 01-06 complete,
  // each with all its items ready). Every built lesson has exactly the
  // buttons its manifest items define, and no media button lacks a fileId.
  const partial = emptyImportState();
  const items = learnUploadItems();
  for (const item of items.slice(0, 10)) partial.items[item.key] = { status: "done", fileId: `FID_${item.key}` };
  ({ menus, counts } = buildLearnMenus(LEARN_LEVELS, partial));
  assert.deepEqual(counts, { levels: 1, lessons: 6, buttons: 19 });
  for (const lesson of LEARN_LEVELS[0].lessons) {
    const built = menus.find((m) => m.id === lesson.id);
    const complete = lesson.items.every((it) => it.kind === "text" || it.kind === "url" || partial.items[learnItemKey(lesson.id, it.key)]?.status === "done");
    if (!complete) {
      assert.ok(!built, `${lesson.id} must not appear before all its items are done`);
      continue;
    }
    assert.ok(built, `${lesson.id} must appear once complete`);
    assert.equal(built.buttons.length, lesson.items.length);
    for (const item of lesson.items) {
      const btn = built.buttons.find((b) => b.id === learnButtonId(lesson.id, item.key));
      assert.ok(btn, `${lesson.id} must have a button for ${item.key}`);
      if (item.kind === "video" || item.kind === "photo") assert.equal(btn.fileId, `FID_${learnItemKey(lesson.id, item.key)}`, `${item.key} needs its file_id`);
    }
  }
  // Lesson 07 (L1 lesson 7) is not complete yet, so it must not appear.
  assert.ok(!menus.some((m) => m.id === "m_learn_l1_07"));
  // No media button anywhere without a file_id.
  for (const menu of menus) for (const button of menu.buttons) {
    if (button.kind === "video" || button.kind === "photo") assert.ok(button.fileId, `${menu.id}/${button.id} must have a file_id`);
  }
});

test("learn-import: full state builds all 29 menus, rebuild is identical (no duplicates)", () => {
  const items = learnUploadItems();
  const state = emptyImportState();
  for (const item of items) {
    state.items[item.key] = { status: "done", fileId: `F_${item.key}`, fileUniqueId: "U", error: "", at: "" };
  }
  const first = buildLearnMenus(LEARN_LEVELS, state);
  const second = buildLearnMenus(LEARN_LEVELS, state);
  assert.deepEqual(first, second);
  assert.equal(first.menus.length, 29);
  assert.deepEqual(first.counts, { levels: 2, lessons: 27, buttons: 93 });
  const l1 = first.menus.find((m) => m.id === "m_learn_l1");
  const l2 = first.menus.find((m) => m.id === "m_learn_l2");
  assert.equal(l1.buttons.length, 17);
  assert.equal(l2.buttons.length, 10);
  const buttons = first.menus.flatMap((m) => m.buttons);
  assert.equal(buttons.filter((b) => b.kind === "video").length, 27);
  assert.equal(buttons.filter((b) => b.kind === "photo").length, 23);
  assert.equal(buttons.filter((b) => b.kind === "text").length, 4);
  assert.equal(buttons.filter((b) => b.kind === "url").length, 12);
  // One lesson's buttons, verbatim from the manifest.
  const lesson3 = first.menus.find((m) => m.id === "m_learn_l1_03");
  assert.deepEqual(lesson3.buttons.map((b) => b.kind), ["video", "photo", "url"]);
  assert.equal(lesson3.buttons[0].label, "🎬 فيديو الدرس");
  assert.equal(lesson3.buttons[0].fileId, `F_${learnItemKey("m_learn_l1_03", "video")}`);
  // User-specified order inside a lesson: L1 video → oral → exam;
  // L2 video → summary → exercise → exam, with the user's labels.
  assert.deepEqual(lesson3.buttons.map((b) => b.label), ["🎬 فيديو الدرس", "🗣 الشفوي", "📝 الامتحان الإلكتروني"]);
  const lessonL2 = first.menus.find((m) => m.id === "m_learn_l2_06");
  assert.deepEqual(lessonL2.buttons.map((b) => b.kind), ["video", "photo", "text", "url"]);
  assert.deepEqual(lessonL2.buttons.map((b) => b.label), ["🎬 فيديو الدرس", "🖼 ملخص الدرس", "📝 التدريب", "📝 الامتحان الإلكتروني"]);
});

test("learn-import: merge keeps existing menus, replaces same-id ones, cap fits 29+existing", () => {
  const existing = normalizeMenus({ menus: [
    { id: VIDEO_MENU_ID, title: "🎬 دروس فيديو", text: "🎬 دروس فيديو", parentId: null, buttons: [{ id: "b_old", label: "درس قديم", kind: "video", fileId: "OLD_VID", fileUniqueId: "U_OLD", fileKind: "video", text: "" }] },
    { id: "m_custom", title: "قائمة مخصصة", text: "قائمة مخصصة", parentId: null, buttons: [{ id: "b_txt", label: "نص", kind: "text", text: "hello" }] },
    { id: "m_learn_l1", title: "قديمة", text: "قديمة", parentId: null, buttons: [] },
  ] });
  const items = learnUploadItems();
  const state = emptyImportState();
  for (const item of items) state.items[item.key] = { status: "done", fileId: "F", fileUniqueId: "U", error: "", at: "" };
  const { menus: learnMenus } = buildLearnMenus(LEARN_LEVELS, state);
  const merged = mergeMenus(existing, learnMenus);
  assert.equal(merged.menus.length, 2 + 29);
  assert.equal(merged.menus.find((m) => m.id === VIDEO_MENU_ID).buttons[0].fileId, "OLD_VID");
  assert.ok(merged.menus.some((m) => m.id === "m_custom"));
  assert.equal(merged.menus.find((m) => m.id === "m_learn_l1").title, "المستوى الأول");
  assert.equal(merged.menus.filter((m) => m.id === "m_learn_l1").length, 1);
  // The other import's category menus coexist (different ids).
  const withCi = mergeMenus(merged, [{ id: "learn_root", title: "📚 دروس اللغة القبطية", text: "x", parentId: null, buttons: [] }]);
  assert.equal(withCi.menus.length, 2 + 29 + 1);
  assert.ok(withCi.menus.some((m) => m.id === "m_learn_l1"));
  assert.ok(withCi.menus.some((m) => m.id === "learn_root"));
});

// ---------------------------------------------------------------------------
// Drive download + Telegram upload (fake network)
// ---------------------------------------------------------------------------

test("learn-import: download rejects HTML/empty, upload captures file_id and deletes the message", async () => {
  const calls = [];
  makeFetchStub(calls);
  const item = learnUploadItems()[0];
  assert.equal(item.kind, "video");
  const uploaded = await uploadLearnFile({ TELEGRAM_BOT_TOKEN: token }, 813894692, item);
  assert.match(uploaded.fileId, /^VID_/);
  assert.match(uploaded.fileUniqueId, /^UVID_/);
  assert.ok(calls.some((c) => c.kind === "drive" && c.driveId === item.driveId));
  assert.ok(calls.some((c) => c.method === "sendVideo" && c.fileName === `${item.driveId}.mp4`));
  assert.equal(calls.filter((c) => c.method === "deleteMessage").length, 1);
  assert.equal(await downloadDriveFile(item.driveId).then((r) => r.data.byteLength), 4);
  await assert.rejects(() => downloadDriveFile(item.driveId, async () => new Response("<html>x</html>", { status: 404, headers: { "content-type": "text/html" } })), /Drive download failed/);
  await assert.rejects(() => uploadLearnFile({ TELEGRAM_BOT_TOKEN: token }, 813894692, item, async (url) => {
    if (String(url).includes("drive.usercontent")) return new Response(new Uint8Array([1]).buffer, { status: 200, headers: { "content-type": "video/mp4" } });
    return Response.json({ ok: false, error_code: 400, description: "Bad Request: file is too big" });
  }), /file is too big/);
});

// ---------------------------------------------------------------------------
// Worker command end to end (fake Telegram + fake Durable Object)
// ---------------------------------------------------------------------------

test("learn-import: /importlearn status, first batch, and non-admin refusal", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv);
  let calls = await sayMsg(kvEnv, ADMIN, "/importlearn status");
  assert.ok(anyMessage(calls, /0\/50/), "status must report 0/50 on a fresh import");
  assert.equal(calls.filter((c) => c.method === "sendVideo").length, 0);

  calls = await sayMsg(kvEnv, ADMIN, "/importlearn");
  assert.ok(anyMessage(calls, /3\/50/), "first run must process one batch of 3");
  assert.equal(calls.filter((c) => c.method === "sendVideo").length, 3);
  assert.equal(calls.filter((c) => c.method === "deleteMessage").length, 3);
  const menus = storedMenus(kvEnv);
  assert.ok(menus.some((m) => m.id === VIDEO_MENU_ID), "m_video must be preserved");
  assert.ok(menus.some((m) => m.id === "m_custom"), "custom menus must be preserved");
  const l1 = menus.find((m) => m.id === "m_learn_l1");
  assert.ok(l1, "level 1 must appear after the first batch");
  assert.equal(l1.buttons.length, 2, "only the two video-only lessons are complete after batch 1");
  const lesson1 = menus.find((m) => m.id === "m_learn_l1_01");
  assert.equal(lesson1.buttons.length, 1);
  assert.equal(lesson1.buttons[0].kind, "video");
  assert.match(lesson1.buttons[0].fileId, /^VID_/);
  // Lesson 03 has its video but its oral photo is not uploaded yet, so the
  // lesson must NOT appear half-built.
  assert.ok(!menus.some((m) => m.id === "m_learn_l1_03"), "lesson 03 must not appear before its oral photo is done");
  assert.ok(!menus.some((m) => m.id === "m_learn_l2"), "level 2 must not appear yet");
  const state = storedState(kvEnv);
  assert.equal(Object.values(state.items).filter((i) => i.status === "done").length, 3);

  calls = await sayMsg(kvEnv, 57, "/importlearn");
  assert.ok(anyMessage(calls, /للأدمن فقط/), "non-admin must be refused");
  assert.equal(calls.filter((c) => c.method === "sendVideo").length, 0);
});

test("learn-import: failed upload is reported and retried on the next run", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv);
  const items = learnUploadItems();
  let calls = await sayMsg(kvEnv, ADMIN, "/importlearn", new Set([items[1].driveId]));
  assert.ok(anyMessage(calls, /2\/50/), "two of the first three must succeed");
  assert.ok(anyMessage(calls, /فشل 1/), "one failure must be reported");
  let state = storedState(kvEnv);
  assert.equal(state.items[items[1].key].status, "failed");

  calls = await sayMsg(kvEnv, ADMIN, "/importlearn");
  assert.ok(anyMessage(calls, /5\/50/), "retry run must reach 5 done (failed + next 2)");
  state = storedState(kvEnv);
  assert.equal(state.items[items[1].key].status, "done");
  assert.equal(Object.values(state.items).filter((i) => i.status === "failed").length, 0);
});

test("learn-import: /importlearn reset clears state and learn menus only", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv);
  await sayMsg(kvEnv, ADMIN, "/importlearn");
  assert.ok(storedMenus(kvEnv).some((m) => m.id === "m_learn_l1"));
  const calls = await sayMsg(kvEnv, ADMIN, "/importlearn reset");
  assert.ok(anyMessage(calls, /تم مسح/));
  assert.ok(!storedMenus(kvEnv).some((m) => String(m.id).startsWith("m_learn_")));
  assert.ok(storedMenus(kvEnv).some((m) => m.id === VIDEO_MENU_ID));
  assert.ok(storedMenus(kvEnv).some((m) => m.id === "m_custom"));
  const status = await sayMsg(kvEnv, ADMIN, "/importlearn status");
  assert.ok(anyMessage(status, /0\/50/));
});

test("learn-import: /__learn-import merges instead of replacing all menus", async () => {
  const kvEnv = { ...env, USERS: fakeKv(), LEARN_IMPORT_SECRET: "test-import-secret" };
  seedMenus(kvEnv);
  const post = (secret, body) => worker.fetch(new Request("https://bot.test/__learn-import", {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-learn-import-secret": secret } : {}) },
    body: JSON.stringify(body),
  }), kvEnv);
  let res = await post(null, { menus: [{ id: "learn_l1_videos", title: "🎬 فيديوهات المستوى الأول", text: "x", parentId: null, buttons: [] }] });
  assert.equal(res.status, 403);
  res = await post("wrong", { menus: [{ id: "learn_l1_videos", title: "🎬 فيديوهات المستوى الأول", text: "x", parentId: null, buttons: [] }] });
  assert.equal(res.status, 403);
  assert.equal(storedMenus(kvEnv).length, 2);
  res = await post("test-import-secret", { menus: [{ id: "learn_l1_videos", title: "🎬 فيديوهات المستوى الأول", text: "x", parentId: null, buttons: [] }] });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, menus: 3, buttons: 2 });
  const menus = storedMenus(kvEnv);
  assert.ok(menus.some((m) => m.id === "learn_l1_videos"), "imported menu must be stored");
  assert.ok(menus.some((m) => m.id === VIDEO_MENU_ID), "m_video must survive the endpoint import");
  assert.ok(menus.some((m) => m.id === "m_custom"), "custom menus must survive the endpoint import");
  res = await post("test-import-secret", { menus: [] });
  assert.equal(res.status, 400);
});
