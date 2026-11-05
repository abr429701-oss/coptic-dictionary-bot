import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore } from "../src/index.js";
import { S, buildReplyMenuKeyboard, buildRootReplyKeyboard, applyRowPlan, resolveMenuLabel, layoutText } from "../src/menu-studio.js";
import { MENUS_KEY, normalizeMenus } from "../src/menu-builder.js";

// ---------------------------------------------------------------------------
// The admin studio must be built only from reply keyboards (real buttons under
// the message field). No inline keyboard and no callback data may be produced.
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

function fakeTelegramApi(calls) {
  return async (url, options = {}) => {
    const body = options.body;
    const payload = !body ? null : typeof body === "string" ? JSON.parse(body) : Object.fromEntries(body.entries());
    calls.push({ url: String(url), payload });
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
async function sendUpdate(kvEnv, update) {
  const calls = [];
  globalThis.fetch = fakeTelegramApi(calls);
  await worker.fetch(updateRequest(update), kvEnv);
  return calls;
}
const say = (kvEnv, userId, text) => sendUpdate(kvEnv, { message: { text, chat: { id: userId, type: "private" }, from: { id: userId } } });
const sent = (calls) => calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => c.payload);
const toChat = (calls, chatId) => sent(calls).filter((m) => String(m.chat_id) === String(chatId));
const anyText = (calls, chatId, re) => toChat(calls, chatId).some((m) => re.test(m.text ?? ""));
const labelsOf = (message) => (message?.reply_markup?.keyboard ?? []).flat().map((b) => b.text);
const storedMenus = (kvEnv) => kvEnv.USERS.store.get(MENUS_KEY)?.menus ?? [];
const ADMIN = 813894692;
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("menu-studio: the reply keyboard is a real bottom keyboard with no callback data", () => {
  const menus = normalizeMenus({ menus: [
    { id: "m_p", title: "رئيسية", text: "t", buttons: [{ id: "b_1", label: "أول", kind: "text", text: "x" }] },
  ] });
  const kb = buildReplyMenuKeyboard(menus, menus.menus[0], { isAdmin: true });
  assert.ok(Array.isArray(kb.keyboard));
  assert.equal(kb.resize_keyboard, true);
  assert.equal(kb.is_persistent, true);
  assert.equal(kb.inline_keyboard, undefined);
  assert.ok(!JSON.stringify(kb).includes("callback_data"));
  assert.ok(JSON.stringify(kb).includes("أول"));
  assert.ok(JSON.stringify(kb).includes(S.ADMIN));
  const root = buildRootReplyKeyboard(menus, { isAdmin: false });
  assert.equal(root.keyboard[0][0].text, "رئيسية");
  assert.equal(root.inline_keyboard, undefined);
});

test("menu-studio: rows plan groups buttons and layout text reports them", () => {
  const state = { menus: [{ id: "m_1", title: "ق", text: "t", buttons: [
    { id: "b_1", label: "أ", kind: "text", text: "1" },
    { id: "b_2", label: "ب", kind: "text", text: "2" },
    { id: "b_3", label: "ج", kind: "text", text: "3" },
  ] }] };
  const { menus, applied } = applyRowPlan(state, "m_1", "2,1");
  assert.equal(applied, true);
  const rows = menus.menus[0].buttons.map((b) => b.row);
  assert.deepEqual(rows, [0, 0, 1]);
  assert.match(layoutText(menus.menus[0]), /صف 1: 2 زر/);
  assert.match(layoutText(menus.menus[0]), /صف 2: 1 زر/);
  const kb = buildReplyMenuKeyboard(menus, menus.menus[0], {});
  assert.equal(kb.keyboard[0].length, 2);
  assert.equal(kb.keyboard[1].length, 1);
  assert.equal(applyRowPlan(state, "m_1", "").applied, false);
});

test("menu-studio: resolveMenuLabel maps a plain tap to a menu or a button", () => {
  const menus = normalizeMenus({ menus: [
    { id: "m_root", title: "الرئيسية", text: "r", buttons: [{ id: "b_go", label: "اذهب", kind: "submenu", targetMenuId: "m_sub" }] },
    { id: "m_sub", title: "فرعية", text: "s", parentId: "m_root", buttons: [{ id: "b_txt", label: "نص", kind: "text", text: "hi" }] },
  ] });
  assert.equal(resolveMenuLabel(menus, "الرئيسية", {}).kind, "menu");
  assert.equal(resolveMenuLabel(menus, "نص", { currentMenuId: "m_sub" }).button.id, "b_txt");
  assert.equal(resolveMenuLabel(menus, S.BACK, { currentMenuId: "m_sub" }).menu.id, "m_root");
  assert.equal(resolveMenuLabel(menus, S.ADMIN, { isAdmin: true }).kind, "admin");
  assert.equal(resolveMenuLabel(menus, "لا شيء", { currentMenuId: "m_sub" }), null);
});

// ---------------------------------------------------------------------------
// The admin studio, end to end
// ---------------------------------------------------------------------------

test("menu-studio: /menuadmin opens a reply keyboard and never an inline one", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = await say(kvEnv, ADMIN, "/menuadmin");
  const panel = toChat(calls, ADMIN).at(-1);
  assert.ok(panel, "the studio must answer");
  assert.ok(Array.isArray(panel.reply_markup?.keyboard), "a reply keyboard is required");
  assert.equal(panel.reply_markup?.inline_keyboard, undefined);
  assert.ok(!JSON.stringify(calls).includes("callback_data"));
  const labels = labelsOf(panel);
  for (const label of [S.MENUS, S.NEW, S.TREE, S.STATS, S.BACKUP, S.IMPORT, S.TOOLS, S.EXIT]) assert.ok(labels.includes(label), `${label} must be on the panel`);
});

