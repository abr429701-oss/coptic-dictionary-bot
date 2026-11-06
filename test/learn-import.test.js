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
  learnUploadItems,
  learnItemKey,
  learnLessonButtonId,
  emptyImportState,
  normalizeImportState,
  importProgress,
  learnPendingItems,
  findLearnLesson,
  learnLessonSendPlan,
  buildLearnMenus,
  dropStaleLearnLessonMenus,
  mergeMenus,
  downloadDriveFile,
  uploadLearnFile,
  parseImportLearnArg,
  learnImportStartText,
  learnProgressText,
  driveDownloadUrl,
} from "../src/learn-import.js";

// ---------------------------------------------------------------------------
// Bulk "learn" lessons importer (2026-11-06, v2).
//
// Frozen manifest (27 lessons from the learn tab) -> Drive download once ->
// Telegram upload once (file_id stored) -> two level menus. ONE /importlearn
// run imports EVERYTHING in the background and reports completion; each
// lesson has ONE button (kind "lesson") and one tap sends the whole lesson,
// items in manifest order (L1: video → oral → exam; L2: video → summary →
// exercise → exam). A lesson button appears only once all its items are
// ready; a media item is never sent without a stored file_id.
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
const tapCallback = (kvEnv, userId, data) => sendUpdateMsg(kvEnv, { callback_query: { id: "cb1", data, from: { id: userId }, message: { message_id: 5, chat: { id: userId, type: "private" }, text: "x" } } });
const messageTexts = (calls) => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload?.text ?? ""));
const anyMessage = (calls, re) => messageTexts(calls).some((t) => re.test(t));
const fullState = () => {
  const state = emptyImportState();
  for (const item of learnUploadItems()) state.items[item.key] = { status: "done", fileId: `F_${item.key}`, fileUniqueId: "U", error: "", at: "" };
  return state;
};

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
  assert.equal(learnLessonButtonId("m_learn_l1_03"), "b_learn_l1_03");
  const allIds = [
    ...LEARN_LEVELS.map((l) => l.id),
    ...LEARN_LEVELS.flatMap((l) => l.lessons.map((x) => x.id)),
    ...LEARN_LEVELS.flatMap((l) => l.lessons.map((x) => learnLessonButtonId(x.id))),
  ];
  assert.equal(new Set(allIds).size, allIds.length);
  assert.ok(allIds.every((id) => id.length <= 40));
  assert.ok(driveDownloadUrl("ABC123").includes("ABC123"));
});

// ---------------------------------------------------------------------------
// State machine (single-run import: pending = everything not done)
// ---------------------------------------------------------------------------

test("learn-import: state normalizes garbage and pending returns everything not done", () => {
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
  // Pending is ALL not-done items (failed first, then the rest) — one run
  // imports everything, there is no small batch anymore.
  const pending = learnPendingItems(state, items);
  assert.equal(pending.length, 49);
  assert.equal(pending[0].key, items[1].key);
  assert.ok(pending.some((p) => p.key === items[2].key));
  assert.ok(pending.some((p) => p.key === items[49].key));
  const progress = importProgress(state, items);
  assert.deepEqual(progress, { total: 50, done: 1, failed: 1, pending: 48, complete: false });
  assert.equal(parseImportLearnArg("/importlearn"), "run");
  assert.equal(parseImportLearnArg("/importlearn status"), "status");
  assert.equal(parseImportLearnArg("/importlearn reset"), "reset");
  assert.equal(parseImportLearnArg("/importlearn blah"), "usage");
  assert.match(learnProgressText(progress), /1\/50/);
  assert.match(learnImportStartText(progress), /متبقٍ 49 ملف من 50/);
});

// ---------------------------------------------------------------------------
// Menu building: only the two level menus, one button per ready lesson
// ---------------------------------------------------------------------------

