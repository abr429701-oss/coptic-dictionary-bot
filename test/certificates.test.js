import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { UserStore } from "../src/index.js";
import { MENUS_KEY } from "../src/menu-builder.js";
import { LEARN_LEVELS } from "../src/learn-manifest.js";
import { buildLearnMenus, emptyImportState, learnUploadItems } from "../src/learn-import.js";
import {
  CERT_MAIN_SHEET_ID,
  CERT_CODES_SHEET_ID,
  CERT_EXAM_ICON_URL,
  certLetterToIndex,
  parseCertCsv,
  certSettingsFromRows,
  findCertRow,
  buildCertReply,
  certFileUrl,
  resolveCertImage,
  lookupCertificate,
} from "../src/certificates.js";

// ---------------------------------------------------------------------------
// Certificate results (2026-11-09): the Apps Script certificate bot's
// lookup logic, ported to the dictionary bot. The level menu's last button
// ("الحصول على شهادة المستوى الأول/الثاني") asks for the student's code;
// the code is looked up live in the same Google Sheets (gviz CSV) and the
// certificate is sent as a photo, or the student's exam state is reported.
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
const USER = 57;

// --- CSV fixtures: small sheets with the real shapes/columns ---
// A row with N columns, values given as { index: value }.
function csvRow(n, values = {}) {
  const cells = Array.from({ length: n }, (_, i) => (values[i] === undefined ? "" : String(values[i])));
  return cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(",");
}
const csv = (rows) => rows.map((r) => csvRow(...r)).join("\n");

// Settings tab (gid 36067296), real values verified live 2026-11-09.
const SETTINGS_CSV = csv([
  [7, { 0: "Sheet to lookup", 1: "Column to lookup", 2: "Column to lookup", 3: "Column to lookup", 4: "Column to lookup", 5: "Column to lookup", 6: "Columns to send" }],
  [7, { 0: "Sheet1", 1: "y", 2: "CX", 3: "G", 4: "CY", 5: "CZ", 6: "AE,W,J,AA,Da,DB,DC" }],
  [7, { 0: "LEVEL2", 1: "C", 2: "F", 3: "E", 4: "H", 5: "G", 6: "cd,ca,cb,cf,ce,bz" }],
]);
const SLIDES_LINK = "https://docs.google.com/presentation/d/SLIDESID1234567890123456789012/edit";
const DRIVE_LINK = "https://drive.google.com/file/d/DRIVEFILEID1234567890123456789/view";
const SHEET1_CSV = csv([
  [107, { 0: "التاريخ", 2: "Merged Doc URL", 6: "الكود" }],
  // Code in col G (lookup), certificate link in col C, reply in AE/W/J/AA/Da/DB/DC.
  [107, { 2: SLIDES_LINK, 6: "5550001", 9: "القاهرة", 22: "أحمد محمد علي", 26: "ممتاز", 30: "مبروك يا بطل", 104: "رسالة دعم", 105: "نصيحة أولى", 106: "نصيحة ثانية" }],
  // Code in col y (lookup), no certificate link -> reply as text only.
  [107, { 6: "", 9: "الجيزة", 22: "ليلى حسن", 24: "5550009", 30: "مبروك يا ليلى" }],
]);
const LEVEL2_CSV = csv([
  [82, { 0: "طابع زمني", 2: "ادخل الرقم الكودي", 71: "الشهادة" }],
  // Code in col C (lookup), Drive link in col BT, reply in cd/ca/cb/cf/ce/bz.
  [82, { 2: "7770002", 71: DRIVE_LINK, 77: "القاهرة", 78: "سارة أحمد", 79: "ممتاز جدًا", 81: "مبروك", 82: "نصيحة", 83: "رسالة" }],
]);
const CODE13_CSV = csv([
  [3, { 0: "الرقم الكودي", 1: "الاسم ثلاثي", 2: "رقم الموبايل" }],
  [3, { 0: "5550001", 1: "أحمد محمد علي", 2: "01000000001" }],
  [3, { 0: "9990003", 1: "سارة أحمد", 2: "01000000002" }],
  [3, { 0: "8880004", 1: "منى حسن", 2: "01000000003" }],
  [3, { 0: "7770005", 1: "كريم علي", 2: "01000000004" }],
  [3, { 0: "6660006", 1: "هدى سامي", 2: "01000000005" }],
]);
const USER_MAIN_CSV = csv([
  [2, { 0: "ادخل الرقم الكودي", 1: "ادخل كلمة السر" }],
  [2, { 0: "9990003", 1: "1000" }],
  [2, { 0: "5550001", 1: "1001" }],
]);
const FINAL_MAIN_CSV = csv([
  // L1: code in cols 0 and 2 -> exams 1 and 2 done, 3..10 missing.
  [20, { 0: "الرقم الكودي للامتحان الاول", 1: "نتيجة الامتحان الاول", 2: "الرقم الكودي للامتحان الثاني", 3: "نتيجة الامتحان الثاني" }],
  [20, { 0: "8880004", 1: "20 / 30", 2: "8880004", 3: "28 / 30" }],
]);
const USER_CODES_CSV = csv([
  [3, { 0: "", 1: "ادخل الرقم الكودي", 2: "ادخل كلمة السر" }],
  [3, { 0: "", 1: "7770002", 2: "98000" }],
]);
const FINAL_CODES_CSV = csv([
  // L2: code in col 0 only -> exam 1 done, 2/3/final missing.
  [10, { 0: "الرقم الكودي للامتحان الاول", 1: "نتيجة الامتحان الاول", 2: "الرقم الكودي للامتحان الثاني", 3: "نتيجة الامتحان الثاني", 4: "الرقم الكودي للامتحان الثالث", 5: "نتيجة الامتحان الثالث", 6: "الرقم الكودي للامتحان الرابع", 7: "نتيجة الامتحان الرابع", 8: "الرقم الكودي النهائي", 9: "الدرجة النهائية" }],
  [10, { 0: "6660006", 1: "20 / 30" }],
]);

