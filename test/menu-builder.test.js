import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore } from "../src/index.js";
import {
  MENUS_KEY, VIDEO_MENU_ID, BUTTON_KINDS,
  makeMenuId, makeButtonId,
  cleanMenuTitle, cleanButtonLabel, cleanUrl, cleanCommand,
  normalizeMenus, findMenu, rootMenus, descendantMenuIds,
  visibleButtons, buildMenuKeyboard, buildRootKeyboard,
  parseMenuTarget, parseButtonTarget,
  addMenu, deleteMenu, addButton, deleteButton, moveButton, updateButton,
  ensureVideoMenu, menuAdminListText,
} from "../src/menu-builder.js";
import { S } from "../src/menu-studio.js";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("menu-builder: normalizeMenus drops invalid menus/buttons and re-roots orphans", () => {
  const { menus } = normalizeMenus({ menus: [
    { id: "m_a", title: "أ", text: "نص أ", parentId: "m_missing", buttons: [{ id: "b_1", label: "زر", kind: "text", text: "مرحبا" }] },
    { id: "m_a", title: "مكرر", buttons: [] },
    { id: "", title: "بلا معرّف", buttons: [] },
    { id: "m_b", title: "", buttons: [] },
    { id: "m_c", title: "ج", buttons: [
      { id: "b_2", label: "رابط فاسد", kind: "url", url: "not-a-url" },
      { id: "b_3", label: "قائمة مفقودة", kind: "submenu", targetMenuId: "m_nope" },
      { id: "b_4", label: "أمر", kind: "command", command: "/quiz" },
    ] },
  ] });
  assert.equal(menus.length, 2);
  assert.equal(menus[0].parentId, null); // orphan parent -> root
  assert.equal(menus[0].buttons.length, 1);
  assert.equal(menus[1].buttons.length, 1); // only the valid command button survives
  assert.equal(menus[1].buttons[0].kind, "command");
});

test("menu-builder: keyboard hides admin-only buttons from users, shows 🔒 to admins, adds back", () => {
  const { menus } = normalizeMenus({ menus: [
    { id: "m_p", title: "رئيسية", text: "t", buttons: [] },
    { id: "m_c", title: "فرعية", text: "t", parentId: "m_p", buttons: [
      { id: "b_pub", label: "عام", kind: "text", text: "x" },
      { id: "b_adm", label: "سري", kind: "text", text: "y", adminOnly: true },
      { id: "b_url", label: "يوتيوب", kind: "url", url: "https://example.com" },
    ] },
  ] });
  const child = findMenu(menus, "m_c");
  const userKb = buildMenuKeyboard(menus, child, false);
  assert.equal(userKb.inline_keyboard.length, 3); // عام + رابط + رجوع
  assert.ok(!JSON.stringify(userKb).includes("سري"));
  assert.ok(userKb.inline_keyboard.at(-1)[0].callback_data === "mb|open|m_p");
  const adminKb = buildMenuKeyboard(menus, child, true);
  assert.equal(adminKb.inline_keyboard.length, 4);
  assert.ok(JSON.stringify(adminKb).includes("🔒 سري"));
  const urlRow = userKb.inline_keyboard.find((r) => r[0].url);
  assert.equal(urlRow[0].url, "https://example.com");
  const rootKb = buildRootKeyboard(menus);
  assert.equal(rootKb.inline_keyboard.length, 1); // only the root menu
  assert.equal(rootKb.inline_keyboard[0][0].callback_data, "mb|open|m_p");
});

test("menu-builder: callback_data stays short, ids are stable and unique", () => {
  const a = makeMenuId(1795000000000);
  const b = makeButtonId(1795000000000, "zz");
  assert.match(a, /^m_[0-9a-z]+$/u);
  assert.notEqual(a, b);
  assert.ok(`mb|btn|${a}|${b}`.length < 64);
  assert.equal(makeMenuId(1795000000000), a);
});

test("menu-builder: cleanUrl / cleanCommand accept only real values", () => {
  assert.equal(cleanUrl("https://youtube.com/watch?v=1"), "https://youtube.com/watch?v=1");
  assert.equal(cleanUrl("javascript:alert(1)"), "");
  assert.equal(cleanUrl("ftp://x"), "");
  assert.equal(cleanCommand("/quiz"), "/quiz");
  assert.equal(cleanCommand("/VIDEOLessons"), "/videolessons");
  assert.equal(cleanCommand("/deleteword"), "");
  assert.equal(cleanCommand("quiz"), "");
});

