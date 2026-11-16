// Messenger parity (learn / certificates / get-code / full admin) —
// unit tests for src/messenger-parity.js. No live network: every live
// source (cert Sheets, Apps Script macro, exam Forms, DO store) is a
// fake injected through createMessengerParity(deps).
import test from "node:test";
import assert from "node:assert/strict";
import {
  createMessengerParity,
  ADMIN_AUDIT,
  ADMIN_CATEGORIES,
  ADMIN_COMMANDS,
  ADMIN_DISPATCH_COMMANDS,
  adminAuditCounts,
  adminCommandStatus,
  levelMenuItems,
  levelsText,
  levelMenuText,
  lessonPlan,
  findLesson,
  r2UrlFor,
  codeMatches,
  bakedPatternFor,
  examUrlFor,
  normalizeGetCodePhoneMsgr,
  getCodePhoneValidMsgr,
  certResultToPlan,
  parseBanArgs,
  normalizeTargetPsid,
  formatUsersList,
  formatBansList,
  resolveMenuNumber,
  LEARN_APP_URL,
  R2_MEDIA_BASE_URL,
} from "../src/messenger-parity.js";
import { LEARN_LEVELS } from "../src/learn-manifest.js";

const ADMIN_PSID = "123456789012345";
const USER_PSID = "987654321098765";

function lastTextWithReplies(plan) {
  const withReplies = (plan.texts ?? []).filter((t) => t.quickReplies?.length);
  assert.equal(withReplies.length, 1, "exactly one text carries quick replies (the last one)");
  assert.equal(withReplies[0], plan.texts[plan.texts.length - 1], "quick replies ride on the LAST text");
  return withReplies[0];
}

// Fake macro implementing the real formula (apps-script/Code.gs
// generateAndStoreCode): code = parseInt(last 8 digits) + 1234567.
function fakeMacro(name, phone) {
  const last8 = String(phone ?? "").slice(-8);
  return { code: String(parseInt(last8, 10) + 1234567), error: null };
}

