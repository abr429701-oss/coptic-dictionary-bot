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
const ALL_COMMANDS_COUNT = 333;

const PAGE_SIZE = 40;
const PAGES = Math.ceil(ALL_COMMANDS_COUNT / PAGE_SIZE);
const edits = (calls) => calls.filter((c) => c.url.endsWith("/editMessageText")).map((c) => c.payload);

test("admin-all-commands: the /admin dashboard carries a كل الأوامر button", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = await say(kvEnv, ADMIN, "/admin");
  const dashboard = sent(calls).find((p) => String(p.text ?? "").includes("لوحة تحكم الأدمن"));
  assert.ok(dashboard, "/admin must show the admin dashboard");
  const buttons = (dashboard.reply_markup?.inline_keyboard ?? []).flat();
  const all = buttons.find((b) => b.callback_data === "ad|allcommands");
  assert.ok(all, "the dashboard must have a كل الأوامر button");
  assert.equal(all.text, "📋 كل الأوامر");
});

test("admin-all-commands: كل الأوامر opens a paginated button grid, no text list", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = await adminCallback(kvEnv, ADMIN, "ad|allcommands");
  assert.equal(sent(calls).length, 0, "the grid must not send the old text list");
  const [page1] = edits(calls);
  assert.ok(page1, "opening كل الأوامر edits the message into the grid");
  assert.match(String(page1.text), /صفحة 1 من 9/, "page 1 of 9");
  assert.match(String(page1.text), /333 أمر/, "the grid states the full count");
  const rows = page1.reply_markup?.inline_keyboard ?? [];
  const cmdButtons = rows.flat().filter((b) => String(b.callback_data ?? "").startsWith("ad|run|"));
  assert.equal(cmdButtons.length, PAGE_SIZE, "page 1 carries 40 command buttons");
  assert.equal(cmdButtons[0].text, "/start", "the first button is /start");
  assert.ok(cmdButtons.every((b) => b.text === `/${String(b.callback_data).split("|")[2]}`), "each button shows its command");
  const nav = rows.at(-1).map((b) => b.text);
  assert.deepEqual(nav, ["🏠 اللوحة", "التالي »"], "page 1 has home + next, no prev");
  const page2calls = await adminCallback(kvEnv, ADMIN, "ad|allcmd|2");
  const [page2] = edits(page2calls);
  assert.match(String(page2.text), /صفحة 2 من 9/, "next opens page 2");
  assert.notEqual(page2.reply_markup.inline_keyboard[0][0].text, "/start", "page 2 shows different commands");
  assert.deepEqual(page2.reply_markup.inline_keyboard.at(-1).map((b) => b.text), ["« السابق", "🏠 اللوحة", "التالي »"], "page 2 has prev + home + next");
  const lastCalls = await adminCallback(kvEnv, ADMIN, `ad|allcmd|${PAGES}`);
  const [last] = edits(lastCalls);
  assert.match(String(last.text), new RegExp(`صفحة ${PAGES} من ${PAGES}`), "the last page opens");
  assert.equal(last.reply_markup.inline_keyboard.flat().filter((b) => String(b.callback_data ?? "").startsWith("ad|run|")).length, ALL_COMMANDS_COUNT - PAGE_SIZE * (PAGES - 1), "the last page carries the remainder");
});

test("admin-all-commands: tapping a command button runs it like typed text", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const onCalls = await adminCallback(kvEnv, ADMIN, "ad|run|livemon|1");
  assert.ok(toAdmin(onCalls).some((p) => /تم تشغيل المراقبة المباشرة/u.test(String(p.text ?? ""))), "tapping /livemon toggles the monitor on");
  const offCalls = await adminCallback(kvEnv, ADMIN, "ad|run|livemon|1");
  assert.ok(toAdmin(offCalls).some((p) => /تم إيقاف المراقبة المباشرة/u.test(String(p.text ?? ""))), "tapping /livemon again toggles it off");
  const usageCalls = await adminCallback(kvEnv, ADMIN, "ad|run|userchat|1");
  assert.ok(toAdmin(usageCalls).some((p) => String(p.text ?? "").includes("/userchat")), "tapping an arg-command runs its bare form, which explains the usage");
});

test("admin-all-commands: a destructive command asks for confirmation first", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const askCalls = await adminCallback(kvEnv, ADMIN, "ad|run|resetstats|1");
  assert.equal(sent(askCalls).length, 0, "tapping /resetstats must not run it at once");
  const [confirm] = edits(askCalls);
  assert.ok(confirm, "tapping a destructive command shows a confirm screen");
  assert.match(String(confirm.text), /يمسح بيانات نهائيًا/, "the confirm screen warns about data loss");
  const confirmBtn = (confirm.reply_markup?.inline_keyboard ?? []).flat().find((b) => b.callback_data === "ad|confirm|resetstats|1");
  assert.ok(confirmBtn, "the confirm screen has a تأكيد التشغيل button");
  assert.ok((confirm.reply_markup?.inline_keyboard ?? []).flat().some((b) => b.callback_data === "ad|allcmd|1"), "the confirm screen has a cancel path back to the grid");
  const runCalls = await adminCallback(kvEnv, ADMIN, "ad|confirm|resetstats|1");
  assert.ok(toAdmin(runCalls).some((p) => /تم تصفير التحليلات/u.test(String(p.text ?? ""))), "confirming runs the command");
  assert.ok(edits(runCalls).some((p) => /صفحة 1 من 9/u.test(String(p.text ?? ""))), "after confirming, the message returns to the grid");
});

test("admin-all-commands: a non-admin gets nothing from the grid buttons", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = await adminCallback(kvEnv, 57, "ad|allcommands");
  assert.equal(sent(calls).length, 0, "the grid is admin-only");
  assert.equal(edits(calls).length, 0, "no grid edit for a non-admin");
});
