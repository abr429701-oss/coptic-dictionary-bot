// src/learn-import.js — bulk lesson importer for the "learn" levels.
//
// The admin runs /importlearn in the bot (see handleImportLearn in
// src/index.js). ONE run imports EVERYTHING: the command answers
// immediately, then the import continues in the background (ctx.waitUntil)
// until all pending files are done, and the admin gets a completion
// message. The importer reads NO sheet at runtime: the frozen manifest
// (src/learn-manifest.js) holds the lessons, and each Drive file is
// downloaded once from its public link, uploaded to Telegram once, and the
// Telegram file_id is stored in the Durable Object (key learn-import:v1).
// User taps afterwards only ever touch Telegram file_ids / URL buttons —
// never the Sheet and never Drive.
//
// Menus: only the two level menus (m_learn_l1, m_learn_l2). Each lesson has
// ONE button (kind "lesson", label = lesson name); tapping it sends the
// WHOLE lesson at once, items in manifest order (L1: video → oral photo →
// exam link; L2: video → summary photo → exercise text → exam link).
// Telegram has no single message that holds a video + a photo + long text
// + a link, so one tap sends the lesson as consecutive messages in that
// order. A lesson button appears only once ALL its items are ready.
//
// This module holds the pure logic (no index.js imports) so it is unit
// testable without the Worker. The orchestration (storeCall round trips,
// the Telegram progress messages, the actual lesson send) lives in
// src/index.js.
import { normalizeMenus, cleanButtonLabel } from "./menu-builder.js";
import { LEARN_LEVELS } from "./learn-manifest.js";

export const LEARN_IMPORT_KEY = "learn-import:v1";
export const LEARN_MENU_PREFIX = "m_learn_";
// Telegram Bot API refuses file uploads over 50MB; every manifest file is
// under 21MB, but the guard stays so a future file fails loudly, not silently.
export const LEARN_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const LEARN_DRIVE_MIME = { video: "video/mp4", photo: "image/jpeg" };

// ---------------------------------------------------------------------------
// Manifest helpers
// ---------------------------------------------------------------------------

// "m_learn_l1_03" + "video" -> "m_learn_l1_03:video" (import-state key).
export function learnItemKey(lessonId, itemKey) {
  return `${lessonId}:${itemKey}`;
}

// "m_learn_l1_03" -> "b_learn_l1_03" (the single lesson button on the level menu).
export function learnLessonButtonId(lessonId) {
  return `b_${String(lessonId).slice(2)}`;
}