function makeParity(deps = {}) {
  return createMessengerParity({
    adminPsids: [ADMIN_PSID],
    certLookup: async () => ({ kind: "not-found" }),
    getCode: async (name, phone) => fakeMacro(name, phone),
    macroUrl: "https://macro.test/exec",
    getStats: async () => ({
      recordCount: 17226, totalSearches: 5000, searchesToday: 120,
      users: 42, bans: 1, voicedWords: 15000, emptyMeaning: 3,
      topWords: [{ word: "ⲁⲑⲙⲟϣⲓ", count: 12 }],
      misses: [{ word: "xyz" }],
      topUsers: [{ id: USER_PSID, searches: 30 }],
      usage: { today: 900, total: 8000 },
    }),
    listUsers: async () => ({
      users: [
        { id: USER_PSID, name: "لمياء", username: "lamiaa", blocked: false },
        { id: "111222333", name: "مستخدم محظور", blocked: true },
      ],
      total: 2,
    }),
    listBans: async () => ({ 111222333: { reason: "سبام", until: null } }),
    banUser: async () => true,
    unbanUser: async (psid) => psid === "111222333",
    listRecipients: async () => [USER_PSID, "111222333"],
    getUserRecord: async (psid) => ({
      record: { name: "لمياء", points: 5, warns: [{ at: "2026-11-16T00:00:00.000Z", reason: "اختبار" }], notes: [] },
      history: [{ q: "ⲁⲑⲙⲟϣⲓ" }],
    }),
    updateUserRecord: async () => true,
    deleteUserRecord: async () => true,
    listUserPage: async ({ query } = {}) => ({
      users: query
        ? [{ id: USER_PSID, name: "لمياء", record: { points: 5 } }]
        : [
            { id: USER_PSID, name: "لمياء", record: { points: 5 } },
            { id: "111222333", name: "آخر", record: { points: 2 } },
          ],
      total: 2,
    }),
    ...deps,
  });
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

test("admin audit covers all 332 Telegram commands exactly once, plus 2 Messenger extras", () => {
  const counts = adminAuditCounts();
  assert.equal(counts.total, 334);
  assert.equal(counts.impl, 193);
  assert.equal(counts.dispatch, 57);
  assert.equal(counts.na, 84);
  const seen = new Set();
  for (const row of ADMIN_AUDIT) {
    assert.ok(!seen.has(row.command), `duplicate audit row: ${row.command}`);
    seen.add(row.command);
  }
  for (const cat of ADMIN_CATEGORIES) {
    for (const name of cat.commands) {
      assert.ok(seen.has(name), `category command missing from audit: ${name}`);
    }
  }
  assert.equal(ADMIN_CATEGORIES.length, 13);
  assert.equal(ADMIN_CATEGORIES.reduce((n, c) => n + c.commands.length, 0), 332);
});

test("admin audit statuses: Telegram-only, dispatch, and implemented samples", () => {
  assert.equal(adminCommandStatus("menuadmin").status, "na");
  assert.match(adminCommandStatus("menuadmin").reason, /تيليجرام/u);
  assert.equal(adminCommandStatus("record").status, "na");
  assert.equal(adminCommandStatus("exportcsv").status, "na");
  assert.equal(adminCommandStatus("schedule").status, "na");
  assert.equal(adminCommandStatus("2fa").status, "na");
  assert.equal(adminCommandStatus("quiz").status, "dispatch");
  assert.equal(adminCommandStatus("wordinfo").status, "dispatch");
  assert.equal(adminCommandStatus("ban").status, "impl");
  assert.equal(adminCommandStatus("motd").status, "impl");
  assert.equal(adminCommandStatus("no-such-command"), null);
  assert.ok(!ADMIN_DISPATCH_COMMANDS.has("ban"), "ban must be gated, not dispatched");
});

// ---------------------------------------------------------------------------
// Learn structure
// ---------------------------------------------------------------------------

test("learn structure: 2 levels, 17 + 10 lessons from the live manifest", () => {
  assert.equal(LEARN_LEVELS.length, 2);
  assert.equal(LEARN_LEVELS[0].lessons.length, 17);
  assert.equal(LEARN_LEVELS[1].lessons.length, 10);
  const l1 = levelMenuItems("m_learn_l1");
  assert.equal(l1.length, 22, "L1: get-code + 17 lessons + cert + search + back + home");
  assert.equal(l1[0].type, "getcode");
  assert.equal(l1[17].type, "lesson", "last lesson is item 18 (1-based)");
  assert.equal(l1[18].type, "cert");
  assert.equal(l1[19].type, "search");
  assert.equal(l1[20].type, "back");
  assert.equal(l1[21].type, "home");
  assert.equal(l1[1].lessonId, "m_learn_l1_01");
  const l2 = levelMenuItems("m_learn_l2");
  assert.equal(l2.length, 14, "L2: 10 lessons + cert + search + back + home");
  assert.equal(l2[0].type, "lesson");
  assert.equal(l2[10].type, "cert");
  assert.equal(levelMenuItems("nope"), null);
  assert.match(levelsText(), /المستوى الأول \(17 درسًا\)/u);
  assert.match(levelsText(), /المستوى الثاني \(10 درسًا\)/u);
  assert.ok(levelsText().includes(LEARN_APP_URL), "levels text links out to the learn webapp");
  assert.match(levelMenuText("m_learn_l1"), /فيديو تعريفي عن اللغة القبطية/u);
});

test("r2UrlFor builds direct public R2 URLs (fast path, no proxy)", () => {
  assert.equal(
    r2UrlFor("1ZrWw4d-UUBGcWZyFiqc-pRQcWvQH3fE8", "video"),
    `${R2_MEDIA_BASE_URL}/1ZrWw4d-UUBGcWZyFiqc-pRQcWvQH3fE8.mp4`,
  );
  assert.equal(
    r2UrlFor("1IxPinWPhnvEUtNypz6tDu1TKy2QIM1Ym", "photo"),
    `${R2_MEDIA_BASE_URL}/1IxPinWPhnvEUtNypz6tDu1TKy2QIM1Ym.jpg`,
  );
  assert.equal(r2UrlFor("", "video"), null);
});

test("lessonPlan follows manifest order with R2 media and a gated exam step", () => {
  const plan = lessonPlan("m_learn_l1_03");
  assert.ok(plan);
  assert.equal(plan.steps[0].type, "media");
  assert.equal(plan.steps[0].kind, "video");
  assert.ok(plan.steps[0].url.startsWith(R2_MEDIA_BASE_URL), "video is a direct R2 URL");
  assert.equal(plan.steps[1].type, "media");
  assert.equal(plan.steps[1].kind, "photo");
  assert.ok(plan.steps[1].url.endsWith(".jpg"), "photo is a direct R2 URL");
  const exam = plan.steps.find((s) => s.type === "exam");
  assert.ok(exam, "lesson 3 has an exam step");
  assert.equal(exam.formId, "1Gts_xgdk3-g7elOTmSXtpouZMvFVLwdQ4fleO3usLYg");
  assert.equal(lessonPlan("m_learn_l9_99"), null);
  assert.equal(findLesson("m_learn_l2_01").level.id, "m_learn_l2");
});

test("/learn sends the levels list with quick replies on the last (only) text", async () => {
  const parity = makeParity();
  const plan = await parity.handleText(USER_PSID, "/learn");
  assert.ok(plan);
  assert.equal(plan.texts.length, 1);
  assert.match(plan.texts[0].text, /المستوى الأول/u);
  const last = lastTextWithReplies(plan);
  assert.equal(last.quickReplies.length, 2);
  assert.equal(last.quickReplies[0].payload, "learn|level:m_learn_l1");
  assert.ok(plan.menuList, "plan carries menuList for the bare-number hook");
  assert.equal(plan.menuList.kind, "learn-home");
  assert.equal(plan.voiceUrl, null);
});

test("level menu lists ALL lessons on one page; quick replies cap at 13", async () => {
  const parity = makeParity();
  const plan = await parity.handleText(USER_PSID, "/learn");
  const level = await parity.handlePick(USER_PSID, "learn|level:m_learn_l1");
  assert.ok(level);
  const lines = level.texts[0].text.split("\n");
  assert.ok(lines.some((l) => l.startsWith("22. ")), "all 22 items are in the text list");
  const last = lastTextWithReplies(level);
  assert.ok(last.quickReplies.length <= 13, "Meta caps quick replies at 13");
  assert.equal(last.quickReplies[0].payload, "learn|getcode");
  assert.equal(level.menuList.items.length, 22);
});

test("bare-number picks resolve against the live menu, including Arabic-Indic digits", async () => {
  const parity = makeParity();
  await parity.handleText(USER_PSID, "/learn");
  const level = await parity.handleText(USER_PSID, "1");
  assert.match(level.texts[0].text, /المستوى الأول/u);
  const out = await parity.handleText(USER_PSID, "99");
  assert.match(out.texts[0].text, /خارج القائمة/u);
  const lesson = await parity.handleText(USER_PSID, "٢");
  assert.ok(lesson.attachments?.length >= 1, "pick 2 opens a lesson with media");
  const inLesson = await parity.handleText(USER_PSID, "99");
  assert.match(inLesson.texts[0].text, /التالي.*السابق/u, "a number inside a lesson gets the nav hint, not an out-of-range error");
  assert.equal(resolveMenuNumber({ items: [{ a: 1 }] }, 2), null);
  assert.equal(resolveMenuNumber({ items: [{ a: 1 }] }, 1).a, 1);
});

test("lesson send: media attachments first in plan, nav quick replies on last text, exam gated", async () => {
  const parity = makeParity();
  const plan = await parity.handlePick(USER_PSID, "learn|lesson:m_learn_l1_03");
  assert.ok(plan);
  assert.equal(plan.attachments.length, 2, "video + photo attachments");
  assert.equal(plan.attachments[0].type, "video");
  assert.ok(plan.attachments[0].url.startsWith(R2_MEDIA_BASE_URL));
  assert.equal(plan.attachments[1].type, "image");
  // The exam is NOT a bare link: the plan asks for the code first.
  assert.ok(plan.texts.some((t) => t.text.includes("أرسل رقمك الكودي لفتح الامتحان")), "exam is gated behind the code");
  assert.ok(!plan.texts.some((t) => t.text.includes("docs.google.com/forms")), "no bare exam link before the gate");
  const last = lastTextWithReplies(plan);
  assert.deepEqual(
    last.quickReplies.map((q) => q.payload),
    ["learn|prev:m_learn_l1_03", "learn|next:m_learn_l1_03", "learn|back:m_learn_l1", "learn|home"],
    "lesson 3 (not the first): السابق + التالي + رجوع + الرئيسية on the last text",
  );
  // The gate remembers the lesson: sending the code opens the exam.
  const gated = await parity.handleText(USER_PSID, "1234567");
  assert.match(gated.texts[0].text, /غير مؤهل/u, "unknown code is denied and the gate stays open");
  const stillGated = await parity.handleText(USER_PSID, "1234567");
  assert.match(stillGated.texts[0].text, /غير مؤهل/u, "gate stays open after a denial");
});

test("lesson nav: next/prev by pick and by word, back to the level, home", async () => {
  const parity = makeParity();
  await parity.handlePick(USER_PSID, "learn|lesson:m_learn_l1_03");
  const next = await parity.handleText(USER_PSID, "التالي");
  assert.ok(next.attachments?.length >= 1);
  const prev = await parity.handlePick(USER_PSID, "learn|prev:m_learn_l1_04");
  assert.ok(prev.attachments?.length >= 1);
  const back = await parity.handleText(USER_PSID, "رجوع");
  assert.match(back.texts[0].text, /المستوى الأول/u);
  const home = await parity.handleText(USER_PSID, "القائمة");
  assert.match(home.texts[0].text, /القاموس القبطي/u);
  assert.equal(await parity.handlePick(USER_PSID, "pick|3"), null, "dictionary pick prefix is not a parity pick");
});

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

test("certResultToPlan maps every lookup outcome", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const ready = certResultToPlan({ kind: "photo", bytes, contentType: "image/png", fileName: "certificate.png", caption: "مبروك <b>لمياء</b>" });
  assert.equal(ready.texts[0].text, "مبروك *لمياء*");
  assert.equal(ready.photoBytes.bytes, bytes);
  assert.equal(ready.photoBytes.contentType, "image/png");
  const icon = certResultToPlan({ kind: "photo", url: "https://example.test/icon.png", caption: "يجب حل <b>الامتحان النهائي</b>" });
  assert.equal(icon.attachments[0].type, "image");
  assert.equal(icon.attachments[0].url, "https://example.test/icon.png");
  assert.match(icon.texts[0].text, /يجب حل \*الامتحان النهائي\*/u);
  assert.equal(certResultToPlan({ kind: "text", text: "نص" }).texts[0].text, "نص");
  assert.equal(certResultToPlan({ kind: "not-found" }).texts[0].text, "الرقم الكودي غير صحيح.");
  assert.equal(certResultToPlan({ kind: "error", text: "خطأ" }).texts[0].text, "خطأ");
});

