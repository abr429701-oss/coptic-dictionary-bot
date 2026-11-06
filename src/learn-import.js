// src/learn-import.js — bulk lesson importer for the "learn" levels.
//
// The admin runs /importlearn in the bot (see handleImportLearn in
// src/index.js). The importer reads NO sheet at runtime: the frozen manifest
// (src/learn-manifest.js) holds the lessons, and each Drive file is
// downloaded once from its public link, uploaded to Telegram once, and the
// Telegram file_id is stored in the Durable Object (key learn-import:v1).
// User taps afterwards only ever touch Telegram file_ids / URL buttons —
// never the Sheet and never Drive.
//
// This module holds the pure logic (no index.js imports) so it is unit
// testable without the Worker. The orchestration (storeCall round trips,
// the Telegram progress messages) lives in src/index.js.
import { normalizeMenus, cleanButtonLabel } from "./menu-builder.js";
import { LEARN_LEVELS } from "./learn-manifest.js";

export const LEARN_IMPORT_KEY = "learn-import:v1";
export const LEARN_MENU_PREFIX = "m_learn_";
// One webhook invocation cannot upload all 50 files (331MB total): each run
// processes only this many pending/failed uploads, and stops early when the
// time budget below is spent. The admin re-runs /importlearn to continue.
export const LEARN_BATCH_SIZE = 3;
export const LEARN_BATCH_TIME_BUDGET_MS = 20000;
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

// "m_learn_l1_03" + "video" -> "b_learn_l1_03_video" (menu button id).
export function learnButtonId(lessonId, itemKey) {
  return `b_${String(lessonId).slice(2)}_${itemKey}`;
}

// "m_learn_l1_03" -> "b_learn_l1_03" (the button on the level menu that opens
// the lesson submenu).
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

// Next pending/failed uploads, in manifest order (failed items are retried).
export function nextImportBatch(state, items, limit = LEARN_BATCH_SIZE) {
  return items.filter((item) => state.items[item.key]?.status !== "done").slice(0, limit);
}

// ---------------------------------------------------------------------------
// Menu building — only from items that are actually ready.
// A media button is never created without a captured Telegram file_id.
// ---------------------------------------------------------------------------

function isItemReady(state, lessonId, item) {
  if (item.kind === "text" || item.kind === "url") return true;
  const entry = state.items[learnItemKey(lessonId, item.key)];
  return entry?.status === "done" && Boolean(entry.fileId);
}

function buildButton(state, lesson, item) {
  const id = learnButtonId(lesson.id, item.key);
  const label = cleanButtonLabel(item.label);
  if (item.kind === "video" || item.kind === "photo") {
    const entry = state.items[learnItemKey(lesson.id, item.key)];
    return {
      id,
      label,
      kind: item.kind,
      fileId: entry.fileId,
      fileUniqueId: entry.fileUniqueId ?? "",
      fileKind: item.kind,
      text: lesson.title, // caption under the media
    };
  }
  if (item.kind === "text") return { id, label, kind: "text", text: String(item.text ?? "") };
  if (item.kind === "url") return { id, label, kind: "url", url: String(item.url ?? "") };
  return null;
}

export function buildLearnMenus(levels = LEARN_LEVELS, state = emptyImportState()) {
  const menus = [];
  let lessonsBuilt = 0;
  let buttonsBuilt = 0;
  for (const level of levels) {
    const lessonMenus = [];
    for (const lesson of level.lessons) {
      const buttons = [];
      for (const item of lesson.items) {
        if (!isItemReady(state, lesson.id, item)) continue;
        const button = buildButton(state, lesson, item);
        if (button) buttons.push(button);
      }
      if (buttons.length !== lesson.items.length) continue; // a lesson appears only once ALL its items are ready (no half-built lessons for users)
      lessonMenus.push({
        id: lesson.id,
        title: cleanButtonLabel(lesson.title),
        text: lesson.title,
        parentId: level.id,
        buttons,
      });
      lessonsBuilt += 1;
      buttonsBuilt += buttons.length;
    }
    if (!lessonMenus.length) continue; // level appears only once it has lessons
    menus.push({
      id: level.id,
      title: cleanButtonLabel(level.title),
      text: level.title,
      parentId: null,
      buttons: lessonMenus.map((lessonMenu) => ({
        id: learnLessonButtonId(lessonMenu.id),
        label: cleanButtonLabel(lessonMenu.title),
        kind: "submenu",
        targetMenuId: lessonMenu.id,
      })),
    });
    menus.push(...lessonMenus);
    buttonsBuilt += lessonMenus.length;
  }
  return { menus, counts: { levels: menus.filter((m) => !m.parentId).length, lessons: lessonsBuilt, buttons: buttonsBuilt } };
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

export function learnProgressText(progress, errors = []) {
  const lines = [
    `📥 <b>استيراد دروس القبطي</b>\n\nتم: <b>${progress.done}/${progress.total}</b> ملف (متبقٍ ${progress.pending}${progress.failed ? `، فشل ${progress.failed}` : ""}).`,
  ];
  if (progress.complete) {
    lines.push("✅ اكتمل الاستيراد — كل الدروس متاحة الآن من /menu (المستوى الأول / المستوى الثاني).");
  } else {
    lines.push("للمتابعة شغّل /importlearn مرة أخرى. وللحالة: /importlearn status — وللبدء من جديد: /importlearn reset.");
  }
  for (const error of errors.slice(0, 5)) lines.push(`⚠️ ${error}`);
  if (errors.length > 5) lines.push(`… و${errors.length - 5} أخطاء أخرى.`);
  return lines.join("\n");
}
