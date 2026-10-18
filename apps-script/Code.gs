/**
 * Coptic Dictionary Bot — Google Apps Script web app.
 *
 * The upload tab is the remote index for recorded voices.  The script keeps
 * Drive and that tab reconciled in both directions:
 *   - a missing/trashed Drive file removes its upload row;
 *   - a deleted upload row trashes the previously indexed Drive file.
 *
 * Deploy as: Execute as "Me", Who has access "Anyone".
 */
const CONFIG = {
  FOLDER_ID: "1Lm0gDumRXJuXwJZ8RCOVePjyJliKyGWv",
  FOLDER_NAME: "dic_final",
  SHEET_ID: "14pUNXtrHoMSU9lBWhKQZyspe-DDTMDudSiuL2sJQRUI",
  DICTIONARY_TAB: "dictionary",
  BAN_TAB: "upload",
  SHARE_WITH_LINK: true,
  ADMIN_ID: "",
  USERS_TAB: "users",
  USERS_SHEET_ID: "",
};

const BAN_HEADER = [
  "id", "word", "drive_url", "drive_file_id", "telegram_file_id",
  "duration_s", "full_name", "user_id", "username", "file_name", "updated_at",
];
const MANIFEST_KEY = "UPLOAD_MANIFEST_V2";

function testSetup() {
  try { Logger.log(JSON.stringify(ping_(), null, 2)); }
  catch (error) { Logger.log("testSetup failed: " + (error && error.message ? error.message : error)); }
}
function doGet() { return json_({ ok: true, service: "coptic-voice-archive" }); }
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (body.action === "ping") return json_(ping_());
    if (body.action === "sync_github_audio") return json_(syncGithubAudio_(body));
    if (body.action === "dictionary_get" || body.action === "dictionary_update") {
      const dictionaryAdmin = body.by && body.by.id != null ? String(body.by.id) : "";
      if (dictionaryAdmin !== "813894692") return json_({ ok: false, error: "unauthorized" });
      return json_(body.action === "dictionary_get" ? dictionaryGet_(body.word) : dictionaryUpdate_(body));
    }
    if (body.action === "users") return json_(upsertUsers_(body.users));
    if (["sync", "reconcile", "delete", "delete_many", "delete_all"].indexOf(body.action) >= 0) {
      if (CONFIG.ADMIN_ID) {
        const senderId = body.by && body.by.id != null ? String(body.by.id) : "";
        if (senderId !== String(CONFIG.ADMIN_ID)) return json_({ ok: false, error: "unauthorized" });
      }
      if (body.action === "delete") return json_(deleteUpload_(body));
      if (body.action === "delete_many") return json_(deleteUploads_(body.ids));
      if (body.action === "delete_all") return json_(deleteAllUploads_());
      return json_(reconcile_());
    }
    if (CONFIG.ADMIN_ID) {
      const senderId = body.by && body.by.id != null ? String(body.by.id) : "";
      if (senderId !== String(CONFIG.ADMIN_ID)) return json_({ ok: false, error: "unauthorized" });
    }
    return json_(upload_(body));
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }

function getFolder_() {
  if (CONFIG.FOLDER_ID) return DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const props = PropertiesService.getScriptProperties();
  const cachedId = props.getProperty("FOLDER_ID_CACHE");
  if (cachedId) {
    try {
      const cached = DriveApp.getFolderById(cachedId);
      if (!cached.isTrashed()) return cached;
    } catch (ignored) {}
    props.deleteProperty("FOLDER_ID_CACHE");
  }
  const found = DriveApp.getFoldersByName(CONFIG.FOLDER_NAME);
  const folder = found.hasNext() ? found.next() : DriveApp.createFolder(CONFIG.FOLDER_NAME);
  props.setProperty("FOLDER_ID_CACHE", folder.getId());
  return folder;
}
function driveLink_(fileId) { return "https://drive.google.com/file/d/" + fileId + "/view?usp=drivesdk"; }
function openSpreadsheet_() { return SpreadsheetApp.openById(CONFIG.SHEET_ID); }
function banSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(CONFIG.BAN_TAB);
  if (!sheet) sheet = spreadsheet.insertSheet(CONFIG.BAN_TAB);
  const first = sheet.getRange(1, 1, 1, BAN_HEADER.length).getValues()[0];
  if (!first.some(function (cell) { return cell !== "" && cell != null; })) {
    sheet.getRange(1, 1, 1, BAN_HEADER.length).setValues([BAN_HEADER]);
  } else {
    // Upgrade old three-column sheets without changing existing data.
    const current = sheet.getLastColumn ? sheet.getLastColumn() : first.length;
    if (current < BAN_HEADER.length) sheet.getRange(1, 1, 1, BAN_HEADER.length).setValues([BAN_HEADER]);
  }
  return sheet;
}
function findRowById_(sheet, id) {
  if (!id || sheet.getLastRow() < 2) return 0;
  const finder = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(id)).matchEntireCell(true).matchCase(false);
  const cell = finder.findNext();
  return cell ? cell.getRow() : 0;
}
function ping_() {
  const folder = getFolder_();
  const spreadsheet = openSpreadsheet_();
  return {
    ok: true,
    folder: { name: folder.getName(), url: folder.getUrl() },
    sheet: { name: spreadsheet.getName(), tab: CONFIG.BAN_TAB, exists: !!spreadsheet.getSheetByName(CONFIG.BAN_TAB) },
    dictionary_tab: CONFIG.DICTIONARY_TAB,
    admin_id: CONFIG.ADMIN_ID || null,
  };
}