test("cert flow: code entry, must-do-final and being-prepared captions, session stays open", async () => {
  const calls = [];
  const parity = makeParity({
    certLookup: async (code, level) => {
      calls.push([code, level]);
      if (code === "5307205") return { kind: "photo", url: "https://example.test/icon.png", caption: "عفوا <b>لمياء</b>،\nيجب حل الامتحان النهائي للحصول على الشهادة. 📚✍️" };
      if (code === "28346014") return { kind: "photo", url: "https://example.test/icon.png", caption: "مبروك <b>أحمد</b>،\nأكملت كل الامتحانات — شهادتك قيد التجهيز، جرّب تاني بعد شوية. 🎓" };
      if (code === "1111111") return { kind: "photo", bytes: new Uint8Array([9]), contentType: "image/jpeg", fileName: "certificate.jpg", caption: "شهادة المستوى الأول" };
      return { kind: "not-found" };
    },
  });
  const ask = await parity.handleText(USER_PSID, "/cert1");
  assert.equal(ask.texts[0].text, "أدخل الرقم الكودي. ");
  const final = await parity.handleText(USER_PSID, "5307205");
  assert.match(final.texts[0].text, /يجب حل الامتحان النهائي/u);
  assert.equal(final.attachments[0].type, "image");
  assert.deepEqual(calls[0], ["5307205", "0"], "L1 maps to Telegram internal level 0");
  // Session stays open: a second code works without re-tapping.
  const prepared = await parity.handleText(USER_PSID, "28346014");
  assert.match(prepared.texts[0].text, /قيد التجهيز/u);
  const ready = await parity.handleText(USER_PSID, "1111111");
  assert.ok(ready.photoBytes, "ready certificate arrives as bytes for upload");
  assert.equal(ready.texts[0].text, "شهادة المستوى الأول");
  const wrong = await parity.handleText(USER_PSID, "0000000");
  assert.equal(wrong.texts[0].text, "الرقم الكودي غير صحيح.");
  const cancel = await parity.handleText(USER_PSID, "/cancel");
  assert.match(cancel.texts[0].text, /تم الإلغاء/u);
  const afterCancel = await parity.handleText(USER_PSID, "5307205");
  assert.equal(afterCancel, null, "after /cancel a bare code is not a cert code — it falls through to search");
});

