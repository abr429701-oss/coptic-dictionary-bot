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
    const isNotice = String(url).endsWith("/sendMessage") && String(payload?.chat_id) === "813894692" &&
      /^(🆕|✅ أكمل التسجيل)/u.test(payload?.text ?? "");
    if (isNotice) (calls.notices ??= []).push(payload);
    else calls.push({ url: String(url), options, payload });
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
async function say(envWithKv, userId, text, firstName) {
  const calls = [];
  fakeTelegramApi(calls);
  const from = { id: userId };
  if (firstName) from.first_name = firstName;
  await worker.fetch(updateRequest({ message: { text, chat: { id: userId, type: "private" }, from } }), envWithKv);
  return calls;
}
async function sayPhoto(envWithKv, userId, caption, firstName) {
  const calls = [];
  fakeTelegramApi(calls);
  const from = { id: userId };
  if (firstName) from.first_name = firstName;
  await worker.fetch(updateRequest({ message: { photo: [{ file_id: "P", file_unique_id: "UP" }], caption, chat: { id: userId, type: "private" }, from } }), envWithKv);
  return calls;
}
const ADMIN = 813894692;
const sent = (calls) => calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => c.payload);
const toAdmin = (calls) => sent(calls).filter((p) => p.chat_id === ADMIN);
async function adminCallback(kvEnv, id, data) {
  const calls = [];
  fakeTelegramApi(calls);
  await worker.fetch(updateRequest({
    callback_query: { id: "ac1", data, from: { id }, message: { message_id: 600, chat: { id }, text: "x" } },
  }), kvEnv);
  return calls;
}
const ALL_COMMANDS_COUNT = 330;

const CATEGORY_IDS = ["main", "stats", "voices", "drive", "users", "dict", "broadcast", "system", "advanced", "learn", "support", "security", "menus"];
const CATEGORY_TITLES = {
  main: "⭐ الأوامر الأساسية", stats: "📊 الإحصاءات والتقارير", voices: "🎙 الأصوات",
  drive: "☁️ Drive والمزامنة", users: "👥 المستخدمون", dict: "📖 القاموس",
  broadcast: "📢 البث والإرسال", system: "⚙️ أدوات النظام", advanced: "🔧 أدوات متقدمة",
  learn: "🎓 التعلم والاختبارات", support: "💬 الدعم والتواصل", security: "🔐 الأمان والصلاحيات",
  menus: "🎛 القوائم والبوت",
};
const edits = (calls) => calls.filter((c) => c.url.endsWith("/editMessageText")).map((c) => c.payload);

test("admin-all-commands: the /admin dashboard lists the command categories by their Arabic names", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = await say(kvEnv, ADMIN, "/admin");
  const dashboard = sent(calls).find((p) => String(p.text ?? "").includes("لوحة تحكم الأدمن"));
  assert.ok(dashboard, "/admin must show the admin dashboard");
  const buttons = (dashboard.reply_markup?.inline_keyboard ?? []).flat();
  assert.ok(!buttons.some((b) => b.callback_data === "ad|allcommands"), "there is no single كل الأوامر button anymore");
  for (const id of CATEGORY_IDS) {
    const btn = buttons.find((b) => b.callback_data === `ad|cmdcat|${id}`);
    assert.ok(btn, `the dashboard must have a button for ${id}`);
    assert.equal(btn.text, CATEGORY_TITLES[id], `the ${id} button shows its Arabic name`);
  }
});

