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
  GET_CODE_EXAMPLE_PHOTO_URL,
  GET_CODE_SCREENSHOT_REJECT_TEXT,
  OCR_SPACE_API_URL,
  OCR_SPACE_MAX_BYTES,
  normalizeGetCodePhone,
  getCodePhoneValid,
  canonicalGetCodePhone,
  getCodeRegistryKey,
  buildGetCodeWhatsAppUrl,
  buildGetCodeReply,
  getCodeFromMacro,
  normalizeOcrDigits,
  checkScreenshotOcrText,
  ocrScreenshotText,
  verifyScreenshotOcr,
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
// OCR stub mode for the screenshot verification tests: "ok" (code
// present, phone saved, own name), "unsaved" (phone digits in the
// text), "unsaved-spaced" (phone digits split with spaces), "nocode" (no
// code in the text), "wrongname" (own code, a DIFFERENT name —
// another student's screenshot; activates since 28 Nov ~05:21, when
// the name check was removed — only the code is checked), "error"
let ocrMode = "ok";
let ocrCalls = [];
const fakeImageBytes = new Uint8Array(64).fill(7);
function ocrStubResponse() {
  const okText = "Coptic\nتم التسجيل، الرقم الكودي الخاص بي: 13580245، اسمي: أحمد محمد علي\n3:12";
  if (ocrMode === "error") return new Response("error", { status: 500 });
  if (ocrMode === "empty") return Response.json({ ParsedResults: [{ ParsedText: "" }], OCRExitCode: 1, IsErroredOnProcessing: false });
  const texts = {
    ok: okText,
    unsaved: "201207829388\nتم التسجيل، الرقم الكودي الخاص بي: 13580245، اسمي: أحمد محمد علي\n3:12",
    "unsaved-spaced": "+20 120 782 9388\nتم التسجيل، الرقم الكودي الخاص بي: 13580245، اسمي: أحمد محمد علي\n3:12",
    nocode: "Coptic\nأهلاً وسهلاً\n3:12",
    wrongname: "Coptic\nتم التسجيل، الرقم الكودي الخاص بي: 13580245، اسمي: محمد أحمد خليل\n3:12",
  };
  return Response.json({ ParsedResults: [{ ParsedText: texts[ocrMode] ?? okText }], OCRExitCode: 1, IsErroredOnProcessing: false });
}
function makeGetCodeFetchStub(calls) {
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    // Telegram file download (the screenshot bytes for OCR) — must be
    // checked before the generic api.telegram.org branch below.
    if (u.includes("/file/bot")) return new Response(fakeImageBytes);
    if (u.includes("api.ocr.space")) {
      ocrCalls.push(u);
      return ocrStubResponse();
    }
    if (u.includes("api.telegram.org")) {
      const method = u.split("/").pop();
      let payload = null;
      if (typeof options.body === "string") {
        try { payload = JSON.parse(options.body); } catch { payload = null; }
      }
      calls.push({ method, payload });
      if (method === "sendMessage") return Response.json({ ok: true, result: { message_id: 900 } });
      if (method === "getFile") return Response.json({ ok: true, result: { file_path: "photos/P1.jpg" } });
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

test("getcode: normalizeGetCodePhone folds Arabic-Indic and Persian digits to Western", () => {
  assert.equal(normalizeGetCodePhone("١٢٣٤"), "1234", "Arabic-Indic digits fold");
  assert.equal(normalizeGetCodePhone("٠١٢٠٧٨٢٩٣٨٨"), "01207829388", "an Arabic-Indic phone folds to Western");
  assert.equal(canonicalGetCodePhone("٠١٢٠٧٨٢٩٣٨٨"), "201207829388", "folded, then canonicalized");
  assert.equal(normalizeGetCodePhone("01٢٣٤5٦٧٨"), "012345678", "mixed Western + Arabic-Indic digits");
  assert.equal(normalizeGetCodePhone("۰۱۲۳۴۵۶۷۸۹"), "0123456789", "Persian digits fold too");
  assert.equal(getCodePhoneValid("١٢٣٤"), true, "a folded 4-digit phone is valid");
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
  // 2026-11-28 correction: the text carries NO name and NO code —
  // it starts directly with the activation steps. The student first
  // sees their name + code in the activation reply after the screenshot.
  assert.ok(reply.startsWith("لتفعيل اشتراكك"), "the text starts with the activation steps");
  assert.ok(!reply.includes("الاسم:"), "no name line in the text");
  assert.ok(!reply.includes("الرقم الكودي الخاص بك هو:"), "no code line in the text");
  assert.match(reply, /سجّل هذا الرقم \+201207829388 في جهات اتصالك أولاً/);
  assert.match(reply, /لفتح المحادثة مع الرقم على الواتساب/);
  assert.match(reply, /Screenshot/);
  assert.match(reply, /الصورة المرفقة/);
  assert.match(reply, /أرسلها هنا في الشات لإتمام التفعيل/);
  assert.match(reply, /wa\.me\/201207829388\?text=/);
  assert.ok(reply.includes(buildGetCodeWhatsAppUrl("13580245", "أحمد محمد علي")), "the full wa.me link is in the reply");
  assert.ok(!reply.includes("is.gd"), "never a shortened link");
  // No caption anymore (2026-11-28): the reply goes out as a plain
  // text message and the photo follows bare, so the 1024-char caption
  // cap does not apply to the reply at any length.
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

test("getcode: tapping the L1 button asks for the phone, then the name, then shows the code", async () => {
  macroMode = "json";
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  const ask = await openLevelAndTapGetCode(kvEnv, USER);
  assert.ok(anyMessage(ask, /اكتب رقم موبايلك/), "tapping the button must ask for the phone first (registry lookup)");
  const nameAsk = await sayMsg(kvEnv, USER, "01012345678");
  assert.ok(anyMessage(nameAsk, /اكتب اسمك الثلاثي/), "a registry miss must lead to the name prompt");
  assert.ok(!anyMessage(nameAsk, /الرقم الكودي الخاص بك/), "no code yet");
  const done = await sayMsg(kvEnv, USER, "أحمد محمد علي");
  // Two messages (2026-11-28, no caption): the notice text first as a
  // plain text message, then the example photo UNDER it, with no caption.
  const texts = done.filter((c) => c.method === "sendMessage");
  assert.equal(texts.length, 1, "exactly one text message — the notice, no separate caption");
  const text = String(texts[0].payload.text ?? "");
  assert.ok(text.startsWith("لتفعيل اشتراكك"), "the text starts with the activation steps — no name/code lines");
  assert.ok(!text.includes("الاسم:"), "no name line in the text");
  assert.ok(!text.includes("الرقم الكودي الخاص بك هو:"), "no code line in the text");
  assert.match(text, /wa\.me\/201207829388\?text=/, "the text carries the ready WhatsApp link");
  assert.ok(text.includes(buildGetCodeWhatsAppUrl("13580245", "أحمد محمد علي")), "the full wa.me link is in the text");
  assert.match(text, /سجّل هذا الرقم \+201207829388/, "the text tells the student to save the number");
  assert.match(text, /الصورة المرفقة/, "the text points at the photo itself");
  const photos = done.filter((c) => c.method === "sendPhoto");
  assert.equal(photos.length, 1, "exactly one photo message is sent");
  assert.equal(photos[0].payload.photo, GET_CODE_EXAMPLE_PHOTO_URL, "the photo is the R2 example screenshot");
  assert.equal(photos[0].payload.caption, undefined, "the photo has NO caption");
  assert.ok(done.findIndex((c) => c.method === "sendMessage") < done.findIndex((c) => c.method === "sendPhoto"), "the text goes out before the photo");
  // The session is over: a later text is not read as a phone number.
  const after = await sayMsg(kvEnv, USER, "01012345678");
  assert.ok(!anyMessage(after, /الرقم الكودي الخاص بك هو:/), "a later phone must not fetch another code");
});

test("getcode: typing the phone in Arabic-Indic digits completes the flow (folded before the macro)", async () => {
  macroMode = "json";
  macroBodies = [];
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  await openLevelAndTapGetCode(kvEnv, USER);
  const nameAsk = await sayMsg(kvEnv, USER, "٠١٢٠٧٨٢٩٣٨٨");
  assert.ok(anyMessage(nameAsk, /اكتب اسمك الثلاثي/), "an Arabic-Indic phone is accepted, not re-asked");
  const done = await sayMsg(kvEnv, USER, "أحمد محمد علي");
  assert.ok(done.some((c) => c.method === "sendPhoto"), "the flow completes with the photo reply");
  // The background user-sheet sync also POSTs to the macro URL, so find
  // the get-code call by its name.
  const codeCall = macroBodies.map((b) => { try { return JSON.parse(b); } catch { return null; } }).find((b) => b?.name === "أحمد محمد علي");
  assert.equal(codeCall?.phone, "01207829388", "the macro receives Western digits only");
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodePhone, "01207829388", "the stored phone is the raw folded form (the registry key is canonical)");
  assert.equal(stored.getcodeScreenshotCode, "9063955", "the code derives from the folded phone's last 8 digits (07829388)");
});

test("getcode: a too-short phone is rejected and the bot asks again", async () => {
  macroMode = "json";
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  await openLevelAndTapGetCode(kvEnv, USER);
  const retry = await sayMsg(kvEnv, USER, "123");
  assert.ok(anyMessage(retry, /٤ أرقام على الأقل/), "a 3-digit phone must be rejected");
  assert.ok(!anyMessage(retry, /الرقم الكودي الخاص بك هو:/));
  // The session is still open: a valid phone now moves on to the name.
  const nameAsk = await sayMsg(kvEnv, USER, "01012345678");
  assert.ok(anyMessage(nameAsk, /اكتب اسمك الثلاثي/), "a valid phone leads to the name prompt");
  const done = await sayMsg(kvEnv, USER, "أحمد محمد علي");
  const text = String(done.find((c) => c.method === "sendMessage")?.payload?.text ?? "");
  assert.match(text, /wa\.me\/201207829388\?text=/, "the text message carries the ready WhatsApp link");
});

test("getcode: when the macro answers with its error page, the bot falls back to the instructions text", async () => {
  macroMode = "html";
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  await openLevelAndTapGetCode(kvEnv, USER);
  await sayMsg(kvEnv, USER, "01012345678");
  const calls = await sayMsg(kvEnv, USER, "أحمد محمد علي");
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
  await sayMsg(kvEnv, USER, "01012345678");
  const calls = await sayMsg(kvEnv, USER, "أحمد محمد علي");
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
  assert.ok(anyMessage(ask, /اكتب رقم موبايلك/), "typing /getcode asks for the phone first");
});

// ---------------------------------------------------------------------------
// Screenshot step (2026-11-28): after the code reply the student sends the
// WhatsApp screenshot back; the bot echoes their name + code (one shot).
// ---------------------------------------------------------------------------

async function sendPhotoMsg(kvEnv, userId) {
  const calls = [];
  makeGetCodeFetchStub(calls);
  await worker.fetch(updateRequest({ message: { photo: [{ file_id: "P1", file_unique_id: "U1", width: 800, height: 600 }], chat: { id: userId, type: "private" }, from: { id: userId } } }), kvEnv);
  return calls;
}

async function completeGetCode(kvEnv, userId) {
  macroMode = "json";
  seedLevelMenus(kvEnv);
  await openLevelAndTapGetCode(kvEnv, userId);
  // Phone FIRST (2026-11-28, cross-platform sync): a registry miss
  // moves on to the name question, then the macro.
  await sayMsg(kvEnv, userId, "01012345678");
  return sayMsg(kvEnv, userId, "أحمد محمد علي");
}

test("getcode: completing the flow stores the name+code+phone and opens the screenshot wait", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, USER);
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, true);
  assert.equal(stored.getcodeScreenshotName, "أحمد محمد علي");
  assert.equal(stored.getcodeScreenshotCode, "13580245");
  assert.equal(stored.getcodePhone, "01012345678", "the phone is stored as typed, folded to Western digits");
  assert.equal(stored.getcodeActivated, false, "macro success alone does NOT activate — only the accepted screenshot does");
});