test("cert flow: bad code shape never hits the Sheets; /cert picker asks the level", async () => {
  let calls = 0;
  const parity = makeParity({ certLookup: async () => { calls += 1; return { kind: "not-found" }; } });
  await parity.handleText(USER_PSID, "/cert2");
  const bad = await parity.handleText(USER_PSID, "abc");
  assert.equal(bad.texts[0].text, "الرقم الكودي غير صحيح.");
  assert.equal(calls, 0, "bad shape is rejected without a Sheets call");
  const picker = await parity.handleText(USER_PSID, "/cert");
  assert.match(picker.texts[0].text, /اختر مستوى الشهادة/u);
  const last = lastTextWithReplies(picker);
  assert.deepEqual(last.quickReplies.map((q) => q.payload), ["cert|level:1", "cert|level:2"]);
  const picked = await parity.handlePick(USER_PSID, "cert|level:2");
  assert.equal(picked.texts[0].text, "أدخل الرقم الكودي. ");
});

// ---------------------------------------------------------------------------
// Get-code
// ---------------------------------------------------------------------------

test("get-code formula: code = parseInt(last 8 digits) + 1234567, Arabic-Indic digits fold", async () => {
  assert.equal(normalizeGetCodePhoneMsgr("٠١٢٠٧٨٢٩٣٨٨"), "01207829388");
  assert.equal(normalizeGetCodePhoneMsgr("+20 120-782-9388"), "201207829388");
  assert.equal(getCodePhoneValidMsgr("٠١٢٣"), true);
  assert.equal(getCodePhoneValidMsgr("١٢٣"), false);
  const parity = makeParity();
  const askName = await parity.handleText(USER_PSID, "/getcode");
  assert.match(askName.texts[0].text, /اسمك الثلاثي/u);
  assert.equal(await parity.handleText(USER_PSID, "   "), null, "blank input is ignored before any flow step");
  const askPhone = await parity.handleText(USER_PSID, "لمياء وائل شرف");
  assert.match(askPhone.texts[0].text, /رقم موبايلك/u);
  const shortPhone = await parity.handleText(USER_PSID, "123");
  assert.match(shortPhone.texts[0].text, /٤ أرقام على الأقل/u);
  const done = await parity.handleText(USER_PSID, "١٢٠٧٨٢٩٣");
  // Phone 12078293 (8 digits): 12078293 + 1234567 = 13312860.
  assert.match(done.texts[0].text, /الرقم الكودي الخاص بك هو: 13312860/u);
  assert.match(done.texts[0].text, /wa\.me\/201207829388/u, "reply carries the admin WhatsApp link");
  assert.match(done.texts[0].text, /لمياء وائل شرف/u);
});