function dictionarySheet_() {
  const sheet = openSpreadsheet_().getSheetByName(CONFIG.DICTIONARY_TAB);
  if (!sheet) throw new Error("dictionary sheet not found");
  return sheet;
}
function normalizeDictionaryWord_(value) {
  return String(value || "").normalize("NFC").replace(/`/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}
function dictionaryGet_(word) {
  const wanted = normalizeDictionaryWord_(word);
  if (!wanted) return { ok: false, error: "word is required" };
  const sheet = dictionarySheet_();
  const columns = Math.max(1, sheet.getLastColumn ? sheet.getLastColumn() : 11);
  const headers = sheet.getRange(1, 1, 1, columns).getValues()[0];
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, columns).getValues() : [];
  let partial = null;
  for (let i = 0; i < rows.length; i++) {
    for (let column = 0; column < rows[i].length; column++) {
      const cell = normalizeDictionaryWord_(rows[i][column]);
      if (!cell) continue;
      if (cell === wanted) return { ok: true, row: i + 2, matched_column: column, headers: headers, values: rows[i] };
      if (!partial && (cell.indexOf(wanted) >= 0 || wanted.indexOf(cell) >= 0)) partial = { row: i + 2, matched_column: column, headers: headers, values: rows[i] };
    }
  }
  if (partial) return { ok: true, ...partial };
  return { ok: false, error: "word not found" };
}
function dictionaryUpdate_(body) {
  const row = Number(body.row);
  const expected = normalizeDictionaryWord_(body.expected_coptic);
  if (!Number.isInteger(row) || row < 2 || !expected || !Array.isArray(body.values)) return { ok: false, error: "row, expected_coptic and values are required" };
  const sheet = dictionarySheet_();
  const columns = Math.max(1, sheet.getLastColumn ? sheet.getLastColumn() : body.values.length);
  if (row > sheet.getLastRow()) return { ok: false, error: "row is out of range" };
  const current = sheet.getRange(row, 1, 1, columns).getValues()[0];
  if (normalizeDictionaryWord_(current[0]) !== expected) return { ok: false, error: "row changed; search for the word again" };
  const values = Array.from({ length: columns }, function (_, index) {
    return index < body.values.length ? body.values[index] : current[index];
  });
  sheet.getRange(row, 1, 1, columns).setValues([values]);
  SpreadsheetApp.flush();
  return { ok: true, row: row, headers: sheet.getRange(1, 1, 1, columns).getValues()[0], values: values };
}

function normalizeAudioWord_(value) {
  return String(value || "").normalize("NFC").replace(/`/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Drops upload rows whose Drive file was deleted or trashed by hand, so a dead Drive link no longer beats the
// GitHub link in dictionary!L. It removes nothing when Drive cannot be listed or answers with an error other
// than "not found", and it never touches rows whose file id cannot be read.
function dropDeadUploads_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const alive = {};
  try {
    const files = getFolder_().getFiles();
    while (files.hasNext()) alive[files.next().getId()] = true;
  } catch (error) {
    return [];
  }
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const columns = Math.max(BAN_HEADER.length, sheet.getLastColumn());
    const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, columns);
    const rows = range.getValues();
    const keep = [];
    const dropped = [];
    rows.forEach(function (row) {
      const id = String(row[0] || "");
      const fileId = String(row[3] || extractFileId_(row[2]) || "");
      let ok = true;
      if (/^\d+$/.test(id) && fileId && !alive[fileId]) ok = driveFileExists_(fileId);
      if (ok) keep.push(row); else dropped.push(id);
    });
    if (dropped.length) {
      range.clearContent();
      if (keep.length) sheet.getRange(2, 1, keep.length, columns).setValues(keep);
      // The manifest keeps these ids on purpose: the next reconcile ("/syncdrive" in the bot) reports them as
      // deleted, and that is what removes the matching saved recordings from the bot.
    }
    return dropped;
  } finally { lock.releaseLock(); }
}
function driveFileExists_(fileId) {
  try { return !DriveApp.getFileById(fileId).isTrashed(); }
  catch (error) { return !/No item with the given ID|could not be found/i.test(String(error && error.message || error)); }
}