test("learn-import: empty state builds no menus, partial state builds only complete lessons", () => {
  // Empty state: nothing is ready, so no learn menu exists yet. A lesson
  // appears only once ALL its items are ready; no half-built lessons are
  // shown to users while the import is still running.
  let { menus, counts } = buildLearnMenus(LEARN_LEVELS, emptyImportState());
  assert.deepEqual(menus, []);
  assert.deepEqual(counts, { levels: 0, lessons: 0, buttons: 0 });

  // Partial state: the first 10 upload items done (L1 lessons 01-06 complete,
  // each with all its items ready). Every built lesson has exactly ONE
  // button (kind "lesson", label = lesson name); there are no lesson
  // submenus anymore.
  const partial = emptyImportState();
  const items = learnUploadItems();
  for (const item of items.slice(0, 10)) partial.items[item.key] = { status: "done", fileId: `FID_${item.key}` };
  ({ menus, counts } = buildLearnMenus(LEARN_LEVELS, partial));
  assert.deepEqual(counts, { levels: 1, lessons: 6, buttons: 7 });
  assert.equal(menus.length, 1);
  assert.equal(menus[0].id, "m_learn_l1");
  assert.equal(menus[0].parentId, null);
  for (const lesson of LEARN_LEVELS[0].lessons) {
    const btn = menus[0].buttons.find((b) => b.lessonId === lesson.id);
    const complete = lesson.items.every((it) => it.kind === "text" || it.kind === "url" || partial.items[learnItemKey(lesson.id, it.key)]?.status === "done");
    if (!complete) {
      assert.ok(!btn, `${lesson.id} must not appear before all its items are done`);
      continue;
    }
    assert.ok(btn, `${lesson.id} must appear once complete`);
    assert.equal(btn.kind, "lesson");
    assert.equal(btn.label, lesson.title);
    assert.equal(btn.id, learnLessonButtonId(lesson.id));
  }
  // Lesson 07 (L1 lesson 7) is not complete yet, so it must not appear.
  assert.ok(!menus[0].buttons.some((b) => b.lessonId === "m_learn_l1_07"));
  // No submenu anywhere: level menus are the only learn menus.
  assert.ok(menus.every((m) => m.parentId === null));
});

test("learn-import: full state builds exactly 2 menus, rebuild is identical (no duplicates)", () => {
  const first = buildLearnMenus(LEARN_LEVELS, fullState());
  const second = buildLearnMenus(LEARN_LEVELS, fullState());
  assert.deepEqual(first, second);
  assert.equal(first.menus.length, 2);
  assert.deepEqual(first.counts, { levels: 2, lessons: 27, buttons: 29 });
  const l1 = first.menus.find((m) => m.id === "m_learn_l1");
  const l2 = first.menus.find((m) => m.id === "m_learn_l2");
  assert.equal(l1.buttons.length, 18);
  assert.equal(l2.buttons.length, 11);
  const buttons = first.menus.flatMap((m) => m.buttons);
  const lessonButtons = buttons.filter((b) => b.kind === "lesson");
  assert.equal(lessonButtons.length, 27);
  assert.ok(lessonButtons.every((b) => /^m_learn_l[12]_\d{2}$/u.test(b.lessonId)), "every lesson button names its lesson");
  assert.deepEqual(lessonButtons.map((b) => b.label), LEARN_LEVELS.flatMap((l) => l.lessons.map((x) => x.title)));
  // Each level menu ends with a way back to the main menu (a /menu command
  // button): the level menus have no parent, so the keyboard builder adds
  // no Back/Home row for them.
  for (const levelMenu of [l1, l2]) {
    const home = levelMenu.buttons.at(-1);
    assert.equal(home.kind, "command");
    assert.equal(home.command, "/menu");
    assert.equal(home.label, "🏠 الرئيسية");
    assert.equal(home.id, `b_${levelMenu.id}_home`);
  }
  // One lesson button, verbatim from the manifest.
  const lesson3 = l1.buttons.find((b) => b.lessonId === "m_learn_l1_03");
  assert.equal(lesson3.label, "الدرس الاول");
  assert.equal(lesson3.id, "b_learn_l1_03");
  const lessonL2 = l2.buttons.find((b) => b.lessonId === "m_learn_l2_06");
  assert.equal(lessonL2.label, "الدرس السادس");
  // No lesson submenus: no menu id ends in _NN and no menu has a parent.
  assert.ok(first.menus.every((m) => m.parentId === null));
  assert.ok(!first.menus.some((m) => /_\d{2}$/u.test(m.id)));
});