test("getcode: sending the screenshot photo confirms activation with the stored name and code, then clears only the wait", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, USER);
  const calls = await sendPhotoMsg(kvEnv, USER);
  assert.ok(anyMessage(calls, /تم تفعيل اشتراكك عزيزنا أحمد محمد علي والرقم الكودي الخاص بك هو: 13580245/), "the photo reply confirms activation with the stored name and code");
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, undefined, "the wait clears on receipt");
  assert.equal(stored.getcodeScreenshotName, "أحمد محمد علي", "the record persists for returning users");
  assert.equal(stored.getcodeScreenshotCode, "13580245", "the record persists for returning users");
  assert.equal(stored.getcodeActivated, true, "the accepted screenshot marks the student activated");
});

test("getcode: a second screenshot photo does not repeat the activation", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, USER);
  await sendPhotoMsg(kvEnv, USER);
  const second = await sendPhotoMsg(kvEnv, USER);
  assert.ok(!anyMessage(second, /تم تفعيل اشتراكك عزيزنا/), "the one-shot wait must not repeat");
});

test("getcode: a photo with no completed get-code session gets no activation reply", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  const calls = await sendPhotoMsg(kvEnv, USER);
  assert.ok(!anyMessage(calls, /تم تفعيل اشتراكك عزيزنا/), "no session, no activation reply");
});