// dictionary!L (audio_url) is always: the human recording in upload!C if there is one, else the GitHub voice link,
// else empty. The GitHub links are kept in the hidden tab below so the sheet can rebuild column L by itself
// whenever someone deletes a row in "upload" or clears a cell in column L (see SheetChangeNotifier.gs).
const GITHUB_LINKS_TAB = "github_audio";

function withScriptLock_(fn) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function readHumanLinks_(upload) {
  const human = {};
  if (upload && upload.getLastRow() >= 2) {
    const rows = upload.getRange(2, 1, upload.getLastRow() - 1, Math.max(3, upload.getLastColumn())).getValues();
    rows.forEach(function (row) {
      const key = normalizeAudioWord_(row[1]);
      const url = String(row[2] || "").trim();
      if (key && /^https:\/\//i.test(url)) human[key] = url;
    });
  }
  return human;
}

function saveGithubLinks_(spreadsheet, github) {
  const rows = Object.keys(github).sort().map(function (key) { return [key, github[key]]; });
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(rows));
  const digest = bytes.map(function (b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, "0"); }).join("");
  const props = PropertiesService.getScriptProperties();
  let sheet = spreadsheet.getSheetByName(GITHUB_LINKS_TAB);
  if (sheet && props.getProperty("GITHUB_LINKS_DIGEST") === digest) return false;
  if (!sheet) sheet = spreadsheet.insertSheet(GITHUB_LINKS_TAB);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 2).setValues([["key", "url"]]);
  if (rows.length) sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  try { sheet.hideSheet(); } catch (ignored) {}
  props.setProperty("GITHUB_LINKS_DIGEST", digest);
  return true;
}

function loadGithubLinks_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(GITHUB_LINKS_TAB);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const github = {};
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function (row) {
    const key = String(row[0] || ""), url = String(row[1] || "").trim();
    if (key && /^https:\/\//i.test(url)) github[key] = url;
  });
  return Object.keys(github).length ? github : null;
}

function writeAudioLinks_(spreadsheet, github) {
  return withScriptLock_(function () {
    const dictionary = dictionarySheet_();
    const human = readHumanLinks_(spreadsheet.getSheetByName(CONFIG.BAN_TAB));
    const rowCount = Math.max(0, dictionary.getLastRow() - 1);
    if (!rowCount) return { ok: true, updated: 0, human: 0, github: 0, empty: 0 };
    const values = dictionary.getRange(2, 1, rowCount, Math.max(12, dictionary.getLastColumn())).getValues();
    let humanCount = 0;
    let githubCount = 0;
    let emptyCount = 0;
    const links = values.map(function (row) {
      const key = normalizeAudioWord_(row[0]);
      const link = human[key] || github[key] || "";
      if (human[key]) humanCount += 1;
      else if (github[key]) githubCount += 1;
      else emptyCount += 1;
      return [link];
    });
    dictionary.getRange(2, 12, links.length, 1).setValues(links);
    dictionary.getRange(1, 12).setValue("audio_url");
    SpreadsheetApp.flush();
    return { ok: true, updated: links.length, human: humanCount, github: githubCount, empty: emptyCount };
  });
}