test("learn-import: send plan is the whole lesson in order, or null when not ready", () => {
  const state = fullState();
  const l1 = findLearnLesson("m_learn_l1_03");
  assert.equal(l1.title, "الدرس الاول");
  // L1 order: video → oral photo → exam link.
  assert.deepEqual(learnLessonSendPlan(l1, state).map((s) => s.kind), ["video", "photo", "url"]);
  const [video, photo, exam] = learnLessonSendPlan(l1, state);
  assert.equal(video.fileId, `F_${learnItemKey("m_learn_l1_03", "video")}`);
  assert.equal(video.caption, "الدرس الاول");
  assert.equal(photo.fileId, `F_${learnItemKey("m_learn_l1_03", "oral")}`);
  assert.equal(exam.label, "📝 الامتحان الإلكتروني");
  assert.match(exam.url, /^https:\/\/docs\.google\.com\/forms\//u);
  // L2 order: video → summary photo → exercise text → exam link.
  const l2 = findLearnLesson("m_learn_l2_06");
  assert.deepEqual(learnLessonSendPlan(l2, state).map((s) => s.kind), ["video", "photo", "text", "url"]);
  assert.match(learnLessonSendPlan(l2, state)[2].text, /التدريب الثالث/u);
  // A lesson with a missing file_id has no plan (button must not exist).
  const partial = emptyImportState();
  partial.items[learnItemKey("m_learn_l1_03", "video")] = { status: "done", fileId: "F1" };
  assert.equal(learnLessonSendPlan(l1, partial), null);
  assert.equal(findLearnLesson("m_learn_nope"), null);
  assert.equal(learnLessonSendPlan(null, state), null);
});

test("learn-import: merge keeps existing menus, stale lesson submenus are dropped", () => {
  const existing = normalizeMenus({ menus: [
    { id: VIDEO_MENU_ID, title: "🎬 دروس فيديو", text: "🎬 دروس فيديو", parentId: null, buttons: [{ id: "b_old", label: "درس قديم", kind: "video", fileId: "OLD_VID", fileUniqueId: "U_OLD", fileKind: "video", text: "" }] },
    { id: "m_custom", title: "قائمة مخصصة", text: "قائمة مخصصة", parentId: null, buttons: [{ id: "b_txt", label: "نص", kind: "text", text: "hello" }] },
    { id: "m_learn_l1", title: "قديمة", text: "قديمة", parentId: null, buttons: [] },
    { id: "m_learn_l1_03", title: "الدرس الاول", text: "الدرس الاول", parentId: "m_learn_l1", buttons: [{ id: "b_learn_l1_03_video", label: "🎬 فيديو الدرس", kind: "video", fileId: "OLD", fileUniqueId: "U", fileKind: "video", text: "" }] },
  ] });
  const { menus: learnMenus } = buildLearnMenus(LEARN_LEVELS, fullState());
  const merged = mergeMenus(existing, learnMenus);
  assert.equal(merged.menus.find((m) => m.id === "m_learn_l1").title, "المستوى الأول");
  assert.equal(merged.menus.filter((m) => m.id === "m_learn_l1").length, 1);
  assert.equal(merged.menus.find((m) => m.id === VIDEO_MENU_ID).buttons[0].fileId, "OLD_VID");
  assert.ok(merged.menus.some((m) => m.id === "m_custom"));
  // The old per-lesson submenu is stale: dropping it leaves 2 learn menus.
  const pruned = dropStaleLearnLessonMenus(merged.menus);
  assert.equal(pruned.length, 4);
  assert.ok(!pruned.some((m) => m.id === "m_learn_l1_03"));
  assert.ok(pruned.some((m) => m.id === "m_learn_l1"));
  assert.ok(pruned.some((m) => m.id === "m_learn_l2"));
  // The other import's category menus coexist (different ids).
  const withCi = mergeMenus(merged, [{ id: "learn_root", title: "📚 دروس اللغة القبطية", text: "x", parentId: null, buttons: [] }]);
  assert.ok(withCi.menus.some((m) => m.id === "learn_root"));
  assert.ok(withCi.menus.some((m) => m.id === "m_learn_l1"));
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

test("learn-import: /importlearn status, one run imports everything, non-admin refusal", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv);
  let calls = await sayMsg(kvEnv, ADMIN, "/importlearn status");
  assert.ok(anyMessage(calls, /0\/50/), "status must report 0/50 on a fresh import");
  assert.equal(calls.filter((c) => c.method === "sendVideo").length, 0);

  // One run imports ALL 50 files (no batching, no re-runs): the admin gets
  // a "started" message first, then the completion message in the same run
  // (tests have no Workers ctx, so the run is awaited inline).
  calls = await sayMsg(kvEnv, ADMIN, "/importlearn");
  assert.ok(anyMessage(calls, /جارٍ استيراد كل الدروس/), "run must answer at once that the import started");
  assert.ok(anyMessage(calls, /50\/50/), "one run must reach 50/50");
  assert.ok(anyMessage(calls, /اكتمل الاستيراد/), "completion line must be sent");
  assert.equal(calls.filter((c) => c.method === "sendVideo").length, 27);
  assert.equal(calls.filter((c) => c.method === "sendPhoto").length, 23);
  assert.equal(calls.filter((c) => c.method === "deleteMessage").length, 50);
  const menus = storedMenus(kvEnv);
  assert.ok(menus.some((m) => m.id === VIDEO_MENU_ID), "m_video must be preserved");
  assert.ok(menus.some((m) => m.id === "m_custom"), "custom menus must be preserved");
  assert.equal(menus.filter((m) => String(m.id).startsWith("m_learn_")).length, 2, "exactly the two level menus");
  const l1 = menus.find((m) => m.id === "m_learn_l1");
  const l2 = menus.find((m) => m.id === "m_learn_l2");
  assert.equal(l1.buttons.length, 18);
  assert.equal(l2.buttons.length, 11);
  assert.ok(l1.buttons.filter((b) => b.kind === "lesson").every((b) => b.lessonId), "level buttons are single lesson buttons");
  assert.equal(l1.buttons.at(-1).command, "/menu", "last row is the way back to the main menu");
  assert.ok(!menus.some((m) => /_\d{2}$/u.test(m.id)), "no lesson submenus");
  const state = storedState(kvEnv);
  assert.equal(Object.values(state.items).filter((i) => i.status === "done").length, 50);

  // A second run on a complete import just reports completion, no uploads.
  calls = await sayMsg(kvEnv, ADMIN, "/importlearn");
  assert.ok(anyMessage(calls, /50\/50/));
  assert.equal(calls.filter((c) => c.method === "sendVideo").length, 0);

  calls = await sayMsg(kvEnv, 57, "/importlearn");
  assert.ok(anyMessage(calls, /للأدمن فقط/), "non-admin must be refused");
  assert.equal(calls.filter((c) => c.method === "sendVideo").length, 0);
});

test("learn-import: failed upload is reported and retried on the next run", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv);
  const items = learnUploadItems();
  let calls = await sayMsg(kvEnv, ADMIN, "/importlearn", new Set([items[1].driveId]));
  assert.ok(anyMessage(calls, /49\/50/), "49 of 50 must succeed on the first run");
  assert.ok(anyMessage(calls, /فشل 1/), "one failure must be reported");
  let state = storedState(kvEnv);
  assert.equal(state.items[items[1].key].status, "failed");
  // Only the failed lesson is missing its button; the other 26 are there.
  assert.equal(storedMenus(kvEnv).find((m) => m.id === "m_learn_l1").buttons.length, 17);

  // The next run retries ONLY the failed item (done items are not re-uploaded).
  calls = await sayMsg(kvEnv, ADMIN, "/importlearn");
  assert.ok(anyMessage(calls, /50\/50/), "retry run must reach 50/50");
  assert.equal(calls.filter((c) => c.method === "sendVideo").length, 1, "only the one failed file is re-uploaded");
  state = storedState(kvEnv);
  assert.equal(state.items[items[1].key].status, "done");
  assert.equal(Object.values(state.items).filter((i) => i.status === "failed").length, 0);
  assert.equal(storedMenus(kvEnv).find((m) => m.id === "m_learn_l1").buttons.length, 18);
});