test("menu-studio: an admin builds a menu and a button entirely with buttons and text", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set(`user:${ADMIN}`, { name: "أدمن", registeredAt: nowIso(), firstSeen: nowIso(), lastSeen: nowIso() });
  await say(kvEnv, ADMIN, "/menuadmin");
  const stepNew = await say(kvEnv, ADMIN, S.NEW);
  assert.ok(anyText(stepNew, ADMIN, /عنوان القائمة/));
  const stepTitle = await say(kvEnv, ADMIN, "قائمة الدروس");
  assert.ok(anyText(stepTitle, ADMIN, /قائمة الدروس/), "the new menu panel must open");
  const menu = storedMenus(kvEnv)[0];
  assert.equal(menu.title, "قائمة الدروس");
  assert.ok(labelsOf(toChat(stepTitle, ADMIN).at(-1)).includes(S.ADDBTN));

  const stepText = await say(kvEnv, ADMIN, S.TEXT);
  assert.ok(anyText(stepText, ADMIN, /نص الرسالة/));
  await say(kvEnv, ADMIN, "مرحبًا بكم في الدروس");
  assert.match(storedMenus(kvEnv)[0].text, /مرحبًا بكم/);

  const stepKind = await say(kvEnv, ADMIN, S.ADDBTN);
  assert.ok(JSON.stringify(toChat(stepKind, ADMIN).at(-1)).includes("نص"));
  await say(kvEnv, ADMIN, "نص");
  await say(kvEnv, ADMIN, "ابدأ هنا");
  const done = await say(kvEnv, ADMIN, "أهلًا بك!");
  assert.equal(storedMenus(kvEnv)[0].buttons.length, 1);
  assert.equal(storedMenus(kvEnv)[0].buttons[0].label, "ابدأ هنا");
  assert.equal(storedMenus(kvEnv)[0].buttons[0].kind, "text");
  assert.equal(storedMenus(kvEnv)[0].buttons[0].text, "أهلًا بك!");
  assert.equal(menu.id, storedMenus(kvEnv)[0].id);
  assert.ok(anyText(done, ADMIN, /ابدأ هنا/) || labelsOf(toChat(done, ADMIN).at(-1)).some((l) => l.includes("ابدأ هنا")));
});

