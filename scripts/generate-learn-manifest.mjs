// scripts/generate-learn-manifest.mjs — regenerate src/learn-manifest.js from
// the live "learn" tab of the "coptic" Google Sheet.
//
// This is the auto-sync half of the learn pipeline: the deploy workflow's
// sync job runs it every 30 minutes; when the Sheet changed, the regenerated
// manifest differs, the job commits it, the deploy follows, and the Worker's
// scheduled tick picks the new media up (see maybeAutoImportLearn).
// The Worker itself NEVER fetches the Sheet at runtime.
//
// Usage:
//   node scripts/generate-learn-manifest.mjs            # fetch the live Sheet
//   node scripts/generate-learn-manifest.mjs --from <sheet-values.json>
//   node scripts/generate-learn-manifest.mjs --from <file> --meta <drive-meta.json>
//
// --from reads a raw `values` response (the original 2026-11-06 interface).
// --meta is optional; when given, every Drive file id is checked against it
// (expected mimeType: video/mp4 for column D, image/jpeg for columns E/G).
//
// Columns (H is ignored entirely — the user said so):
//   A level (1/2) | B lesson button name | C description (same as B)
//   D video Drive link | E oral photo link (L1) OR exercise TEXT (L2)
//   F Google Forms exam link | G summary photo link (L2)
//
// Lesson ids are positional inside their level (m_learn_l1_01, ...), exactly
// as the frozen manifest has them. Appending a lesson at the END of a level
// is clean; inserting one in the MIDDLE renumbers the lessons after it, and
// the bot re-uploads those (their stored file_ids are keyed by lesson id).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LEARN_SHEET_ID = "1kZKjF2KDsGT0HslGSenN-pDTzx4FpX0QDPqX0ZOnriY";
export const LEARN_SHEET_TAB = "learn";

export function learnSheetGvizUrl(sheetId = LEARN_SHEET_ID, tab = LEARN_SHEET_TAB) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
}

// Parse a gviz `out:json` response body into the plain `values` shape the
// builder eats: an array of rows, each an array of cell strings. The gviz
// envelope is `/*O_o*/\ngoogle.visualization.Query.setResponse({...});`.
export function parseGvizResponse(text) {
  const start = String(text ?? "").indexOf("{");
  const end = String(text ?? "").lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("gviz response has no JSON body");
  const payload = JSON.parse(String(text).slice(start, end + 1));
  if (payload.status !== "ok") {
    const detail = payload.errors?.map((e) => e.detailed_message ?? e.message ?? "").filter(Boolean).join("; ");
    throw new Error(`gviz query failed: ${detail || payload.status}`);
  }
  const rows = payload.table?.rows ?? [];
  return rows.map((row) =>
    (row.c ?? []).map((cell) => {
      if (cell == null || cell.v == null) return "";
      return String(cell.v);
    }),
  );
}

export function driveIdFromUrl(url) {
  const text = String(url ?? "").trim();
  return (
    text.match(/\/d\/([A-Za-z0-9_-]+)/u)?.[1] ??
    text.match(/[?&]id=([A-Za-z0-9_-]+)/u)?.[1] ??
    ""
  );
}

const cell = (row, index) => String(row[index] ?? "").trim();

function checkDrive(meta, id, expectedMime, where) {
  if (!id) throw new Error(`Missing Drive id (${where})`);
  if (!meta) return;
  const entry = meta[id];
  if (!entry) throw new Error(`Drive file not in metadata: ${id} (${where})`);
  if (entry.mimeType !== expectedMime) {
    throw new Error(`Drive file ${id} (${where}) is ${entry.mimeType}, expected ${expectedMime}`);
  }
}