test("menu-builder: addMenu caps at 20 and rejects bad parents/titles", () => {
  let state = { menus: [] };
  for (let i = 0; i < 21; i++) {
    const r = addMenu(state, { title: `قائمة ${i}` });
    state = r.menus;
    if (i < 20) assert.ok(r.menu, `menu ${i} should be created`);
    else assert.equal(r.menu, null);
  }
  assert.equal(addMenu(state, { title: "   " }).menu, null);
  assert.equal(addMenu(state, { title: "x", parentId: "m_nope" }).menu, null);
  assert.equal(state.menus.length, 20);
});

test("menu-builder: deleteMenu re-parents children and drops dangling submenu buttons", () => {
  let state = { menus: [
    { id: "m_root", title: "ر", text: "t", buttons: [{ id: "b_go", label: "إلى فرعية", kind: "submenu", targetMenuId: "m_sub" }] },
    { id: "m_sub", title: "ف", text: "t", parentId: "m_root", buttons: [] },
    { id: "m_kid", title: "حفيد", text: "t", parentId: "m_sub", buttons: [] },
  ] };
  const r = deleteMenu(state, "2");
  assert.equal(r.removed.id, "m_sub");
  assert.equal(r.menus.menus.length, 2);
  assert.equal(findMenu(r.menus, "m_kid").parentId, "m_root"); // re-parented up
  assert.equal(findMenu(r.menus, "m_root").buttons.length, 0); // dangling button dropped
  assert.equal(deleteMenu(state, "99").removed, null);
});

test("menu-builder: addButton / deleteButton / moveButton / updateButton", () => {
  let state = { menus: [{ id: "m_1", title: "ق", text: "t", buttons: [] }] };
  const kinds = ["text", "photo", "video", "audio", "document", "url", "popup", "submenu", "command"];
  assert.equal(kinds.length, BUTTON_KINDS.length);
  let r1 = addButton(state, "m_1", { label: "نص", kind: "text", text: "أهلا" });
  assert.ok(r1.button);
  state = r1.menus;
  let r2 = addButton(state, "m_1", { label: "فيديو", kind: "video", fileId: "VID9" });
  assert.ok(r2.button);
  state = r2.menus;
  assert.equal(addButton(state, "m_1", { label: "x", kind: "nope" }).button, null);
  assert.equal(addButton(state, "m_1", { label: "x", kind: "url", url: "bad" }).button, null);
  // move second button up -> first
  const moved = moveButton(state, "m_1", r2.button.id, "up");
  assert.equal(moved.moved, true);
  assert.equal(moved.menus.menus[0].buttons[0].id, r2.button.id);
  assert.equal(moveButton(moved.menus, "m_1", r2.button.id, "up").moved, false); // top already
  // relabel only
  const upd = updateButton(moved.menus, "m_1", r2.button.id, { label: "فيديو جديد" });
  assert.equal(upd.button.label, "فيديو جديد");
  assert.equal(upd.button.kind, "video"); // kind never changes on edit
  // delete by number
  const del = deleteButton(upd.menus, "m_1", "2");
  assert.equal(del.removed.label, "نص");
  assert.equal(del.menus.menus[0].buttons.length, 1);
  assert.equal(deleteButton(del.menus, "m_1", "5").removed, null);
});

test("menu-builder: parse targets by number or id", () => {
  const state = { menus: [
    { id: "m_a", title: "أ", text: "t", buttons: [{ id: "b_1", label: "واحد", kind: "text", text: "x" }] },
    { id: "m_b", title: "ب", text: "t", buttons: [] },
  ] };
  assert.equal(parseMenuTarget("2", state).menu.id, "m_b");
  assert.equal(parseMenuTarget("m_a", state).menu.id, "m_a");
  assert.equal(parseMenuTarget("0", state), null);
  assert.equal(parseButtonTarget("1", state.menus[0]).button.id, "b_1");
  assert.equal(parseButtonTarget("b_1", state.menus[0]).button.id, "b_1");
  assert.equal(parseButtonTarget("b_x", state.menus[0]), null);
});