// Fetch stub: gviz sheets return the fixtures above, image URLs return
// fake image bytes, Telegram calls are recorded.
function makeCertFetchStub(calls, { failSheets = false } = {}) {
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.includes("api.telegram.org")) {
      const method = u.split("/").pop();
      let payload = null;
      if (typeof options.body === "string") {
        try { payload = JSON.parse(options.body); } catch { payload = null; }
      }
      calls.push({ method, payload });
      if (method === "sendPhoto") return Response.json({ ok: true, result: { message_id: 700, photo: [{ file_id: "SMALL", file_unique_id: "US" }, { file_id: "PHOTO_1", file_unique_id: "UP1" }] } });
      if (method === "sendMessage") return Response.json({ ok: true, result: { message_id: 900 } });
      return Response.json({ ok: true, result: {} });
    }
    if (u.includes("docs.google.com/spreadsheets")) {
      if (failSheets) return new Response("error", { status: 500 });
      const parsed = new URL(u);
      const sheet = parsed.searchParams.get("sheet");
      const gid = parsed.searchParams.get("gid");
      if (gid === "36067296") return new Response(SETTINGS_CSV, { status: 200, headers: { "content-type": "text/csv" } });
      if (u.includes(CERT_MAIN_SHEET_ID)) {
        if (sheet === "Sheet1") return new Response(SHEET1_CSV, { status: 200, headers: { "content-type": "text/csv" } });
        if (sheet === "LEVEL2") return new Response(LEVEL2_CSV, { status: 200, headers: { "content-type": "text/csv" } });
        if (sheet === "USER") return new Response(USER_MAIN_CSV, { status: 200, headers: { "content-type": "text/csv" } });
        if (sheet === "FINAL") return new Response(FINAL_MAIN_CSV, { status: 200, headers: { "content-type": "text/csv" } });
      }
      if (u.includes(CERT_CODES_SHEET_ID)) {
        if (sheet === "code13") return new Response(CODE13_CSV, { status: 200, headers: { "content-type": "text/csv" } });
        if (sheet === "USER") return new Response(USER_CODES_CSV, { status: 200, headers: { "content-type": "text/csv" } });
        if (sheet === "FINAL") return new Response(FINAL_CODES_CSV, { status: 200, headers: { "content-type": "text/csv" } });
      }
      return new Response("Not found", { status: 404 });
    }
    if (u.includes("docs.google.com/presentation") || u.includes("drive.google.com/uc")) {
      return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200, headers: { "content-type": "image/png" } });
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
// Seed the two level menus (as /importlearn builds them, all lessons ready).
function seedLevelMenus(kvEnv) {
  const state = emptyImportState();
  for (const item of learnUploadItems()) state.items[item.key] = { status: "done", fileId: `F_${item.key}`, fileUniqueId: "U", error: "", at: "" };
  const { menus } = buildLearnMenus(LEARN_LEVELS, state);
  kvEnv.USERS.store.set(MENUS_KEY, { menus });
}
async function sayMsg(kvEnv, userId, text, stubOptions) {
  const calls = [];
  makeCertFetchStub(calls, stubOptions ?? {});
  await worker.fetch(updateRequest({ message: { text, chat: { id: userId, type: "private" }, from: { id: userId } } }), kvEnv);
  return calls;
}
async function openLevelAndTapCert(kvEnv, userId, levelLabel) {
  await sayMsg(kvEnv, userId, "/menu");
  await sayMsg(kvEnv, userId, levelLabel);
  return sayMsg(kvEnv, userId, levelLabel === "المستوى الأول" ? "الحصول على شهادة المستوى الأول" : "الحصول على شهادة المستوى الثاني");
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("certificates: letterToIndex matches the Apps Script helper", () => {
  assert.equal(certLetterToIndex("A"), 0);
  assert.equal(certLetterToIndex("C"), 2);
  assert.equal(certLetterToIndex("G"), 6);
  assert.equal(certLetterToIndex("Z"), 25);
  assert.equal(certLetterToIndex("AA"), 26);
  assert.equal(certLetterToIndex("BT"), 71);
  assert.equal(certLetterToIndex("CX"), 101);
  assert.equal(certLetterToIndex("Da"), 104);
});

test("certificates: parseCertCsv handles quoted commas, escaped quotes and CRLF", () => {
  const rows = parseCertCsv('"a","b,c","d""e"\r\n"1","","3"\n');
  assert.deepEqual(rows, [["a", "b,c", 'd"e'], ["1", "", "3"]]);
});

test("certificates: settings rows give the live lookup/response columns", () => {
  const settings = certSettingsFromRows(parseCertCsv(SETTINGS_CSV));
  assert.equal(settings[0].sheet, "Sheet1");
  assert.deepEqual(settings[0].lookup, [24, 101, 6, 102, 103]);
  assert.deepEqual(settings[0].response, [30, 22, 9, 26, 104, 105, 106]);
  assert.equal(settings[1].sheet, "LEVEL2");
  assert.deepEqual(settings[1].lookup, [2, 5, 4, 7, 6]);
  assert.deepEqual(settings[1].response, [81, 78, 79, 83, 82, 77]);
});

test("certificates: findCertRow + buildCertReply follow the settings columns", () => {
  const data = parseCertCsv(SHEET1_CSV);
  const settings = certSettingsFromRows(parseCertCsv(SETTINGS_CSV))[0];
  const row = findCertRow(data, settings.lookup, "5550001");
  assert.ok(row);
  assert.equal(buildCertReply(row, settings.response), "مبروك يا بطل\nأحمد محمد علي\nالقاهرة\nممتاز\nرسالة دعم\nنصيحة أولى\nنصيحة ثانية");
  assert.equal(findCertRow(data, settings.lookup, "5550009").length, 107);
  assert.equal(findCertRow(data, settings.lookup, "0000000"), null);
});

test("certificates: certFileUrl derives the Slides export and Drive download URLs", () => {
  assert.equal(certFileUrl(SLIDES_LINK).url, "https://docs.google.com/presentation/d/SLIDESID1234567890123456789012/export/png");
  assert.equal(certFileUrl(DRIVE_LINK).url, "https://drive.google.com/uc?export=download&id=DRIVEFILEID1234567890123456789");
  assert.equal(certFileUrl("not a link").url, null);
  assert.match(certFileUrl("not a link").error, /تعذر استخراج الشهادة/);
});

// ---------------------------------------------------------------------------
// Full lookup (module level, stubbed fetch)
// ---------------------------------------------------------------------------

test("certificates: lookupCertificate sends the L1 certificate as a photo", async () => {
  const calls = [];
  makeCertFetchStub(calls);
  const result = await lookupCertificate("5550001", "0");
  assert.equal(result.kind, "photo");
  assert.equal(result.url, "https://docs.google.com/presentation/d/SLIDESID1234567890123456789012/export/png");
  assert.match(result.caption, /مبروك يا بطل/);
  assert.match(result.caption, /أحمد محمد علي/);
});

test("certificates: lookupCertificate sends the L2 certificate from a Drive link", async () => {
  const calls = [];
  makeCertFetchStub(calls);
  const result = await lookupCertificate("7770002", "1");
  assert.equal(result.kind, "photo");
  assert.equal(result.url, "https://drive.google.com/uc?export=download&id=DRIVEFILEID1234567890123456789");
  assert.match(result.caption, /سارة أحمد/);
});

test("certificates: found row without a link returns the reply as text", async () => {
  const calls = [];
  makeCertFetchStub(calls);
  const result = await lookupCertificate("5550009", "0");
  assert.equal(result.kind, "text");
  assert.match(result.text, /مبروك يا ليلى/);
});

test("certificates: completed student with no certificate row is not-found", async () => {
  const calls = [];
  makeCertFetchStub(calls);
  assert.deepEqual(await lookupCertificate("9990003", "0"), { kind: "not-found" });
});

test("certificates: student with missing exams gets the icon photo naming them", async () => {
  const calls = [];
  makeCertFetchStub(calls);
  const result = await lookupCertificate("8880004", "0");
  assert.equal(result.kind, "photo");
  assert.equal(result.url, CERT_EXAM_ICON_URL);
  assert.match(result.caption, /منى حسن/);
  assert.match(result.caption, /يجب حل الامتحان الثالث والرابع والخامس والسادس والسابع والثامن والتاسع والنهائي للحصول على الشهادة/);
});

test("certificates: student with no exams gets the start-exams message", async () => {
  const calls = [];
  makeCertFetchStub(calls);
  const result = await lookupCertificate("7770005", "0");
  assert.equal(result.kind, "photo");
  assert.equal(result.url, CERT_EXAM_ICON_URL);
  assert.match(result.caption, /يجب بدء حل الامتحانات الالكترونية وانهاءها للحصول على الشهادة/);
});

test("certificates: L2 missing exams list the remaining exams", async () => {
  const calls = [];
  makeCertFetchStub(calls);
  const result = await lookupCertificate("6660006", "1");
  assert.equal(result.kind, "photo");
  assert.match(result.caption, /هدى سامي/);
  assert.match(result.caption, /يجب حل الامتحان الثاني والثالث والنهائي للحصول على الشهادة/);
});

test("certificates: unknown code is not-found", async () => {
  const calls = [];
  makeCertFetchStub(calls);
  assert.deepEqual(await lookupCertificate("0000000", "0"), { kind: "not-found" });
});

test("certificates: unreachable sheets return a friendly error", async () => {
  const calls = [];
  makeCertFetchStub(calls, { failSheets: true });
  const result = await lookupCertificate("5550001", "0");
  assert.equal(result.kind, "error");
  assert.match(result.text, /تعذّر الوصول لشيت النتائج/);
});

test("certificates: a non-image certificate link returns the Apps Script error text", async () => {
  const calls = [];
  makeCertFetchStub(calls);
  // A Slides link whose export does not serve an image.
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.includes("docs.google.com/spreadsheets")) {
      const parsed = new URL(u);
      if (parsed.searchParams.get("gid") === "36067296") return new Response(SETTINGS_CSV, { status: 200, headers: { "content-type": "text/csv" } });
      if (parsed.searchParams.get("sheet") === "Sheet1") return new Response(SHEET1_CSV, { status: 200, headers: { "content-type": "text/csv" } });
      return new Response("Not found", { status: 404 });
    }
    if (u.includes("docs.google.com/presentation")) {
      return new Response("<html>denied</html>", { status: 403, headers: { "content-type": "text/html" } });
    }
    return new Response("Not found", { status: 404 });
  };
  const result = await lookupCertificate("5550001", "0");
  assert.equal(result.kind, "text");
  assert.match(result.text, /مبروك يا بطل/);
  assert.match(result.text, /تعذر جلب الشهادة\. خوادم جوجل ترفض الوصول للرابط \(رمز الخطأ: 403\)/);
});

