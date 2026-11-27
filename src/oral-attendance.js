// src/oral-attendance.js — oral attendance (إثبات حضور الشفوي).
//
// Per lesson the student opens that lesson's ورقة الشفوي (the "🗣 الشفوي"
// photo item in src/learn-manifest.js), reads 3 words from it and records
// them as a voice message. The bot verifies AUTOMATICALLY from Telegram's
// voice metadata only (duration + file size): the recording exists, is not
// empty and has a plausible duration. No pronunciation grading, no human
// listening, and nothing is kept — the recording is not stored at all
// (no file_id, no R2 upload); only the attendance mark is saved, once per
// lesson, in the UserStore Durable Object.
//
// Honest limit: metadata cannot prove the recording actually contains the
// 3 words, or that it is not silence — a silent recording of plausible
// length would pass. Detecting silence would need downloading and
// analysing the audio, which the free-tier Worker cannot afford per
// message. The check proves a real voice message of plausible length was
// sent, nothing more.
//
// No Sheet, no Apps Script, no certificate gate yet (the attendance-as-
// certificate-condition is a separate later step, not built here).
// Attendance records are admin-only: /attendance lists everything for the
// admin; a student sees only their own list.

import { LEARN_LEVELS } from "./learn-manifest.js";

export const ORAL_RECORD_BUTTON = "🎙 سجّل الشفوي";
export const ORAL_MIN_SECONDS = 2;
export const ORAL_MAX_SECONDS = 60;
// Bytes: a real 2s Opus voice message is several KB; under 1KB is an
// empty/broken upload, not a recording.
export const ORAL_MIN_FILE_SIZE = 1000;
export const ORAL_ATTENDANCE_PREFIX = "oral:att:";
export const ORAL_LIST_LIMIT = 100;

export function oralAttendanceKey(userId) {
  return `${ORAL_ATTENDANCE_PREFIX}${userId}`;
}

export function findOralLesson(lessonId, levels = LEARN_LEVELS) {
  const id = String(lessonId ?? "").trim();
  if (!id) return null;
  for (const level of levels ?? []) {
    const lesson = (level?.lessons ?? []).find((l) => l?.id === id);
    if (lesson) return lesson;
  }
  return null;
}

// A lesson has a ورقة شفوي when its manifest items include the "oral" photo.
export function lessonHasOral(lesson) {
  return Array.isArray(lesson?.items) && lesson.items.some((item) => item?.key === "oral");
}

export function oralLessonTitle(lessonId, levels = LEARN_LEVELS) {
  const id = String(lessonId ?? "").trim();
  for (const level of levels ?? []) {
    const lesson = (level?.lessons ?? []).find((l) => l?.id === id);
    if (lesson) return `${level?.title ?? ""} — ${lesson.title}`.replace(/^ — /u, "");
  }
  return id;
}

export function oralLessonCount(levels = LEARN_LEVELS) {
  let count = 0;
  for (const level of levels ?? []) {
    for (const lesson of level?.lessons ?? []) if (lessonHasOral(lesson)) count += 1;
  }
  return count;
}

// Validate a Telegram voice/audio object by metadata only.
// Returns { ok: true } or { ok: false, reason } where reason is one of:
// "missing" (no duration at all), "short" (< 2s), "long" (> 60s),
// "tiny" (file_size present but under 1KB — an empty/broken upload).
export function validateOralVoice(source) {
  const duration = Number(source?.duration);
  if (!source || !Number.isFinite(duration) || duration <= 0) return { ok: false, reason: "missing" };
  if (duration < ORAL_MIN_SECONDS) return { ok: false, reason: "short" };
  if (duration > ORAL_MAX_SECONDS) return { ok: false, reason: "long" };
  const size = Number(source?.file_size);
  if (Number.isFinite(size) && size < ORAL_MIN_FILE_SIZE) return { ok: false, reason: "tiny" };
  return { ok: true };
}