// Called by the GitHub audio workflow after each batch: remembers the GitHub links and rebuilds column L.
function syncGithubAudio_(body) {
  const configured = PropertiesService.getScriptProperties().getProperty("GITHUB_AUDIO_SYNC_SECRET") || "";
  if (!configured || String(body.secret || "") !== configured) return { ok: false, error: "unauthorized" };
  if (!Array.isArray(body.audio)) return { ok: false, error: "audio must be an array" };

  const spreadsheet = openSpreadsheet_();
  const upload = spreadsheet.getSheetByName(CONFIG.BAN_TAB);
  const droppedUploads = upload ? dropDeadUploads_(upload) : [];
  const github = {};
  body.audio.forEach(function (item) {
    const key = normalizeAudioWord_(item && item.coptic);
    const url = String(item && item.url || "").trim();
    if (key && /^https:\/\//i.test(url)) github[key] = url;
  });
  saveGithubLinks_(spreadsheet, github);
  const result = writeAudioLinks_(spreadsheet, github);
  result.dropped_dead_uploads = droppedUploads.length;
  return result;
}

// Rebuilds column L from the stored GitHub links and the upload tab, without waiting for GitHub. Used when a row of
// "upload" is deleted, a link in column L is cleared, or a Drive recording disappears.
function refreshAudioLinks_() {
  const spreadsheet = openSpreadsheet_();
  const github = loadGithubLinks_(spreadsheet);
  if (!github) return { ok: true, skipped: true, reason: "no GitHub links stored yet; the next audio sync stores them" };
  const upload = spreadsheet.getSheetByName(CONFIG.BAN_TAB);
  const dropped = upload ? dropDeadUploads_(upload) : [];
  const result = writeAudioLinks_(spreadsheet, github);
  result.dropped_dead_uploads = dropped.length;
  return result;
}

// The dictionary sheet is A=Coptic, B=IPA, C=Arabic/full meaning.
function dictionaryLabel_(word) {
  const sheet = openSpreadsheet_().getSheetByName(CONFIG.DICTIONARY_TAB);
  if (!sheet || sheet.getLastRow() < 2) return String(word || "");
  const values = sheet.getRange(1, 1, sheet.getLastRow(), Math.max(3, sheet.getLastColumn ? sheet.getLastColumn() : 3)).getValues();
  const wanted = String(word || "").normalize("NFC").replace(/`/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  for (let i = 1; i < values.length; i++) {
    const coptic = String(values[i][0] || "").normalize("NFC").replace(/`/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (coptic === wanted) {
      const arabic = String(values[i][2] || "").replace(/\s+/g, " ").trim();
      return arabic ? arabic + " - " + String(word || "").trim() : String(word || "").trim();
    }
  }
  return String(word || "").trim();
}
function sanitizeFileName_(name) {
  return String(name).replace(/[\\/:*?"<>|\r\n]/g, " ").replace(/\s+/g, " ").trim().substring(0, 180) || "voice";
}

function setHumanDictionaryLink_(word, url) {
  try {
    const wanted = normalizeAudioWord_(word);
    if (!wanted || !url) return 0;
    const sheet = dictionarySheet_();
    const rowCount = Math.max(0, sheet.getLastRow() - 1);
    if (!rowCount) return 0;
    const values = sheet.getRange(2, 1, rowCount, Math.max(12, sheet.getLastColumn())).getValues();
    const links = values.map(function (row) {
      return [normalizeAudioWord_(row[0]) === wanted ? String(url) : String(row[11] || "")];
    });
    sheet.getRange(2, 12, links.length, 1).setValues(links);
    sheet.getRange(1, 12).setValue("audio_url");
    SpreadsheetApp.flush();
    return links.filter(function (row) { return row[0] === String(url); }).length;
  } catch (ignored) {
    return 0;
  }
}

function upload_(body) {
  if (!body.audio_base64) return { ok: false, error: "audio_base64 is missing" };
  const id = body.id == null || body.id === "" ? "" : String(body.id);
  if (id && !/^\d+$/.test(id)) return { ok: false, error: "id must be a number" };
  const word = String(body.word || "").trim();
  const mimeType = String(body.mime_type || "audio/ogg");
  const extension = mimeType.indexOf("mpeg") >= 0 ? "mp3" : "ogg";
  const fileName = sanitizeFileName_(dictionaryLabel_(word) || id || "voice-" + Date.now()) + "." + extension;
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  let createdFile = null;
  try {
    const sheet = banSheet_(openSpreadsheet_());
    const oldRow = findRowById_(sheet, id);
    const old = oldRow ? sheet.getRange(oldRow, 1, 1, BAN_HEADER.length).getValues()[0] : [];
    if (old[3]) { try { DriveApp.getFileById(String(old[3])).setTrashed(true); } catch (ignored) {} }
    const blob = Utilities.newBlob(Utilities.base64Decode(body.audio_base64), mimeType, fileName);
    const folder = getFolder_();
    createdFile = folder.createFile(blob);
    createdFile.setDescription(JSON.stringify({ id: id, word: word, file_name: fileName }));
    if (CONFIG.SHARE_WITH_LINK) createdFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = driveLink_(createdFile.getId());
    recordInBan_(openSpreadsheet_(), { id: id, word: word, url: url, fileId: createdFile.getId(), fileName: fileName, body: body });
    setHumanDictionaryLink_(word, url);
    rememberUpload_(id, createdFile.getId());
    return { ok: true, file_id: createdFile.getId(), url: url, file_name: fileName, folder_url: folder.getUrl() };
  } catch (error) {
    if (createdFile) { try { createdFile.setTrashed(true); } catch (ignored) {} }
    throw error;
  } finally { lock.releaseLock(); }
}
function recordInBan_(spreadsheet, info) {
  const sheet = banSheet_(spreadsheet);
  const by = info.body && info.body.by ? info.body.by : {};
  const row = [
    info.id, info.word, info.url, info.fileId,
    info.body && info.body.file_id ? info.body.file_id : "",
    info.body && info.body.duration != null ? info.body.duration : "",
    by.name || "", by.id || "", by.username || "", info.fileName || "", new Date().toISOString(),
  ];
  const target = findRowById_(sheet, info.id);
  if (target) sheet.getRange(target, 1, 1, row.length).setValues([row]);
  else sheet.appendRow(row);
}

function manifest_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(MANIFEST_KEY) || "{}"); }
  catch (ignored) { return {}; }
}
function saveManifest_(value) { PropertiesService.getScriptProperties().setProperty(MANIFEST_KEY, JSON.stringify(value)); }
function rememberUpload_(id, fileId) { if (!id) return; const m = manifest_(); m[String(id)] = String(fileId); saveManifest_(m); }
function removeManifest_(id) { const m = manifest_(); delete m[String(id)]; saveManifest_(m); }
function trashFile_(fileId) { if (!fileId) return false; try { DriveApp.getFileById(String(fileId)).setTrashed(true); return true; } catch (ignored) { return false; } }
function deleteUploads_(ids) {
  const wanted = Array.from(new Set((Array.isArray(ids) ? ids : []).map(String).filter(function (id) { return /^\d+$/.test(id); })));
  if (!wanted.length) return { ok: true, deleted: 0 };
  let result;
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sheet = banSheet_(openSpreadsheet_());
    const wantedSet = {};
    wanted.forEach(function (id) { wantedSet[id] = true; });
    const fileIds = {};
    const manifest = manifest_();
    for (let row = sheet.getLastRow(); row >= 2; row--) {
      const values = sheet.getRange(row, 1, 1, BAN_HEADER.length).getValues()[0];
      const id = String(values[0] || "");
      if (wantedSet[id]) {
        if (values[3] || manifest[id]) fileIds[String(values[3] || manifest[id])] = true;
        sheet.deleteRow(row);
        delete manifest[id];
      }
    }
    Object.keys(fileIds).forEach(trashFile_);
    saveManifest_(manifest);
    result = { ok: true, deleted: wanted.length, trashed: Object.keys(fileIds).length };
  } finally { lock.releaseLock(); }
  // sheet.deleteRow() does not fire the onChange trigger, so rebuild column L manually.
  try { refreshAudioLinks_(); } catch (ignored) {}
  return result;
}
function deleteAllUploads_() {
  let result;
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sheet = banSheet_(openSpreadsheet_());
    const fileIds = {};
    const manifest = manifest_();
    for (let row = 2; row <= sheet.getLastRow(); row++) {
      const values = sheet.getRange(row, 1, 1, BAN_HEADER.length).getValues()[0];
      const fileId = String(values[3] || manifest[String(values[0] || "")] || "");
      if (fileId) fileIds[fileId] = true;
    }
    Object.keys(manifest).forEach(function (id) { if (manifest[id]) fileIds[String(manifest[id])] = true; });
    // Also clear orphan files that are still inside the configured folder.
    const folder = getFolder_();
    const files = folder.getFiles ? folder.getFiles() : null;
    if (files) while (files.hasNext()) fileIds[String(files.next().getId())] = true;
    Object.keys(fileIds).forEach(trashFile_);
    for (let row = sheet.getLastRow(); row >= 2; row--) sheet.deleteRow(row);
    saveManifest_({});
    result = { ok: true, deleted: Object.keys(fileIds).length, folder_cleared: true };
  } finally { lock.releaseLock(); }
  // sheet.deleteRow() does not fire the onChange trigger, so rebuild column L manually.
  try { refreshAudioLinks_(); } catch (ignored) {}
  return result;
}
function deleteUpload_(body) {
  const id = String(body.id == null ? "" : body.id);
  if (!/^\d+$/.test(id)) return { ok: false, error: "id must be a number" };
  let result;
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sheet = banSheet_(openSpreadsheet_());
    const row = findRowById_(sheet, id);
    const values = row ? sheet.getRange(row, 1, 1, BAN_HEADER.length).getValues()[0] : [];
    const fileId = values[3] || manifest_()[id];
    const trashed = trashFile_(fileId);
    if (row && sheet.deleteRow) sheet.deleteRow(row);
    removeManifest_(id);
    result = { ok: true, id: id, file_id: fileId || null, trashed: trashed };
  } finally { lock.releaseLock(); }
  // sheet.deleteRow() does not fire the onChange trigger, so rebuild column L manually.
  try { refreshAudioLinks_(); } catch (ignored) {}
  return result;
}

