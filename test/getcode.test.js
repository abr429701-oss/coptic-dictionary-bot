import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore } from "../src/index.js";
import { MENUS_KEY } from "../src/menu-builder.js";
import { LEARN_LEVELS } from "../src/learn-manifest.js";
import { buildLearnMenus, emptyImportState, learnUploadItems, LEARN_GET_CODE_TEXT } from "../src/learn-import.js";
import {
  GET_CODE_WHATSAPP_NUMBER,
  normalizeGetCodePhone,
  getCodePhoneValid,
  buildGetCodeWhatsAppUrl,
  buildGetCodeReply,
  getCodeFromMacro,
} from "../src/getcode.js";

// ---------------------------------------------------------------------------
// "الحصول على الرقم الكودي" (2026-11-09, corrected 2026-11-12 to the final
// system): the in-bot version of the Apps Script web form (the final
// project «المشروع النهائي للرقم الكودي»). The bot asks for the name,
// then the phone, then POSTs {name, phone} to the bot's own Apps Script
// web app (apps-script/Code.gs — generateAndStoreCode, copied verbatim
// from the final project): the code is 1234567 + last-8-digits, stored as
// [code, name, phone] in the "code" sheet (only when the phone is new);
// an existing phone returns the same code without storing. The bot shows the code
// with a ready WhatsApp link to 201207829388 — when the admin receives
// that message, the student's step is verified (a contact list cannot be
// checked from Telegram or a web page). Code.gs answers through its
// json_() helper, so the bot gets real JSON (the standalone project's
// doPost returned a plain object, which a web app cannot return —
// verified live 2026-11-09, and nothing was stored).
// ---------------------------------------------------------------------------

const token = "test-token";
const secret = "test-secret-should-be-long-enough";
const fakeMacroUrl = "https://script.google.com/macros/s/FAKECODE/exec";
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
const env = { TELEGRAM_BOT_TOKEN: token, WEBHOOK_SECRET: secret, ASSETS: fakeAssets, VOICE_CAPTION: "off", APPS_SCRIPT_URL: fakeMacroUrl };
const USER = 57;