export async function getOralAttendance(storeCall, userId) {
  if (!storeCall) return null;
  try {
    const value = (await storeCall({ op: "get", key: oralAttendanceKey(userId) })).value ?? null;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

// Mark one lesson attended for a user. Idempotent: a second mark of the
// same lesson returns { already: true } and does not re-write. Returns
// { already, record } — record is the stored attendance object
// { userId, name, lessons: { [lessonId]: isoTimestamp } }.
export async function markOralAttendance(storeCall, userId, lessonId, name = "") {
  const key = oralAttendanceKey(userId);
  const record = (await getOralAttendance(storeCall, userId)) ?? { userId: String(userId), name: String(name ?? ""), lessons: {} };
  if (!record.lessons || typeof record.lessons !== "object") record.lessons = {};
  if (record.lessons[lessonId]) return { already: true, record };
  record.lessons[lessonId] = new Date().toISOString();
  if (name) record.name = String(name);
  await storeCall({ op: "put", key, value: record });
  return { already: false, record };
}

// All attendance records (admin only). The DO listprefix op caps at 100
// entries per call; attendance is small today, so one page is enough.
export async function listOralAttendance(storeCall) {
  if (!storeCall) return [];
  try {
    const res = await storeCall({ op: "listprefix", key: ORAL_ATTENDANCE_PREFIX, limit: ORAL_LIST_LIMIT });
    return Array.isArray(res?.entries) ? res.entries : [];
  } catch {
    return [];
  }
}

export function oralPromptText(lessonTitle) {
  return `🎙 افتح ورقة الشفوي «🗣 الشفوي» في درس «${lessonTitle}»، واقرأ منها 3 كلمات وسجّلهم صوتيًا هنا.\n(للإلغاء: /cancel)`;
}

export function oralAcceptedText(lessonTitle) {
  return `✅ تم تسجيل حضورك في «${lessonTitle}».`;
}

export function oralRejectedText(reason) {
  if (reason === "short") return "⚠️ التسجيل قصير جدًا — اقرأ 3 كلمات من ورقة الشفوي وسجّل تاني.";
  if (reason === "long") return "⚠️ التسجيل طويل جدًا — اقرأ 3 كلمات بس من ورقة الشفوي وسجّل تاني.";
  return "⚠️ التسجيل مش واضح — سجّل تاني.";
}

export const ORAL_ALREADY_TEXT = "انت سجلت الدرس ده خلاص";

export const ORAL_CANCEL_TEXT = "✅ تم إلغاء تسجيل الشفوي.";

export const ORAL_NO_LESSON_TEXT = "افتح درس فيه ورقة الشفوي الأول، وبعدين اضغط «🎙 سجّل الشفوي».";

export const ORAL_LESSON_HAS_NO_ORAL_TEXT = "الدرس ده مفيهوش ورقة شفوي.";

export function oralOwnListText(record, total = oralLessonCount()) {
  const lessons = record?.lessons ?? {};
  const ids = Object.keys(lessons);
  if (!ids.length) {
    return "🎙 لسه ما سجلتش أي شفوي.\nافتح أي درس فيه ورقة الشفوي واضغط «🎙 سجّل الشفوي» واقرأ 3 كلمات وسجّلهم.";
  }
  const lines = [`🎙 حضورك الشفوي: ${ids.length} من ${total} درسًا`, ""];
  for (const id of ids) lines.push(`✅ ${oralLessonTitle(id)}`);
  return lines.join("\n");
}

export function oralAdminListText(entries, total = oralLessonCount()) {
  if (!entries.length) return "🎙 لسه مفيش أي حضور شفوي مسجّل.";
  const rows = entries
    .map(({ key, value }) => {
      const userId = String(key ?? "").slice(ORAL_ATTENDANCE_PREFIX.length);
      const lessons = value?.lessons ?? {};
      return { userId, name: value?.name ?? "", count: Object.keys(lessons).length, ids: Object.keys(lessons) };
    })
    .sort((a, b) => b.count - a.count || String(a.name ?? "").localeCompare(String(b.name ?? ""), "ar"));
  const totalMarks = rows.reduce((sum, row) => sum + row.count, 0);
  const lines = [`🎙 حضور الشفوي — ${rows.length} طالب، ${totalMarks} تسجيل (من ${total} درسًا فيه ورقة شفوي)`, ""];
  let shown = 0;
  for (const row of rows) {
    const who = row.name ? `${row.name} (🆔 ${row.userId})` : `🆔 ${row.userId}`;
    const line = `• ${who} — ${row.count} ${row.count === 1 ? "درس" : "دروس"}: ${row.ids.map((id) => oralLessonTitle(id)).join("، ")}`;
    if ([...lines, line].join("\n").length > 3800) break;
    lines.push(line);
    shown += 1;
  }
  if (shown < rows.length) lines.push(`…و ${rows.length - shown} طالب آخرين (القائمة طويلة).`);
  return lines.join("\n");
}
