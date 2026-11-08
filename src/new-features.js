// src/new-features.js — diverse new features (v2 batch), built ONLY from real repo data.
// No invented words, meanings or IPA: every example is computed from the bundled
// dictionary (data/dictionary.json) or from alphabetLetters() in features.js.
// This module is self-contained and must not import index.js (no circular import).
// Storage (per-user settings, flashcards, quiz state) lives in index.js via
// getUser/saveUser; this module only builds questions, texts and keyboards.

import records from "../data/dictionary.json" with { type: "json" };
import { alphabetLetters } from "./features.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const MARKS = /[\u0300-\u036f\u064b-\u065f\u0670\u06d6-\u06ed]/gu;
function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase()
    .replace(MARKS, "").replace(/`/gu, "")
    .replace(/[أإآٱ]/gu, "ا").replace(/ى/gu, "ي")
    .replace(/\s+/gu, " ").trim();
}
function splitMeaning(value) {
  return String(value ?? "").split(/\s*[،,]\s*/u).map((p) => p.trim()).filter(Boolean);
}
function firstMeaning(record) { return splitMeaning(record?.meaning ?? "")[0] ?? ""; }
function recordById(id) {
  return records.find((r) => String(r?.id) === String(id)) ?? null;
}
function recordIndexById(id) {
  return records.findIndex((r) => String(r?.id) === String(id));
}
function pickRandomRecord(filter) {
  for (let tries = 0; tries < 40; tries += 1) {
    const r = records[Math.floor(Math.random() * records.length)];
    if (!r || r._deleted) continue;
    if (filter && !filter(r)) continue;
    return r;
  }
  return null;
}
function distinctOptions(correctLabel, pickLabel, maxTries = 60) {
  const seen = new Set([normalize(correctLabel)]);
  const out = [];
  for (let i = 0; i < maxTries && out.length < 3; i += 1) {
    const r = pickRandomRecord();
    if (!r) break;
    const label = String(pickLabel(r) ?? "").trim();
    if (!label || label.length > 40 || seen.has(normalize(label))) continue;
    seen.add(normalize(label));
    out.push(label);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1) Word sharing: /start word_<id> deep link
// ---------------------------------------------------------------------------
// Sharing follows the language the user searched in (ar/en/fr/de): the
// button label, the shared text and the meaning shown are all in that
// language; anything else (Coptic/Greek/unknown) falls back to Arabic.
export const SHARE_LANGUAGES = ["ar", "en", "fr", "de"];
export function shareLanguage(language) {
  return SHARE_LANGUAGES.includes(language) ? language : "ar";
}
const SHARE_BUTTON_TEXT = {
  ar: "🔗 مشاركة الكلمة",
  en: "🔗 Share word",
  fr: "🔗 Partager le mot",
  de: "🔗 Wort teilen",
};
export function shareButtonText(language) {
  return SHARE_BUTTON_TEXT[shareLanguage(language)];
}
const SHARE_LINE = {
  ar: "🔗 شارك الكلمة:",
  en: "🔗 Share the word:",
  fr: "🔗 Partager le mot :",
  de: "🔗 Wort teilen:",
};
const SHARE_SETUP_NOTE = {
  ar: "فعّل BOT_USERNAME في إعدادات البوت ليظهر رابط t.me",
  en: "set BOT_USERNAME in the bot settings to show a t.me link",
  fr: "définissez BOT_USERNAME dans les paramètres du bot pour afficher un lien t.me",
  de: "legen Sie BOT_USERNAME in den Bot-Einstellungen fest, um einen t.me-Link anzuzeigen",
};
// First meaning of the record in the given language (Arabic field `meaning`,
// English `english`, French `translation_fr`, German `translation_de`);
// falls back to the Arabic meaning when that language has none.
const MEANING_FIELDS = { en: "english", fr: "translation_fr", de: "translation_de" };
export function meaningInLanguage(record, language) {
  const lang = shareLanguage(language);
  const field = MEANING_FIELDS[lang];
  const value = field ? splitMeaning(record?.[field] ?? "")[0] : "";
  return value || firstMeaning(record);
}
export function deepLink(env, id) {
  const username = String(env?.BOT_USERNAME ?? "").replace(/^@/u, "").trim();
  if (!username || id == null) return null;
  return `https://t.me/${username}?start=word_${id}`;
}
export function shareTextForRecord(env, record, language = "ar") {
  if (!record) return "";
  const lang = shareLanguage(language);
  const link = deepLink(env, record.id);
  const line = `📖 <b>${escapeHtml(String(record.coptic ?? "").slice(0, 60))}</b> — ${escapeHtml(meaningInLanguage(record, lang).slice(0, 80))}`;
  if (link) return `${line}\n\n${SHARE_LINE[lang]} ${link}`;
  // No BOT_USERNAME configured yet: the deep link cannot be built, so share the
  // in-bot form instead and tell the admin what to set (see report).
  return `${line}\n\n${SHARE_LINE[lang]} /start word_${record.id} (${SHARE_SETUP_NOTE[lang]})`;
}
// Plain-text version for t.me/share/url (no HTML — the share text is sent as-is).
export function sharePlainTextForRecord(env, record, language = "ar") {
  if (!record) return "";
  const lang = shareLanguage(language);
  return `📖 ${String(record.coptic ?? "").slice(0, 60)} — ${meaningInLanguage(record, lang).slice(0, 80)}`;
}
export function shareKeyboardForRecord(env, record, language = "ar") {
  const link = deepLink(env, record?.id);
  if (!link) return null;
  return { inline_keyboard: [[{ text: shareButtonText(language), url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(sharePlainTextForRecord(env, record, language))}` }]] };
}

// ---------------------------------------------------------------------------
// 2) Quiz v2: 3 types — meaning / Coptic word / English
// ---------------------------------------------------------------------------
export const QUIZ_V2_TYPES = ["meaning", "coptic", "english"];
export function pickQuizV2Question(type = "meaning") {
  const t = QUIZ_V2_TYPES.includes(type) ? type : QUIZ_V2_TYPES[Math.floor(Math.random() * 3)];
  let record = null;
  let prompt = "";
  let correct = "";
  let pickLabel = null;
  if (t === "coptic") {
    record = pickRandomRecord((r) => firstMeaning(r).length >= 2 && firstMeaning(r).length <= 40 && String(r.coptic ?? "").length >= 2);
    if (!record) return null;
    prompt = `ما الكلمة القبطية التي معناها «${firstMeaning(record)}»؟`;
    correct = String(record.coptic ?? "").replace(/`/gu, "").trim();
    pickLabel = (r) => String(r.coptic ?? "").replace(/`/gu, "").trim();
  } else if (t === "english") {
    record = pickRandomRecord((r) => String(r.english ?? "").split(/[,\/]/u)[0]?.trim().length >= 2 && String(r.coptic ?? "").length >= 2);
    if (!record) return null;
    prompt = `What is the English meaning of <b>${escapeHtml(String(record.coptic ?? ""))}</b>?`;
    correct = String(record.english ?? "").split(/[,\/]/u)[0].trim();
    pickLabel = (r) => String(r.english ?? "").split(/[,\/]/u)[0].trim();
  } else {
    record = pickRandomRecord((r) => firstMeaning(r).length >= 2 && firstMeaning(r).length <= 60 && String(r.coptic ?? "").length >= 2);
    if (!record) return null;
    prompt = `ما معنى كلمة <b>${escapeHtml(String(record.coptic ?? ""))}</b>؟`;
    correct = firstMeaning(record);
    pickLabel = (r) => firstMeaning(r);
  }
  if (!correct) return null;
  const wrong = distinctOptions(correct, pickLabel);
  if (wrong.length < 3) return null;
  const options = [...wrong.map((label) => ({ label, correct: false })), { label: correct, correct: true }];
  // Fisher-Yates shuffle (no bias to the correct position).
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { type: t, prompt, options, correctIndex: options.findIndex((o) => o.correct), answerText: correct, recordId: record.id ?? null };
}
export function dailyQuizType(date = new Date()) {
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
  return QUIZ_V2_TYPES[((day % 3) + 3) % 3];
}

// ---------------------------------------------------------------------------
// 3) Flashcards: simple spaced repetition over the user's favorites
// ---------------------------------------------------------------------------
// flashState: { box: { "<normalized word>": level 0..3 } } stored on user.flash.
// Level 0 = new/due, 3 = known. "Again" resets to 0, "Known" raises by 1.
export function pickFlashcard(favs, flashState) {
  const box = (flashState && typeof flashState.box === "object" && flashState.box) || {};
  if (!Array.isArray(favs) || !favs.length) return null;
  const sorted = [...favs].sort((a, b) => (box[normalize(a.word)] ?? 0) - (box[normalize(b.word)] ?? 0));
  const fav = sorted[0];
  return { fav, level: box[normalize(fav.word)] ?? 0, remaining: sorted.filter((f) => (box[normalize(f.word)] ?? 0) < 3).length };
}
export function updateFlashcard(flashState, word, known) {
  const box = { ...((flashState && typeof flashState.box === "object" && flashState.box) || {}) };
  const key = normalize(word);
  box[key] = known ? Math.min(3, (box[key] ?? 0) + 1) : 0;
  return { box, updatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// 4) Mini-lessons: alphabet + 5 short lessons, all examples from real records
// ---------------------------------------------------------------------------
export function lessonList() {
  const letters = [...alphabetLetters().keys()];
  const groups = [];
  const per = Math.max(1, Math.ceil(letters.length / 5));
  for (let i = 0; i < 5; i += 1) groups.push(letters.slice(i * per, (i + 1) * per));
  return [
    { id: 0, title: "الحروف القبطية", letters },
    ...groups.map((lettersInGroup, i) => ({ id: i + 1, title: `الدرس ${i + 1}: حروف ${lettersInGroup.join(" ")}`, letters: lettersInGroup })),
  ];
}
function examplesForLetters(letters, limit = 3) {
  const set = new Set(letters);
  const out = [];
  const seen = new Set();
  for (const r of records) {
    if (out.length >= limit) break;
    const coptic = String(r.coptic ?? "").trim();
    const first = [...coptic].find((c) => /[\u2c80-\u2cff]/u.test(c));
    if (!first || !set.has(first)) continue;
    const key = normalize(coptic);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
export function lessonText(id) {
  const lessons = lessonList();
  const lesson = lessons.find((l) => l.id === Number(id));
  if (!lesson) return null;
  const names = alphabetLetters();
  const lines = [`📚 <b>${escapeHtml(lesson.title)}</b>`, ""];
  if (lesson.id === 0) {
    lines.push("الحروف القبطية وأسماؤها من القاموس نفسه:");
    for (const letter of lesson.letters) lines.push(`• <b>${escapeHtml(letter)}</b> — ${escapeHtml(names.get(letter) ?? "")}`);
    lines.push("", "نصيحة: ابدأ بحفظ شكل كل حرف وصوته، ثم جرّب /lessons للتدريب على كلمات تبدأ به.");
    return lines.join("\n");
  }
  lines.push("الحروف في هذا الدرس:");
  for (const letter of lesson.letters) lines.push(`• <b>${escapeHtml(letter)}</b> — ${escapeHtml(names.get(letter) ?? "")}`);
  lines.push("", "أمثلة من القاموس تبدأ بهذه الحروف:");
  for (const r of examplesForLetters(lesson.letters)) {
    lines.push(`• <b>${escapeHtml(String(r.coptic ?? "").slice(0, 40))}</b> — ${escapeHtml(firstMeaning(r).slice(0, 60))}${r.english ? ` (${escapeHtml(String(r.english).split(/[,\/]/u)[0].trim().slice(0, 40))})` : ""}`);
  }
  lines.push("", "درّب نفسك: ابحث عن كل كلمة واسمع نطقها، ثم جرّبها في /flashcards لو حفظتها في مفضلتك.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 6) Smarter search: "did you mean" on no-result (local Levenshtein)
// ---------------------------------------------------------------------------
function levenshtein(a, b, max) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.min(a.length, b.length) <= max ? Math.min(a.length, b.length) : Infinity;
  if (Math.abs(a.length - b.length) > max) return Infinity;
  let prev = [];
  let curr = [];
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] <= max ? prev[b.length] : Infinity;
}
export function suggestSimilar(query, limit = 3) {
  const wanted = normalize(query);
  if (!wanted || wanted.length < 2) return [];
  const max = wanted.length <= 4 ? 1 : wanted.length <= 8 ? 2 : 3;
  const best = new Map(); // normalized candidate -> {label, dist, index}
  for (let i = 0; i < records.length; i += 1) {
    const r = records[i];
    if (!r || r._deleted) continue;
    const candidates = [
      String(r.coptic ?? "").replace(/`/gu, "").trim(),
      String(r.english ?? "").split(/[,\/]/u)[0]?.trim() ?? "",
      firstMeaning(r),
    ];
    for (const label of candidates) {
      const norm = normalize(label);
      if (!norm || norm === wanted) continue;
      const dist = levenshtein(norm, wanted, max);
      if (dist === Infinity) continue;
      const prev = best.get(norm);
      if (!prev || dist < prev.dist) best.set(norm, { label, dist, index: i });
    }
  }
  return [...best.values()].sort((a, b) => a.dist - b.dist || a.label.length - b.label.length).slice(0, limit);
}