test("getcode: /cancel drops the screenshot wait but keeps the stored code", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, USER);
  const cancel = await sayMsg(kvEnv, USER, "/cancel");
  assert.ok(anyMessage(cancel, /تم إلغاء الحصول على الرقم الكودي/));
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, undefined);
  assert.equal(stored.getcodeScreenshotCode, "13580245", "cancelling the wait keeps the stored code");
  const calls = await sendPhotoMsg(kvEnv, USER);
  assert.ok(!anyMessage(calls, /تم تفعيل اشتراكك عزيزنا/), "a cancelled wait must not confirm on a later photo");
});

// ---------------------------------------------------------------------------
// Returning user (2026-11-28): a user who already has a code gets it back
// directly, with no name/phone questions.
// ---------------------------------------------------------------------------

test("getcode: a first-time user still gets the phone question", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  const ask = await openLevelAndTapGetCode(kvEnv, USER);
  assert.ok(anyMessage(ask, /اكتب رقم موبايلك/), "a first-time user starts with the phone question (registry lookup)");
  assert.ok(!anyMessage(ask, /مرحباً /), "no greeting without a stored code");
});

test("getcode: a returning user tapping the button gets their stored code, no name question", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, USER);
  await sendPhotoMsg(kvEnv, USER); // activate first — a never-activated record does NOT greet
  const again = await openLevelAndTapGetCode(kvEnv, USER);
  assert.ok(anyMessage(again, /مرحباً أحمد محمد علي، الرقم الكودي الخاص بك هو 13580245/), "the stored code comes back directly");
  assert.ok(!anyMessage(again, /اكتب اسمك الثلاثي/), "no name question for a returning user");
});

test("getcode: a returning user typing /getcode gets their stored code directly", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, USER);
  await sendPhotoMsg(kvEnv, USER); // activate first — a never-activated record does NOT greet
  const again = await sayMsg(kvEnv, USER, "/getcode");
  assert.ok(anyMessage(again, /مرحباً أحمد محمد علي، الرقم الكودي الخاص بك هو 13580245/));
  assert.ok(!anyMessage(again, /اكتب اسمك الثلاثي/));
});

test("getcode: the stored record survives the screenshot reply, so /getcode still greets afterwards", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, USER);
  await sendPhotoMsg(kvEnv, USER);
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, undefined);
  assert.equal(stored.getcodeScreenshotName, "أحمد محمد علي");
  assert.equal(stored.getcodeScreenshotCode, "13580245");
  const again = await sayMsg(kvEnv, USER, "/getcode");
  assert.ok(anyMessage(again, /مرحباً أحمد محمد علي، الرقم الكودي الخاص بك هو 13580245/));
});

// ---------------------------------------------------------------------------
// /resetcode (2026-11-28): hidden admin-only — clears the caller's own
// stored get-code record so the next /getcode runs the full flow again.
// Same phone → same code (last 8 digits + 1234567); the reset re-opens
// the FLOW, it never mints a new code.
// ---------------------------------------------------------------------------

const ADMIN = 813894692; // DEFAULT_ADMIN_IDS in src/index.js

test("getcode: /resetcode (admin) clears the stored record and the next /getcode asks for the name again", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, ADMIN);
  assert.equal(kvEnv.USERS.store.get(`user:${ADMIN}`).getcodeScreenshotCode, "13580245");
  const reset = await sayMsg(kvEnv, ADMIN, "/resetcode");
  assert.ok(anyMessage(reset, /تم مسح الرقم الكودي المسجّل — ابعت \/getcode من الأول\./), "the admin gets one confirmation line");
  const stored = kvEnv.USERS.store.get(`user:${ADMIN}`);
  assert.equal(stored.getcodeScreenshotName, undefined, "the stored name is gone");
  assert.equal(stored.getcodeScreenshotCode, undefined, "the stored code is gone");
  assert.equal(stored.getcodeScreenshotAwaiting, undefined, "any open wait is gone too");
  const again = await sayMsg(kvEnv, ADMIN, "/getcode");
  assert.ok(anyMessage(again, /اكتب رقم موبايلك/), "the next /getcode asks for the phone again");
  assert.ok(!anyMessage(again, /مرحباً /), "no returning-user greeting after a reset");
});

test("getcode: /resetcode (admin) clears an open screenshot wait, so a later photo does not activate", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, ADMIN);
  assert.equal(kvEnv.USERS.store.get(`user:${ADMIN}`).getcodeScreenshotAwaiting, true);
  await sayMsg(kvEnv, ADMIN, "/resetcode");
  const stored = kvEnv.USERS.store.get(`user:${ADMIN}`);
  assert.equal(stored.getcodeScreenshotAwaiting, undefined);
  assert.equal(stored.getcodeScreenshotCode, undefined);
  const photo = await sendPhotoMsg(kvEnv, ADMIN);
  assert.ok(!anyMessage(photo, /تم تفعيل اشتراكك عزيزنا/), "a photo after a reset must not activate");
});

test("getcode: /resetcode from a non-admin gets no reply and the record survives", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, USER);
  await sendPhotoMsg(kvEnv, USER); // activate first, so the final /getcode greets
  const reset = await sayMsg(kvEnv, USER, "/resetcode");
  assert.equal(messageTexts(reset).length, 0, "a student typing /resetcode gets no reply at all");
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotCode, "13580245", "the record survives a non-admin /resetcode");
  const again = await sayMsg(kvEnv, USER, "/getcode");
  assert.ok(anyMessage(again, /مرحباً أحمد محمد علي، الرقم الكودي الخاص بك هو 13580245/), "the returning-user greeting still works");
});