// Reconciles changes made manually in Drive or the upload tab.
function reconcile_() {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sheet = banSheet_(openSpreadsheet_());
    const previous = manifest_();
    const current = {};
    const deleted = [];
    for (let row = sheet.getLastRow(); row >= 2; row--) {
      const values = sheet.getRange(row, 1, 1, BAN_HEADER.length).getValues()[0];
      const id = String(values[0] || "");
      if (!/^\d+$/.test(id)) continue;
      const fileId = String(values[3] || extractFileId_(values[2]) || "");
      let alive = false;
      if (fileId) { try { alive = !DriveApp.getFileById(fileId).isTrashed(); } catch (ignored) {} }
      if (!alive) {
        if (sheet.deleteRow) sheet.deleteRow(row);
        deleted.push(id); removeManifest_(id);
      } else { current[id] = fileId; }
    }
    Object.keys(previous).forEach(function (id) {
      if (!current[id]) { trashFile_(previous[id]); deleted.push(id); }
    });
    saveManifest_(current);
    return { ok: true, active_ids: Object.keys(current), deleted_ids: Array.from(new Set(deleted)), checked: Object.keys(current).length };
  } finally { lock.releaseLock(); }
}
function extractFileId_(url) { const match = String(url || "").match(/\/d\/([^/]+)/); return match ? match[1] : ""; }

