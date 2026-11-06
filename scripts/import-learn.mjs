import { writeFile } from "node:fs/promises";

const SHEET_ID = process.env.SHEET_ID ?? "1kZKjF2KDsGT0HslGSenN-pDTzx4FpX0QDPqX0ZOnriY";
const SHEET_NAME = process.env.SHEET_NAME ?? "learn";
const WORKER_URL = String(process.env.WORKER_URL ?? "").replace(/\/+$/u, "");
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const IMPORT_SECRET = process.env.LEARN_IMPORT_SECRET;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID ?? "813894692";
const DRY_RUN = process.env.DRY_RUN === "true";

if (!BOT_TOKEN && !DRY_RUN) throw new Error("TELEGRAM_BOT_TOKEN is required");
if (!WORKER_URL && !DRY_RUN) throw new Error("WORKER_URL is required");
if (!IMPORT_SECRET && !DRY_RUN) throw new Error("LEARN_IMPORT_SECRET is required");

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function value(row, index) { return String(row[index] ?? "").trim(); }
function driveId(url) {
  const text = String(url ?? "");
  return text.match(/\/d\/([A-Za-z0-9_-]+)/u)?.[1]
    ?? text.match(/[?&]id=([A-Za-z0-9_-]+)/u)?.[1]
    ?? "";
}
function cleanLabel(text, fallback) {
  const label = String(text || fallback || "").replace(/\s+/gu, " ").trim();
  return label.slice(0, 40) || fallback;
}
function buttonId(prefix, n) { return `learn_${prefix}_${String(n).padStart(2, "0")}`.slice(0, 40); }
function menu(id, title, text, parentId = null) {
  return { id, title: cleanLabel(title, title), text: String(text || title).slice(0, 3000), parentId, buttons: [] };
}
function addButton(target, id, label, kind, extra = {}) {
  target.buttons.push({ id: id.slice(0, 40), label: cleanLabel(label, "محتوى"), kind, ...extra });
}