test("learn-import: rebuild drops old per-lesson submenus left by the previous version", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv);
  // Menus as the previous (deployed) importer left them: level menus plus
  // per-lesson submenus.
  kvEnv.USERS.store.set(MENUS_KEY, { menus: [
    ...storedMenus(kvEnv),
    { id: "m_learn_l1", title: "المستوى الأول", text: "المستوى الأول", parentId: null, buttons: [] },
    { id: "m_learn_l1_03", title: "الدرس الاول", text: "الدرس الاول", parentId: "m_learn_l1", buttons: [] },
    { id: "m_learn_l2_06", title: "الدرس السادس", text: "الدرس السادس", parentId: "m_learn_l2", buttons: [] },
  ] });
  await sayMsg(kvEnv, ADMIN, "/importlearn");
  const menus = storedMenus(kvEnv);
  assert.ok(!menus.some((m) => m.id === "m_learn_l1_03"), "old lesson submenu must be gone");
  assert.ok(!menus.some((m) => m.id === "m_learn_l2_06"), "old lesson submenu must be gone");
  assert.ok(menus.some((m) => m.id === "m_learn_l1"));
  assert.ok(menus.some((m) => m.id === "m_learn_l2"));
});

test("learn-import: /importlearn on an already-complete import still rebuilds menus (drops v1 submenus)", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv);
  // State as the previous importer left it: 50/50 done. Menus as the
  // previous importer left them: level menus plus per-lesson submenus
  // with one button per item. Before the fix, /importlearn short-
  // circuited on "complete" and never rebuilt, so users kept seeing
  // the old separate item buttons.
  kvEnv.USERS.store.set(LEARN_IMPORT_KEY, fullState());
  kvEnv.USERS.store.set(MENUS_KEY, { menus: [
    ...storedMenus(kvEnv),
    { id: "m_learn_l1", title: "المستوى الأول", text: "المستوى الأول", parentId: null, buttons: [{ id: "b_learn_l1_01", label: "الدرس الاول", kind: "submenu", targetMenuId: "m_learn_l1_01" }] },
    { id: "m_learn_l1_01", title: "الدرس الاول", text: "الدرس الاول", parentId: "m_learn_l1", buttons: [{ id: "b_learn_l1_01_video", label: "🎬 فيديو الدرس", kind: "video", fileId: "OLD", fileUniqueId: "U", fileKind: "video", text: "" }] },
    { id: "m_learn_l2_06", title: "الدرس السادس", text: "الدرس السادس", parentId: "m_learn_l2", buttons: [] },
  ] });
  const calls = await sayMsg(kvEnv, ADMIN, "/importlearn");
  assert.ok(anyMessage(calls, /50\/50/), "complete import must still report 50/50");
  assert.ok(anyMessage(calls, /تم حذف القوائم المخزنة القديمة/), "the reply must say the old stored menus were deleted");
  assert.equal(calls.filter((c) => c.method === "sendVideo").length, 0, "nothing left to upload");
  const menus = storedMenus(kvEnv);
  assert.equal(menus.filter((m) => String(m.id).startsWith("m_learn_")).length, 2, "exactly the two level menus");
  assert.ok(!menus.some((m) => m.id === "m_learn_l1_01"), "old lesson submenu must be gone");
  assert.ok(!menus.some((m) => m.id === "m_learn_l2_06"), "old lesson submenu must be gone");
  const l1 = menus.find((m) => m.id === "m_learn_l1");
  assert.equal(l1.buttons.length, 18);
  assert.ok(l1.buttons.filter((b) => b.kind === "lesson").every((b) => b.lessonId), "level buttons are single lesson buttons");
  assert.ok(!menus.flatMap((m) => m.buttons ?? []).some((b) => b.kind === "submenu" && String(b.targetMenuId ?? "").startsWith("m_learn_l1_")), "no old submenu buttons remain");
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