test("getcode: a very long name still gets text + bare photo, no caption (no cap anymore)", async () => {
  const longName = "أ".repeat(120);
  const kvEnv = { ...env, USERS: fakeKv() };
  macroMode = "json";
  seedLevelMenus(kvEnv);
  await openLevelAndTapGetCode(kvEnv, USER);
  await sayMsg(kvEnv, USER, "01012345678");
  const done = await sayMsg(kvEnv, USER, longName);
  assert.ok(anyMessage(done, /لتفعيل اشتراكك/), "the text still carries the activation steps");
  assert.ok(anyMessage(done, /wa\.me\/201207829388\?text=/), "the text still carries the link");
  const photos = done.filter((c) => c.method === "sendPhoto");
  assert.equal(photos.length, 1, "the photo still goes out");
  assert.equal(photos[0].payload.photo, GET_CODE_EXAMPLE_PHOTO_URL);
  assert.equal(photos[0].payload.caption, undefined, "the photo has no caption, however long the name");
  assert.ok(done.findIndex((c) => c.method === "sendMessage") < done.findIndex((c) => c.method === "sendPhoto"), "the text goes out before the photo");
});

// ---------------------------------------------------------------------------
// Screenshot OCR verification (2026-11-28): the bot OCRs the screenshot
// the student sends back. The admin number showing as raw digits means
// it is NOT saved → reject; a missing/wrong code means the registration
// message was not sent → reject; a name that is not the uploading
// student's own means it is someone else's screenshot → reject
// (anti-cheat). ALL rejections use the single rejection text (the
// user's exact words). Anything else (no key, OCR error, empty text)
// FAILS OPEN and activates as before.
// ---------------------------------------------------------------------------

test("getcode OCR: checkScreenshotOcrText accepts a saved number with the code present", () => {
  assert.equal(checkScreenshotOcrText("Coptic\nتم التسجيل، الرقم الكودي الخاص بي: 13580245، اسمي: أحمد محمد علي\n3:12", "13580245").verdict, "ok");
  // Any saved name counts — Arabic, English, anything, not just "Coptic".
  assert.equal(checkScreenshotOcrText("My Friend\nتم التسجيل، الرقم الكودي الخاص بي: 13580245\n3:12", "13580245").verdict, "ok");
  assert.equal(checkScreenshotOcrText("صديقي\nتم التسجيل، الرقم الكودي الخاص بي: 13580245\n3:12", "13580245").verdict, "ok");
});

test("getcode OCR: checkScreenshotOcrText rejects the admin number showing unsaved", () => {
  const withCode = "تم التسجيل، الرقم الكودي الخاص بي: 13580245";
  assert.equal(checkScreenshotOcrText(`+201207829388\n${withCode}`, "13580245").verdict, "unsaved-number");
  assert.equal(checkScreenshotOcrText(`201207829388\n${withCode}`, "13580245").verdict, "unsaved-number");
  assert.equal(checkScreenshotOcrText(`1207829388\n${withCode}`, "13580245").verdict, "unsaved-number");
  assert.equal(checkScreenshotOcrText(`+20 120 782 9388\n${withCode}`, "13580245").verdict, "unsaved-number");
  assert.equal(checkScreenshotOcrText(`01207829388\n${withCode}`, "13580245").verdict, "unsaved-number");
  // The phone check wins over the code check: an unsaved number is
  // rejected even when the code is present.
});

test("getcode OCR: checkScreenshotOcrText rejects a screenshot without the code", () => {
  assert.equal(checkScreenshotOcrText("Coptic\nأهلاً وسهلاً\n3:12", "13580245").verdict, "no-code");
  assert.equal(checkScreenshotOcrText("", "13580245").verdict, "no-code");
});

test("getcode OCR: Arabic-Indic digits fold to Western digits", () => {
  assert.equal(normalizeOcrDigits("١٣٥٨٠٢٤٥"), "13580245");
  assert.equal(normalizeOcrDigits("٢٠١٢٠٧٨٢٩٣٨٨"), "201207829388");
  assert.equal(checkScreenshotOcrText("Coptic\nتم التسجيل، الرقم الكودي الخاص بي: ١٣٥٨٠٢٤٥", "13580245").verdict, "ok");
  assert.equal(checkScreenshotOcrText("٢٠١٢٠٧٨٢٩٣٨٨\nتم التسجيل: ١٣٥٨٠٢٤٥", "13580245").verdict, "unsaved-number");
});

test("getcode OCR: the single rejection text is the user's exact wording", () => {
  assert.equal(GET_CODE_SCREENSHOT_REJECT_TEXT, "قم برفع صورة مضبوطة تُوضح أن الرقم مسجل في جهات اتصالك، وتُوضح اسمك ورقمك الكودي في شات الواتساب.");
});

test("getcode OCR: the name is no longer checked at all (28 Nov ~05:21 — only the code proves the registration)", () => {
  const withCode = "Coptic\nتم التسجيل، الرقم الكودي الخاص بي: 13580245\n3:12";
  // Any name in the OCR text — Coptic, Greek, Arabic, a different
  // student's name, or no name at all — with the RIGHT code → ok.
  // The code is unique per student, so another student's screenshot
  // shows a different code → no-code; the example image has no code
  // (blurred) → no-code. The name was redundant.
  assert.equal(checkScreenshotOcrText(withCode, "13580245").verdict, "ok", "no name in the OCR text → ok");
  assert.equal(checkScreenshotOcrText("Coptic\nتم التسجيل، الرقم الكودي الخاص بي: 13580245، اسمي: محمد أحمد خليل\n3:12", "13580245").verdict, "ok", "another student's name → ok");
  assert.equal(checkScreenshotOcrText("Coptic\nتم التسجيل، الرقم الكودي الخاص بي: 13580245، اسمي: Ⲁⲃⲣⲁⲁⲙ\n3:12", "13580245").verdict, "ok", "Coptic name → ok");
  assert.equal(checkScreenshotOcrText("Coptic\nتم التسجيل، الرقم الكودي الخاص بي: 13580245، اسمي: Αβραάμ\n3:12", "13580245").verdict, "ok", "Greek name → ok");
});