test("menu-studio: rows, rename, lock and delete happen from the button panel", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set(`user:${ADMIN}`, { name: "أدمن", registeredAt: nowIso(), firstSeen: nowIso(), lastSeen: nowIso() });
  kvEnv.USERS.store.set(MENUS_KEY, { menus: [{
    id: "m_1", title: "ق", text: "t", buttons: [
      { id: "b_1", label: "أ", kind: "text", text: "1" },
      { id: "b_2", label: "ب", kind: "text", text: "2" },
      { id: "b_3", label: "ج", kind: "text", text: "3" },
    ],
  }] });
  await say(kvEnv, ADMIN, "/menuadmin");
  await say(kvEnv, ADMIN, S.MENUS);
  await say(kvEnv, ADMIN, "1. ق");
  const rowsStep = await say(kvEnv, ADMIN, S.ROWS);
  assert.ok(anyText(rowsStep, ADMIN, /صف/));
  await say(kvEnv, ADMIN, "2,1");
  assert.deepEqual(storedMenus(kvEnv)[0].buttons.map((b) => b.row), [0, 0, 1]);

  await say(kvEnv, ADMIN, "2. ب");
  assert.ok(anyText(await say(kvEnv, ADMIN, S.LABEL), ADMIN, /التسمية الحالية/));
  await say(kvEnv, ADMIN, "باء");
  assert.equal(storedMenus(kvEnv)[0].buttons[1].label, "باء");

  await say(kvEnv, ADMIN, "2. باء");
  await say(kvEnv, ADMIN, S.LOCK);
  assert.equal(storedMenus(kvEnv)[0].buttons[1].adminOnly, true);

  await say(kvEnv, ADMIN, "3. ج");
  await say(kvEnv, ADMIN, S.DEL);
  assert.equal(storedMenus(kvEnv)[0].buttons.length, 2);
  assert.equal(storedMenus(kvEnv)[0].buttons.some((b) => b.label === "ج"), false);
});

test("menu-studio: backup text can be imported back, and tools wipe everything", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set(`user:${ADMIN}`, { name: "أدمن", registeredAt: nowIso(), firstSeen: nowIso(), lastSeen: nowIso() });
  kvEnv.USERS.store.set(MENUS_KEY, { menus: [{ id: "m_x", title: "قديمة", text: "t", buttons: [] }] });
  await say(kvEnv, ADMIN, "/menuadmin");
  await say(kvEnv, ADMIN, S.BACKUP);
  const json = JSON.stringify({ menus: [{ id: "m_new", title: "مستوردة", text: "وصلت", buttons: [] }] });
  await say(kvEnv, ADMIN, S.IMPORT);
  await say(kvEnv, ADMIN, json);
  assert.equal(storedMenus(kvEnv)[0].title, "مستوردة");

  await say(kvEnv, ADMIN, "/menuadmin");
  await say(kvEnv, ADMIN, S.TOOLS);
  await say(kvEnv, ADMIN, S.WIPE);
  assert.equal(storedMenus(kvEnv).length, 0);
});

test("menu-studio: a user opens /menu and taps a real button (no callback data)", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set(MENUS_KEY, { menus: [
    { id: "m_r", title: "الرئيسية", text: "قائمة رئيسية", buttons: [
      { id: "b_sub", label: "إلى الفرعية", kind: "submenu", targetMenuId: "m_s" },
      { id: "b_txt", label: "رسالة", kind: "text", text: "محتوى الزر" },
    ] },
    { id: "m_s", title: "فرعية", text: "داخل الفرعية", parentId: "m_r", buttons: [] },
  ] });
  const list = await say(kvEnv, 700, "/menu");
  const panel = toChat(list, 700).at(-1);
  assert.ok(Array.isArray(panel.reply_markup?.keyboard));
  assert.equal(panel.reply_markup?.inline_keyboard, undefined);
  assert.ok(!JSON.stringify(toChat(list, 700)).includes("callback_data"));

  const opened = await say(kvEnv, 700, "الرئيسية");
  assert.ok(anyText(opened, 700, /قائمة رئيسية/));
  const kb = toChat(opened, 700).at(-1).reply_markup;
  assert.ok(Array.isArray(kb.keyboard));
  assert.ok(JSON.stringify(kb).includes("رسالة"));

  const pressed = await say(kvEnv, 700, "رسالة");
  assert.ok(anyText(pressed, 700, /محتوى الزر/));

  const sub = await say(kvEnv, 700, "إلى الفرعية");
  assert.ok(anyText(sub, 700, /داخل الفرعية/));
  const back = await say(kvEnv, 700, S.BACK);
  assert.ok(anyText(back, 700, /قائمة رئيسية/));
});

test("menu-studio: a normal dictionary word is not swallowed by the menu layer", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  kvEnv.USERS.store.set(MENUS_KEY, { menus: [{ id: "m_r", title: "الرئيسية", text: "r", buttons: [] }] });
  const calls = await say(kvEnv, 701, "ⲫⲱⲥ");
  assert.ok(calls.some((c) => c.url.endsWith("/sendMessage") || c.url.endsWith("/sendVoice")), "the search must run");
  assert.ok(!anyText(calls, 701, /^🔘 <b>القوائم<\/b>/u));
});
