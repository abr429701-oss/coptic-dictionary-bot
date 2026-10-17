/**
 * Tells GitHub when the dictionary sheet changes, so the bot's data and the word voices refresh within minutes.
 *
 * Add this as a NEW file in the Apps Script project (next to Code.gs). One-time setup:
 *   1. Project Settings > Script Properties > Add: GITHUB_DISPATCH_TOKEN = a fine-grained GitHub token for the
 *      repo abr429701-oss/coptic-dictionary-bot only, with "Contents: Read and write".
 *   2. Run setupSheetChangeTriggers() once from the editor and accept the permissions.
 *   3. Optional check: run testSheetChangeNotification() - a "Deploy Coptic Dictionary Bot" run should appear in GitHub Actions.
 *
 * Links in column L repair themselves: deleting a row in "upload", or clearing a link in column L, rebuilds the
 * column from the human recordings plus the GitHub links stored in the hidden "github_audio" tab (about a minute).
 *
 * What counts as a change in the "dictionary" tab:
 *   - any edited, pasted, cleared or filled cell (onEdit);
 *   - any inserted or deleted row/column (onChange) - confirmed by comparing a fingerprint of the tab, so
 *     rows added to other tabs (like recordings) never trigger anything.
 * The audio link column (L) is ignored: the audio sync writes it, so it must never loop back.
 * Changes are grouped: the notice is sent one minute after the LAST change (at most five minutes after the first).
 * Only the changed words are rebuilt on GitHub; every unchanged word keeps its data, voice and saved Telegram copy.
 */
const NOTIFY = {
  REPO: "abr429701-oss/coptic-dictionary-bot",
  QUIET_SECONDS: 60,
  MAX_WAIT_SECONDS: 300,
  AUDIO_LINK_COLUMN: 12, // column L (audio_url) is written by the audio sync
  FIRST_KEY: "DICT_DIRTY_FIRST",
  LAST_KEY: "DICT_DIRTY_LAST",
  STRUCT_KEY: "DICT_STRUCTURE_CHECK",
  LINKS_KEY: "AUDIO_LINKS_DIRTY_AT",
  LINKS_QUIET_SECONDS: 15, // rebuild column L this long after the last edit of a link or of the upload tab
  FINGERPRINT_KEY: "DICT_FINGERPRINT",
  STRUCTURE_TYPES: ["INSERT_ROW", "REMOVE_ROW", "INSERT_COLUMN", "REMOVE_COLUMN", "OTHER"],
};

// Installable onEdit trigger: a cell was typed, pasted, cleared or filled.
function notifyDictionaryEdit(e) {
  const range = e && e.range;
  if (!range) return;
  const tab = range.getSheet().getName();
  if (tab === CONFIG.BAN_TAB) { // a recording row of "upload" was edited or cleared
    markLinksDirty_();
    return;
  }
  if (tab !== CONFIG.DICTIONARY_TAB) return;
  if (range.getLastRow() < 2) return; // header row
  const link = NOTIFY.AUDIO_LINK_COLUMN;
  if (range.getColumn() <= link && range.getLastColumn() >= link) markLinksDirty_(); // a link was edited or cleared
  if (range.getColumn() === link && range.getLastColumn() === link) return; // only the link column: nothing for GitHub
  markDictionaryDirty_();
}

function markLinksDirty_() {
  PropertiesService.getScriptProperties().setProperty(NOTIFY.LINKS_KEY, String(Date.now()));
}

// Installable onChange trigger: rows or columns were inserted or deleted (in any tab - checked later).
function notifyDictionaryStructureChange(e) {
  if (!e || NOTIFY.STRUCTURE_TYPES.indexOf(e.changeType) === -1) return;
  PropertiesService.getScriptProperties().setProperty(NOTIFY.STRUCT_KEY, "1");
  markLinksDirty_(); // a deleted row in "upload" must not leave its link in column L
}

function markDictionaryDirty_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const now = String(Date.now());
    if (!props.getProperty(NOTIFY.FIRST_KEY)) props.setProperty(NOTIFY.FIRST_KEY, now);
    props.setProperty(NOTIFY.LAST_KEY, now);
  } finally {
    lock.releaseLock();
  }
}