// ---------------------------------------------------------------------------
// Worker flow: menu button -> ask for the code -> code -> certificate
// ---------------------------------------------------------------------------

test("certificates: tapping the L1 certificate button asks for the code, then the code fetches the certificate", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  const ask = await openLevelAndTapCert(kvEnv, USER, "المستوى الأول");
  assert.ok(anyMessage(ask, /أدخل الرقم الكودي/), "tapping the cert button must ask for the code");
  const calls = await sayMsg(kvEnv, USER, "5550001");
  const photo = calls.find((c) => c.method === "sendPhoto");
  assert.ok(photo, "the certificate must arrive as a photo");
  assert.equal(photo.payload.photo, "https://docs.google.com/presentation/d/SLIDESID1234567890123456789012/export/png");
  assert.match(String(photo.payload.caption ?? ""), /مبروك يا بطل/);
  assert.match(String(photo.payload.caption ?? ""), /أحمد محمد علي/);
});

test("certificates: tapping the L2 certificate button fetches the L2 certificate", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  const ask = await openLevelAndTapCert(kvEnv, USER, "المستوى الثاني");
  assert.ok(anyMessage(ask, /أدخل الرقم الكودي/));
  const calls = await sayMsg(kvEnv, USER, "7770002");
  const photo = calls.find((c) => c.method === "sendPhoto");
  assert.ok(photo);
  assert.equal(photo.payload.photo, "https://drive.google.com/uc?export=download&id=DRIVEFILEID1234567890123456789");
  assert.match(String(photo.payload.caption ?? ""), /سارة أحمد/);
});

