/**
 * Coptic Dictionary Bot — voice archive (Google Apps Script web app).
 *
 * The bot sends every admin recording here. This script:
 *   1. saves the audio file in a Drive folder (named "<word id>.ogg"),
 *   2. records it in the "Ban" tab of the dictionary spreadsheet, keyed by the word's PERMANENT id,
 *   3. stores the Drive link and recording metadata there without changing dictionary data.
 *
 * Setup: see apps-script/README.md.  Deploy as: Execute as "Me", Who has access "Anyone".
 */
const CONFIG = {
  // A long random text. You can instead set it as a Script property named SECRET (recommended).
  SECRET: "",
  // Optional: the Drive folder id (the part after /folders/ in its URL). If empty, a folder named
  // FOLDER_NAME is found or created in My Drive.
  FOLDER_ID: "",
  FOLDER_NAME: "Coptic Dictionary Voices",
  // The dictionary spreadsheet (same one the bot reads).
  SHEET_ID: "1kXVA3CNgETqym5Vz3lBUu_2gZ01QNdx7ROtGVnIJp0c",
  ARCHIVE_TAB: "Ban",
  // Anyone with the link can listen. Keep false to stay private to your Google account.
  SHARE_WITH_LINK: false,
};
const ARCHIVE_HEADERS = ["id", "word", "drive_url", "drive_file_id", "telegram_file_id", "duration_s", "updated_at"];

// Run this once from the editor (Run ▶ testSetup) to grant Drive/Sheets permissions and see the folder.
function testSetup() {
  Logger.log(JSON.stringify(ping_()));
}

function doGet() {
  return json_({ ok: true, service: "coptic-voice-archive" });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const secret = getSecret_();
    if (!secret) return json_({ ok: false, error: "SECRET is not configured in the script" });
    if (body.secret !== secret) return json_({ ok: false, error: "unauthorized" });
    if (body.action === "ping") return json_(ping_());
    return json_(upload_(body));
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function getSecret_() {
  return PropertiesService.getScriptProperties().getProperty("SECRET") || CONFIG.SECRET || "";
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function getFolder_() {
  const props = PropertiesService.getScriptProperties();
  const configured = CONFIG.FOLDER_ID || props.getProperty("FOLDER_ID") || props.getProperty("FOLDER_ID_CACHE");
  if (configured) return DriveApp.getFolderById(configured);
  const found = DriveApp.getFoldersByName(CONFIG.FOLDER_NAME);
  const folder = found.hasNext() ? found.next() : DriveApp.createFolder(CONFIG.FOLDER_NAME);
  props.setProperty("FOLDER_ID_CACHE", folder.getId());
  return folder;
}

function openSpreadsheet_() {
  return SpreadsheetApp.openById(CONFIG.SHEET_ID);
}

function archiveSheet_(spreadsheet) {
  return spreadsheet.getSheetByName(CONFIG.ARCHIVE_TAB)
    || spreadsheet.insertSheet(CONFIG.ARCHIVE_TAB, spreadsheet.getNumSheets());
}

// Reuse the archive table if it exists; otherwise put it after all existing Ban data.
function archiveTable_(sheet) {
  const lastColumn = sheet.getLastColumn();
  const headers = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    : [];
  for (let start = 0; start <= headers.length - ARCHIVE_HEADERS.length; start += 1) {
    if (ARCHIVE_HEADERS.every((header, offset) => String(headers[start + offset] || "").trim() === header)) {
      return { startColumn: start + 1 };
    }
  }

  const startColumn = lastColumn + 1;
  const requiredLastColumn = startColumn + ARCHIVE_HEADERS.length - 1;
  const maxColumns = sheet.getMaxColumns();
  if (requiredLastColumn > maxColumns) {
    sheet.insertColumnsAfter(maxColumns, requiredLastColumn - maxColumns);
  }
  sheet.getRange(1, startColumn, 1, ARCHIVE_HEADERS.length).setValues([ARCHIVE_HEADERS]);
  return { startColumn };
}

function ping_() {
  const folder = getFolder_();
  const spreadsheet = openSpreadsheet_();
  return {
    ok: true,
    folder: { name: folder.getName(), url: folder.getUrl() },
    sheet: { name: spreadsheet.getName(), archiveTab: archiveSheet_(spreadsheet).getName() },
  };
}

function upload_(body) {
  if (!body.audio_base64) return { ok: false, error: "audio_base64 is missing" };
  const id = body.id == null || body.id === "" ? "" : String(body.id);
  if (id && !/^\d+$/.test(id)) return { ok: false, error: "id must be a number" };
  const word = String(body.word || "");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const extension = String(body.mime_type || "audio/ogg").indexOf("mpeg") >= 0 ? "mp3" : "ogg";
    const name = (id || "voice-" + Date.now()) + "." + extension;
    const blob = Utilities.newBlob(Utilities.base64Decode(body.audio_base64), body.mime_type || "audio/ogg", name);
    const folder = getFolder_();
    const file = folder.createFile(blob);
    file.setDescription(word);
    if (CONFIG.SHARE_WITH_LINK) file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = file.getUrl();

    const spreadsheet = openSpreadsheet_();
    recordInBanSheet_(spreadsheet, { id: id, word: word, url: url, fileId: file.getId(), body: body });
    return { ok: true, file_id: file.getId(), url: url, folder_url: folder.getUrl(), archive_tab: CONFIG.ARCHIVE_TAB };
  } finally {
    lock.releaseLock();
  }
}

function recordInBanSheet_(spreadsheet, info) {
  const sheet = archiveSheet_(spreadsheet);
  const { startColumn } = archiveTable_(sheet);
  const row = [info.id, info.word, info.url, info.fileId, info.body.file_id || "", info.body.duration || "", new Date()];
  const last = sheet.getLastRow();
  let target = 0;
  if (info.id && last > 1) {
    const ids = sheet.getRange(2, startColumn, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i += 1) {
      if (String(ids[i][0]) === info.id) {
        target = i + 2;
        break;
      }
    }
  }
  let oldFileId = "";
  if (target) {
    oldFileId = sheet.getRange(target, startColumn + 3).getValue();
  } else {
    target = Math.max(last + 1, 2);
  }
  // Save the replacement link before trashing the old Drive file.
  sheet.getRange(target, startColumn, 1, row.length).setValues([row]);
  if (oldFileId && oldFileId !== info.fileId) {
    try {
      DriveApp.getFileById(String(oldFileId)).setTrashed(true);
    } catch (ignored) {
      // already deleted
    }
  }
}
