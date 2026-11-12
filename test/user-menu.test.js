import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore } from "../src/index.js";
import { invalidateHiddenUiCache } from "../src/ui-visibility.js";
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
    store,
    alarms,
    object,
    idFromName: (name) => name,
    get: () => ({
      fetch: (url, options) => object.fetch(new Request(url, options)),
    }),
  };
}
async function say(envWithKv, userId, text) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({ message: { text, chat: { id: userId, type: "private" }, from: { id: userId, first_name: "Tester" } } }), envWithKv);
  return calls;
}

// setMyCommands is sent from a fire-and-forget inBackground() task on /start
// (in production it rides ctx.waitUntil; in tests there is no ctx, so the
// call races the assertion). Wait for it instead of assuming it already
// happened — the assertion itself stays strict.
async function waitForCall(calls, pred, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = calls.find(pred);
    if (found) return found;
    if (Date.now() >= deadline) return undefined;
    await new Promise((r) => setTimeout(r, 5));
  }
}
const ADMIN = 813894692;
const sent = (calls) => calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => c.payload);
const nowIso = () => new Date().toISOString();
function seedUser(kvEnv, id, name) {
  kvEnv.USERS.store.set(`user:${id}`, { name, registeredAt: nowIso(), firstSeen: nowIso(), lastSeen: nowIso() });
}
const SIX = ["start", "keyboard", "learn", "menu", "contact", "random"];
const SIX_DESCRIPTIONS = {
  start: "بدء استخدام القاموس",
  keyboard: "لوحة مفاتيح قبطية لكتابة الكلمات",
  learn: "بوت تعلم اللغة القبطية من الصفر",
  menu: "القوائم والدروس",
  contact: "تواصل مع الإدارة",
  random: "كلمة عشوائية",
};

// Runs first: it is the only test that triggers the user setMyCommands
// (the menu is cached per Worker isolate afterwards).
test("user-menu: hidden user commands are unhidden once, and the side menu lists exactly the six", async () => {
  invalidateHiddenUiCache();
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 61, "مينا");
  // The admin had hidden /contact and /random before with /hidebutton.
  kvEnv.USERS.store.set("hidden_ui:v1", { command: ["contact", "random", "quiz"], text: [], callback: [] });
  const calls = await say(kvEnv, 61, "/start");
  const setCommands = await waitForCall(calls, (c) => c.url.endsWith("/setMyCommands") && !c.payload?.scope);
  assert.ok(setCommands, "user setMyCommands must be sent on /start");
  const commands = setCommands.payload?.commands ?? [];
  assert.deepEqual(commands.map((c) => c.command), SIX, "the user menu lists exactly the six chosen commands, in order");
  for (const c of commands) assert.equal(c.description, SIX_DESCRIPTIONS[c.command], `/${c.command} keeps its description`);
  const hidden = kvEnv.USERS.store.get("hidden_ui:v1");
  assert.ok(!hidden.command.includes("contact") && !hidden.command.includes("random"), "the six are unhidden by the one-time migration");
  assert.ok(hidden.command.includes("quiz"), "other hidden commands stay hidden");
  assert.equal(kvEnv.USERS.store.get("usermenu:v2:migrated"), true, "the migration marker is set so the cleanup runs once");
});

test("user-menu: the /start commands list shows /menu after /learn", async () => {
  invalidateHiddenUiCache();
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 62, "مينا");
  const calls = await say(kvEnv, 62, "/start");
  const help = sent(calls).find((p) => String(p.text ?? "").includes("القاموس القبطي الناطق — الأوامر"));
  assert.ok(help, "the /start commands list is sent");
  const lines = String(help.text).split("\n");
  const general = lines.slice(lines.indexOf("🔹 <b>عامة</b>") + 1, lines.indexOf("💡 اكتب أي كلمة مباشرة للبحث: قبطي / عربي / إنجليزي / يوناني / فرنسي / ألماني."));
  assert.deepEqual(general, [
    "/start — بدء الاستخدام وإظهار القائمة",
    "/keyboard — لوحة مفاتيح قبطية",
    "/learn — تعلم اللغة القبطية",
    "/menu — القوائم والدروس",
    "/random — كلمة عشوائية من القاموس",
    "/contact — تواصل مع إدارة البوت (أو زر «📞 تواصل مع الإدارة»)",
  ], "the general section lists the six commands with /menu after /learn");
});