test("getcode OCR: checkScreenshotOcrText accepts the saved number with the student's code, whatever name shows", () => {
  const own = "Coptic\nتم التسجيل، الرقم الكودي الخاص بي: 13580245، اسمي: أحمد محمد علي\n3:12";
  assert.equal(checkScreenshotOcrText(own, "13580245").verdict, "ok");
  assert.equal(checkScreenshotOcrText("Coptic\nRegistration done, my code: 13580245, my name: Lamiaa Wael Sharaf\n3:12", "13580245").verdict, "ok");
  assert.equal(checkScreenshotOcrText("Coptic\nتم التسجيل، الرقم الكودي الخاص بي: 13580245، اسمي: أحمَد مُحمَّد عَلي\n3:12", "13580245").verdict, "ok");
  assert.equal(checkScreenshotOcrText("Coptic\nتم التسجيل، الرقم الكودي الخاص بي: 13580245، اسمي: احمد محمد على\n3:12", "13580245").verdict, "ok");
});

test("getcode OCR: another student's screenshot is caught by the CODE, not the name (right code + wrong name → ok)", () => {
  // Right code, wrong name → ok now: the name is not checked.
  const other = "Coptic\nتم التسجيل، الرقم الكودي الخاص بي: 13580245، اسمي: محمد أحمد خليل\n3:12";
  assert.equal(checkScreenshotOcrText(other, "13580245").verdict, "ok");
  // The anti-cheat still holds through the code: another student's
  // screenshot carries a DIFFERENT code → no-code.
  assert.equal(checkScreenshotOcrText("Coptic\nتم التسجيل، الرقم الكودي الخاص بي: 99999999، اسمي: محمد أحمد خليل\n3:12", "13580245").verdict, "no-code");
  // The example image has no code at all (blurred) → no-code.
  assert.equal(checkScreenshotOcrText("Coptic\nتم التسجيل، الرقم الكودي الخاص بي:\n3:12", "13580245").verdict, "no-code");
});

test("getcode OCR: checkScreenshotOcrText rejects a wrong code even when the name is right", () => {
  const own = "Coptic\nتم التسجيل، الرقم الكودي الخاص بي: 99999999، اسمي: أحمد محمد علي\n3:12";
  assert.equal(checkScreenshotOcrText(own, "13580245").verdict, "no-code");
});

function ocrFetchStub(json, status = 200) {
  return async (url, options = {}) => {
    assert.equal(url, OCR_SPACE_API_URL, "the OCR call goes to OCR.space");
    return status === 200 ? Response.json(json) : new Response("error", { status });
  };
}
const ocrOkJson = { ParsedResults: [{ ParsedText: "Coptic\nتم التسجيل، الرقم الكودي الخاص بي: 13580245\n3:12" }], OCRExitCode: 1, IsErroredOnProcessing: false };

test("getcode OCR: verifyScreenshotOcr fails open with no key, oversize image, or an OCR error", async () => {
  assert.equal((await verifyScreenshotOcr(new Uint8Array(10), "13580245", "")).verdict, "skipped", "no key → skipped");
  assert.equal((await verifyScreenshotOcr(new Uint8Array(10), "13580245", null)).verdict, "skipped");
  assert.equal((await verifyScreenshotOcr(new Uint8Array(OCR_SPACE_MAX_BYTES + 1), "13580245", "k")).verdict, "skipped", "over the 1 MB free limit → skipped");
  assert.equal((await verifyScreenshotOcr(new Uint8Array(10), "13580245", "k", ocrFetchStub(null, 500))).verdict, "skipped", "HTTP 500 → skipped");
  assert.equal((await verifyScreenshotOcr(new Uint8Array(10), "13580245", "k", ocrFetchStub({ ParsedResults: [], OCRExitCode: 3, IsErroredOnProcessing: true }))).verdict, "skipped", "errored processing → skipped");
  assert.equal((await verifyScreenshotOcr(new Uint8Array(10), "13580245", "k", ocrFetchStub({ ParsedResults: [{ ParsedText: "   " }], OCRExitCode: 1, IsErroredOnProcessing: false }))).verdict, "skipped", "empty OCR text → skipped");
  const throwing = async () => { throw new Error("network down"); };
  assert.equal((await verifyScreenshotOcr(new Uint8Array(10), "13580245", "k", throwing)).verdict, "skipped", "thrown fetch → skipped");
});

test("getcode OCR: verifyScreenshotOcr returns the check verdicts", async () => {
  assert.equal((await verifyScreenshotOcr(new Uint8Array(10), "13580245", "k", ocrFetchStub(ocrOkJson))).verdict, "ok");
  assert.equal((await verifyScreenshotOcr(new Uint8Array(10), "13580245", "k", ocrFetchStub({ ParsedResults: [{ ParsedText: "201207829388\nتم التسجيل: 13580245" }], OCRExitCode: 1, IsErroredOnProcessing: false }))).verdict, "unsaved-number");
  assert.equal((await verifyScreenshotOcr(new Uint8Array(10), "13580245", "k", ocrFetchStub({ ParsedResults: [{ ParsedText: "Coptic\nأهلاً" }], OCRExitCode: 1, IsErroredOnProcessing: false }))).verdict, "no-code");
});

test("getcode OCR: verifyScreenshotOcr ignores the name — a wrong name with the right code is ok", async () => {
  const wrongNameJson = { ParsedResults: [{ ParsedText: "Coptic\nتم التسجيل، الرقم الكودي الخاص بي: 13580245، اسمي: محمد أحمد خليل" }], OCRExitCode: 1, IsErroredOnProcessing: false };
  assert.equal((await verifyScreenshotOcr(new Uint8Array(10), "13580245", "k", ocrFetchStub(wrongNameJson))).verdict, "ok", "wrong name, right code → ok");
  const ownNameJson = { ParsedResults: [{ ParsedText: "Coptic\nتم التسجيل، الرقم الكودي الخاص بي: 13580245، اسمي: أحمد محمد علي" }], OCRExitCode: 1, IsErroredOnProcessing: false };
  assert.equal((await verifyScreenshotOcr(new Uint8Array(10), "13580245", "k", ocrFetchStub(ownNameJson))).verdict, "ok");
});

test("getcode OCR: ocrScreenshotText posts base64 to OCR.space and reads ParsedText", async () => {
  let seenUrl = "";
  let seenBody = "";
  const spy = async (url, options = {}) => {
    seenUrl = String(url);
    seenBody = String(options.body ?? "");
    return Response.json(ocrOkJson);
  };
  const { text, error } = await ocrScreenshotText(new Uint8Array([1, 2, 3]), "k", spy);
  assert.equal(error, null);
  assert.match(text, /13580245/);
  assert.equal(seenUrl, OCR_SPACE_API_URL);
  assert.ok(seenBody.includes("base64Image=data%3Aimage%2Fjpeg%3Bbase64%2C"), "the image goes as base64");
  assert.ok(seenBody.includes("apikey=k"), "the key is sent");
  assert.ok(seenBody.includes("OCREngine=2"), "Engine 2 is used");
});

