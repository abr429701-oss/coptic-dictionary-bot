// Generate dictionary audio with the same Amazon Polly voice used by IPA Reader.
// Voice: Miguel [US Spanish], standard engine, SSML <phoneme alphabet="ipa">.
// Usage: node scripts/gen_audio_polly.mjs <outDir> [limit]

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import records from "../data/dictionary.json" with { type: "json" };
import { ipaForSpeech } from "../src/neural-voice.js";

const { PollyClient, SynthesizeSpeechCommand } = await import("@aws-sdk/client-polly");
const run = promisify(execFile);
const outDir = path.resolve(process.argv[2] ?? "audio-out");
const limit = Number(process.argv[3] ?? 0) || Infinity;
const VOICE = process.env.POLLY_VOICE ?? "Miguel";
const ENGINE = process.env.POLLY_ENGINE ?? "standard";
const REGION = process.env.AWS_REGION ?? "us-west-2";
const SAMPLE_RATE = process.env.POLLY_SAMPLE_RATE ?? "16000";
const REPEATS = Math.max(1, Number(process.env.POLLY_REPEATS ?? 3));
const BREAK_MS = Math.max(0, Number(process.env.POLLY_BREAK_MS ?? 700));
const WORKERS = Math.max(1, Number(process.env.POLLY_WORKERS ?? 3));
const BITRATE = process.env.OPUS_BITRATE ?? "32k";
const DRY_RUN = Math.max(0, Number(process.env.POLLY_DRY_RUN ?? 0));
const SETTINGS = ["polly", VOICE, ENGINE, REGION, SAMPLE_RATE, REPEATS, BREAK_MS, BITRATE].join("|");

function safeFilePart(value) {
  return String(value ?? "").normalize("NFC")
    .replace(/[\\/:*?"<>|\r\n]/gu, " ").replace(/\s+/gu, " ").trim()
    .replace(/[. ]+$/gu, "").slice(0, 180);
}

function audioFileName(record, id) {
  const label = [safeFilePart(record?.meaning), safeFilePart(record?.coptic)].filter(Boolean).join(" - ");
  return `${(label || `voice-${id}`).slice(0, 240).replace(/[. ]+$/gu, "")}.ogg`;
}

function xmlEscape(value) {
  return String(value).replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

// IPA Reader sends the IPA as-is inside Polly's IPA phoneme tag. Keep this path
// separate from the old eSpeak conversion so the voice and pronunciation match.
function ssmlForIpa(ipa) {
  const phoneme = xmlEscape(String(ipa).replace(/\//gu, "").trim());
  const one = `<phoneme alphabet="ipa" ph="${phoneme}"></phoneme>`;
  const body = Array.from({ length: REPEATS }, () => one).join(` <break time="${BREAK_MS}ms"/> `);
  return `<speak>${body}</speak>`;
}

const firstRecordById = new Map();
for (const record of records) if (record?.id != null && !firstRecordById.has(String(record.id))) firstRecordById.set(String(record.id), record);
await mkdir(outDir, { recursive: true });
const manifestPath = path.join(outDir, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, "utf8")) : {};
const jobs = [];
for (const [id, record] of firstRecordById) {
  const ipa = ipaForSpeech(record, { liturgical: true, preserveJinkim: true });
  if (!ipa) continue;
  const fileName = audioFileName(record, id);
  const hash = createHash("sha1").update(`${SETTINGS}|${ipa}`).digest("hex").slice(0, 12);
  const old = manifest[id];
  if (old?.hash === hash && old?.fileName === fileName && existsSync(path.join(outDir, fileName))) continue;
  jobs.push({ id, record, ipa, fileName, hash, ssml: ssmlForIpa(ipa) });
}
const todo = jobs.slice(0, limit);
console.log(`${todo.length} pending (of ${firstRecordById.size}); Polly ${VOICE}/${ENGINE}; IPA Reader format; region ${REGION}`);
if (DRY_RUN) {
  for (const job of jobs.slice(0, DRY_RUN)) console.log(JSON.stringify({ id: job.id, ipa: job.ipa, ssml: job.ssml }));
  process.exit(0);
}

const client = new PollyClient({ region: REGION });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function synthesize(ssml) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const result = await client.send(new SynthesizeSpeechCommand({
        Text: ssml, TextType: "ssml", OutputFormat: "mp3", SampleRate: SAMPLE_RATE,
        VoiceId: VOICE, Engine: ENGINE,
      }));
      return new Uint8Array(await result.AudioStream.transformToByteArray());
    } catch (error) {
      const details = `${error?.name ?? ""} ${error?.message ?? ""}`;
      if (/AccessDenied|UnrecognizedClient|InvalidSignature|ExpiredToken|Credentials/iu.test(details)) {
        throw new Error(`AWS Polly credentials rejected: ${details}`);
      }
      if (/Throttl|ServiceFailure|ServiceUnavailable|TooManyRequests/iu.test(details) && attempt < 4) {
        await sleep(2000 * attempt);
        continue;
      }
      throw error;
    }
  }
}

async function toOgg(mp3, id) {
  const input = path.join(tmpdir(), `polly-${id}-${process.pid}.mp3`);
  const output = path.join(tmpdir(), `polly-${id}-${process.pid}.ogg`);
  try {
    await writeFile(input, mp3);
    await run("ffmpeg", ["-loglevel", "error", "-y", "-i", input, "-ac", "1", "-ar", "24000", "-c:a", "libopus", "-b:a", BITRATE, "-application", "audio", output]);
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(input, { force: true });
    await rm(output, { force: true });
  }
}

let next = 0;
let done = 0;
let failed = 0;
let fatal = null;
async function worker() {
  while (!fatal) {
    const job = todo[next++];
    if (!job) return;
    try {
      console.log(`Generating ${job.id}: ${job.ipa}`);
      const ogg = await toOgg(await synthesize(job.ssml), job.id);
      await writeFile(path.join(outDir, job.fileName), ogg);
      manifest[job.id] = { hash: job.hash, fileName: job.fileName };
      done++;
      if (done % 25 === 0) await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    } catch (error) {
      failed++;
      console.error(`word ${job.id} failed: ${String(error?.message ?? error).split("\n")[0]}`);
      if (/credentials rejected/iu.test(String(error?.message))) fatal = error;
    }
  }
}
await Promise.all(Array.from({ length: Math.min(WORKERS, Math.max(1, todo.length)) }, worker));
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
const audioIndex = {};
for (const [id, record] of firstRecordById) {
  const entry = manifest[id];
  if (entry?.fileName) audioIndex[id] = entry.fileName;
}
await writeFile(path.join(outDir, "audio-index.json"), `${JSON.stringify(audioIndex, null, 2)}\n`);
if (fatal) throw fatal;
if (failed && done === 0) throw new Error(`All Polly jobs failed (${failed})`);
console.log(`done: ${done} generated, ${failed} failed`);