// ---------------------------------------------------------------------------
// 7) Interactive /help + UI language (ar/en for the new-features messages)
// ---------------------------------------------------------------------------
export function helpText(lang = "ar") {
  if (lang === "en") {
    return [
      "📖 <b>Coptic Dictionary — Help</b>",
      "",
      "<b>Search:</b> just type a word in Coptic, Arabic, English, French, German or Greek.",
      "<b>New:</b> /flashcards — review favorites • /quiz — quick quiz • /dailyquiz — today's quiz • /voicesettings — voice repeats • /help — this help",
      "<b>Saved:</b> /fav — save last word • /myfav — favorites • /mystats — stats • /recent — recent searches",
      "<b>Voice:</b> /voiceon / /voiceoff — auto voice • /voiceonce — play once • /voicethree — play 3 times",
      "<b>Language:</b> /lang ar — العربية • /lang en — English (new-features messages)",
      "Share a word: open a result and use its Share button.",
    ].join("\n");
  }
  return [
    "📖 <b>القاموس القبطي — المساعدة</b>",
    "",
    "<b>البحث:</b> اكتب أي كلمة مباشرة: قبطي / عربي / إنجليزي / فرنسي / ألماني / يوناني.",
    "<b>الجديد:</b> /flashcards — مراجعة المفضلة • /quiz — اختبار سريع • /dailyquiz — اختبار اليوم • /voicesettings — إعدادات الصوت • /help — هذه المساعدة",
    "<b>المحفوظ:</b> /fav — حفظ آخر كلمة • /myfav — المفضلة • /mystats — إحصاءاتك • /recent — آخر عمليات البحث",
    "<b>الصوت:</b> /voiceon و /voiceoff — النطق التلقائي • /voiceonce — مرة واحدة • /voicethree — 3 مرات",
    "<b>اللغة:</b> /lang ar — العربية • /lang en — English (لرسائل المميزات الجديدة)",
    "لمشاركة كلمة: افتح نتيجتها واضغط زر المشاركة.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 8) Admin analytics formatting (data comes from the DO "retention" op / index.js)
// ---------------------------------------------------------------------------
export function retentionText(stats) {
  if (!stats) return "لا توجد بيانات احتفاظ بعد.";
  const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "—");
  const lines = [
    "📊 <b>الاحتفاظ والقمع</b>",
    `👥 إجمالي المستخدمين: <b>${Number(stats.total ?? 0).toLocaleString("en-US")}</b>`,
    "",
    "<b>الاحتفاظ (نشط خلال آخر 24 ساعة / من نفس الفئة):</b>",
    `• يوم 1: ${Number(stats.d1?.active ?? 0)} من ${Number(stats.d1?.total ?? 0)} (${pct(stats.d1?.active ?? 0, stats.d1?.total ?? 0)})`,
    `• يوم 7: ${Number(stats.d7?.active ?? 0)} من ${Number(stats.d7?.total ?? 0)} (${pct(stats.d7?.active ?? 0, stats.d7?.total ?? 0)})`,
    `• يوم 30: ${Number(stats.d30?.active ?? 0)} من ${Number(stats.d30?.total ?? 0)} (${pct(stats.d30?.active ?? 0, stats.d30?.total ?? 0)})`,
    "",
    "<b>القمع:</b>",
    `• بدأوا: ${Number(stats.funnel?.started ?? 0)}`,
    `• بحثوا: ${Number(stats.funnel?.searched ?? 0)}`,
    `• حفظوا مفضلة: ${Number(stats.funnel?.faved ?? 0)}`,
    `• لعبوا اختبار (نقاط): ${Number(stats.funnel?.quizzed ?? 0)}`,
    "",
    "ملحوظة: الفئات الصغيرة قد تكون صفرًا في الأيام الأولى، وهذا طبيعي.",
  ];
  return lines.join("\n");
}
export function opsText(info) {
  const lines = [
    "🖥️ <b>حالة التشغيل</b>",
    `⏱ مدة تشغيل هذه النسخة: <b>${escapeHtml(String(info?.uptime ?? "—"))}</b>`,
    `📚 سجلات القاموس: <b>${Number(info?.records ?? 0).toLocaleString("en-US")}</b>`,
    `🔎 عمليات بحث (إجمالي): <b>${Number(info?.searches ?? 0).toLocaleString("en-US")}</b>`,
    `⚠️ أخطاء مسجلة: <b>${Number(info?.errors ?? 0)}</b>`,
    `📌 آخر تحديث للإحصاءات: ${escapeHtml(String(info?.updatedAt ?? "—"))}`,
  ];
  if (info?.lastError) lines.push(`آخر خطأ: ${escapeHtml(String(info.lastError).slice(0, 200))}`);
  return lines.join("\n");
}

export { recordById, recordIndexById, escapeHtml };
