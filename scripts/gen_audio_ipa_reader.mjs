// Generate dictionary audio by using ipa-reader.com itself.
// The site selects Amazon Polly anonymously, with VoiceId Miguel and IPA input.
// No AWS account, AWS keys, or paid API credentials are needed in this workflow.
// Usage: node scripts/gen_audio_ipa_reader.mjs <outDir> [limit]

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import records from "../data/dictionary.json" with { type: "json" };
import { ipaForSpeech } from "../src/neural-voice.js";
import { SINGLE_WORD_MARKER } from "../src/ogg-repeat.js";

const run = promisify(execFile);
const SITE = "https://ipa-reader.com/";
const VOICE = process.env.IPA_VOICE ?? "Miguel";
const RATE = Number(process.env.IPA_SLOW_FACTOR ?? 0.75);
const REPEATS = Math.max(1, Number(process.env.IPA_REPEATS ?? 3));
const BREAK_MS = Math.max(0, Number(process.env.IPA_BREAK_MS ?? 700));
const OUTPUT_SAMPLE_RATE = 16000;
const OUTPUT_BITRATE = "16k";
const OPUS_APPLICATION = "voip";
const OPUS_FRAME_DURATION = 60;
const WORKERS = Math.max(1, Number(process.env.IPA_WORKERS ?? 1));
const limit = Number(process.argv[3] ?? 0) || Infinity;
const outDir = path.resolve(process.argv[2] ?? "audio-out");
if (!(RATE >= 0.5 && RATE <= 2)) throw new Error("IPA_SLOW_FACTOR must be between 0.5 and 2");

