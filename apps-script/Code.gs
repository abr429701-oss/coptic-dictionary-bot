/**
 * Coptic Dictionary Bot — voice archive (Google Apps Script web app).
 *
 * The bot sends every admin recording here. This script:
 *   1. saves the audio file in a Drive folder (named "<word id>.ogg"),
 *   2. writes ONE row per word in the "Ban" tab: id, word, Drive link
 *      (https://drive.google.com/file/d/<FILE_ID>/view?usp=drivesdk), file ids, duration,
 *      the recorder's full name, Telegram id and username.
 *
 * No password is needed. (If you ever add a Script property named SECRET, the bot must send it.)
 * Setup: see apps-script/README.md.  Deploy as: Execute as "Me", Who has access "Anyone".
 */
const CONFIG = {
  // Optional. Leave empty = no password. (Can also be a Script property named SECRET.)
  SECRET: "",
  // Optional: the Drive folder id (the part after /folders/ in its URL). If empty, a folder named
  // FOLDER_NAME is found or created in My Drive.
  FOLDER_ID: "",
  FOLDER_NAME: "Coptic Dictionary Voices",
  // The dictionary spreadsheet (same one the bot reads).
  SHEET_ID: "1kXVA3CNgETqym5Vz3lBUu_2gZ01QNdx7ROtGVnIJp0c",
  // Tab that receives one row per recorded word.
  BAN_TAB: "Ban",
  // Anyone with the link can listen. Keep false to stay private to your Google account.
  SHARE_WITH_LINK: false,
};

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
    if (secret && body.secret !== secret) return json_({ ok: false, error: "unauthorized" });
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

function ping_() {
  const folder = getFolder_();
  const spreadsheet = openSpreadsheet_();
  return {
    ok: true,
    folder: { name: folder.getName(), url: folder.getUrl() },
    sheet: { name: spreadsheet.getName(), tab: CONFIG.BAN_TAB },
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
    const url = driveLink_(file.getId());

    recordInBan_(openSpreadsheet_(), { id: id, word: word, url: url, fileId: file.getId(), body: body });
    return { ok: true, file_id: file.getId(), url: url, folder_url: folder.getUrl() };
  } finally {
    lock.releaseLock();
  }
}

function driveLink_(fileId) {
  return "https://drive.google.com/file/d/" + fileId + "/view?usp=drivesdk";
}

const BAN_HEADER = ["id", "word", "drive_url", "drive_file_id", "telegram_file_id", "duration_s", "full_name", "user_id", "username"];

function banSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(CONFIG.BAN_TAB);
  if (!sheet) sheet = spreadsheet.insertSheet(CONFIG.BAN_TAB, spreadsheet.getNumSheets());
  if (!sheet.getRange(1, 1).getValue()) sheet.getRange(1, 1, 1, BAN_HEADER.length).setValues([BAN_HEADER]);
  return sheet;
}

function recordInBan_(spreadsheet, info) {
  const sheet = banSheet_(spreadsheet);
  const by = info.body.by || {};
  const row = [
    info.id,
    info.word,
    info.url,
    info.fileId,
    info.body.file_id || "",
    info.body.duration || "",
    by.name || "",
    by.id == null ? "" : String(by.id),
    by.username ? "@" + String(by.username).replace(/^@/, "") : "",
  ];
  const last = sheet.getLastRow();
  let target = 0;
  if (info.id && last > 1) {
    const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i += 1) {
      if (String(ids[i][0]) === info.id) {
        target = i + 2;
        break;
      }
    }
  }
  if (target) {
    // Re-recording: the previous Drive file is replaced (moved to trash).
    const oldFileId = sheet.getRange(target, 4).getValue();
    if (oldFileId && oldFileId !== info.fileId) {
      try {
        DriveApp.getFileById(String(oldFileId)).setTrashed(true);
      } catch (ignored) {
        // already deleted
      }
    }
    sheet.getRange(target, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}
