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
  GET_CODE_SCREENSHOT_UNSAVED_TEXT,
  GET_CODE_SCREENSHOT_NO_CODE_TEXT,
  OCR_SPACE_API_URL,
  OCR_SPACE_MAX_BYTES,
  normalizeGetCodePhone,
  getCodePhoneValid,
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
// present, phone saved), "unsaved" (phone digits in the text),
// "unsaved-spaced" (phone digits split with spaces), "nocode" (no
// code in the text), "error" (HTTP 500), "empty" (blank OCR text).
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
  // 2026-11-28 correction: the caption carries NO name and NO code —
  // it starts directly with the activation steps. The student first
  // sees their name + code in the activation reply after the screenshot.
  assert.ok(reply.startsWith("لتفعيل اشتراكك"), "the caption starts with the activation steps");
  assert.ok(!reply.includes("الاسم:"), "no name line in the caption");
  assert.ok(!reply.includes("الرقم الكودي الخاص بك هو:"), "no code line in the caption");
  assert.match(reply, /سجّل هذا الرقم \+201207829388 في جهات اتصالك أولاً/);
  assert.match(reply, /لفتح المحادثة مع الرقم على الواتساب/);
  assert.match(reply, /Screenshot/);
  assert.match(reply, /الصورة المرفقة/);
  assert.match(reply, /أرسلها هنا في الشات لإتمام التفعيل/);
  assert.match(reply, /wa\.me\/201207829388\?text=/);
  assert.ok(reply.includes(buildGetCodeWhatsAppUrl("13580245", "أحمد محمد علي")), "the full wa.me link is in the reply");
  assert.ok(!reply.includes("is.gd"), "never a shortened link");
  // Telegram photo captions cap at 1024 chars — the reply is sent as a
  // caption, so it must fit with a realistic name.
  assert.ok(reply.length <= 1024, "a normal name fits the caption cap");
  assert.ok(buildGetCodeReply("أحمد محمد علي عبد الرحمن حسن إبراهيم", "13580245").length <= 1024, "even a long realistic name fits the caption cap");
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
  // One photo message only: the reply is the photo caption, no separate text.
  assert.equal(done.filter((c) => c.method === "sendMessage").length, 0, "no separate text message — the reply is the photo caption");
  const photos = done.filter((c) => c.method === "sendPhoto");
  assert.equal(photos.length, 1, "exactly one photo message is sent");
  assert.equal(photos[0].payload.photo, GET_CODE_EXAMPLE_PHOTO_URL, "the photo is the R2 example screenshot");
  const caption = String(photos[0].payload.caption ?? "");
  assert.ok(caption.startsWith("لتفعيل اشتراكك"), "the caption starts with the activation steps — no name/code lines");
  assert.ok(!caption.includes("الاسم:"), "no name line in the caption");
  assert.ok(!caption.includes("الرقم الكودي الخاص بك هو:"), "no code line in the caption");
  assert.match(caption, /wa\.me\/201207829388\?text=/, "the caption carries the ready WhatsApp link");
  assert.ok(caption.includes(buildGetCodeWhatsAppUrl("13580245", "أحمد محمد علي")), "the full wa.me link is in the caption");
  assert.match(caption, /سجّل هذا الرقم \+201207829388/, "the caption tells the student to save the number");
  assert.match(caption, /الصورة المرفقة/, "the caption points at the photo itself");
  assert.ok(caption.length <= 1024, "the caption fits Telegram's 1024-char cap");
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
  const caption = String(done.find((c) => c.method === "sendPhoto")?.payload?.caption ?? "");
  assert.match(caption, /wa\.me\/201207829388\?text=/, "the photo caption carries the ready WhatsApp link");
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
  await sayMsg(kvEnv, userId, "أحمد محمد علي");
  return sayMsg(kvEnv, userId, "01012345678");
}

test("getcode: completing the phone step stores the name+code and opens the screenshot wait", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, USER);
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, true);
  assert.equal(stored.getcodeScreenshotName, "أحمد محمد علي");
  assert.equal(stored.getcodeScreenshotCode, "13580245");
});

test("getcode: sending the screenshot photo confirms activation with the stored name and code, then clears only the wait", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, USER);
  const calls = await sendPhotoMsg(kvEnv, USER);
  assert.ok(anyMessage(calls, /تم تفعيل اشتراكك عزيزنا، أحمد محمد علي والرقم الكودي الخاص بك هو: 13580245/), "the photo reply confirms activation with the stored name and code");
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, undefined, "the wait clears on receipt");
  assert.equal(stored.getcodeScreenshotName, "أحمد محمد علي", "the record persists for returning users");
  assert.equal(stored.getcodeScreenshotCode, "13580245", "the record persists for returning users");
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

test("getcode: a first-time user still gets the name question", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  const ask = await openLevelAndTapGetCode(kvEnv, USER);
  assert.ok(anyMessage(ask, /اكتب اسمك الثلاثي/), "a first-time user starts with the name question");
  assert.ok(!anyMessage(ask, /مرحباً،/), "no greeting without a stored code");
});

test("getcode: a returning user tapping the button gets their stored code, no name question", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, USER);
  const again = await openLevelAndTapGetCode(kvEnv, USER);
  assert.ok(anyMessage(again, /مرحباً، أحمد محمد علي، الرقم الكودي الخاص بك هو 13580245/), "the stored code comes back directly");
  assert.ok(!anyMessage(again, /اكتب اسمك الثلاثي/), "no name question for a returning user");
});