test("certificates: an unknown code gets 'الرقم الكودي غير صحيح.'", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  await openLevelAndTapCert(kvEnv, USER, "المستوى الأول");
  const calls = await sayMsg(kvEnv, USER, "0000000");
  assert.ok(anyMessage(calls, /الرقم الكودي غير صحيح\./));
  assert.ok(!calls.some((c) => c.method === "sendPhoto"), "no photo for an unknown code");
});

test("certificates: the flow runs once — the next text searches the dictionary again", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  await openLevelAndTapCert(kvEnv, USER, "المستوى الأول");
  await sayMsg(kvEnv, USER, "0000000");
  const calls = await sayMsg(kvEnv, USER, "5550001");
  assert.ok(!anyMessage(calls, /الرقم الكودي غير صحيح/), "the second text must not be read as a code");
  assert.ok(!calls.some((c) => c.method === "sendPhoto" && String(c.payload?.photo ?? "").includes("export/png")), "no certificate photo on the second text");
});

test("certificates: /cancel leaves the certificate flow", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  await openLevelAndTapCert(kvEnv, USER, "المستوى الأول");
  const cancel = await sayMsg(kvEnv, USER, "/cancel");
  assert.ok(anyMessage(cancel, /تم إلغاء إدخال الرقم الكودي/));
  const calls = await sayMsg(kvEnv, USER, "5550001");
  assert.ok(!anyMessage(calls, /الرقم الكودي غير صحيح/), "the code after /cancel must not be read as a code");
});

test("certificates: going home leaves the certificate flow", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  seedLevelMenus(kvEnv);
  await openLevelAndTapCert(kvEnv, USER, "المستوى الأول");
  await sayMsg(kvEnv, USER, "🏠 الرئيسية");
  const calls = await sayMsg(kvEnv, USER, "5550001");
  assert.ok(!anyMessage(calls, /الرقم الكودي غير صحيح/), "a code typed after going home must not be read as a code");
});