// Upload items only (video/photo). Text exercises and Forms URLs need no
// upload and are always ready.
export function learnUploadItems(levels = LEARN_LEVELS) {
  const items = [];
  for (const level of levels) {
    for (const lesson of level.lessons) {
      for (const item of lesson.items) {
        if (item.kind === "video" || item.kind === "photo") {
          items.push({
            key: learnItemKey(lesson.id, item.key),
            lessonId: lesson.id,
            levelId: level.id,
            kind: item.kind,
            itemKey: item.key,
            driveId: item.driveId,
            label: item.label,
            title: lesson.title,
          });
        }
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Import state (stored in the Durable Object under LEARN_IMPORT_KEY)
// ---------------------------------------------------------------------------

export function emptyImportState() {
  return { version: 1, startedAt: null, updatedAt: null, items: {} };
}

// Coerce any stored value into a valid state; entries for items that are not
// in the manifest are dropped, unknown statuses become pending.
export function normalizeImportState(value, levels = LEARN_LEVELS) {
  const state = emptyImportState();
  if (!value || typeof value !== "object") return state;
  if (typeof value.startedAt === "string") state.startedAt = value.startedAt;
  if (typeof value.updatedAt === "string") state.updatedAt = value.updatedAt;
  const known = new Set(learnUploadItems(levels).map((item) => item.key));
  const raw = value.items && typeof value.items === "object" ? value.items : {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!known.has(key) || !entry || typeof entry !== "object") continue;
    const status = entry.status === "done" || entry.status === "failed" ? entry.status : "pending";
    state.items[key] = {
      status,
      fileId: typeof entry.fileId === "string" ? entry.fileId : "",
      fileUniqueId: typeof entry.fileUniqueId === "string" ? entry.fileUniqueId : "",
      error: typeof entry.error === "string" ? entry.error.slice(0, 300) : "",
      at: typeof entry.at === "string" ? entry.at : "",
    };
  }
  return state;
}

export function importProgress(state, items) {
  const total = items.length;
  const done = items.filter((item) => state.items[item.key]?.status === "done").length;
  const failed = items.filter((item) => state.items[item.key]?.status === "failed").length;
  return { total, done, failed, pending: total - done - failed, complete: total > 0 && done === total };
}

// All pending/failed uploads, in manifest order (failed items are retried).
// One /importlearn run processes ALL of them, not a small batch.
export function learnPendingItems(state, items) {
  return items.filter((item) => state.items[item.key]?.status !== "done");
}

// ---------------------------------------------------------------------------
// Lesson lookup + send plan (one tap sends the whole lesson, in order)
// ---------------------------------------------------------------------------

export function findLearnLesson(lessonId, levels = LEARN_LEVELS) {
  const id = String(lessonId ?? "").trim();
  for (const level of levels) {
    const lesson = level.lessons.find((l) => l.id === id);
    if (lesson) return lesson;
  }
  return null;
}

// Ordered send steps for one tap on a lesson button, or null when the
// lesson is not found or not fully ready (a media item without a file_id).
// Steps carry everything the sender needs: media steps hold the stored
// Telegram file_id, text steps the exercise text, url steps the Forms link.
export function learnLessonSendPlan(lesson, state) {
  if (!lesson || !Array.isArray(lesson.items) || !lesson.items.length) return null;
  const steps = [];
  for (const item of lesson.items) {
    if (item.kind === "video" || item.kind === "photo") {
      const entry = state.items[learnItemKey(lesson.id, item.key)];
      if (entry?.status !== "done" || !entry.fileId) return null;
      steps.push({ kind: item.kind, fileId: entry.fileId, caption: lesson.title });
    } else if (item.kind === "text") {
      steps.push({ kind: "text", text: String(item.text ?? "") });
    } else if (item.kind === "url") {
      steps.push({ kind: "url", url: String(item.url ?? ""), label: cleanButtonLabel(item.label) });
    } else {
      return null;
    }
  }
  return steps.length ? steps : null;
}

// ---------------------------------------------------------------------------
// Menu building — only the two level menus, one button per ready lesson.
// A lesson button is never created without every item ready.
// ---------------------------------------------------------------------------

function isItemReady(state, lessonId, item) {
  if (item.kind === "text" || item.kind === "url") return true;
  const entry = state.items[learnItemKey(lessonId, item.key)];
  return entry?.status === "done" && Boolean(entry.fileId);
}

export function buildLearnMenus(levels = LEARN_LEVELS, state = emptyImportState()) {
  const menus = [];
  let lessonsBuilt = 0;
  let buttonsBuilt = 0;
  for (const level of levels) {
    const lessonButtons = [];
    for (const lesson of level.lessons) {
      // A lesson appears only once ALL its items are ready (no half-built
      // lessons for users); tapping its single button then sends it all.
      if (!lesson.items.every((item) => isItemReady(state, lesson.id, item))) continue;
      lessonButtons.push({
        id: learnLessonButtonId(lesson.id),
        label: cleanButtonLabel(lesson.title),
        kind: "lesson",
        lessonId: lesson.id,
      });
      lessonsBuilt += 1;
    }
    if (!lessonButtons.length) continue; // level appears only once it has lessons
    // A way back: the level menus have no parent, so the keyboard builder
    // adds no Back/Home row for them and the user would be stuck inside
    // the level (only /menu typed by hand would get them out). Both nav
    // buttons are the last two rows of every level menu, back first then
    // home — the same order as the native nav row. Both go to /menu: the
    // level menus have no parent, so back and home mean the same here.
    lessonButtons.push({
      id: `b_${level.id}_back`,
      label: "🔙 رجوع",
      kind: "command",
      command: "/menu",
    });
    lessonButtons.push({
      id: `b_${level.id}_home`,
      label: "🏠 الرئيسية",
      kind: "command",
      command: "/menu",
    });
    menus.push({
      id: level.id,
      title: cleanButtonLabel(level.title),
      text: level.title,
      parentId: null,
      buttons: lessonButtons,
    });
    buttonsBuilt += lessonButtons.length;
  }
  return { menus, counts: { levels: menus.length, lessons: lessonsBuilt, buttons: buttonsBuilt } };
}

// Menus the old importer built: one submenu per lesson (m_learn_l1_01 …
// m_learn_l2_10). The new design has no lesson submenus, so a rebuild must
// drop them; the level menus are replaced by the merge below. (The CI
// import's learn_root/learn_l1/learn_l2 menus have no "m_" prefix and are
// untouched by this.)
export const LEARN_LESSON_MENU_ID = /^m_learn_l[12]_\d{2}$/u;
export function dropStaleLearnLessonMenus(menus) {
  return (menus ?? []).filter((m) => !LEARN_LESSON_MENU_ID.test(String(m?.id ?? "").trim()));
}

// Merge incoming menus into the stored ones: menus with an incoming id are
// replaced, everything else (m_video, custom menus, the other import's
// learn_* menus) is preserved untouched. The result is normalized (and so
// capped at MAX_MENUS).
export function mergeMenus(existing, incoming) {
  const incomingIds = new Set(
    (incoming ?? []).map((m) => String(m?.id ?? "").trim()).filter(Boolean),
  );
  const kept = (existing?.menus ?? []).filter((m) => !incomingIds.has(String(m?.id ?? "").trim()));
  return normalizeMenus({ menus: [...kept, ...(incoming ?? [])] });
}

// ---------------------------------------------------------------------------
// Drive download + Telegram upload (Worker side; fetch is injectable in tests)
// ---------------------------------------------------------------------------

export function driveDownloadUrl(driveId) {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveId)}&export=download&confirm=t`;
}

export async function downloadDriveFile(driveId, fetchFn = globalThis.fetch) {
  const response = await fetchFn(driveDownloadUrl(driveId), {
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  const type = response.headers?.get?.("content-type") ?? "";
  if (!response.ok || type.includes("text/html")) {
    throw new Error(`Drive download failed for ${driveId}: HTTP ${response.status}`);
  }
  const data = await response.arrayBuffer();
  if (!data.byteLength) throw new Error(`Drive file is empty: ${driveId}`);
  if (data.byteLength > LEARN_MAX_UPLOAD_BYTES) {
    throw new Error(`Drive file over the 50MB Telegram cap: ${driveId}`);
  }
  return { data, type };
}

// Download one manifest item from Drive, upload it to Telegram in the admin
// chat, delete the sent message (the file_id stays valid), and return the
// captured file_id. Throws on any failure — the caller records it and moves on.
export async function uploadLearnFile(env, chatId, item, fetchFn = globalThis.fetch) {
  const { data, type } = await downloadDriveFile(item.driveId, fetchFn);
  const method = item.kind === "video" ? "sendVideo" : "sendPhoto";
  const field = item.kind === "video" ? "video" : "photo";
  const mime = /^(video|image)\//u.test(type) ? type : LEARN_DRIVE_MIME[item.kind];
  const filename = `${item.driveId}.${item.kind === "video" ? "mp4" : "jpg"}`;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", String(item.title).slice(0, 900));
  form.append(field, new Blob([data], { type: mime }), filename);
  const response = await fetchFn(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const parsed = await response.json().catch(() => null);
  if (!response.ok || !parsed?.ok) {
    throw new Error(`Telegram ${method} failed: ${parsed?.description ?? response.status}`);
  }
  const media = item.kind === "video" ? parsed.result?.video : parsed.result?.photo?.at(-1);
  const fileId = media?.file_id;
  if (!fileId) throw new Error(`Telegram ${method} returned no file_id`);
  const messageId = parsed.result?.message_id;
  if (messageId) {
    // Best effort: keep the admin chat clean; the file_id stays valid.
    await fetchFn(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/deleteMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
  }
  return { fileId, fileUniqueId: media?.file_unique_id ?? "" };
}

// ---------------------------------------------------------------------------
// Command parsing + progress text
// ---------------------------------------------------------------------------

export function parseImportLearnArg(text) {
  const arg = String(text ?? "").slice("/importlearn".length).trim().toLowerCase();
  if (!arg) return "run";
  if (arg === "status") return "status";
  if (arg === "reset") return "reset";
  return "usage";
}

export function learnImportStartText(progress) {
  const remaining = progress.total - progress.done;
  return `⏳ <b>جارٍ استيراد كل الدروس...</b>\n\nمتبقٍ ${remaining} ملف من ${progress.total} — سأرسل لك رسالة عند الانتهاء.`;
}

export function learnProgressText(progress, errors = []) {
  const lines = [
    `📥 <b>استيراد دروس القبطي</b>\n\nتم: <b>${progress.done}/${progress.total}</b> ملف (متبقٍ ${progress.pending}${progress.failed ? `، فشل ${progress.failed}` : ""}).`,
  ];
  if (progress.complete) {
    lines.push("✅ اكتمل الاستيراد — كل الدروس متاحة الآن من /menu (المستوى الأول / المستوى الثاني).");
  } else {
    lines.push("لإعادة محاولة العناصر الفاشلة شغّل /importlearn مرة أخرى (يعيد المحاولة من حيث توقف، ولا يعيد رفع ما تم). وللحالة: /importlearn status — وللبدء من جديد: /importlearn reset.");
  }
  for (const error of errors.slice(0, 5)) lines.push(`⚠️ ${error}`);
  if (errors.length > 5) lines.push(`… و${errors.length - 5} أخطاء أخرى.`);
  return lines.join("\n");
}