function upsertUsers_(users) {
  if (!Array.isArray(users) || !users.length) return { ok: false, error: "users is missing" };
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const spreadsheet = CONFIG.USERS_SHEET_ID ? SpreadsheetApp.openById(CONFIG.USERS_SHEET_ID) : openSpreadsheet_();
    let sheet = spreadsheet.getSheetByName(CONFIG.USERS_TAB);
    const usersHeader = ["name", "username", "id", "joined_at", "registered_at", "blocked", "blocked_at"];
    if (!sheet) {
      sheet = spreadsheet.insertSheet(CONFIG.USERS_TAB, spreadsheet.getNumSheets());
      sheet.appendRow(usersHeader);
    } else {
      const header = sheet.getRange(1, 1, 1, usersHeader.length).getValues()[0];
      if (!usersHeader.every(function (expected, i) { return String(header[i]).toLowerCase() === expected; })) {
        sheet.getRange(1, 1, 1, usersHeader.length).setValues([usersHeader]);
      }
    }
    const last = sheet.getLastRow(); const rowOf = {};
    if (last > 1) sheet.getRange(2, 3, last - 1, 1).getValues().forEach(function (row, i) { rowOf[String(row[0])] = i + 2; });
    let added = 0, updated = 0;
    users.slice(0, 200).forEach(function (user) {
      const id = String(user.id == null ? "" : user.id); if (!/^\d+$/.test(id)) return;
      const username = user.username ? "@" + String(user.username).replace(/^@/, "") : "";
      const target = rowOf[id]; const old = target ? sheet.getRange(target, 1, 1, usersHeader.length).getValues()[0] : [];
      const row = [user.name || old[0] || "", username || old[1] || "", id, user.joined_at || old[3] || "", user.registered_at || old[4] || "", user.blocked === true ? "نعم" : "لا", user.blocked_at || old[6] || ""];
      if (target) { sheet.getRange(target, 1, 1, usersHeader.length).setValues([row]); updated++; }
      else { sheet.appendRow(row); rowOf[id] = sheet.getLastRow(); added++; }
    });
    return { ok: true, added: added, updated: updated };
  } finally { lock.releaseLock(); }
}