test("get-code macro failure falls back to the registration instructions, never inventing a code", async () => {
  const parity = makeParity({ getCode: async () => ({ code: null, error: "macro-unreachable" }) });
  await parity.handleText(USER_PSID, "/getcode");
  await parity.handleText(USER_PSID, "اسم الطالب");
  const failed = await parity.handleText(USER_PSID, "01207829388");
  assert.match(failed.texts[0].text, /تعذّر إحضار الرقم الكودي/u);
  assert.match(failed.texts[0].text, /201207829388/u, "fallback tells the student to contact the admin");
  assert.doesNotMatch(failed.texts[0].text, /13312860/u);
});

// ---------------------------------------------------------------------------
// Exam gate
// ---------------------------------------------------------------------------

test("codeMatches: full-string match, alternation, fail-closed fallback", () => {
  assert.equal(codeMatches("(111|222|333)", "222"), true);
  assert.equal(codeMatches("(111|222|333)", "22"), false);
  assert.equal(codeMatches("(111|222|333)", "2222"), false);
  assert.equal(codeMatches("1234567", "1234567"), true);
  // Uncompilable pattern: the set fallback only applies to a wrapped
  // alternation; anything else blocks.
  assert.equal(codeMatches("(111|222", "111"), false);
  assert.equal(bakedPatternFor("f1", [{ formId: "f1", questions: [{ validation: { kind: "regex", pattern: "(1|2)" } }] }]), "(1|2)");
  assert.equal(bakedPatternFor("f9", []), null);
  assert.equal(examUrlFor("f1", "https://edit.test", [{ formId: "f1", submitUrl: "https://docs.google.com/forms/d/e/abc/formResponse" }]), "https://docs.google.com/forms/d/e/abc/viewform");
  assert.equal(examUrlFor("f9", "https://edit.test", []), "https://edit.test");
});

test("exam gate: baked pattern first, live pattern on miss, greeting name, fail closed", async () => {
  const parity = makeParity({
    examForms: [{ formId: "1Gts_xgdk3-g7elOTmSXtpouZMvFVLwdQ4fleO3usLYg", submitUrl: "https://docs.google.com/forms/d/e/AAA/formResponse", questions: [{ validation: { kind: "regex", pattern: "(1111111|2222222)" } }] }],
    fetchLiveExamPattern: async () => ({ pattern: "(3333333|4444444)", errorText: "" }),
    lookupCodeName: async (code) => (code === "2222222" ? "لمياء" : null),
  });
  await parity.handlePick(USER_PSID, "learn|lesson:m_learn_l1_03");
  // Baked-allowed code, with the greeting name.
  const allowed = await parity.handleText(USER_PSID, "2222222");
  assert.match(allowed.texts[0].text, /أهلًا لمياء/u);
  assert.match(allowed.texts[0].text, /📝 الامتحان الإلكتروني: https:\/\/docs\.google\.com\/forms\/d\/e\/AAA\/viewform/u);
  // Live-only code (not baked) opens via the live pattern.
  await parity.handlePick(USER_PSID, "learn|lesson:m_learn_l1_03");
  const live = await parity.handleText(USER_PSID, "3333333");
  assert.match(live.texts[0].text, /الامتحان الإلكتروني/u);
  // Unknown code is denied; the gate stays open for a retry.
  await parity.handlePick(USER_PSID, "learn|lesson:m_learn_l1_03");
  const denied = await parity.handleText(USER_PSID, "9999999");
  assert.match(denied.texts[0].text, /غير مؤهل/u);
  const retry = await parity.handleText(USER_PSID, "1111111");
  assert.match(retry.texts[0].text, /الامتحان الإلكتروني/u);
});