// Everything in the dictionary tab except the audio link column, reduced to a short text.
function dictionaryFingerprint_() {
  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.DICTIONARY_TAB);
  if (!sheet) return "";
  const rows = sheet.getDataRange().getValues().map(function (row) {
    return row.filter(function (_cell, index) { return index !== NOTIFY.AUDIO_LINK_COLUMN - 1; });
  });
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(rows));
  return bytes.map(function (b) { return ((b < 0 ? b + 256 : b)).toString(16).padStart(2, "0"); }).join("");
}

// Time-driven trigger (every minute).
function flushDictionaryChanges() {
  const props = PropertiesService.getScriptProperties();

  const linksAt = Number(props.getProperty(NOTIFY.LINKS_KEY));
  if (linksAt && Date.now() - linksAt >= NOTIFY.LINKS_QUIET_SECONDS * 1000) {
    props.deleteProperty(NOTIFY.LINKS_KEY);
    try {
      refreshAudioLinks_();
    } catch (error) {
      props.setProperty(NOTIFY.LINKS_KEY, String(Date.now())); // try again next minute
      console.error("Rebuilding the audio links failed: " + error);
    }
  }

  if (props.getProperty(NOTIFY.STRUCT_KEY)) {
    props.deleteProperty(NOTIFY.STRUCT_KEY);
    try {
      const fingerprint = dictionaryFingerprint_();
      if (fingerprint && fingerprint !== props.getProperty(NOTIFY.FINGERPRINT_KEY)) {
        props.setProperty(NOTIFY.FINGERPRINT_KEY, fingerprint);
        markDictionaryDirty_();
      }
    } catch (error) {
      props.setProperty(NOTIFY.STRUCT_KEY, "1"); // try again next minute
      console.error("Fingerprint check failed: " + error);
    }
  }

  const first = Number(props.getProperty(NOTIFY.FIRST_KEY));
  const last = Number(props.getProperty(NOTIFY.LAST_KEY));
  if (!first || !last) return;
  const now = Date.now();
  if (now - last < NOTIFY.QUIET_SECONDS * 1000 && now - first < NOTIFY.MAX_WAIT_SECONDS * 1000) return;
  if (!sendSheetChanged_()) return; // the dirty mark stays, so the next minute tries again

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    if (props.getProperty(NOTIFY.LAST_KEY) === String(last)) {
      props.deleteProperty(NOTIFY.FIRST_KEY);
      props.deleteProperty(NOTIFY.LAST_KEY);
    } else {
      props.setProperty(NOTIFY.FIRST_KEY, props.getProperty(NOTIFY.LAST_KEY)); // changed again while sending
    }
  } finally {
    lock.releaseLock();
  }
  try {
    props.setProperty(NOTIFY.FINGERPRINT_KEY, dictionaryFingerprint_());
  } catch (error) {
    console.error("Could not refresh the fingerprint: " + error);
  }
}

function sendSheetChanged_() {
  const token = PropertiesService.getScriptProperties().getProperty("GITHUB_DISPATCH_TOKEN");
  if (!token) {
    console.error("GITHUB_DISPATCH_TOKEN is not set in Script Properties");
    return false;
  }
  const response = UrlFetchApp.fetch("https://api.github.com/repos/" + NOTIFY.REPO + "/dispatches", {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    payload: JSON.stringify({ event_type: "sheet-changed" }),
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  if (status !== 204) console.error("GitHub answered " + status + ": " + response.getContentText().slice(0, 200));
  return status === 204;
}

// Run once.
function setupSheetChangeTriggers() {
  const ours = ["notifyDictionaryEdit", "notifyDictionaryStructureChange", "flushDictionaryChanges"];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (ours.indexOf(trigger.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("notifyDictionaryEdit").forSpreadsheet(CONFIG.SHEET_ID).onEdit().create();
  ScriptApp.newTrigger("notifyDictionaryStructureChange").forSpreadsheet(CONFIG.SHEET_ID).onChange().create();
  ScriptApp.newTrigger("flushDictionaryChanges").timeBased().everyMinutes(1).create();
  PropertiesService.getScriptProperties().setProperty(NOTIFY.FINGERPRINT_KEY, dictionaryFingerprint_());
  console.log("Triggers are ready.");
}

// Optional: sends the notice right now.
function testSheetChangeNotification() {
  console.log(sendSheetChanged_() ? "Sent: check GitHub > Actions." : "Not sent: see the log above.");
}