test("menu-builder: ensureVideoMenu creates the video menu exactly once", () => {
  const first = ensureVideoMenu({ menus: [] });
  assert.equal(first.created, true);
  assert.equal(first.menu.id, VIDEO_MENU_ID);
  assert.equal(first.menu.title, "🎬 دروس فيديو");
  const second = ensureVideoMenu(first.menus);
  assert.equal(second.created, false);
  assert.equal(second.menus.menus.length, 1);
  // a video button can be added to it like any menu button
  const added = addButton(second.menus, VIDEO_MENU_ID, { label: "الدرس الأول", kind: "video", fileId: "VID1" });
  assert.ok(added.button);
  assert.equal(added.menus.menus[0].buttons[0].kind, "video");
});

test("menu-builder: descendantMenuIds blocks submenu cycles", () => {
  const state = { menus: [
    { id: "m_a", title: "أ", text: "t", buttons: [] },
    { id: "m_b", title: "ب", text: "t", parentId: "m_a", buttons: [] },
    { id: "m_c", title: "ج", text: "t", parentId: "m_b", buttons: [] },
  ] };
  const desc = descendantMenuIds(state, "m_a");
  assert.ok(desc.has("m_b") && desc.has("m_c") && !desc.has("m_a"));
  assert.equal(descendantMenuIds(state, "m_c").size, 0);
});

test("menu-builder: menuAdminListText lists menus with parents", () => {
  const text = menuAdminListText({ menus: [
    { id: "m_a", title: "أ", text: "t", buttons: [{ id: "b_1", label: "x", kind: "text", text: "y" }] },
  ] });
  assert.match(text, /1\. أ/);
  assert.match(text, /رئيسية/);
  assert.match(text, /1 زر/);
});

// ---------------------------------------------------------------------------
// Worker integration (same harness shape as test/new-features.test.js)
// ---------------------------------------------------------------------------

import records from "../data/dictionary.json" with { type: "json" };
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
const fakeOgg = () => new Response(new Uint8Array([79, 103, 103, 83, 1, 2, 3]), { headers: { "content-type": "audio/ogg" } });
const isGeneratedAudio = (url) => String(url).includes("raw.githubusercontent.com/abr429701-oss/coptic-dictionary-bot/audio/");
function fakeTelegramApi(calls) {
  globalThis.fetch = async (url, options = {}) => {
    if (isGeneratedAudio(url)) return fakeOgg();
    const body = options.body;
    const payload = !body ? null : typeof body === "string" ? JSON.parse(body) : Object.fromEntries(body.entries());
    calls.push({ url: String(url), options, payload });
    return Response.json({ ok: true, result: { message_id: 900 } });
  };
}
function updateRequest(update, headers = {}) {
  return new Request("https://bot.test/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret, ...headers },
    body: JSON.stringify(update),
  });
}
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
    store, alarms, object,
    idFromName: (name) => name,
    get: () => ({ fetch: (url, options) => object.fetch(new Request(url, options)) }),
  };
}
async function sendUpdate(kvEnv, update) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest(update), kvEnv);
  return calls;
}
async function say(kvEnv, userId, text) {
  return sendUpdate(kvEnv, { message: { text, chat: { id: userId, type: "private" }, from: { id: userId } } });
}
async function sendCallback(kvEnv, userId, data, messageId = 5) {
  return sendUpdate(kvEnv, { callback_query: { id: "cb1", data, from: { id: userId }, message: { message_id: messageId, chat: { id: userId, type: "private" }, text: "x" } } });
}
const ADMIN = 813894692;
const sent = (calls) => calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => c.payload);
const videos = (calls) => calls.filter((c) => c.url.endsWith("/sendVideo")).map((c) => c.payload);
// Background jobs (new-user notice, weekly summary) also send messages to the
// admin chat, so assertions must look at the messages for the target chat.
const toChat = (calls, chatId) => sent(calls).filter((m) => String(m.chat_id) === String(chatId));
const anyText = (calls, chatId, re) => toChat(calls, chatId).some((m) => re.test(m.text ?? ""));
const nowIso = () => new Date().toISOString();
const storedMenus = (kvEnv) => kvEnv.USERS.store.get(MENUS_KEY)?.menus ?? [];
const labelsOf = (message) => (message?.reply_markup?.keyboard ?? []).flat().map((b) => b.text);
const noInline = (calls) => !calls.some((c) => JSON.stringify(c.payload?.reply_markup ?? {}).includes("inline_keyboard"));

