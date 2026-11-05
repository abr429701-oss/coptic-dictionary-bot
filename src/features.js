// src/features.js — user-facing dictionary features built ONLY from real repo data
// (data/dictionary.json + data/audio-manifest.json, the same bundled sources the
// Worker already ships). No invented words, meanings or mappings: every list,
// count and name below is computed from the bundled dictionary itself.

import records from "../data/dictionary.json" with { type: "json" };
import audioManifest from "../data/audio-manifest.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Local normalization (self-contained; features.js must not import index.js)
// ---------------------------------------------------------------------------
const MARKS = /[\u0300-\u036f\u064b-\u065f\u0670\u06d6-\u06ed]/gu; // jinkim + Arabic diacritics
function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC").toLowerCase()
    .replace(MARKS, "")
    .replace(/`/gu, "")
    .replace(/[أإآٱ]/gu, "ا").replace(/ى/gu, "ي")
    .replace(/\s+/gu, " ").trim();
}
const COPTIC_RE = /[\u2C80-\u2CFF]/u;
function firstLetter(coptic) {
  const stripped = String(coptic ?? "").replace(MARKS, "").replace(/`/gu, "").trim();
  const char = [...stripped].find((c) => COPTIC_RE.test(c));
  return char ?? "";
}
const bareHeadword = (value) => String(value ?? "").replace(MARKS, "").replace(/`/gu, "").replace(/\s*\([^)]*\)/gu, "").replace(/\s+/gu, " ").trim();

// Quick standalone lookup used by /translate and /similar. The main search in
// index.js stays richer (sharded index); this is an exact/prefix pass over the
// bundled records only.
export function quickLookup(query) {
  const q = normalize(query);
  if (!q) return null;
  let hit = records.find((r) => normalize(r.coptic) === q || bareHeadword(r.coptic).toLowerCase() === q);
  if (!hit) hit = records.find((r) => normalize(r.greek).split(/[\s,،/]+/u).includes(q));
  if (!hit) hit = records.find((r) => normalize(r.meaning).split(/[،,\s]+/u).includes(q) || normalize(r.english).split(/[،,\s]+/u).includes(q));
  if (!hit) hit = records.find((r) => normalize(bareHeadword(r.coptic)).startsWith(q));
  return hit ?? null;
}

// ---------------------------------------------------------------------------
// /copticdate — today in the Coptic calendar (pure calendar arithmetic,
// anchored to the known fact: 1 Tout 1743 = 11 September 2026; Coptic years
// divisible by 4 are leap — 1744 spans Feb 2028 and has Nasie).
// ---------------------------------------------------------------------------
const COPTIC_MONTHS_AR = ["توت", "بابه", "هاتور", "كيهك", "طوبة", "أمشير", "برمهات", "برمودة", "بشنس", "بؤونة", "أبيب", "نسى", "النسيء"];
const ANCHOR_UTC = Date.UTC(2026, 8, 11); // 1 Tout 1743
const ANCHOR_YEAR = 1743;
const yearLength = (year) => (year % 4 === 0 ? 366 : 365);
export function copticDateParts(utcMidnight = Date.now()) {
  let dayIndex = Math.floor((utcMidnight - ANCHOR_UTC) / 86400000);
  let year = ANCHOR_YEAR;
  while (dayIndex < 0) { year -= 1; dayIndex += yearLength(year); }
  while (dayIndex >= yearLength(year)) { dayIndex -= yearLength(year); year += 1; }
  const month = Math.floor(dayIndex / 30);
  return { year, month: month + 1, day: (dayIndex % 30) + 1 };
}
export function copticDateNow(now = new Date()) {
  const parts = copticDateParts(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthName = COPTIC_MONTHS_AR[parts.month - 1] ?? `الشهر ${parts.month}`;
  return `📅 التاريخ القبطي اليوم: <b>${parts.day} ${escapeHtml(monthName)} ${parts.year}</b>\n(يوافق ${now.getUTCDate()}/${now.getUTCMonth() + 1}/${now.getUTCFullYear()})`;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// /alphabet — the Coptic alphabet with the letter names exactly as the
// dictionary spells them ("ⲁ (ⲁⲗⲫⲁ)" records), computed from real records.
// ---------------------------------------------------------------------------
export function alphabetLetters() {
  const letters = new Map(); // letter -> name inside parentheses (real sheet data)
  for (const r of records) {
    const coptic = String(r.coptic ?? "").trim();
    const match = /^([\u2C80-\u2CFF])\s*\(([^)]+)\)\s*$/u.exec(coptic);
    if (match && !letters.has(match[1])) letters.set(match[1], match[2].trim());
  }
  return letters;
}
export function alphabetText() {
  const letters = alphabetLetters();
  const rows = [...letters.entries()].map(([letter, name], i) => `${i + 1}. ${letter} — ${escapeHtml(name)}`);
  return `🔤 الحروف القبطية (${letters.size} حرفًا كما وردت في القاموس):\n${rows.join("\n")}`;
}

// ---------------------------------------------------------------------------
// /letterstats — how many headwords begin with each Coptic letter (real counts).
// ---------------------------------------------------------------------------
export function letterStatsText() {
  const counts = new Map();
  for (const r of records) {
    const letter = firstLetter(r.coptic);
    if (!letter) continue;
    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, n]) => s + n, 0);
  const rows = sorted.map(([letter, n]) => `${letter}: ${n.toLocaleString("en-US")}`);
  return `📊 توزيع ${total.toLocaleString("en-US")} كلمة على الحروف الأولى:\n${rows.join(" · ")}`;
}

// ---------------------------------------------------------------------------
// /longest — the longest Coptic headwords in the dictionary.
// ---------------------------------------------------------------------------
export function longestText(topN = 5) {
  const seen = new Set();
  const entries = [];
  for (const r of records) {
    const bare = bareHeadword(r.coptic);
    if (!bare || seen.has(bare)) continue;
    seen.add(bare);
    entries.push({ bare, meaning: String(r.meaning ?? "").split(/[،,]/u)[0].trim().slice(0, 60), len: [...bare].length });
  }
  entries.sort((a, b) => b.len - a.len);
  const rows = entries.slice(0, topN).map((e, i) => `${i + 1}. <b>${escapeHtml(e.bare)}</b> (${e.len} حرفًا) — ${escapeHtml(e.meaning)}`);
  return `📏 أطول الكلمات القبطية في القاموس:\n${rows.join("\n")}`;
}

// ---------------------------------------------------------------------------
// /origins — real breakdown of the origin field (قبطي/يوناني/…).
// ---------------------------------------------------------------------------
export function originsText() {
  const counts = new Map();
  for (const r of records) {
    const origin = String(r.origin ?? "").trim() || "غير محدد";
    counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, n]) => s + n, 0);
  const rows = sorted.map(([origin, n]) => `${escapeHtml(origin)}: ${n.toLocaleString("en-US")} (${Math.round(n / total * 100)}%)`);
  return `🏛️ أصول الكلمات في القاموس (${total.toLocaleString("en-US")} مدخل):\n${rows.join("\n")}`;
}

// ---------------------------------------------------------------------------
// /wordcount — dictionary size + real audio coverage from the bundled manifest.
// ---------------------------------------------------------------------------
export function wordCountText() {
  const ids = new Set(records.map((r) => String(r.id)));
  const withAudio = [...ids].filter((id) => audioManifest[id] || audioManifest[String(id)]).length;
  const percent = Math.round(withAudio / ids.size * 100);
  return `📚 حجم القاموس: <b>${records.length.toLocaleString("en-US")}</b> مدخل\n🔊 مدخل له ملف صوت منشور: <b>${withAudio.toLocaleString("en-US")}</b> (${percent}%)\n🗂️ الملفات الصوتية المفهرسة: ${Object.keys(audioManifest).length.toLocaleString("en-US")}`;
}

// ---------------------------------------------------------------------------
// /startswith <حرف> — browse headwords beginning with a Coptic (or Arabic) letter.
// ---------------------------------------------------------------------------
export function startsWithText(arg, limit = 40) {
  const q = normalize(arg);
  if (!q) return "✏️ الاستخدام: /startswith <حرف أو مقطع> — مثل: /startswith ⲫ";
  const seen = new Set();
  const found = [];
  for (const r of records) {
    const bare = bareHeadword(r.coptic);
    if (!bare || seen.has(bare) || !normalize(bare).startsWith(q)) continue;
    seen.add(bare);
    found.push({ bare, meaning: String(r.meaning ?? "").split(/[،,]/u)[0].trim().slice(0, 50) });
    if (found.length >= limit) break;
  }
  if (!found.length) return `لا توجد كلمات تبدأ بـ «${escapeHtml(arg)}».`;
  return `🔍 ${found.length}${seen.size >= limit ? "+" : ""} كلمة تبدأ بـ «${escapeHtml(arg)}»:\n${found.map((f) => `• <b>${escapeHtml(f.bare)}</b> — ${escapeHtml(f.meaning)}`).join("\n")}\n\nابحث عن أي كلمة بإرسالها مباشرة.`;
}

// ---------------------------------------------------------------------------
// /similar <كلمة> — real siblings: same origin AND same kind as the matched word.
// ---------------------------------------------------------------------------
export function similarText(arg) {
  const hit = quickLookup(arg);
  if (!hit) return `لم أجد «${escapeHtml(arg)}» للعثور على كلمات شقيقة. ابحث بها أولًا.`;
  const origin = String(hit.origin ?? "").trim();
  const kind = String(hit.kind ?? "").trim();
  const siblings = [];
  const seen = new Set([String(hit.id)]);
  for (const r of records) {
    if (seen.has(String(r.id))) continue;
    if (String(r.origin ?? "").trim() !== origin || String(r.kind ?? "").trim() !== kind) continue;
    siblings.push(r);
    seen.add(String(r.id));
    if (siblings.length >= 8) break;
  }
  const head = `🧩 كلمات شقيقة لـ <b>${escapeHtml(bareHeadword(hit.coptic))}</b> (نفس الأصل: ${escapeHtml(origin || "—")}، نفس النوع: ${escapeHtml(kind || "—")}):`;
  if (!siblings.length) return `${head}\nلا توجد كلمات أخرى بنفس الأصل والنوع في القاموس.`;
  return `${head}\n${siblings.map((r) => `• <b>${escapeHtml(bareHeadword(r.coptic))}</b> — ${escapeHtml(String(r.meaning ?? "").split(/[،,]/u)[0].trim().slice(0, 50))}`).join("\n")}`;
}

// ---------------------------------------------------------------------------
// /translate <كلمة> — the matched word with all bundled translation fields side by side.
// ---------------------------------------------------------------------------
export function translateText(arg) {
  const hit = quickLookup(arg);
  if (!hit) return `لم أجد «${escapeHtml(arg)}» في القاموس. جرّب البحث المباشر بالكلمة.`;
  const row = (label, value) => value ? `${label}: ${escapeHtml(String(value).trim().slice(0, 120))}` : null;
  const rows = [
    `🔤 <b>${escapeHtml(bareHeadword(hit.coptic))}</b>${hit.pronunciation ? ` [${escapeHtml(String(hit.pronunciation).trim())}]` : ""}`,
    row("🇪🇬 عربي", hit.meaning),
    row("🇬🇧 إنجليزي", hit.english),
    row("🇫🇷 فرنسي", hit.translation_fr),
    row("🇩🇪 ألماني", hit.translation_de),
    row("🏛️ يوناني", hit.greek),
    row("📦 النوع", hit.kind),
    row("🏛️ الأصل", hit.origin),
  ].filter(Boolean);
  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// /vocab — a random study pack of 5 real words with pronunciation.
// ---------------------------------------------------------------------------
export function vocabText(size = 5) {
  const pool = records.filter((r) => String(r.pronunciation ?? "").trim() && String(r.meaning ?? "").trim());
  const picked = [];
  const used = new Set();
  while (picked.length < size && used.size < pool.length) {
    const index = Math.floor(Math.random() * pool.length);
    if (used.has(index)) continue;
    used.add(index);
    picked.push(pool[index]);
  }
  const rows = picked.map((r, i) => `${i + 1}. <b>${escapeHtml(bareHeadword(r.coptic))}</b> [${escapeHtml(String(r.pronunciation).trim())}]\n   ${escapeHtml(String(r.meaning).split(/[،,]/u)[0].trim().slice(0, 70))}`);
  return `🎒 حزمة مفردات اليوم (${picked.length} كلمات — أعد الأمر لحزمة جديدة):\n${rows.join("\n")}\n\nشغّل نطق أي كلمة بالبحث عنها مباشرة.`;
}

// ---------------------------------------------------------------------------
// /guess — a word-guessing game: the bot shows a real meaning, the user replies
// with the Coptic word (text answer; state kept per user with a TTL).
// ---------------------------------------------------------------------------
const GUESS_TTL_MS = 10 * 60 * 1000;
const pendingGuess = new Map(); // userId -> { answer, askedAt, meaningHint }
export function startGuess(userId) {
  const pool = records.filter((r) => {
    const bare = bareHeadword(r.coptic);
    return bare.length >= 2 && bare.length <= 12 && !String(r.meaning ?? "").includes("\n");
  });
  if (!pool.length) return "لا توجد كلمات صالحة للعبة حاليًا.";
  const record = pool[Math.floor(Math.random() * pool.length)];
  pendingGuess.set(String(userId), { answer: bareHeadword(record.coptic), askedAt: Date.now(), meaningHint: String(record.meaning ?? "").split(/[،,]/u)[0].trim().slice(0, 80) });
  return `🎮 <b>خمّن الكلمة القبطية!</b>\n\nالمعنى: <b>${escapeHtml(pendingGuess.get(String(userId)).meaningHint)}</b>\n\nأجب بكتابة الكلمة القبطية نفسها في الرسالة التالية (عندك 10 دقائق). للإلغاء: /guess انسحب`;
}
export function handleGuessReply(userId, text) {
  const key = String(userId);
  const round = pendingGuess.get(key);
  if (!round) return null;
  pendingGuess.delete(key);
  if (Date.now() - round.askedAt > GUESS_TTL_MS) return `⌛ انتهى وقت الجولة. الكلمة كانت <b>${escapeHtml(round.answer)}</b>. جرّب /guess من جديد.`;
  if (normalize(text) === "انسحب") return `🏳️ انسحبت. الكلمة كانت <b>${escapeHtml(round.answer)}</b>.`;
  const reply = normalize(text);
  if (reply === normalize(round.answer) || normalize(round.answer).startsWith(reply) && reply.length >= 2) {
    return `✅ <b>أحسنت!</b> الكلمة هي <b>${escapeHtml(round.answer)}</b> — ${escapeHtml(round.meaningHint)}\nجولة جديدة: /guess`;
  }
  return `❌ ليست هي. الكلمة الصحيحة: <b>${escapeHtml(round.answer)}</b> — ${escapeHtml(round.meaningHint)}\nجولة أخرى: /guess`;
}