test("admin-all-commands: every command sits in exactly one category, nothing missing", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const seen = [];
  for (const id of CATEGORY_IDS) {
    const calls = await adminCallback(kvEnv, ADMIN, `ad|cmdcat|${id}`);
    // A background admin job (e.g. the weekly summary tick) may legitimately
    // send a message on some updates, so assert on the content instead of silence:
    // no sent message may be the old text command list ("/name — description" lines).
    assert.ok(!sent(calls).some((p) => /\/[a-z0-9_]+ — /u.test(String(p.text ?? ""))), `opening ${id} must not send a text list`);
    const [page] = edits(calls);
    assert.ok(page, `opening ${id} edits the message into its menu`);
    assert.match(String(page.text), new RegExp(CATEGORY_TITLES[id].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `the ${id} page shows its Arabic title`);
    const cmdButtons = (page.reply_markup?.inline_keyboard ?? []).flat().filter((b) => String(b.callback_data ?? "").startsWith("ad|run|"));
    assert.ok(cmdButtons.length > 0, `${id} has command buttons`);
    assert.ok(cmdButtons.every((b) => b.text === `/${String(b.callback_data).split("|")[2]}`), "each button shows its command");
    assert.ok(cmdButtons.every((b) => String(b.callback_data).endsWith(`|${id}`)), "each button returns to its own category");
    const nav = page.reply_markup.inline_keyboard.at(-1).map((b) => b.text);
    assert.deepEqual(nav, ["🏠 اللوحة"], `${id} has a home button`);
    seen.push(...cmdButtons.map((b) => String(b.callback_data).split("|")[2]));
  }
  assert.equal(seen.length, ALL_COMMANDS_COUNT, "all 330 commands are listed");
  assert.equal(new Set(seen).size, ALL_COMMANDS_COUNT, "no command appears in two categories");
});

test("admin-all-commands: tapping a command button runs it like typed text", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const onCalls = await adminCallback(kvEnv, ADMIN, "ad|run|livemon|stats");
  assert.ok(toAdmin(onCalls).some((p) => /تم تشغيل المراقبة المباشرة/u.test(String(p.text ?? ""))), "tapping /livemon toggles the monitor on");
  const offCalls = await adminCallback(kvEnv, ADMIN, "ad|run|livemon|stats");
  assert.ok(toAdmin(offCalls).some((p) => /تم إيقاف المراقبة المباشرة/u.test(String(p.text ?? ""))), "tapping /livemon again toggles it off");
  const usageCalls = await adminCallback(kvEnv, ADMIN, "ad|run|userchat|stats");
  assert.ok(toAdmin(usageCalls).some((p) => String(p.text ?? "").includes("/userchat")), "tapping an arg-command runs its bare form, which explains the usage");
});

test("admin-all-commands: a destructive command asks for confirmation first", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const askCalls = await adminCallback(kvEnv, ADMIN, "ad|run|resetstats|advanced");
  assert.equal(sent(askCalls).length, 0, "tapping /resetstats must not run it at once");
  const [confirm] = edits(askCalls);
  assert.ok(confirm, "tapping a destructive command shows a confirm screen");
  assert.match(String(confirm.text), /يمسح بيانات نهائيًا/, "the confirm screen warns about data loss");
  const confirmBtn = (confirm.reply_markup?.inline_keyboard ?? []).flat().find((b) => b.callback_data === "ad|confirm|resetstats|advanced");
  assert.ok(confirmBtn, "the confirm screen has a تأكيد التشغيل button");
  assert.ok((confirm.reply_markup?.inline_keyboard ?? []).flat().some((b) => b.callback_data === "ad|cmdcat|advanced"), "the confirm screen has a cancel path back to its category");
  const runCalls = await adminCallback(kvEnv, ADMIN, "ad|confirm|resetstats|advanced");
  assert.ok(toAdmin(runCalls).some((p) => /تم تصفير التحليلات/u.test(String(p.text ?? ""))), "confirming runs the command");
  assert.ok(edits(runCalls).some((p) => /أدوات متقدمة/u.test(String(p.text ?? ""))), "after confirming, the message returns to its category");
});

test("admin-all-commands: a non-admin gets nothing from the category buttons", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = await adminCallback(kvEnv, 57, "ad|cmdcat|stats");
  assert.equal(sent(calls).length, 0, "the categories are admin-only");
  assert.equal(edits(calls).length, 0, "no category edit for a non-admin");
});