test("getcode: a returning user typing /getcode gets their stored code directly", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await completeGetCode(kvEnv, USER);
  const again = await sayMsg(kvEnv, USER, "/getcode");
  assert.ok(anyMessage(again, /مرحباً، أحمد محمد علي، الرقم الكودي الخاص بك هو 13580245/));
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
  assert.ok(anyMessage(again, /مرحباً، أحمد محمد علي، الرقم الكودي الخاص بك هو 13580245/));
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
  assert.ok(anyMessage(again, /اكتب اسمك الثلاثي/), "the next /getcode asks for the name again");
  assert.ok(!anyMessage(again, /مرحباً،/), "no returning-user greeting after a reset");
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
  const reset = await sayMsg(kvEnv, USER, "/resetcode");
  assert.equal(messageTexts(reset).length, 0, "a student typing /resetcode gets no reply at all");
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotCode, "13580245", "the record survives a non-admin /resetcode");
  const again = await sayMsg(kvEnv, USER, "/getcode");
  assert.ok(anyMessage(again, /مرحباً، أحمد محمد علي، الرقم الكودي الخاص بك هو 13580245/), "the returning-user greeting still works");
});

test("getcode: a very long name falls back to text + bare photo (caption cap)", async () => {
  const longName = "أ".repeat(120);
  assert.ok(buildGetCodeReply(longName, "13580245").length > 1024, "the caption would exceed the cap");
  const kvEnv = { ...env, USERS: fakeKv() };
  macroMode = "json";
  seedLevelMenus(kvEnv);
  await openLevelAndTapGetCode(kvEnv, USER);
  await sayMsg(kvEnv, USER, longName);
  const done = await sayMsg(kvEnv, USER, "01012345678");
  assert.ok(anyMessage(done, /لتفعيل اشتراكك/), "the text fallback still carries the activation steps");
  assert.ok(anyMessage(done, /wa\.me\/201207829388\?text=/), "the text fallback still carries the link");
  const photos = done.filter((c) => c.method === "sendPhoto");
  assert.equal(photos.length, 1, "the photo still goes out");
  assert.equal(photos[0].payload.photo, GET_CODE_EXAMPLE_PHOTO_URL);
  assert.equal(photos[0].payload.caption, undefined, "the fallback photo has no caption");
  assert.ok(done.findIndex((c) => c.method === "sendMessage") < done.findIndex((c) => c.method === "sendPhoto"), "the text goes out before the photo");
});

// ---------------------------------------------------------------------------
// Screenshot OCR verification (2026-11-28): the bot OCRs the screenshot
// the student sends back. The admin number showing as raw digits means
// it is NOT saved → reject; a missing code means the registration
// message was not sent → reject; anything else (no key, OCR error,
// empty text) FAILS OPEN and activates as before.
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
  assert.ok(anyMessage(calls, /تم تفعيل اشتراكك عزيزنا، أحمد محمد علي والرقم الكودي الخاص بك هو: 13580245/), "an accepted screenshot activates");
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, undefined, "the wait clears on accept");
  assert.equal(stored.getcodeScreenshotCode, "13580245", "the record persists");
});

test("getcode OCR: an unsaved number is rejected, the wait stays open, and a good re-send activates", async () => {
  const kvEnv = ocrKvEnv();
  await completeGetCode(kvEnv, USER);
  ocrMode = "unsaved";
  const rejected = await sendPhotoMsg(kvEnv, USER);
  assert.ok(anyMessage(rejected, /الرقم ظاهر في السكرين مش مسجل/), "an unsaved number is rejected");
  assert.ok(!anyMessage(rejected, /تم تفعيل اشتراكك عزيزنا/), "no activation on rejection");
  let stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, true, "the wait stays open after a rejection");
  ocrMode = "ok";
  const accepted = await sendPhotoMsg(kvEnv, USER);
  assert.ok(anyMessage(accepted, /تم تفعيل اشتراكك عزيزنا، أحمد محمد علي/), "a good re-send activates");
  stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, undefined);
});

test("getcode OCR: a screenshot without the code is rejected and the wait stays open", async () => {
  const kvEnv = ocrKvEnv();
  await completeGetCode(kvEnv, USER);
  ocrMode = "nocode";
  const rejected = await sendPhotoMsg(kvEnv, USER);
  assert.ok(anyMessage(rejected, /رسالة التسجيل مش ظاهرة في السكرين/), "a missing code is rejected");
  assert.ok(!anyMessage(rejected, /تم تفعيل اشتراكك عزيزنا/));
  const stored = kvEnv.USERS.store.get(`user:${USER}`);
  assert.equal(stored.getcodeScreenshotAwaiting, true, "the wait stays open after a rejection");
});

test("getcode OCR: an OCR error fails open and activates", async () => {
  const kvEnv = ocrKvEnv();
  await completeGetCode(kvEnv, USER);
  ocrMode = "error";
  const calls = await sendPhotoMsg(kvEnv, USER);
  assert.ok(anyMessage(calls, /تم تفعيل اشتراكك عزيزنا، أحمد محمد علي والرقم الكودي الخاص بك هو: 13580245/), "an OCR error must not strand the student");
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
