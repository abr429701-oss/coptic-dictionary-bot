/**
 * Coptic Dictionary Bot — voice archive (Google Apps Script web app).
 *
 * The bot sends every admin recording here. This script:
 *   1. saves the audio file in a Drive folder (named "<word id>.ogg"),
 *   2. writes ONE row per word in the "upload" tab: id, word, Drive link
 *      (https://drive.google.com/file/d/<FILE_ID>/view?usp=drivesdk), file id, duration.
 *
 * Setup: see apps-script/README.md.  Deploy as: Execute as "Me", Who has access "Anyone".
 */
const CONFIG = {
  // Optional: the Drive folder id (the part after /folders/ in its URL).
  FOLDER_ID: "1Lm0gDumRXJuXwJZ8RCOVePjyJliKyGWv",
  FOLDER_NAME: "dic_final",
  // The dictionary spreadsheet (same one the bot reads).
  SHEET_ID: "14pUNXtrHoMSU9lBWhKQZyspe-DDTMDudSiuL2sJQRUI",
  // Tab that receives one row per recorded word.
  BAN_TAB: "upload",
  // Anyone with the link can listen.
  SHARE_WITH_LINK: true,
  // Leave empty so the bot can archive recordings from the configured workflow.
  ADMIN_ID: "",
  // Telegram users are synchronized to this tab in the same spreadsheet.
  USERS_TAB: "users",
  USERS_SHEET_ID: "",
};

const BAN_HEADER = [
  "id",
  "word",
  "drive_url",
];

// Run this once from the editor (Run ▶ testSetup) to grant Drive/Sheets permissions and see the folder.
function testSetup() {
  try {
    Logger.log(JSON.stringify(ping_(), null, 2));
  } catch (error) {
    Logger.log("testSetup failed: " + (error && error.message ? error.message : error));
  }
}

function doGet() {
  return json_({ ok: true, service: "coptic-voice-archive" });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (body.action === "ping") return json_(ping_());
    if (body.action === "users") return json_(upsertUsers_(body.users));

    // 🔒 Only the configured admin may upload recordings.
    if (CONFIG.ADMIN_ID) {
      const senderId = body.by && body.by.id != null ? String(body.by.id) : "";
      if (senderId !== String(CONFIG.ADMIN_ID)) {
        return json_({ ok: false, error: "unauthorized" });
      }
    }

    return json_(upload_(body));
  } catch (error) {
    return json_({
      ok: false,
      error: String(error && error.message ? error.message : error),
    });
  }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Drive                                     */
/* -------------------------------------------------------------------------- */

/**
 * Resolves the target folder.
 * Order of preference:
 *   1. CONFIG.FOLDER_ID (hard-coded in the script).
 *   2. A cached id stored in Script Properties (validated; falls back if missing/trashed).
 *   3. A folder named CONFIG.FOLDER_NAME in My Drive (created if not found).
 */
function getFolder_() {
  // 1) Explicit id from CONFIG.
  if (CONFIG.FOLDER_ID) {
    return DriveApp.getFolderById(CONFIG.FOLDER_ID);
  }

  const props = PropertiesService.getScriptProperties();

  // 2) Cached id — validate before trusting it.
  const cachedId = props.getProperty("FOLDER_ID_CACHE");
  if (cachedId) {
    try {
      const cached = DriveApp.getFolderById(cachedId);
      if (!cached.isTrashed()) return cached;
    } catch (ignored) {
      // Folder was deleted or access revoked — fall through and recreate.
    }
    props.deleteProperty("FOLDER_ID_CACHE");
  }

  // 3) Find or create by name.
  const found = DriveApp.getFoldersByName(CONFIG.FOLDER_NAME);
  const folder = found.hasNext() ? found.next() : DriveApp.createFolder(CONFIG.FOLDER_NAME);
  props.setProperty("FOLDER_ID_CACHE", folder.getId());
  return folder;
}

function driveLink_(fileId) {
  return "https://drive.google.com/file/d/" + fileId + "/view?usp=drivesdk";
}

/* -------------------------------------------------------------------------- */
/*                                  Sheets                                     */
/* -------------------------------------------------------------------------- */

function openSpreadsheet_() {
  return SpreadsheetApp.openById(CONFIG.SHEET_ID);
}

/**
 * Returns the "upload" sheet, creating it (with header) if needed.
 * Recreates the header if row 1 is empty in the first column.
 */
function banSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(CONFIG.BAN_TAB);
  if (!sheet) sheet = spreadsheet.insertSheet(CONFIG.BAN_TAB);

  const firstRow = sheet.getRange(1, 1, 1, BAN_HEADER.length).getValues()[0];
  const hasHeader = firstRow.some(function (cell) {
    return cell !== "" && cell != null;
  });
  if (!hasHeader) {
    sheet.getRange(1, 1, 1, BAN_HEADER.length).setValues([BAN_HEADER]);
  }
  return sheet;
}