// ---------------------------------------------------------------------------
// One tap sends the whole lesson, in order
// ---------------------------------------------------------------------------

test("learn-import: plain tap on a lesson sends video, photo, then the exam link", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv);
  await sayMsg(kvEnv, ADMIN, "/importlearn");
  // Plain-text tap path: /menu, then the level title, then the lesson title.
  await sayMsg(kvEnv, 57, "/menu");
  await sayMsg(kvEnv, 57, "المستوى الأول");
  const calls = await sayMsg(kvEnv, 57, "الدرس الاول");
  assert.deepEqual(calls.map((c) => c.method), ["sendVideo", "sendPhoto", "sendMessage"]);
  assert.match(String(calls[0].payload?.caption ?? ""), /الدرس الاول/u);
  assert.match(String(calls[1].payload?.caption ?? ""), /الدرس الاول/u);
  const exam = calls[2].payload;
  assert.equal(exam.text, "📝 الامتحان الإلكتروني");
  assert.equal(exam.reply_markup.inline_keyboard[0][0].text, "📝 الامتحان الإلكتروني");
  assert.match(exam.reply_markup.inline_keyboard[0][0].url, /^https:\/\/docs\.google\.com\/forms\//u);
});

test("learn-import: tapping 🏠 الرئيسية inside a level returns to the main menu", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv);
  await sayMsg(kvEnv, ADMIN, "/importlearn");
  await sayMsg(kvEnv, 57, "/menu");
  await sayMsg(kvEnv, 57, "المستوى الأول");
  // Inside the level, the only way back used to be typing /menu by hand:
  // the level menu has no parent, so no Back/Home row is added for it.
  const calls = await sayMsg(kvEnv, 57, "🏠 الرئيسية");
  assert.ok(anyMessage(calls, /القوائم/u), "tapping home must open the main menu list");
  assert.ok(!calls.some((c) => c.method === "sendVideo" || c.method === "sendPhoto"), "no lesson must be sent");
});

