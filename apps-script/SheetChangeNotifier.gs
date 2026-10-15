/**
 * Tells GitHub when the dictionary sheet changes, so the bot's data and the word voices refresh within minutes.
 *
 * Add this as a NEW file in the Apps Script project (next to Code.gs). One-time setup:
 *   1. Project Settings > Script Properties > Add: GITHUB_DISPATCH_TOKEN = a fine-grained GitHub token for the
 *      repo abr429701-oss/coptic-dictionary-bot only, with "Contents: Read and write".
 *   2. Run setupSheetChangeTriggers() once from the editor and accept the permissions.
 *   3. Optional check: run testSheetChangeNotification() - a "Sync" run should appear in GitHub Actions.
 *
 * Any edited cell in a row of the "dictionary" tab counts (Coptic, IPA, meaning, translations...). Edits are
 * grouped: the notice is sent one minute after the LAST edit (at most five minutes after the first one).
 * Edits made by scripts (like the audio link column) do not fire onEdit, so they never loop back.
 * Deleting or inserting whole rows is not an edit event; the 30-minute sync on GitHub catches those.
 */
const NOTIFY = {
  REPO: "abr429701-oss/coptic-dictionary-bot",
  QUIET_SECONDS: 60,
  MAX_WAIT_SECONDS: 300,
  AUDIO_LINK_COLUMN: 12, // column L (audio_url) is written by the audio sync
  FIRST_KEY: "DICT_DIRTY_FIRST",
  LAST_KEY: "DICT_DIRTY_LAST",
};

// Installable onEdit trigger.
function notifyDictionaryEdit(e) {
  const range = e && e.range;
  if (!range) return;
  if (range.getSheet().getName() !== CONFIG.DICTIONARY_TAB) return;
  if (range.getLastRow() < 2) return; // header row
  if (range.getColumn() === NOTIFY.AUDIO_LINK_COLUMN && range.getLastColumn() === NOTIFY.AUDIO_LINK_COLUMN) return;
  markDictionaryDirty_();
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

// Time-driven trigger (every minute): sends the notice once the edits have stopped.
function flushDictionaryChanges() {
  const props = PropertiesService.getScriptProperties();
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
      props.setProperty(NOTIFY.FIRST_KEY, props.getProperty(NOTIFY.LAST_KEY)); // edited again while sending
    }
  } finally {
    lock.releaseLock();
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
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    const name = trigger.getHandlerFunction();
    if (name === "notifyDictionaryEdit" || name === "flushDictionaryChanges") ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("notifyDictionaryEdit").forSpreadsheet(CONFIG.SHEET_ID).onEdit().create();
  ScriptApp.newTrigger("flushDictionaryChanges").timeBased().everyMinutes(1).create();
  console.log("Triggers are ready.");
}

// Optional: sends the notice right now.
function testSheetChangeNotification() {
  console.log(sendSheetChanged_() ? "Sent: check GitHub > Actions." : "Not sent: see the log above.");
}