async function fetchSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SHEET_ID)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Sheet download failed: ${response.status}`);
  const rows = parseCsv(await response.text());
  if (!rows.length) throw new Error("The sheet is empty");
  return {
    headers: rows[0],
    rows: rows.slice(1).filter((row) => value(row, 0) === "1" || value(row, 0) === "2"),
  };
}

async function downloadDrive(url) {
  const id = driveId(url);
  if (!id) throw new Error(`Invalid Drive URL: ${url}`);
  const downloadUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(downloadUrl, { redirect: "follow" });
    const type = response.headers.get("content-type") ?? "";
    const data = Buffer.from(await response.arrayBuffer());
    if (response.ok && data.length > 0 && !type.includes("text/html")) return { id, data, type };
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
  }
  throw new Error(`Drive file is not publicly downloadable: ${id}`);
}

async function telegram(method, fields, file = null) {
  const form = new FormData();
  for (const [key, val] of Object.entries(fields)) form.append(key, String(val));
  if (file) form.append(file.field, new Blob([file.data], { type: file.type || "application/octet-stream" }), file.name);
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: "POST", body: form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(`Telegram ${method} failed: ${result.description ?? response.status}`);
  return result.result;
}

const downloaded = new Map();
const uploaded = new Map();
async function uploadDrive(url, kind, caption) {
  const id = driveId(url);
  if (uploaded.has(`${kind}:${id}`)) return uploaded.get(`${kind}:${id}`);
  let file = downloaded.get(id);
  if (!file) { file = await downloadDrive(url); downloaded.set(id, file); }
  if (DRY_RUN) return `DRY_${kind}_${id}`;
  let result;
  if (kind === "video") {
    result = await telegram("sendVideo", { chat_id: ADMIN_CHAT_ID, caption: String(caption).slice(0, 900) }, { field: "video", data: file.data, type: "video/mp4", name: `${id}.mp4` });
    const item = { fileId: result.video.file_id, fileUniqueId: result.video.file_unique_id ?? "" };
    uploaded.set(`${kind}:${id}`, item);
    await telegram("deleteMessage", { chat_id: ADMIN_CHAT_ID, message_id: result.message_id }).catch(() => null);
    return item;
  }
  result = await telegram("sendPhoto", { chat_id: ADMIN_CHAT_ID, caption: String(caption).slice(0, 900) }, { field: "photo", data: file.data, type: "image/jpeg", name: `${id}.jpg` });
  const photo = result.photo?.at(-1);
  const item = { fileId: photo.file_id, fileUniqueId: photo.file_unique_id ?? "" };
  uploaded.set(`${kind}:${id}`, item);
  await telegram("deleteMessage", { chat_id: ADMIN_CHAT_ID, message_id: result.message_id }).catch(() => null);
  return item;
}

function buildMenus(rows) {
  const root = menu("learn_root", "📚 دروس اللغة القبطية", "📚 <b>دروس اللغة القبطية</b>\n\nاختر المستوى:");
  const l1 = menu("learn_l1", "🥇 المستوى الأول", "🥇 <b>المستوى الأول</b>\n\nاختر نوع المحتوى:", root.id);
  const l2 = menu("learn_l2", "🥈 المستوى الثاني", "🥈 <b>المستوى الثاني</b>\n\nاختر نوع المحتوى:", root.id);
  addButton(root, "learn_root_l1", l1.title, "submenu", { targetMenuId: l1.id });
  addButton(root, "learn_root_l2", l2.title, "submenu", { targetMenuId: l2.id });
  const cats = [
    menu("learn_l1_videos", "🎬 فيديوهات المستوى الأول", "🎬 فيديوهات المستوى الأول", l1.id),
    menu("learn_l1_oral", "🗣 الشفوي المستوى الأول", "🗣 صور الشفوي للمستوى الأول", l1.id),
    menu("learn_l1_forms", "📝 امتحانات المستوى الأول", "📝 امتحانات Google Forms للمستوى الأول", l1.id),
    menu("learn_l2_videos", "🎬 فيديوهات المستوى الثاني", "🎬 فيديوهات المستوى الثاني", l2.id),
    menu("learn_l2_training", "✍️ تدريبات المستوى الثاني", "✍️ تدريبات المستوى الثاني", l2.id),
    menu("learn_l2_forms", "📝 امتحانات المستوى الثاني", "📝 امتحانات Google Forms للمستوى الثاني", l2.id),
    menu("learn_l2_summaries", "🖼 ملخصات المستوى الثاني", "🖼 صور ملخصات المستوى الثاني", l2.id),
  ];
  for (const [parent, list] of [[l1, cats.slice(0, 3)], [l2, cats.slice(3)]]) {
    for (const child of list) addButton(parent, `${child.id}_link`, child.title, "submenu", { targetMenuId: child.id });
  }
  return { root, l1, l2, cats };
}

async function main() {
  const sheet = await fetchSheet();
  const rows = sheet.rows;
  const { root, l1, l2, cats } = buildMenus(rows);
  const byLevel = { "1": rows.filter((r) => value(r, 0) === "1"), "2": rows.filter((r) => value(r, 0) === "2") };
  const stats = { rows: rows.length, videos: 0, photos: 0, forms: 0, texts: 0 };

  const addMediaList = async (target, list, kind, col, prefix) => {
    let n = 0;
    for (const row of list) {
      const url = value(row, col);
      if (!url) continue;
      n += 1;
      const title = value(row, 1) || `الدرس ${n}`;
      const media = await uploadDrive(url, kind, title);
      addButton(target, buttonId(prefix, n), title, kind, media);
      stats[kind === "video" ? "videos" : "photos"] += 1;
    }
  };
  const addForms = (target, list, prefix) => {
    let n = 0;
    for (const row of list) {
      const url = value(row, 5);
      if (!url) continue;
      n += 1;
      addButton(target, buttonId(prefix, n), `${value(row, 1) || `الدرس ${n}`} — الامتحان`, "url", { url });
      stats.forms += 1;
    }
  };
  const addTexts = (target, list, prefix) => {
    let n = 0;
    for (const row of list) {
      const text = value(row, 4);
      if (!text || /^https?:\/\//u.test(text)) continue;
      n += 1;
      addButton(target, buttonId(prefix, n), `${value(row, 1) || `الدرس ${n}`} — التدريب`, "text", { text });
      stats.texts += 1;
    }
  };
  const addInstruction = (target, text, id) => {
    if (text) addButton(target, id, "📜 تعليمات الشهادة", "text", { text });
  };

  await addMediaList(cats[0], byLevel["1"], "video", 3, "l1_video");
  await addMediaList(cats[1], byLevel["1"], "photo", 4, "l1_oral");
  addForms(cats[2], byLevel["1"], "l1_form");
  await addMediaList(cats[3], byLevel["2"], "video", 3, "l2_video");
  addTexts(cats[4], byLevel["2"], "l2_training");
  addForms(cats[5], byLevel["2"], "l2_form");
  await addMediaList(cats[6], byLevel["2"], "photo", 6, "l2_summary");
  const instructionRow = rows.find((row) => value(row, 12) || value(row, 13)) ?? [];
  addInstruction(l1, value(instructionRow, 12), "learn_l1_certificate");
  addInstruction(l2, value(instructionRow, 13), "learn_l2_certificate");

  const menus = { menus: [root, l1, l2, ...cats] };
  await writeFile("/tmp/learn-import-summary.json", JSON.stringify({ stats, menus: menus.menus.map((m) => ({ id: m.id, title: m.title, buttons: m.buttons.length })), downloaded: downloaded.size, uploaded: uploaded.size }, null, 2));
  console.log(JSON.stringify({ stage: "built", stats, downloaded: downloaded.size, uploaded: uploaded.size }, null, 2));
  if (DRY_RUN) return;
  const response = await fetch(`${WORKER_URL}/__learn-import`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-learn-import-secret": IMPORT_SECRET },
    body: JSON.stringify(menus),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(`Worker import failed: ${response.status} ${JSON.stringify(result)}`);
  console.log(JSON.stringify({ stage: "stored", result }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