test("user-menu: a command hidden with /hidebutton disappears from the /start list for users, but not for the admin", async () => {
  invalidateHiddenUiCache();
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 63, "مينا");
  seedUser(kvEnv, ADMIN, "الأدمن");
  // The one-time migration already ran, so this hide sticks.
  kvEnv.USERS.store.set("usermenu:v1:migrated", true);
  kvEnv.USERS.store.set("hidden_ui:v1", { command: ["random"], text: [], callback: [] });
  const userCalls = await say(kvEnv, 63, "/start");
  const userHelp = sent(userCalls).find((p) => String(p.text ?? "").includes("القاموس القبطي الناطق — الأوامر"));
  assert.ok(userHelp, "the /start commands list is sent to the user");
  assert.ok(!String(userHelp.text).includes("/random —"), "the hidden /random line is gone for the user");
  assert.ok(String(userHelp.text).includes("/menu — القوائم والدروس"), "the other commands stay");
  const adminCalls = await say(kvEnv, ADMIN, "/start");
  const adminHelp = sent(adminCalls).find((p) => String(p.text ?? "").includes("القاموس القبطي الناطق — الأوامر"));
  assert.ok(adminHelp, "the /start commands list is sent to the admin");
  assert.ok(String(adminHelp.text).includes("/random — كلمة عشوائية من القاموس"), "the admin still sees the hidden command");
});

test("user-menu: /menu as admin opens the learn menus instead of the old custom-buttons reply", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, ADMIN, "الأدمن");
  kvEnv.USERS.store.set("menus:v1", { menus: [
    { id: "m_learn_l1", title: "المستوى الأول", text: "المستوى الأول", parentId: null, buttons: [{ id: "b1", label: "الدرس 1", kind: "lesson", lessonId: "L1-01" }] },
    { id: "m_learn_l2", title: "المستوى الثاني", text: "المستوى الثاني", parentId: null, buttons: [] },
  ] });
  const calls = await say(kvEnv, ADMIN, "/menu");
  const root = sent(calls).find((p) => String(p.text ?? "").includes("أختر المستوى لبدء تعلم اللغة القبطية"));
  assert.ok(root, "the admin sees the root menus");
  assert.ok(!sent(calls).some((p) => String(p.text ?? "").includes("لا توجد أزرار مخصصة")), "the old custom-buttons reply must not swallow /menu");
});

test("user-menu: /search leaves the menu and prompts for a word", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 63, "مينا");
  kvEnv.USERS.store.set("user:63", { ...kvEnv.USERS.store.get("user:63"), menuNav: "m_learn_l1" });
  const calls = await say(kvEnv, 63, "/search");
  const prompt = sent(calls).find((p) => String(p.text ?? "").includes("اكتب الكلمة للبحث في القاموس"));
  assert.ok(prompt, "the search prompt is sent");
  assert.equal(prompt.reply_markup?.remove_keyboard, true, "the menu keyboard is dropped");
  const after = kvEnv.USERS.store.get("user:63");
  assert.ok(!after?.menuNav, "the menu position is cleared");
});

test("user-menu: tapping the learn-menu search button leaves the menu and prompts for a word", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 64, "مينا");
  kvEnv.USERS.store.set("user:64", { ...kvEnv.USERS.store.get("user:64"), menuNav: "m_learn_l1" });
  kvEnv.USERS.store.set("menus:v1", { menus: [
    { id: "m_learn_l1", title: "المستوى الأول", text: "المستوى الأول", parentId: null, buttons: [
      { id: "b_search", label: "🔍 بحث في القاموس", kind: "command", command: "/search" },
      { id: "b_back", label: "🔙 رجوع", kind: "command", command: "/menu" },
    ] },
  ] });
  const calls = await say(kvEnv, 64, "🔍 بحث في القاموس");
  const prompt = sent(calls).find((p) => String(p.text ?? "").includes("اكتب الكلمة للبحث في القاموس"));
  assert.ok(prompt, "tapping the search button prompts for a word");
  assert.equal(prompt.reply_markup?.remove_keyboard, true, "the menu keyboard is dropped");
});

test("user-menu: /app sends a web_app button opening the learning app", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 63, "مينا");
  const calls = await say(kvEnv, 63, "/app");
  const appMsg = sent(calls).find((p) => String(p.text ?? "").includes("تطبيق التعلم"));
  assert.ok(appMsg, "the /app reply is sent");
  const button = appMsg.reply_markup?.inline_keyboard?.[0]?.[0];
  assert.ok(button?.web_app?.url, "the reply carries a web_app button");
  assert.equal(button.web_app.url, "https://coptic-dictionary-bot.abr429701.workers.dev/learn-app/?v=2");
});