function safeFilePart(value) {
  return String(value ?? "").normalize("NFC")
    .replace(/[\\/:*?"<>|\r\n]/gu, " ").replace(/\s+/gu, " ").trim()
    .replace(/[. ]+$/gu, "").slice(0, 180);
}
function truncateUtf8(value, maxBytes) {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}
function audioFileName(record, id) {
  const firstArabicWord = safeFilePart(record?.meaning).split(" ")[0]
    .replace(/^[()[\]{}،,;؛:.!?]+|[()[\]{}،,;؛:.!?]+$/gu, "");
  const arabic = truncateUtf8(firstArabicWord || "voice", 64);
  const coptic = truncateUtf8(safeFilePart(record?.coptic) || "word", 96);
  return `${arabic}-${coptic}-${id}.ogg`;
}
function makeHash(ipa, fileName) {
  return createHash("sha1").update(JSON.stringify({
    site: SITE,
    voice: VOICE,
    rate: RATE,
    repeats: REPEATS,
    breakMs: BREAK_MS,
    ipa,
    fileName,
    output: { codec: "libopus", sampleRate: OUTPUT_SAMPLE_RATE, channels: 1, bitrate: OUTPUT_BITRATE, application: OPUS_APPLICATION, frameDuration: OPUS_FRAME_DURATION },
  })).digest("hex").slice(0, 12);
}

await mkdir(outDir, { recursive: true });
const manifestPath = path.join(outDir, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, "utf8")) : {};
const jobsById = new Map();
const seenIds = new Set(); // one file per id: only the FIRST record of an id counts, even when it is already done
for (const record of records) {
  if (record?.id == null || seenIds.has(String(record.id))) continue;
  seenIds.add(String(record.id));
  const ipa = ipaForSpeech(record, { liturgical: true, preserveJinkim: true });
  if (!ipa) continue;
  const old = manifest[record.id];
  const oldOutput = old?.fileName ? path.join(outDir, old.fileName) : null;
  // Do not rename/rebuild existing audio just because the naming convention changed.
  const fileName = oldOutput && existsSync(oldOutput)
    ? old.fileName
    : audioFileName(record, record.id);
  const hash = makeHash(ipa, fileName);
  if (old?.hash === hash && old?.fileName === fileName && existsSync(path.join(outDir, fileName))) continue;
  jobsById.set(String(record.id), { id: record.id, ipa, fileName, hash });
}
const jobs = [...jobsById.values()];
const todo = jobs.slice(0, limit);
console.log(`${todo.length} pending (of ${jobs.length}); site=${SITE}; voice=${VOICE}; slow=${RATE}; repeats=${REPEATS}; pause=${BREAK_MS}ms; workers=${WORKERS}`);

async function downloadFromReader(page, ipa) {
  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator(`#polly-voice option[value="${VOICE}"]`).waitFor({ state: "attached", timeout: 60000 });
  await page.locator(".select-styled").click();
  await page.locator(`li[rel="${VOICE}"]`).click();
  await page.fill("#ipa-text", ipa);
  await page.click("#submit");
  const audio = page.locator("audio").last();
  await audio.waitFor({ state: "attached", timeout: 60000 });
  const url = await audio.locator("source").getAttribute("src");
  if (!url) throw new Error("IPA Reader returned no audio URL");
  const response = await page.request.get(url, { headers: { Referer: SITE } });
  if (!response.ok()) throw new Error(`Audio download failed: HTTP ${response.status()}`);
  return new Uint8Array(await response.body());
}

async function toTelegramOgg(mp3, id) {
  const input = path.join(tmpdir(), `ipa-reader-${id}-${process.pid}.mp3`);
  const output = path.join(tmpdir(), `ipa-reader-${id}-${process.pid}.ogg`);
  try {
    await writeFile(input, mp3);
    const audioLabels = Array.from({ length: REPEATS }, (_, index) => `[a${index}]`).join("");
    const pauseCount = Math.max(0, REPEATS - 1);
    const silenceLabels = Array.from({ length: pauseCount }, (_, index) => `[s${index}]`).join("");
    const sequence = Array.from({ length: REPEATS * 2 - 1 }, (_, index) => index % 2 === 0 ? `[a${index / 2}]` : `[s${(index - 1) / 2}]`).join("");
    const filter = [
      `[0:a]atempo=${RATE},aformat=sample_rates=${OUTPUT_SAMPLE_RATE}:channel_layouts=mono,asplit=${REPEATS}${audioLabels}`,
      pauseCount ? `anullsrc=r=${OUTPUT_SAMPLE_RATE}:cl=mono:d=${BREAK_MS / 1000},asplit=${pauseCount}${silenceLabels}` : "",
      `${sequence}concat=n=${REPEATS * 2 - 1}:v=0:a=1[out]`,
    ].filter(Boolean).join(";");
    await run("ffmpeg", ["-loglevel", "error", "-y", "-i", input, "-filter_complex", filter, "-map", "[out]", "-ac", "1", "-ar", String(OUTPUT_SAMPLE_RATE), "-c:a", "libopus", "-application", OPUS_APPLICATION, "-vbr", "on", "-compression_level", "10", "-b:a", OUTPUT_BITRATE, "-frame_duration", String(OPUS_FRAME_DURATION), ...(REPEATS === 1 ? ["-metadata", `comment=${SINGLE_WORD_MARKER}`] : []), output], { maxBuffer: 1024 * 1024 });
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
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    while (!fatal) {
      const job = todo[next++];
      if (!job) break;
      try {
        console.log(`Generating ${job.id}: ${job.ipa}`);
        const mp3 = await downloadFromReader(page, job.ipa);
        const ogg = await toTelegramOgg(mp3, job.id);
        await writeFile(path.join(outDir, job.fileName), ogg);
        manifest[job.id] = { hash: job.hash, fileName: job.fileName };
        done++;
        if (done % 10 === 0) await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      } catch (error) {
        failed++;
        const message = String(error?.message ?? error).split("\n")[0];
        console.error(`word ${job.id} failed: ${message}`);
        if (/blocked|forbidden|429|too many|captcha/iu.test(message)) fatal = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  } finally {
    await browser.close();
  }
}
await Promise.all(Array.from({ length: Math.min(WORKERS, Math.max(1, todo.length)) }, worker));
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
const audioIndex = {};
for (const record of records) {
  const entry = manifest[record.id];
  if (entry?.fileName) audioIndex[record.id] = entry.fileName;
}
await writeFile(path.join(outDir, "audio-index.json"), `${JSON.stringify(audioIndex, null, 2)}\n`);
if (fatal) throw fatal;
if (failed && done === 0) throw new Error(`All IPA Reader jobs failed (${failed})`);
console.log(`done: ${done} generated, ${failed} failed`);