test("exam gate fails closed with no live pattern source", async () => {
  const parity = makeParity({ examForms: [], fetchLiveExamPattern: null });
  await parity.handlePick(USER_PSID, "learn|lesson:m_learn_l1_03");
  const denied = await parity.handleText(USER_PSID, "1234567");
  assert.match(denied.texts[0].text, /غير مؤهل/u, "an unchecked code never opens an exam");
});

// ---------------------------------------------------------------------------
// Admin gate + subset
// ---------------------------------------------------------------------------

test("admin gate: non-admin gets silence, unconfigured PSID means nobody is admin", async () => {
  const parity = makeParity();
  for (const cmd of ["/admin", "/users", "/bans", "/ban 123456789", "/broadcast hi", "/reload", "/liveusers", "/menuadmin"]) {
    const plan = await parity.handleText(USER_PSID, cmd);
    assert.deepEqual(plan, { texts: [], voiceUrl: null }, `${cmd} must be silent for non-admin`);
  }
  assert.deepEqual(await parity.handlePick(USER_PSID, "admin|stats"), { texts: [], voiceUrl: null }, "non-admin admin pick is silent");
  const unconfigured = createMessengerParity({ adminPsids: [] });
  const denied = await unconfigured.handleText(ADMIN_PSID, "/admin");
  assert.deepEqual(denied, { texts: [], voiceUrl: null }, "no PSID configured: fail closed, even for the would-be admin");
  assert.equal(unconfigured.isAdmin(ADMIN_PSID), false);
  assert.equal(parity.isAdmin(ADMIN_PSID), true);
  assert.equal(parity.isAdmin(USER_PSID), false);
});

test("/admin shows the 13 categories; a category shows its commands; quick replies on last text", async () => {
  const parity = makeParity();
  const dash = await parity.handleText(ADMIN_PSID, "/admin");
  assert.equal(dash.texts.length, 1);
  assert.match(dash.texts[0].text, /الإدارة/u);
  assert.ok(dash.texts[0].text.includes("⭐ الأوامر الأساسية (16 أمر)"));
  assert.ok(dash.texts[0].text.includes("🎛 القوائم والبوت (23 أمر)"));
  const last = lastTextWithReplies(dash);
  assert.equal(last.quickReplies.length, 13, "all 13 categories fit in quick replies");
  assert.equal(last.quickReplies[0].payload, "admin|cat:main");
  assert.equal(dash.menuList.kind, "admin-cats");
  const users = await parity.handlePick(ADMIN_PSID, "admin|cat:users");
  assert.match(users.texts[0].text, /المستخدمون/u);
  assert.ok(users.texts[0].text.includes("/ban"));
  assert.ok(users.texts[0].text.includes("/userdelete"));
  assert.equal(users.menuList.kind, "admin-cmds");
  const dash2 = await parity.handleText(ADMIN_PSID, "/dashboard");
  assert.match(dash2.texts[0].text, /الإدارة/u);
});

test("admin users/bans lists format from the injected sources", async () => {
  const parity = makeParity();
  const users = await parity.handleText(ADMIN_PSID, "/users");
  assert.match(users.texts[0].text, /المستخدمون: 2/u);
  assert.match(users.texts[0].text, /لمياء/u);
  assert.match(users.texts[0].text, /🚫/u, "banned user is flagged");
  const bans = await parity.handleText(ADMIN_PSID, "/bans");
  assert.match(bans.texts[0].text, /المحظورون: 1/u);
  assert.match(bans.texts[0].text, /111222333/u);
  assert.match(bans.texts[0].text, /سبام/u);
  assert.equal(formatUsersList([], 0), "👥 المستخدمون: 0\nلا يوجد مستخدمون بعد.");
  assert.equal(formatBansList({}), "🚫 لا يوجد محظورون حاليًا.");
});

test("ban parsing: target, temp hours, reason; self-ban and admin-ban denied", async () => {
  assert.deepEqual(parseBanArgs("123456789 24h سبام"), { psid: "123456789", hours: 24, reason: "سبام" });
  assert.deepEqual(parseBanArgs("123456789"), { psid: "123456789", hours: null, reason: "" });
  assert.equal(parseBanArgs("abc").psid, null);
  assert.equal(normalizeTargetPsid("msgr:123456789"), "123456789");
  assert.equal(normalizeTargetPsid("12"), null);
  const parity = makeParity();
  const banned = await parity.handleText(ADMIN_PSID, "/ban 555666777 24h سبام");
  assert.match(banned.texts[0].text, /تم حظر 555666777 لمدة 24 ساعة — سبام/u);
  const self = await parity.handleText(ADMIN_PSID, `/ban ${ADMIN_PSID}`);
  assert.match(self.texts[0].text, /لا يمكنك حظر نفسك/u);
  const unban = await parity.handleText(ADMIN_PSID, "/unban 111222333");
  assert.match(unban.texts[0].text, /تم إلغاء حظر 111222333/u);
  const unbanMiss = await parity.handleText(ADMIN_PSID, "/unban 999888777");
  assert.match(unbanMiss.texts[0].text, /ليس محظورًا/u);
  const usage = await parity.handleText(ADMIN_PSID, "/ban xyz");
  assert.match(usage.texts[0].text, /الاستخدام/u);
});