test("menu-builder: /menu empty state, /menuadmin is admin-only", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const empty = await say(kvEnv, 51, "/menu");
  assert.ok(anyText(empty, 51, /لا توجد قوائم مخصصة/));
  const denied = await say(kvEnv, 51, "/menuadmin");
  assert.ok(anyText(denied, 51, /للأدمن فقط/));
  const deniedAdd = await say(kvEnv, 51, "/addvideo درس");
  assert.ok(anyText(deniedAdd, 51, /للأدمن فقط/));
});

test("menu-builder: /menuadmin studio builds a menu that users open from bottom buttons", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const started = await say(kvEnv, ADMIN, "/addmenu");
  assert.ok(anyText(started, ADMIN, /محرر القوائم/));
  assert.ok(noInline(sent(started)), "the retired /addmenu must not send an inline panel");
  const prompt = await say(kvEnv, ADMIN, S.NEW);
  assert.ok(anyText(prompt, ADMIN, /عنوان القائمة/));
  const done = await say(kvEnv, ADMIN, "قائمة التعلم");
  assert.equal(storedMenus(kvEnv).length, 1);
  assert.equal(storedMenus(kvEnv)[0].title, "قائمة التعلم");
  assert.ok(anyText(done, ADMIN, /قائمة التعلم/));
  assert.ok(noInline(sent(done)));

  const list = await say(kvEnv, 53, "/menu");
  assert.ok(labelsOf(toChat(list, 53).at(-1)).includes("قائمة التعلم"));
  const opened = await say(kvEnv, 53, "قائمة التعلم");
  assert.ok(anyText(opened, 53, /قائمة التعلم/));
  assert.ok(noInline(sent(opened)));
});

test("menu-builder: a button built with the studio panels answers a user tap", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await say(kvEnv, ADMIN, "/menuadmin");
  await say(kvEnv, ADMIN, S.NEW);
  await say(kvEnv, ADMIN, "قائمة الاختبار");
  await say(kvEnv, ADMIN, S.ADDBTN);
  const kinds = await say(kvEnv, ADMIN, "نص");
  assert.ok(anyText(kinds, ADMIN, /تسمية الزر/));
  await say(kvEnv, ADMIN, "ترحيب");
  const content = await say(kvEnv, ADMIN, "أهلًا بالجميع!");
  assert.ok(anyText(content, ADMIN, /قائمة الاختبار/));
  assert.equal(storedMenus(kvEnv)[0].buttons.length, 1);
  assert.equal(storedMenus(kvEnv)[0].buttons[0].kind, "text");
  assert.equal(storedMenus(kvEnv)[0].buttons[0].label, "ترحيب");

  await say(kvEnv, 55, "/menu");
  const opened = await say(kvEnv, 55, "قائمة الاختبار");
  assert.ok(labelsOf(toChat(opened, 55).at(-1)).includes("ترحيب"));
  const tapped = await say(kvEnv, 55, "ترحيب");
  assert.ok(anyText(tapped, 55, /أهلًا بالجميع!/));
});

test("menu-builder: a submenu is created inside a menu and linked back automatically", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await say(kvEnv, ADMIN, "/menuadmin");
  await say(kvEnv, ADMIN, S.NEW);
  await say(kvEnv, ADMIN, "أب");
  const ask = await say(kvEnv, ADMIN, S.NEWSUB);
  assert.ok(anyText(ask, ADMIN, /القائمة الفرعية/));
  await say(kvEnv, ADMIN, "ابن");
  assert.equal(storedMenus(kvEnv).length, 2);
  const parent = storedMenus(kvEnv).find((m) => m.title === "أب");
  const child = storedMenus(kvEnv).find((m) => m.title === "ابن");
  assert.equal(child.parentId, parent.id);
  assert.equal(parent.buttons.length, 1);
  assert.equal(parent.buttons[0].kind, "submenu");
  assert.equal(parent.buttons[0].targetMenuId, child.id);
  // the user walks أب -> ابن from bottom buttons only
  await say(kvEnv, 61, "/menu");
  await say(kvEnv, 61, "أب");
  const childMenu = await say(kvEnv, 61, "ابن");
  assert.ok(anyText(childMenu, 61, /ابن/));
  assert.ok(noInline(sent(childMenu)));
});