// Build the LEARN_LEVELS structure from plain `values` rows (header row
// first). Pure: the same rows always build the same levels.
export function buildLearnLevels(rows, meta = null) {
  const levels = [];
  for (const levelNum of ["1", "2"]) {
    const levelRows = rows.slice(1).filter((row) => cell(row, 0) === levelNum);
    const lessons = levelRows.map((row, index) => {
      const n = index + 1;
      const levelTag = `l${levelNum}`;
      const lessonId = `m_learn_${levelTag}_${String(n).padStart(2, "0")}`;
      const title = cell(row, 1);
      if (!title) throw new Error(`Row with no lesson name (level ${levelNum}, #${n})`);
      if (title.length > 40) throw new Error(`Lesson title over 40 chars: ${title}`);
      const items = [];
      const video = driveIdFromUrl(cell(row, 3));
      if (video) {
        checkDrive(meta, video, "video/mp4", `${lessonId} video`);
        items.push({ key: "video", kind: "video", driveId: video, label: "🎬 فيديو الدرس" });
      }
      const e = cell(row, 4);
      if (e) {
        if (/^https?:\/\//u.test(e)) {
          const photo = driveIdFromUrl(e);
          checkDrive(meta, photo, "image/jpeg", `${lessonId} oral`);
          items.push({ key: "oral", kind: "photo", driveId: photo, label: "🗣 الشفوي" });
        } else {
          // Level-2 exercise text (confirmed by the user: texts, not photos).
          items.push({ key: "exercise", kind: "text", text: e, label: "📝 التدريب" });
        }
      }
      const form = cell(row, 5);
      if (form) {
        if (!/^https?:\/\//u.test(form)) throw new Error(`Bad Forms URL (${lessonId}): ${form}`);
        items.push({ key: "exam", kind: "url", url: form, label: "📝 الامتحان الإلكتروني" });
      }
      const summary = driveIdFromUrl(cell(row, 6));
      if (summary) {
        checkDrive(meta, summary, "image/jpeg", `${lessonId} summary`);
        items.push({ key: "summary", kind: "photo", driveId: summary, label: "🖼 ملخص الدرس" });
      }
      if (!items.length) throw new Error(`Lesson with no items: ${lessonId} (${title})`);
      // Button order inside a lesson is the user's order: L1 video → oral →
      // exam; L2 video → summary → exercise → exam.
      const order = levelNum === "1" ? ["video", "oral", "exam"] : ["video", "summary", "exercise", "exam"];
      items.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
      return { id: lessonId, title, items };
    });
    levels.push({
      id: `m_learn_l${levelNum}`,
      title: levelNum === "1" ? "المستوى الأول" : "المستوى الثاني",
      lessons,
    });
  }
  return levels;
}

export function countLearnItems(levels) {
  const counts = { lessons: 0, videos: 0, photos: 0, forms: 0, texts: 0 };
  for (const level of levels) {
    for (const lesson of level.lessons) {
      counts.lessons += 1;
      for (const item of lesson.items) {
        if (item.kind === "video") counts.videos += 1;
        else if (item.kind === "photo") counts.photos += 1;
        else if (item.kind === "url") counts.forms += 1;
        else if (item.kind === "text") counts.texts += 1;
      }
    }
  }
  return counts;
}

export function renderLearnManifest(levels) {
  return `// src/learn-manifest.js — snapshot of the "learn" tab (levels 1+2).
// Regenerated automatically by the deploy workflow's sync job
// (node scripts/generate-learn-manifest.mjs) every 30 minutes from the live
// "coptic" Sheet — when the Sheet changes, this file changes, the job
// commits it, the deploy follows, and the bot's scheduled tick re-imports
// the changed media. DO NOT edit by hand — regenerate instead.
// Column H ("الاستثناء") is ignored entirely by user instruction.
// The Worker never fetches the Sheet at runtime; the importer
// (/importlearn, or the scheduled auto-import) downloads each Drive file
// once from its public link, uploads it to Telegram, and stores the
// Telegram file_id.
export const LEARN_MANIFEST_VERSION = 1;
export const LEARN_LEVELS = ${JSON.stringify(levels, null, 2)};
`;
}

async function main() {
  const args = process.argv.slice(2);
  const fromIndex = args.indexOf("--from");
  const metaIndex = args.indexOf("--meta");
  const sheetPath = fromIndex >= 0 ? args[fromIndex + 1] : null;
  const metaPath = metaIndex >= 0 ? args[metaIndex + 1] : null;
  if ((fromIndex >= 0 && !sheetPath) || (metaIndex >= 0 && !metaPath)) {
    console.error("Usage: node scripts/generate-learn-manifest.mjs [--from <sheet-values.json>] [--meta <drive-meta.json>]");
    process.exit(1);
  }
  const meta = metaPath ? JSON.parse(readFileSync(resolve(metaPath), "utf8")) : null;
  let rows;
  if (sheetPath) {
    const sheet = JSON.parse(readFileSync(resolve(sheetPath), "utf8"));
    rows = sheet.values ?? [];
  } else {
    const response = await fetch(learnSheetGvizUrl(), { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Sheet fetch failed: HTTP ${response.status}`);
    rows = parseGvizResponse(await response.text());
  }
  const levels = buildLearnLevels(rows, meta);
  const out = renderLearnManifest(levels);
  const root = fileURLToPath(new URL("..", import.meta.url));
  const target = resolve(root, "src", "learn-manifest.js");
  const changed = !existsSync(target) || readFileSync(target, "utf8") !== out;
  writeFileSync(target, out);
  console.log(JSON.stringify({ wrote: "src/learn-manifest.js", changed, ...countLearnItems(levels) }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`generate-learn-manifest failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  });
}