test("admin user commands: userinfo, warns, points, leaderboard, usernote", async () => {
  const parity = makeParity();
  const info = await parity.handleText(ADMIN_PSID, "/userinfo 987654321098765");
  assert.match(info.texts[0].text, /معلومات المستخدم 987654321098765/u);
  assert.match(info.texts[0].text, /لمياء/u);
  assert.match(info.texts[0].text, /تحذيرات: 1/u);
  const warns = await parity.handleText(ADMIN_PSID, "/warns 987654321098765");
  assert.match(warns.texts[0].text, /تحذيرات 987654321098765 \(1\)/u);
  const points = await parity.handleText(ADMIN_PSID, "/points 987654321098765");
  assert.match(points.texts[0].text, /نقاط 987654321098765: 5/u);
  const board = await parity.handleText(ADMIN_PSID, "/leaderboard");
  assert.match(board.texts[0].text, /لوحة المتصدرين/u);
  assert.match(board.texts[0].text, /987654321098765 — 5 نقطة/u);
  const found = await parity.handleText(ADMIN_PSID, "/userlookup لمياء");
  assert.match(found.texts[0].text, /لمياء/u);
  const stats = await parity.handleText(ADMIN_PSID, "/usage");
  assert.match(stats.texts[0].text, /استهلاك الطلبات/u);
  assert.match(stats.texts[0].text, /اليوم: 900/u);
  const topwords = await parity.handleText(ADMIN_PSID, "/topwords");
  assert.match(topwords.texts[0].text, /ⲁⲑⲙⲟϣⲓ/u);
});

test("dangerous admin commands ask first; نعم executes, إلغاء cancels", async () => {
  const parity = makeParity();
  const ask = await parity.handleText(ADMIN_PSID, "/purgeinactive");
  assert.match(ask.texts[0].text, /تأكيد/u);
  assert.match(ask.texts[0].text, /حذف المستخدمين الخاملين/u);
  lastTextWithReplies(ask);
  const done = await parity.handleText(ADMIN_PSID, "نعم");
  assert.match(done.texts[0].text, /تم حذف \d+ مستخدم خامل/u);
  const ask2 = await parity.handleText(ADMIN_PSID, "/purgeinactive");
  assert.match(ask2.texts[0].text, /تأكيد/u);
  const cancelled = await parity.handleText(ADMIN_PSID, "إلغاء");
  assert.match(cancelled.texts[0].text, /تم الإلغاء/u);
  const after = await parity.handleText(ADMIN_PSID, "نعم");
  assert.equal(after, null, "after cancel, نعم is not a confirm — it falls through");
});

test("broadcast: confirm flow returns a task; quick-reply confirm works too", async () => {
  const parity = makeParity();
  const ask = await parity.handleText(ADMIN_PSID, "/broadcast أهلًا بالجميع");
  assert.match(ask.texts[0].text, /تأكيد البث/u);
  assert.match(ask.texts[0].text, /سيتم إرسال الرسالة إلى 2 مستخدم/u);
  lastTextWithReplies(ask);
  const go = await parity.handleText(ADMIN_PSID, "نعم");
  assert.match(go.texts[0].text, /جارٍ إرسال البث/u);
  assert.deepEqual(go.task, { type: "broadcast", text: "أهلًا بالجميع", from: ADMIN_PSID });
  const ask2 = await parity.handleText(ADMIN_PSID, "/broadcast رسالة ثانية");
  const cancel = await parity.handlePick(ADMIN_PSID, "admin|cancel-broadcast");
  assert.match(cancel.texts[0].text, /تم إلغاء البث/u);
  const noText = await parity.handleText(ADMIN_PSID, "/broadcast");
  assert.match(noText.texts[0].text, /الاستخدام/u);
});

test("admin settings persist in the store: motd, feature, blacklist", async () => {
  const parity = makeParity();
  const set = await parity.handleText(ADMIN_PSID, "/motd أهلًا بكم في القاموس");
  assert.match(set.texts[0].text, /تم تعيين رسالة اليوم/u);
  const show = await parity.handleText(ADMIN_PSID, "/motd");
  assert.match(show.texts[0].text, /أهلًا بكم في القاموس/u);
  const flag = await parity.handleText(ADMIN_PSID, "/feature quiz off");
  assert.match(flag.texts[0].text, /quiz: off/u);
  const bl = await parity.handleText(ADMIN_PSID, "/blacklist add كلمة-سيئة");
  assert.match(bl.texts[0].text, /أُضيف/u);
  const blShow = await parity.handleText(ADMIN_PSID, "/blacklist");
  assert.match(blShow.texts[0].text, /كلمة-سيئة/u);
});