/**
 * Finds the row whose first column equals `id`. Returns 0 when not found.
 * Uses TextFinder for speed even on large sheets.
 */
function findRowById_(sheet, id) {
  if (!id) return 0;
  const last = sheet.getLastRow();
  if (last < 2) return 0;

  const finder = sheet
    .getRange(2, 1, last - 1, 1)
    .createTextFinder(String(id))
    .matchEntireCell(true)
    .matchCase(false);
  const cell = finder.findNext();
  return cell ? cell.getRow() : 0;
}

/* -------------------------------------------------------------------------- */
/*                                   API                                       */
/* -------------------------------------------------------------------------- */

function ping_() {
  const folder = getFolder_();
  const spreadsheet = openSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(CONFIG.BAN_TAB);
  return {
    ok: true,
    folder: { name: folder.getName(), url: folder.getUrl() },
    sheet: {
      name: spreadsheet.getName(),
      tab: CONFIG.BAN_TAB,
      exists: !!sheet,
    },
    admin_id: CONFIG.ADMIN_ID || null,
  };
}

function upload_(body) {
  if (!body.audio_base64) return { ok: false, error: "audio_base64 is missing" };

  const id = body.id == null || body.id === "" ? "" : String(body.id);
  if (id && !/^\d+$/.test(id)) return { ok: false, error: "id must be a number" };

  const word = String(body.word || "");
  const mimeType = String(body.mime_type || "audio/ogg");
  const extension = mimeType.indexOf("mpeg") >= 0 ? "mp3" : "ogg";
  const fileStem = sanitizeFileName_(word || id || "voice-" + Date.now());
  const fileName = fileStem + "." + extension;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  let createdFile = null;
  try {
    const blob = Utilities.newBlob(Utilities.base64Decode(body.audio_base64), mimeType, fileName);
    const folder = getFolder_();

    createdFile = folder.createFile(blob);
    createdFile.setDescription(word);
    if (CONFIG.SHARE_WITH_LINK) {
      createdFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }

    const url = driveLink_(createdFile.getId());

    recordInBan_(openSpreadsheet_(), {
      id: id,
      word: word,
      url: url,
      fileId: createdFile.getId(),
      body: body,
    });

    return {
      ok: true,
      file_id: createdFile.getId(),
      url: url,
      folder_url: folder.getUrl(),
    };
  } catch (error) {
    // Roll back the Drive file if the sheet write failed.
    if (createdFile) {
      try {
        createdFile.setTrashed(true);
      } catch (ignored) {
        // ignore
      }
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Rows                                       */
/* -------------------------------------------------------------------------- */

function recordInBan_(spreadsheet, info) {
  const sheet = banSheet_(spreadsheet);

  const row = [
    info.id,
    info.word,
    info.url,
  ];

  const target = findRowById_(sheet, info.id);

  if (target) {
    sheet.getRange(target, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}


// Upserts Telegram users into the "users" tab, keyed by Telegram id (column C).
function upsertUsers_(users) {
  if (!Array.isArray(users) || !users.length) return { ok: false, error: "users is missing" };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = CONFIG.USERS_SHEET_ID ? SpreadsheetApp.openById(CONFIG.USERS_SHEET_ID) : openSpreadsheet_();
    let sheet = spreadsheet.getSheetByName(CONFIG.USERS_TAB);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(CONFIG.USERS_TAB, spreadsheet.getNumSheets());
      sheet.appendRow(["name", "username", "id"]);
    }
    const last = sheet.getLastRow();
    const rowOf = {};
    if (last > 1) {
      sheet.getRange(2, 3, last - 1, 1).getValues().forEach(function (row, i) {
        rowOf[String(row[0])] = i + 2;
      });
    }
    const now = new Date();
    let added = 0;
    let updated = 0;
    users.slice(0, 200).forEach(function (user) {
      const id = String(user.id == null ? "" : user.id);
      if (!/^\d+$/.test(id)) return;
      const username = user.username ? "@" + String(user.username).replace(/^@/, "") : "";
      const target = rowOf[id];
      if (target) {
        const old = sheet.getRange(target, 1, 1, 3).getValues()[0];
        sheet.getRange(target, 1, 1, 3).setValues([[
          user.name || old[0], username || old[1], id,
        ]]);
        updated += 1;
      } else {
        sheet.appendRow([user.name || "", username, id]);
        rowOf[id] = sheet.getLastRow();
        added += 1;
      }
    });
    return { ok: true, added: added, updated: updated };
  } finally {
    lock.releaseLock();
  }
}

function sanitizeFileName_(name) {
  return String(name)
    .replace(/[\\/:*?"<>|\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 180) || "voice";
}
