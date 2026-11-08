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
const ADMIN = 813894692;
const sent = (calls) => calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => c.payload);
const nowIso = () => new Date().toISOString();
function seedUser(kvEnv, id, name) {
  kvEnv.USERS.store.set(`user:${id}`, { name, registeredAt: nowIso(), firstSeen: nowIso(), lastSeen: nowIso() });
}
const NINE = ["start", "keyboard", "learn", "fav", "myfav", "mystats", "menu", "contact", "random"];
const NINE_DESCRIPTIONS = {
  start: "بدء استخدام القاموس",
  keyboard: "لوحة مفاتيح قبطية لكتابة الكلمات",
  learn: "بوت تعلم اللغة القبطية من الصفر",
  fav: "حفظ آخر كلمة بحثت عنها",
  myfav: "كلماتك المفضلة",
  mystats: "إحصاءاتك ونقاطك",
  menu: "القوائم والدروس",
  contact: "تواصل مع الإدارة",
  random: "كلمة عشوائية",
};

// Runs first: it is the only test that triggers the user setMyCommands
// (the menu is cached per Worker isolate afterwards).
test("user-menu: hidden user commands are unhidden once, and the side menu lists exactly the nine", async () => {
  invalidateHiddenUiCache();
  const kvEnv = { ...env, USERS: fakeKv() };
  seedUser(kvEnv, 61, "مينا");
  // The admin had hidden /contact and /random before with /hidebutton.
  kvEnv.USERS.store.set("hidden_ui:v1", { command: ["contact", "random", "quiz"], text: [], callback: [] });
  const calls = await say(kvEnv, 61, "/start");
  const setCommands = calls.find((c) => c.url.endsWith("/setMyCommands") && !c.payload?.scope);
  assert.ok(setCommands, "user setMyCommands must be sent on /start");
  const commands = setCommands.payload?.commands ?? [];
  assert.deepEqual(commands.map((c) => c.command), NINE, "the user menu lists exactly the nine chosen commands, in order");
  for (const c of commands) assert.equal(c.description, NINE_DESCRIPTIONS[c.command], `/${c.command} keeps its description`);
  const hidden = kvEnv.USERS.store.get("hidden_ui:v1");
  assert.ok(!hidden.command.includes("contact") && !hidden.command.includes("random"), "the nine are unhidden by the one-time migration");
  assert.ok(hidden.command.includes("quiz"), "other hidden commands stay hidden");
  assert.equal(kvEnv.USERS.store.get("usermenu:v1:migrated"), true, "the migration marker is set so the cleanup runs once");
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