test("learn-import: inline tap on an L2 lesson sends video, photo, exercise text, exam link", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv);
  await sayMsg(kvEnv, ADMIN, "/importlearn");
  const calls = await tapCallback(kvEnv, 57, "mb|btn|m_learn_l2|b_learn_l2_06");
  assert.deepEqual(calls.map((c) => c.method), ["answerCallbackQuery", "sendVideo", "sendPhoto", "sendMessage", "sendMessage"]);
  assert.match(String(calls[1].payload?.caption ?? ""), /الدرس السادس/u);
  assert.match(messageTexts(calls).find((t) => /التدريب الثالث/u.test(t)) ?? "", /التدريب الثالث/u);
  const exam = calls[4].payload;
  assert.equal(exam.text, "📝 الامتحان الإلكتروني");
  assert.match(exam.reply_markup.inline_keyboard[0][0].url, /^https:\/\/docs\.google\.com\/forms\//u);
});

test("learn-import: one failed lesson item does not abort the rest of the lesson", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv);
  await sayMsg(kvEnv, ADMIN, "/importlearn");
  // Telegram rejects the oral photo; the video, the failure message and
  // the exam link must still arrive, in order. (This test installs its own
  // fetch stub and calls the worker directly, because sendUpdateMsg would
  // replace the stub with the standard one.)
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.includes("api.telegram.org")) {
      const method = u.split("/").pop();
      let payload = null;
      if (typeof options.body === "string") {
        try { payload = JSON.parse(options.body); } catch { payload = null; }
      }
      calls.push({ method, payload });
      if (method === "sendPhoto") return Response.json({ ok: false, error_code: 400, description: "Bad Request: wrong file identifier" });
      if (method === "sendVideo") return Response.json({ ok: true, result: { message_id: 1, video: { file_id: "V", file_unique_id: "UV" } } });
      return Response.json({ ok: true, result: { message_id: 900 } });
    }
    return new Response("Not found", { status: 404 });
  };
  await worker.fetch(updateRequest({ callback_query: { id: "cb1", data: "mb|btn|m_learn_l1|b_learn_l1_03", from: { id: ADMIN }, message: { message_id: 5, chat: { id: ADMIN, type: "private" }, text: "x" } } }), kvEnv);
  assert.deepEqual(calls.map((c) => c.method), ["answerCallbackQuery", "sendVideo", "sendPhoto", "sendMessage", "sendMessage", "sendMessage"]);
  assert.ok(messageTexts(calls).some((t) => /تعذّر إرسال هذا المحتوى/u.test(t)), "generic failure message must be sent");
  assert.ok(messageTexts(calls).some((t) => /wrong file identifier/u.test(t)), "admin sees the real reason");
  const exam = calls.at(-1).payload;
  assert.equal(exam.text, "📝 الامتحان الإلكتروني");
});