function ocrKvEnv() {
  return { ...env, USERS: fakeKv(), OCR_SPACE_API_KEY: "test-ocr-key" };
}

test("getcode OCR: an accepted screenshot activates (OCR configured)", async () => {
  const kvEnv = ocrKvEnv();
  await completeGetCode(kvEnv, USER);
  ocrMode = "ok";
  ocrCalls = [];
  const calls = await sendPhotoMsg(kvEnv, USER);
  assert.equal(ocrCalls.length, 1, "the screenshot is OCRed once");
  assert.ok(anyMessage(calls, /تم تفعيل اشتراكك عزيزنا أحمد محمد علي والرقم الكودي الخاص بك هو: 13580245/), "an accepted screenshot activates");
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, undefined, "the wait clears on accept");
  assert.equal(stored.getcodeScreenshotCode, "13580245", "the record persists");
});

test("getcode OCR: an unsaved number is rejected, the wait stays open, and a good re-send activates", async () => {
  const kvEnv = ocrKvEnv();
  await completeGetCode(kvEnv, USER);
  ocrMode = "unsaved";
  const rejected = await sendPhotoMsg(kvEnv, USER);
  assert.ok(anyMessage(rejected, /قم برفع صورة مضبوطة تُوضح أن الرقم مسجل في جهات اتصالك، وتُوضح اسمك ورقمك الكودي في شات الواتساب\./), "an unsaved number is rejected with the user's exact wording");
  assert.ok(!anyMessage(rejected, /تم تفعيل اشتراكك عزيزنا/), "no activation on rejection");
  let stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, true, "the wait stays open after a rejection");
  ocrMode = "ok";
  const accepted = await sendPhotoMsg(kvEnv, USER);
  assert.ok(anyMessage(accepted, /تم تفعيل اشتراكك عزيزنا أحمد محمد علي/), "a good re-send activates");
  stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, undefined);
});

test("getcode OCR: a screenshot without the code is rejected with the single rejection text and the wait stays open", async () => {
  const kvEnv = ocrKvEnv();
  await completeGetCode(kvEnv, USER);
  ocrMode = "nocode";
  const rejected = await sendPhotoMsg(kvEnv, USER);
  assert.ok(anyMessage(rejected, /قم برفع صورة مضبوطة تُوضح أن الرقم مسجل في جهات اتصالك، وتُوضح اسمك ورقمك الكودي في شات الواتساب\./), "a missing code is rejected with the single rejection text");
  assert.ok(!anyMessage(rejected, /تم تفعيل اشتراكك عزيزنا/));
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, true, "the wait stays open after a rejection");
});

test("getcode OCR: a screenshot with the right code but another student's name now ACTIVATES (the name is not checked)", async () => {
  const kvEnv = ocrKvEnv();
  await completeGetCode(kvEnv, USER);
  ocrMode = "wrongname";
  const calls = await sendPhotoMsg(kvEnv, USER);
  // 28 Nov ~05:21 — the name check is gone: only the code proves the
  // registration message, so a different name in the OCR text with the
  // right code activates. The anti-cheat still holds through the code
  // (another student's screenshot carries a different code → no-code).
  assert.ok(anyMessage(calls, /تم تفعيل اشتراكك عزيزنا أحمد محمد علي والرقم الكودي الخاص بك هو: 13580245/), "right code + wrong name activates now");
  assert.ok(!anyMessage(calls, /قم برفع صورة مضبوطة/), "no rejection on a name difference");
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, undefined, "the wait clears on accept");
});

test("getcode OCR: an OCR error fails open and activates", async () => {
  const kvEnv = ocrKvEnv();
  await completeGetCode(kvEnv, USER);
  ocrMode = "error";
  const calls = await sendPhotoMsg(kvEnv, USER);
  assert.ok(anyMessage(calls, /تم تفعيل اشتراكك عزيزنا أحمد محمد علي والرقم الكودي الخاص بك هو: 13580245/), "an OCR error must not strand the student");
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, undefined);
});

test("getcode OCR: without a key the screenshot activates without any OCR call", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, USER);
  ocrMode = "unsaved";
  ocrCalls = [];
  const calls = await sendPhotoMsg(kvEnv, USER);
  assert.equal(ocrCalls.length, 0, "no key → no OCR call at all");
  assert.ok(anyMessage(calls, /تم تفعيل اشتراكك عزيزنا/), "no key → activation as before");
});

// ---------------------------------------------------------------------------
// Shared get-code registry (2026-11-28, cross-platform sync): one
// phone-keyed record in the Telegram Worker's UserStore DO —
// `getcode:registry:<canonicalPhone>` → {name, code, updatedAt} — so a
// student who got their code on one platform is recognized instantly on
// the others without re-entering name/phone. Telegram reads/writes the
// DO in-process; WhatsApp + Messenger reach the same entries through
// the /getcode-registry endpoints behind a bearer secret.
// ---------------------------------------------------------------------------

test("getcode registry: canonicalGetCodePhone folds to the 12-digit 20... form", () => {
  assert.equal(canonicalGetCodePhone("01207829388"), "201207829388", "11 digits starting with 0");
  assert.equal(canonicalGetCodePhone("+201207829388"), "201207829388", "12 digits starting with 20");
  assert.equal(canonicalGetCodePhone("201207829388"), "201207829388", "already canonical");
  assert.equal(canonicalGetCodePhone("1207829388"), "201207829388", "10 digits starting with 1");
  assert.equal(canonicalGetCodePhone("0101 234-5678"), "201012345678", "spaces and dashes are stripped");
  assert.equal(canonicalGetCodePhone("٠١٢٠٧٨٢٩٣٨٨"), "201207829388", "Arabic-Indic digits fold to Western");
  assert.equal(canonicalGetCodePhone("۰۱۲۰۷۸۲۹۳۸۸"), "201207829388", "Persian digits fold to Western");
  assert.equal(canonicalGetCodePhone("123"), null, "too short to canonicalize");
  assert.equal(canonicalGetCodePhone(""), null);
  assert.equal(canonicalGetCodePhone(null), null);
  assert.equal(canonicalGetCodePhone("442071234567"), null, "a foreign number has no canonical form");
});