test("menu-builder: the menu panel offers a link button and linking stores a submenu button", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set(MENUS_KEY, { menus: [
    { id: "m_a", title: "أولى", text: "أ", buttons: [] },
    { id: "m_b", title: "ثانية", text: "ب", buttons: [] },
  ] });
  const panel = await say(kvEnv, ADMIN, "/menuadmin");
  assert.ok(noInline(sent(panel)));
  const kb = toChat(panel, ADMIN).at(-1)?.reply_markup?.keyboard ?? [];
  const flat = kb.flat().map((b) => b.text);
  assert.ok(flat.includes(S.NEW) && flat.includes(S.MENUS), flat.join("|"));
  // the panel that owns the link action is the per-menu panel
  await say(kvEnv, ADMIN, S.MENUS);
  const opened = await say(kvEnv, ADMIN, "1. أولى");
  const menuKb = toChat(opened, ADMIN).at(-1)?.reply_markup?.keyboard ?? [];
  const menuLabels = menuKb.flat().map((b) => b.text);
  assert.ok(menuLabels.includes(S.LINK), `menu panel labels: ${menuLabels.join("|")}`);
  assert.ok(menuLabels.includes(S.NEWSUB));
  // and the stored tree accepts the link exactly the way the panel writes it
  const linked = addButton({ menus: storedMenus(kvEnv) }, "m_a", { label: "ثانية", kind: "submenu", targetMenuId: "m_b" });
  assert.equal(linked.button?.kind, "submenu");
  assert.equal(linked.button?.targetMenuId, "m_b");
});

test("menu-builder: a video lesson is added from the studio and played for users", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await say(kvEnv, ADMIN, "/menuadmin");
  await say(kvEnv, ADMIN, S.VIDEO);
  assert.ok(storedMenus(kvEnv).some((m) => m.id === VIDEO_MENU_ID));
  await say(kvEnv, ADMIN, S.ADDBTN);
  const asked = await say(kvEnv, ADMIN, "فيديو");
  assert.ok(anyText(asked, ADMIN, /تسمية الزر/));
  const askedFile = await say(kvEnv, ADMIN, "الدرس الأول");
  assert.ok(anyText(askedFile, ADMIN, /أرسل الملف/));
  await sendUpdate(kvEnv, { message: { video: { file_id: "VID_TEST_1", file_unique_id: "UQ1" }, chat: { id: ADMIN, type: "private" }, from: { id: ADMIN } } });
  const vid = storedMenus(kvEnv).find((m) => m.id === VIDEO_MENU_ID);
  assert.equal(vid.buttons.length, 1);
  assert.equal(vid.buttons[0].fileId, "VID_TEST_1");
  const list = await say(kvEnv, 57, "/videolessons");
  assert.ok(anyText(list, 57, /دروس فيديو|الدرس الأول/));
  const played = await sendCallback(kvEnv, 57, `mb|btn|${VIDEO_MENU_ID}|${vid.buttons[0].id}`);
  assert.equal(videos(played)[0]?.video, "VID_TEST_1");
});

test("menu-builder: the whole /menuadmin flow never sends an inline keyboard", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const all = [];
  const step = async (text) => { const calls = await say(kvEnv, ADMIN, text); all.push(...calls); return calls; };
  await step("/menuadmin");
  await step(S.NEW);
  await step("قائمة نظيفة");
  await step(S.TITLE);
  await step("عنوان جديد");
  await step(S.TEXT);
  await step("نص جديد");
  await step(S.ROWS);
  await step("1");
  await step(S.ADDBTN);
  await step("رابط");
  await step("زر رابط");
  await step("https://example.com/x");
  await step(S.PREVIEW);
  await step(S.ADDBTN);
  await step("نص");
  await step("زر نص");
  await step("محتوى الزر");
  await step(S.NEWSUB);
  await step("فرعية تجريبية");
  await step(S.BACK);
  await step(S.LINK);
  await step(S.STATS);
  await step(S.BACK);
  await step(S.TREE);
  await step(S.MENUS);
  await step(S.BACK);
  await step(S.BACKUP);
  await step(S.TOOLS);
  await step(S.BACK);
  await step(S.IMPORT);
  await step(S.BACK);
  await step(S.EXIT);
  assert.ok(all.length > 20, "the flow must produce messages");
  assert.ok(noInline(all), "no inline_keyboard anywhere in the admin flow");
  const keyboards = all.filter((c) => c.payload?.reply_markup?.keyboard);
  assert.ok(keyboards.length >= 15, "every panel is a bottom keyboard");
});