test("Telegram-only admin commands answer with the reason, never silence, never a crash", async () => {
  const parity = makeParity();
  for (const cmd of ["/menuadmin", "/record", "/livemon", "/conversations", "/webhook", "/exportcsv", "/2fa", "/keyboard"]) {
    const plan = await parity.handleText(ADMIN_PSID, cmd);
    assert.ok(plan?.texts?.[0]?.text?.includes("غير متاح على ماسنجر"), `${cmd} must explain why it is not applicable`);
  }
  const na = await parity.handlePick(ADMIN_PSID, "admin|cmd:menuadmin");
  assert.match(na.texts[0].text, /غير متاح على ماسنجر/u);
});

test("dispatch commands run through the owning agent, or fall through when unwired", async () => {
  const parity = makeParity({
    runUserCommand: async (cmd) => (cmd === "quiz" ? { texts: [{ text: "سؤال الاختبار" }], voiceUrl: null } : null),
  });
  const quiz = await parity.handleText(USER_PSID, "/quiz");
  assert.equal(quiz.texts[0].text, "سؤال الاختبار");
  const unwired = makeParity();
  assert.equal(await unwired.handleText(USER_PSID, "/quiz"), null, "without the dep, a user command falls through to its owner");
  assert.equal(await unwired.handleText(USER_PSID, "/wordinfo ⲁⲑⲙⲟϣⲓ"), null);
});

test("/reload reports live counts and the auto-sync note", async () => {
  const parity = makeParity();
  const plan = await parity.handleText(ADMIN_PSID, "/reload");
  assert.match(plan.texts[0].text, /27 درسًا في 2 مستويين/u);
  assert.match(plan.texts[0].text, /30 دقيقة/u);
});

test("tickets and drive admin: list, view, reply task, drive status", async () => {
  const parity = makeParity({
    listTickets: async () => [{ id: "7", subject: "مشكلة في الدرس", status: "مفتوحة" }],
    getTicket: async () => ({ id: "7", userId: USER_PSID, subject: "مشكلة في الدرس", status: "مفتوحة", messages: [] }),
    getDriveConfig: async () => ({ configured: true }),
  });
  const tickets = await parity.handleText(ADMIN_PSID, "/tickets");
  assert.match(tickets.texts[0].text, /مشكلة في الدرس/u);
  const reply = await parity.handleText(ADMIN_PSID, "/reply 7 تم الحل، جرّب مرة أخرى");
  assert.deepEqual(reply.task, { type: "send-dm", to: USER_PSID, text: "تم الحل، جرّب مرة أخرى", from: ADMIN_PSID });
  const drive = await parity.handleText(ADMIN_PSID, "/drive");
  assert.match(drive.texts[0].text, /مهيأ ومتصل/u);
});

// ---------------------------------------------------------------------------
// Welcome / routing
// ---------------------------------------------------------------------------

test("/start lists the parity commands; /help, /menu, /app, /about work; unknown text falls through", async () => {
  const parity = makeParity();
  const start = await parity.handleText(USER_PSID, "/start");
  assert.match(start.texts[0].text, /\/learn/u);
  assert.match(start.texts[0].text, /\/cert/u);
  assert.match(start.texts[0].text, /\/getcode/u);
  lastTextWithReplies(start);
  const help = await parity.handleText(USER_PSID, "/help");
  assert.match(help.texts[0].text, /المساعدة/u);
  const menu = await parity.handleText(USER_PSID, "/menu");
  assert.match(menu.texts[0].text, /القائمة/u);
  assert.equal(menu.menuList.kind, "menu");
  const app = await parity.handleText(USER_PSID, "/app");
  assert.ok(app.texts[0].text.includes(LEARN_APP_URL));
  assert.equal(await parity.handleText(USER_PSID, "ⲁⲑⲙⲟϣⲓ"), null, "a plain word is not parity — dictionary search decides");
  assert.equal(await parity.handleText(USER_PSID, "/unknowncmd"), null);
  assert.equal(await parity.handleText(USER_PSID, "   "), null);
  assert.equal(await parity.handlePick(USER_PSID, "learn|bogus"), null);
  assert.equal(await parity.handlePick(USER_PSID, ""), null);
});

test("banned users get silence from parity handlers", async () => {
  const parity = makeParity({ isBanned: async (psid) => psid === USER_PSID });
  assert.deepEqual(await parity.handleText(USER_PSID, "/learn"), { texts: [], voiceUrl: null });
  assert.deepEqual(await parity.handlePick(USER_PSID, "learn|levels"), { texts: [], voiceUrl: null });
  const ok = await parity.handleText(ADMIN_PSID, "/learn");
  assert.match(ok.texts[0].text, /التعلم/u);
});