test("getcode registry: the key is getcode:registry:<canonicalPhone>", () => {
  assert.equal(getCodeRegistryKey("201207829388"), "getcode:registry:201207829388");
});

const REGISTRY_SECRET = "test-registry-secret-should-be-long";
function registryKvEnv(withSecret = true) {
  return withSecret
    ? { ...env, USERS: fakeKv(), GETCODE_REGISTRY_SECRET: REGISTRY_SECRET }
    : { ...env, USERS: fakeKv() };
}
async function registryFetch(kvEnv, method, path, { secret, body, rawBody } = {}) {
  const headers = {};
  if (secret) headers.authorization = `Bearer ${secret}`;
  if (body !== undefined || rawBody !== undefined) headers["content-type"] = "application/json";
  const res = await worker.fetch(
    new Request(`https://bot.test${path}`, {
      method,
      headers,
      body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
    }),
    kvEnv,
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}

test("getcode registry: endpoints reject without a secret configured, and with a wrong secret", async () => {
  const noSecretEnv = registryKvEnv(false);
  const noSecret = await registryFetch(noSecretEnv, "GET", "/getcode-registry?phone=201207829388", { secret: REGISTRY_SECRET });
  assert.equal(noSecret.status, 401, "no secret configured → reject even with a token");
  assert.equal(noSecret.json.error, "unauthorized");
  const kvEnv = registryKvEnv(true);
  const missing = await registryFetch(kvEnv, "GET", "/getcode-registry?phone=201207829388");
  assert.equal(missing.status, 401, "missing Authorization header → 401");
  const wrong = await registryFetch(kvEnv, "GET", "/getcode-registry?phone=201207829388", { secret: "wrong-secret" });
  assert.equal(wrong.status, 401, "wrong secret → 401");
  const correct = await registryFetch(kvEnv, "GET", "/getcode-registry?phone=201207829388", { secret: REGISTRY_SECRET });
  assert.equal(correct.status, 200, "the exact Bearer token works");
});

test("getcode registry: GET/POST/DELETE round-trip through the endpoints", async () => {
  const kvEnv = registryKvEnv(true);
  const miss = await registryFetch(kvEnv, "GET", "/getcode-registry?phone=201207829388", { secret: REGISTRY_SECRET });
  assert.equal(miss.status, 200);
  assert.deepEqual(miss.json, { found: false }, "an unknown phone is not found");
  const stored = await registryFetch(kvEnv, "POST", "/getcode-registry", {
    secret: REGISTRY_SECRET,
    body: { phone: "01012345678", name: "أحمد محمد علي", code: "13580245" },
  });
  assert.equal(stored.status, 200);
  assert.deepEqual(stored.json, { ok: true }, "a non-canonical phone is stored under its canonical key");
  const hit = await registryFetch(kvEnv, "GET", "/getcode-registry?phone=%2B201012345678", { secret: REGISTRY_SECRET });
  assert.equal(hit.status, 200);
  assert.deepEqual(hit.json, { found: true, name: "أحمد محمد علي", code: "13580245" }, "the entry is found under the canonical phone");
  const deleted = await registryFetch(kvEnv, "DELETE", "/getcode-registry?phone=1012345678", { secret: REGISTRY_SECRET });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.json, { ok: true }, "deleting by a non-canonical form works too");
  const gone = await registryFetch(kvEnv, "GET", "/getcode-registry?phone=201012345678", { secret: REGISTRY_SECRET });
  assert.deepEqual(gone.json, { found: false }, "the entry is gone after DELETE");
  const deleteAgain = await registryFetch(kvEnv, "DELETE", "/getcode-registry?phone=201012345678", { secret: REGISTRY_SECRET });
  assert.equal(deleteAgain.status, 200, "deleting an absent entry is still ok (idempotent)");
});

test("getcode registry: endpoints validate their input", async () => {
  const kvEnv = registryKvEnv(true);
  assert.equal((await registryFetch(kvEnv, "GET", "/getcode-registry?phone=123", { secret: REGISTRY_SECRET })).status, 400, "a non-canonical phone → 400");
  assert.equal((await registryFetch(kvEnv, "GET", "/getcode-registry", { secret: REGISTRY_SECRET })).status, 400, "a missing phone → 400");
  assert.equal((await registryFetch(kvEnv, "POST", "/getcode-registry", { secret: REGISTRY_SECRET, body: { phone: "123", name: "أحمد محمد علي", code: "13580245" } })).status, 400, "POST with a bad phone → 400");
  assert.equal((await registryFetch(kvEnv, "POST", "/getcode-registry", { secret: REGISTRY_SECRET, body: { phone: "01012345678", name: "  ", code: "13580245" } })).status, 400, "POST with an empty name → 400");
  assert.equal((await registryFetch(kvEnv, "POST", "/getcode-registry", { secret: REGISTRY_SECRET, body: { phone: "01012345678", name: "أحمد محمد علي", code: "abc" } })).status, 400, "POST with a non-digit code → 400");
  assert.equal((await registryFetch(kvEnv, "POST", "/getcode-registry", { secret: REGISTRY_SECRET, rawBody: "{not json" })).status, 400, "POST with malformed JSON → 400");
  assert.equal((await registryFetch(kvEnv, "DELETE", "/getcode-registry?phone=123", { secret: REGISTRY_SECRET })).status, 400, "DELETE with a bad phone → 400");
  assert.equal((await registryFetch(kvEnv, "PUT", "/getcode-registry?phone=201207829388", { secret: REGISTRY_SECRET })).status, 405, "an unsupported method → 405");
});

