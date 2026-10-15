// Runs in GitHub Actions after the bot dispatches "voice-recorded".
// Downloads the recording from Telegram, compresses it with ffmpeg, uploads it to Drive through the
// existing Apps Script "upload" action, then tells the bot where the new file is.
// The event payload is read from the event file (not from env/command lines) so nothing shows up in public logs.
import { readFileSync, writeFileSync, mkdtempSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const { TELEGRAM_BOT_TOKEN, APPS_SCRIPT_URL, CALLBACK_SECRET, WORKER_URL, GITHUB_EVENT_PATH } = process.env;
for (const [name, value] of Object.entries({ TELEGRAM_BOT_TOKEN, APPS_SCRIPT_URL, CALLBACK_SECRET, WORKER_URL, GITHUB_EVENT_PATH })) {
  if (!value) throw new Error(`${name} is missing`);
}
const job = JSON.parse(readFileSync(GITHUB_EVENT_PATH, "utf8")).client_payload ?? {};
if (!job.id || !job.fileId) throw new Error("The event has no recording to process");

const BITRATE = process.env.VOICE_BITRATE ?? "16k";
const dir = mkdtempSync(path.join(tmpdir(), "voice-"));
const input = path.join(dir, "in.ogg");
const output = path.join(dir, "out.ogg");

async function download() {
  const info = await (await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(job.fileId)}`)).json();
  const filePath = info?.ok ? info.result?.file_path : null;
  if (!filePath) throw new Error("Telegram did not return a file path");
  const response = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`);
  if (!response.ok) throw new Error(`Telegram file download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function compress(trimSilence) {
  const trim = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse";
  const args = ["-loglevel", "error", "-y", "-i", input, ...(trimSilence ? ["-af", trim] : []),
    "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-application", "voip", "-vbr", "on", "-compression_level", "10",
    "-b:a", BITRATE, "-frame_duration", "60", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
    "-page_duration", "10000000", output];
  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (result.status !== 0) return null;
  return statSync(output).size;
}

async function callAppsScript(payload) {
  const response = await fetch(APPS_SCRIPT_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), redirect: "follow" });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { throw new Error(`Apps Script returned ${response.status} (not JSON)`); }
  if (!response.ok || !result.ok) throw new Error(result.error || `Apps Script failed: ${response.status}`);
  return result;
}

const original = await download();
writeFileSync(input, original);
let audio = original;
let size = compress(true);
if (size !== null && size < 300) size = compress(false); // the trim removed (almost) everything: keep the sound
if (size !== null && size >= 300 && size < original.length) audio = readFileSync(output);
console.log(`Recording ${job.id}: ${original.length} -> ${audio.length} bytes`);

const uploaded = await callAppsScript({
  action: "upload",
  id: job.id,
  word: job.word ?? "",
  audio_base64: audio.toString("base64"),
  mime_type: "audio/ogg",
  file_id: job.fileId,
  duration: job.duration ?? "",
  by: job.by ?? null,
});

let lastError;
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const response = await fetch(`${WORKER_URL.replace(/\/+$/u, "")}/voice-drive`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-callback-secret": CALLBACK_SECRET },
      body: JSON.stringify({ id: job.id, fileId: job.fileId, drive: { url: uploaded.url ?? null, fileId: uploaded.file_id ?? null } }),
    });
    if (response.ok) { console.log("The bot knows the Drive link."); process.exit(0); }
    lastError = new Error(`The bot answered ${response.status}`);
  } catch (error) {
    lastError = error;
  }
  await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
}
throw lastError;