// The Code.gs stub mirrors generateAndStoreCode: code = 1234567 + last 8
// digits of the phone. `macroMode` switches the stub's behaviour:
// "json" (Code.gs deployed), "html" (an outdated deployment: error page),
// "error" (HTTP 500).
let macroMode = "json";
let macroBodies = [];
let macroUrls = [];
function makeGetCodeFetchStub(calls) {
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.includes("api.telegram.org")) {
      const method = u.split("/").pop();
      let payload = null;
      if (typeof options.body === "string") {
        try { payload = JSON.parse(options.body); } catch { payload = null; }
      }
      calls.push({ method, payload });
      if (method === "sendMessage") return Response.json({ ok: true, result: { message_id: 900 } });
      return Response.json({ ok: true, result: {} });
    }
    if (u.includes("script.google.com/macros")) {
      const body = typeof options.body === "string" ? options.body : "";
      macroBodies.push(body);
      macroUrls.push(u);
      if (macroMode === "html") {
        return new Response("<html><head><title>Error</title></head><body>The script completed but the returned value is not a supported return type.</body></html>", { status: 200, headers: { "content-type": "text/html" } });
      }
      if (macroMode === "error") return new Response("error", { status: 500 });
      const parsed = JSON.parse(body);
      const digits = String(parsed.phone ?? "").replace(/\D/gu, "");
      const code = 1234567 + Number(digits.slice(-8));
      return Response.json({ success: true, code, message: "تم إنشاء الرقم الكودي وتخزين البيانات بنجاح" });
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
const messageTexts = (calls) => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload?.text ?? ""));
const anyMessage = (calls, re) => messageTexts(calls).some((t) => re.test(t));
function seedLevelMenus(kvEnv) {
  const state = emptyImportState();
  for (const item of learnUploadItems()) state.items[item.key] = { status: "done", fileId: `F_${item.key}`, fileUniqueId: "U", error: "", at: "" };
  const { menus } = buildLearnMenus(LEARN_LEVELS, state);
  kvEnv.USERS.store.set(MENUS_KEY, { menus });
}
async function sayMsg(kvEnv, userId, text) {
  const calls = [];
  makeGetCodeFetchStub(calls);
  await worker.fetch(updateRequest({ message: { text, chat: { id: userId, type: "private" }, from: { id: userId } } }), kvEnv);
  return calls;
}
async function openLevelAndTapGetCode(kvEnv, userId) {
  await sayMsg(kvEnv, userId, "/menu");
  await sayMsg(kvEnv, userId, "المستوى الأول");
  return sayMsg(kvEnv, userId, "الحصول على الرقم الكودي");
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("getcode: normalizeGetCodePhone strips everything but digits", () => {
  assert.equal(normalizeGetCodePhone("+201207829388"), "201207829388");
  assert.equal(normalizeGetCodePhone("0101 234-5678"), "01012345678");
  assert.equal(normalizeGetCodePhone(" 01012345678 "), "01012345678");
  assert.equal(normalizeGetCodePhone(""), "");
});

test("getcode: getCodePhoneValid needs at least 4 digits (the code uses the last 4)", () => {
  assert.equal(getCodePhoneValid("01012345678"), true);
  assert.equal(getCodePhoneValid("1234"), true);
  assert.equal(getCodePhoneValid("123"), false);
  assert.equal(getCodePhoneValid(""), false);
});

test("getcode: the WhatsApp link opens a chat with the admin, pre-filled with the code and name", () => {
  const url = buildGetCodeWhatsAppUrl("13580245", "أحمد محمد علي");
  assert.ok(url.startsWith(`https://wa.me/${GET_CODE_WHATSAPP_NUMBER}?text=`), "the link chats with the admin number");
  const text = decodeURIComponent(url.split("text=")[1]);
  assert.match(text, /13580245/);
  assert.match(text, /أحمد محمد علي/);
});

test("getcode: the reply mirrors the form's success screen", () => {
  const reply = buildGetCodeReply("أحمد محمد علي", "13580245");
  assert.match(reply, /الاسم: أحمد محمد علي/);
  assert.match(reply, /الرقم الكودي الخاص بك هو: 13580245/);
  assert.match(reply, /201207829388/);
  assert.match(reply, /wa\.me\/201207829388\?text=/);
});

test("getcode: the fallback instructions text is the exact dictated registration text", () => {
  assert.match(LEARN_GET_CODE_TEXT, /\+201207829388/);
  assert.match(LEARN_GET_CODE_TEXT, /script\.google\.com\/macros\/s\/AKfycbz68tq_KXu_1ZV0pB1s0NidWhnTli3zG0k_8rjFQWhp\/exec/);
  assert.match(LEARN_GET_CODE_TEXT, /201207829388\+/);
  assert.equal(LEARN_GET_CODE_TEXT.length, 516);
});

test("getcode: getCodeFromMacro posts {name, phone} to the bot's Apps Script URL and reads the code", async () => {
  const calls = [];
  makeGetCodeFetchStub(calls);
  macroMode = "json";
  macroBodies = [];
  macroUrls = [];
  const result = await getCodeFromMacro("أحمد محمد علي", "0101 234-5678", fakeMacroUrl);
  assert.equal(result.code, "13580245");
  assert.equal(result.error, null);
  assert.equal(JSON.parse(macroBodies[0]).phone, "01012345678", "the phone is sent digits-only");
  assert.equal(JSON.parse(macroBodies[0]).name, "أحمد محمد علي");
  assert.equal(macroUrls[0], fakeMacroUrl, "the POST goes to the bot's Apps Script URL (driveConfig)");
});

test("getcode: getCodeFromMacro with no Apps Script URL configured reports unreachable", async () => {
  const result = await getCodeFromMacro("أحمد محمد علي", "01012345678", null);
  assert.equal(result.code, null);
  assert.equal(result.error, "macro-unreachable");
});

test("getcode: getCodeFromMacro reports an outdated deployment (HTML error page) as unreadable", async () => {
  const calls = [];
  makeGetCodeFetchStub(calls);
  macroMode = "html";
  const result = await getCodeFromMacro("أحمد محمد علي", "01012345678", fakeMacroUrl);
  assert.equal(result.code, null);
  assert.equal(result.error, "macro-unreadable");
});

test("getcode: getCodeFromMacro reports an HTTP failure and a thrown fetch", async () => {
  const calls = [];
  makeGetCodeFetchStub(calls);
  macroMode = "error";
  assert.equal((await getCodeFromMacro("أحمد محمد علي", "01012345678", fakeMacroUrl)).error, "macro-unreadable");
  const throwing = async () => { throw new Error("network down"); };
  assert.equal((await getCodeFromMacro("أحمد محمد علي", "01012345678", fakeMacroUrl, throwing)).error, "macro-unreachable");
});

// ---------------------------------------------------------------------------
// Worker flow: button -> name -> phone -> code (+ WhatsApp link)
// ---------------------------------------------------------------------------

test("getcode: tapping the L1 button asks for the name, then the phone, then shows the code", async () => {
  macroMode = "json";
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  const ask = await openLevelAndTapGetCode(kvEnv, USER);
  assert.ok(anyMessage(ask, /اكتب اسمك الثلاثي/), "tapping the button must ask for the name");
  const phoneAsk = await sayMsg(kvEnv, USER, "أحمد محمد علي");
  assert.ok(anyMessage(phoneAsk, /اكتب رقم موبايلك/), "the name must lead to the phone prompt");
  assert.ok(!anyMessage(phoneAsk, /الرقم الكودي الخاص بك/), "no code yet");
  const done = await sayMsg(kvEnv, USER, "01012345678");
  assert.ok(anyMessage(done, /الرقم الكودي الخاص بك هو: 13580245/), "the code is 1234567 + the last 8 digits, as the file computes it");
  assert.ok(anyMessage(done, /wa\.me\/201207829388\?text=/), "the reply carries the ready WhatsApp link");
  assert.ok(anyMessage(done, /سجّل الرقم 201207829388/), "the reply tells the student to save the number");
  // The session is over: a later text is not read as a phone number.
  const after = await sayMsg(kvEnv, USER, "01012345678");
  assert.ok(!anyMessage(after, /الرقم الكودي الخاص بك هو:/), "a later phone must not fetch another code");
});

test("getcode: a too-short phone is rejected and the bot asks again", async () => {
  macroMode = "json";
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  await openLevelAndTapGetCode(kvEnv, USER);
  await sayMsg(kvEnv, USER, "أحمد محمد علي");
  const retry = await sayMsg(kvEnv, USER, "123");
  assert.ok(anyMessage(retry, /٤ أرقام على الأقل/), "a 3-digit phone must be rejected");
  assert.ok(!anyMessage(retry, /الرقم الكودي الخاص بك هو:/));
  // The session is still open: a valid phone now completes it.
  const done = await sayMsg(kvEnv, USER, "01012345678");
  assert.ok(anyMessage(done, /الرقم الكودي الخاص بك هو: 13580245/));
});

test("getcode: when the macro answers with its error page, the bot falls back to the instructions text", async () => {
  macroMode = "html";
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  await openLevelAndTapGetCode(kvEnv, USER);
  await sayMsg(kvEnv, USER, "أحمد محمد علي");
  const calls = await sayMsg(kvEnv, USER, "01012345678");
  assert.ok(anyMessage(calls, /تعذّر إحضار الرقم الكودي مباشرة/), "the fallback must say the direct fetch failed");
  assert.ok(anyMessage(calls, /script\.google\.com\/macros\/s\/AKfycbz68tq_KXu_1ZV0pB1s0NidWhnTli3zG0k_8rjFQWhp\/exec/), "the fallback carries the web form link");
  assert.ok(!anyMessage(calls, /الرقم الكودي الخاص بك هو:/), "no invented code when the macro cannot be read");
});

test("getcode: when no Apps Script URL is linked, the bot falls back to the instructions text", async () => {
  macroMode = "json";
  const { APPS_SCRIPT_URL: _unused, ...envWithoutUrl } = env;
  const kvEnv = { ...envWithoutUrl, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  await openLevelAndTapGetCode(kvEnv, USER);
  await sayMsg(kvEnv, USER, "أحمد محمد علي");
  const calls = await sayMsg(kvEnv, USER, "01012345678");
  assert.ok(anyMessage(calls, /تعذّر إحضار الرقم الكودي مباشرة/), "without a linked Apps Script URL the direct fetch cannot run");
  assert.ok(anyMessage(calls, /script\.google\.com\/macros\/s\/AKfycbz68tq_KXu_1ZV0pB1s0NidWhnTli3zG0k_8rjFQWhp\/exec/), "the fallback carries the web form link");
  assert.ok(!anyMessage(calls, /الرقم الكودي الخاص بك هو:/), "no invented code when nothing is linked");
});

test("getcode: /cancel leaves the get-code flow", async () => {
  macroMode = "json";
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  await openLevelAndTapGetCode(kvEnv, USER);
  const cancel = await sayMsg(kvEnv, USER, "/cancel");
  assert.ok(anyMessage(cancel, /تم إلغاء الحصول على الرقم الكودي/));
  const calls = await sayMsg(kvEnv, USER, "أحمد محمد علي");
  assert.ok(!anyMessage(calls, /اكتب رقم موبايلك/), "a name after /cancel must not continue the flow");
});

test("getcode: going home leaves the get-code flow", async () => {
  macroMode = "json";
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  await openLevelAndTapGetCode(kvEnv, USER);
  await sayMsg(kvEnv, USER, "🏠 الرئيسية");
  const calls = await sayMsg(kvEnv, USER, "أحمد محمد علي");
  assert.ok(!anyMessage(calls, /اكتب رقم موبايلك/), "a name after going home must not continue the flow");
});

test("getcode: /getcode works when typed directly", async () => {
  macroMode = "json";
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  const ask = await sayMsg(kvEnv, USER, "/getcode");
  assert.ok(anyMessage(ask, /اكتب اسمك الثلاثي/));
});