test("getcode registry: a registry hit greets immediately — no name question, no macro call", async () => {
  macroMode = "json";
  macroBodies = [];
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  // The student got their code on another platform: the registry
  // already has their phone.
  kvEnv.USERS.store.set(getCodeRegistryKey("201012345678"), { name: "أحمد محمد علي", code: "13580245", updatedAt: "2026-11-28T00:00:00.000Z" });
  const ask = await sayMsg(kvEnv, USER, "/getcode");
  assert.ok(anyMessage(ask, /اكتب رقم موبايلك/), "a first-time Telegram user still starts with the phone question");
  // The background user-sheet sync also POSTs to the macro URL, so the
  // hit is proven by the DELTA across the phone step, not the total.
  const macroCallsBeforeHit = macroBodies.length;
  const greet = await sayMsg(kvEnv, USER, "01012345678");
  assert.ok(anyMessage(greet, /مرحباً أحمد محمد علي، الرقم الكودي الخاص بك هو 13580245/), "a registry hit greets with the stored name+code");
  assert.ok(!anyMessage(greet, /اكتب اسمك الثلاثي/), "the name question is never asked on a hit");
  assert.equal(macroBodies.length, macroCallsBeforeHit, "no macro call on a hit — the code comes from the registry");
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotName, "أحمد محمد علي", "the local record is written");
  assert.equal(stored.getcodeScreenshotCode, "13580245");
  assert.equal(stored.getcodePhone, "01012345678", "the phone is stored as typed, folded to Western digits");
  assert.equal(stored.getcodeActivated, true, "a registry hit means an activated student — the local record is activated too");
  assert.equal(stored.getcodeScreenshotAwaiting, undefined, "no screenshot wait on a registry hit");
  const again = await sayMsg(kvEnv, USER, "/getcode");
  assert.ok(anyMessage(again, /مرحباً أحمد محمد علي، الرقم الكودي الخاص بك هو 13580245/), "the next /getcode greets from the local record");
});

test("getcode registry: a miss runs the normal flow — the registry entry is written ONLY on activation, not at macro success", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, USER);
  assert.equal(kvEnv.USERS.store.get(getCodeRegistryKey("201012345678")), undefined, "no registry entry after macro success alone — the student has not activated yet");
  const stored0 = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored0.getcodeActivated, false, "macro success alone does not activate");
  await sendPhotoMsg(kvEnv, USER);
  const entry = kvEnv.USERS.store.get(getCodeRegistryKey("201012345678"));
  assert.equal(entry?.name, "أحمد محمد علي", "the registry entry is written on activation");
  assert.equal(entry?.code, "13580245");
  assert.ok(typeof entry?.updatedAt === "string" && entry.updatedAt.length > 0, "the entry carries an updatedAt timestamp");
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodePhone, "01012345678", "the local record carries the phone as typed, folded to Western digits");
});

test("getcode registry: /resetcode clears the local record AND the registry entry", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, ADMIN);
  await sendPhotoMsg(kvEnv, ADMIN); // activate — the entry is written only on activation
  assert.ok(kvEnv.USERS.store.get(getCodeRegistryKey("201012345678")), "the registry entry exists before the reset");
  await sayMsg(kvEnv, ADMIN, "/resetcode");
  const stored = kvEnv.USERS.store.get(`user:${ADMIN}`);
  assert.equal(stored.getcodeScreenshotName, undefined, "the local name is gone");
  assert.equal(stored.getcodeScreenshotCode, undefined, "the local code is gone");
  assert.equal(stored.getcodePhone, undefined, "the local phone is gone");
  assert.equal(kvEnv.USERS.store.get(getCodeRegistryKey("201012345678")), undefined, "the registry entry is gone too");
  // Without the registry entry, the next /getcode re-runs the flow
  // instead of greeting immediately.
  const again = await sayMsg(kvEnv, ADMIN, "/getcode");
  assert.ok(anyMessage(again, /اكتب رقم موبايلك/), "the next /getcode asks for the phone again");
  assert.ok(!anyMessage(again, /مرحباً /), "no greeting after a reset");
});

// ---------------------------------------------------------------------------
// Activation gate (2026-11-28, the hole the user reported): a student who
// stops at the screenshot step and leaves, then taps /getcode again,
// must NOT get the code — the wait re-opens and the notice is re-sent,
// so he resumes where he stopped. Only an accepted screenshot activates
// and reveals the code from then on.
// ---------------------------------------------------------------------------

test("getcode: a never-activated record + /getcode re-opens the screenshot wait and re-sends the notice — the code is NOT revealed", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, USER); // macro success, no photo yet
  const stored0 = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored0.getcodeActivated, false, "macro success alone does not activate");
  const again = await sayMsg(kvEnv, USER, "/getcode");
  assert.ok(!anyMessage(again, /مرحباً /), "no greeting for a never-activated student");
  assert.ok(!anyMessage(again, /الرقم الكودي الخاص بك هو/), "the code is not revealed in plain text");
  assert.ok(anyMessage(again, /لتفعيل اشتراكك/), "the notice is re-sent");
  const photos = again.filter((c) => c.method === "sendPhoto");
  assert.equal(photos.length, 1, "the example photo is re-sent under the notice");
  assert.equal(photos[0].payload.photo, GET_CODE_EXAMPLE_PHOTO_URL);
  assert.equal(photos[0].payload.caption, undefined, "no caption on the re-sent photo");
  assert.ok(again.findIndex((c) => c.method === "sendMessage") < again.findIndex((c) => c.method === "sendPhoto"), "the text goes out before the photo");
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, true, "the wait is re-opened");
  // The resumed wait accepts the screenshot — that is the activation.
  const calls = await sendPhotoMsg(kvEnv, USER);
  assert.ok(anyMessage(calls, /تم تفعيل اشتراكك عزيزنا/), "the re-opened wait activates on the screenshot");
  assert.equal(kvEnv.USERS.store.get(`user:${USER}`).getcodeActivated, true);
});

test("getcode: an activated record + /getcode greets with the code (no re-asking, no notice)", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, USER);
  await sendPhotoMsg(kvEnv, USER);
  assert.equal(kvEnv.USERS.store.get(`user:${USER}`).getcodeActivated, true, "the accepted screenshot marks the student activated");
  const again = await sayMsg(kvEnv, USER, "/getcode");
  assert.ok(anyMessage(again, /مرحباً أحمد محمد علي، الرقم الكودي الخاص بك هو 13580245/), "an activated student gets the code back directly");
  assert.ok(!anyMessage(again, /لتفعيل اشتراكك/), "no notice re-send for an activated student");
});

test("getcode registry: /resetcode on an old record without a phone clears locally only", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  // A record from before the registry existed: name+code, no phone.
  kvEnv.USERS.store.set(`user:${ADMIN}`, { getcodeScreenshotName: "أحمد محمد علي", getcodeScreenshotCode: "13580245" });
  const reset = await sayMsg(kvEnv, ADMIN, "/resetcode");
  assert.ok(anyMessage(reset, /تم مسح الرقم الكودي المسجّل/), "the reset still confirms");
  const stored = kvEnv.USERS.store.get(`user:${ADMIN}`);
  assert.equal(stored.getcodeScreenshotName, undefined, "the local record is cleared");
  assert.equal(stored.getcodeScreenshotCode, undefined);
});
