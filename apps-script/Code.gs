/**
 * Coptic Dictionary Bot — voice archive (Google Apps Script web app).
 *
 * The bot sends every admin recording here. This script:
 *   1. saves the audio file in a Drive folder (named "<word id>.ogg"),
 *   2. records it in a "Voices" tab of the dictionary spreadsheet, keyed by the word's PERMANENT id,
 *   3. writes the file link next to the matching word(s) in the main sheet (column AT).
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
  MAIN_SHEET_NAME: "", // empty = the first tab
  VOICES_TAB: "Voices",
  // Put the link next to the word in the main sheet. Column AT is free (the bot reads A..AS only).
  WRITE_LINK_TO_MAIN_SHEET: true,
  MAIN_LINK_COLUMN: 46, // 46 = AT
  MAIN_LINK_HEADER: "Voice link",
  MAX_ROWS_LINKED_PER_WORD: 50,
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

function mainSheet_(spreadsheet) {
  return CONFIG.MAIN_SHEET_NAME ? spreadsheet.getSheetByName(CONFIG.MAIN_SHEET_NAME) : spreadsheet.getSheets()[0];
}

// Same cleanup the bot's build script applies, so rows can be matched: jinkim ` -> combining mark.
function cleanCoptic_(value) {
  return String(value == null ? "" : value)
    .replace(/`(\p{L})/gu, "$1\u0300")
    .replace(/\s+/g, " ")
    .trim();
}

function wordKey_(value) {
  return cleanCoptic_(value).normalize("NFC").toLowerCase();
}

function ping_() {
  const folder = getFolder_();
  const spreadsheet = openSpreadsheet_();
  return {
    ok: true,
    folder: { name: folder.getName(), url: folder.getUrl() },
    sheet: { name: spreadsheet.getName(), mainTab: mainSheet_(spreadsheet).getName() },
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
    recordInVoicesTab_(spreadsheet, { id: id, word: word, url: url, fileId: file.getId(), body: body });
    const linked = CONFIG.WRITE_LINK_TO_MAIN_SHEET && word ? linkInMainSheet_(spreadsheet, word, url) : 0;
    return { ok: true, file_id: file.getId(), url: url, folder_url: folder.getUrl(), rows_linked: linked };
  } finally {
    lock.releaseLock();
  }
}

function recordInVoicesTab_(spreadsheet, info) {
  let sheet = spreadsheet.getSheetByName(CONFIG.VOICES_TAB);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG.VOICES_TAB, spreadsheet.getNumSheets());
    sheet.appendRow(["id", "word", "drive_url", "drive_file_id", "telegram_file_id", "duration_s", "updated_at"]);
  }
  const row = [info.id, info.word, info.url, info.fileId, info.body.file_id || "", info.body.duration || "", new Date()];
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

function linkInMainSheet_(spreadsheet, word, url) {
  const sheet = mainSheet_(spreadsheet);
  if (!sheet) return 0;
  if (!sheet.getRange(1, CONFIG.MAIN_LINK_COLUMN).getValue()) {
    sheet.getRange(1, CONFIG.MAIN_LINK_COLUMN).setValue(CONFIG.MAIN_LINK_HEADER);
  }
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const wanted = wordKey_(word);
  const values = sheet.getRange(2, 1, last - 1, 1).getValues();
  let linked = 0;
  for (let i = 0; i < values.length && linked < CONFIG.MAX_ROWS_LINKED_PER_WORD; i += 1) {
    if (wordKey_(values[i][0]) === wanted) {
      sheet.getRange(i + 2, CONFIG.MAIN_LINK_COLUMN).setValue(url);
      linked += 1;
    }
  }
  return linked;
}