// ---------------------------------------------------------------------------
// Removed commands (9, permanently): /theme, /transliterate, /copticnum,
// /deleteme, /largefont, /settings, /rate, /achievements, /etymology.
// They must not respond anymore and must not appear in the bot command list.
// Kept on purpose: the transliterate() helper (used by /pronounce),
// /voicesettings, /ratewarn, the gamify badge awarding in admin-pro.js.
// ---------------------------------------------------------------------------

test("learn-import: 9 removed commands no longer respond or list", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv);
  // The old command outputs must never appear again.
  const dead = [
    ["/theme light", /تم حفظ سمتك/u],
    ["/transliterate ⲁⲃⲃⲁ", /^🔤 النقل الصوتي:/u],
    ["/copticnum 5", /بالأرقام القبطية/u],
    ["/deleteme", /حذف حسابك/u],
    ["/largefont", /الخط الكبير/u],
    ["/settings", /إعداداتك/u],
    ["/rate ⲁⲛⲁⲩ 5", /شكرًا لتقييمك/u],
    ["/achievements", /إنجازاتك/u],
    ["/etymology ⲁⲃⲃⲁ", /أصل الكلمة/u],
  ];
  for (const [text, re] of dead) {
    const calls = await sayMsg(kvEnv, 57, text);
    assert.ok(!messageTexts(calls).some((t) => re.test(t)), `${text} must not answer anymore`);
  }
  // The bot command list (setMyCommands on /start) must not contain them.
  const removed = ["theme", "transliterate", "copticnum", "deleteme", "largefont", "settings", "rate", "achievements", "etymology"];
  let calls = await sayMsg(kvEnv, 57, "/start");
  let setCommands = calls.find((c) => c.method === "setMyCommands" && !c.payload?.scope);
  assert.ok(setCommands, "user setMyCommands must be sent on /start");
  let names = (setCommands.payload?.commands ?? []).map((c) => c.command);
  for (const name of removed) assert.ok(!names.includes(name), `${name} must not be listed`);
  assert.ok(names.includes("voicesettings"), "/voicesettings must stay listed");
  calls = await sayMsg(kvEnv, ADMIN, "/start");
  setCommands = calls.find((c) => c.method === "setMyCommands" && c.payload?.scope);
  assert.ok(setCommands, "admin setMyCommands must be sent on /start");
  names = (setCommands.payload?.commands ?? []).map((c) => c.command);
  for (const name of removed) assert.ok(!names.includes(name), `${name} must not be listed for admins either`);
  assert.ok(names.includes("ratewarn"), "/ratewarn must stay listed for admins");
  // The internal transliteration helper still works via /pronounce.
  calls = await sayMsg(kvEnv, 57, "/pronounce ⲁⲃⲃⲁ");
  assert.ok(anyMessage(calls, /النقل الصوتي \(باللاتيني\)/u), "/pronounce must still show the latin transliteration");
});

test("learn-import: /menuadmin studio and manual menu commands are intact", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedMenus(kvEnv);
  await sayMsg(kvEnv, ADMIN, "/importlearn");
  // The studio still opens from /menuadmin.
  let calls = await sayMsg(kvEnv, ADMIN, "/menuadmin");
  assert.ok(anyMessage(calls, /محرر القوائم/u), "studio must open from /menuadmin");
  // The manual commands still redirect into the studio instead of dying.
  calls = await sayMsg(kvEnv, ADMIN, "/addmenu قائمة اختبار");
  assert.ok(anyMessage(calls, /محرر القوائم يعمل الآن/u), "/addmenu must still open the studio flow");
  calls = await sayMsg(kvEnv, ADMIN, "/videolist");
  assert.ok(anyMessage(calls, /محرر القوائم يعمل الآن/u), "/videolist must still open the studio flow");
  // There is no command literally called /adminmenu in the code — the manual
  // editor is /menuadmin. (The user calls it /adminmenu; keep the real name.)
  const src = readFileSync(resolve(testRoot, "src", "index.js"), "utf8")
    + readFileSync(resolve(testRoot, "src", "menu-studio.js"), "utf8")
    + readFileSync(resolve(testRoot, "src", "menu-builder.js"), "utf8");
  assert.ok(!src.includes("adminmenu"), "no /adminmenu command exists; the editor is /menuadmin");
  assert.ok(src.includes("/menuadmin"), "/menuadmin must be present");
});
