// Generate dictionary audio by driving https://ipa-reader.com/ with Playwright.
// The site sends the IPA to Amazon Polly and returns an MP3 URL. We download that
// result, slow it down, repeat it three times with a short pause, and save Ogg/Opus
// files ready for Telegram.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import records from "../data/dictionary.json" with { type: "json" };

const run = promisify(execFile);
const SITE = "https://ipa-reader.com/";
const VOICE = process.env.IPA_VOICE ?? "Matthew";
const RATE = Number(process.env.IPA_SLOW_FACTOR ?? 0.75);
const REPEATS = Math.max(1, Number(process.env.IPA_REPEATS ?? 3));
const BREAK_MS = Math.max(0, Number(process.env.IPA_BREAK_MS ?? 700));
const WORKERS = Math.max(1, Number(process.env.IPA_WORKERS ?? 2));
const limit = Number(process.argv[3] ?? 0) || Infinity;
const outDir = path.resolve(process.argv[2] ?? "audio-out");

if (!(RATE >= 0.5 && RATE <= 2)) throw new Error("IPA_SLOW_FACTOR must be between 0.5 and 2");

await mkdir(outDir, { recursive: true });
const manifestPath = path.join(outDir, "manifest.json");
const manifest = existsSync(manifestPath)
  ? JSON.parse(await readFile(manifestPath, "utf8"))
  : {};

function makeHash(record, ipa) {
  return createHash("sha1")
    .update(JSON.stringify({ site: SITE, voice: VOICE, rate: RATE, repeats: REPEATS, breakMs: BREAK_MS, ipa }))
    .digest("hex")
    .slice(0, 12);
}

const jobsById = new Map();
for (const record of records) {
  if (record?.id == null) continue;
  // `pronunciation` is the IPA column imported from the sheet. Do not use the
  // English phonetic/transliteration column here.
  const ipa = String(record.pronunciation ?? "").trim();
  if (!ipa) continue;
  const hash = makeHash(record, ipa);
  const output = path.join(outDir, `${record.id}.ogg`);
  if (manifest[record.id] === hash && existsSync(output)) continue;
  // Several dictionary rows can share one permanent word id because they
  // represent different meanings. Generate one audio file per word id.
  if (!jobsById.has(String(record.id))) {
    jobsById.set(String(record.id), { id: record.id, ipa, hash });
  }
}

const jobs = [...jobsById.values()];
const todo = jobs.slice(0, limit);
console.log(`${todo.length} pending (of ${jobs.length}); site=${SITE}; voice=${VOICE}; slow=${RATE}; repeats=${REPEATS}; pause=${BREAK_MS}ms`);

async function downloadFromReader(page, ipa) {
  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('#polly-voice option[value="Matthew"]').waitFor({ state: "attached", timeout: 60000 });
  // IPA Reader hides the native select and creates a custom visible menu.
  // Click the visible menu so its own change handler updates the real value.
  await page.locator(".select-styled").click();
  await page.locator(`li[rel="${VOICE}"]`).click();
  await page.fill("#ipa-text", ipa);
  await page.click("#submit");
  const audio = page.locator("audio").last();
  await audio.waitFor({ state: "attached", timeout: 60000 });
  const url = await audio.locator("source").getAttribute("src");
  if (!url) throw new Error("IPA Reader returned no audio URL");
  // The presigned Polly URL requires the same browser context/Referer as the
  // page; plain Node fetch can receive HTTP 403 from the signed endpoint.
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
      `[0:a]atempo=${RATE},aformat=sample_rates=24000:channel_layouts=mono,asplit=${REPEATS}${audioLabels}`,
      pauseCount ? `anullsrc=r=24000:cl=mono:d=${BREAK_MS / 1000},asplit=${pauseCount}${silenceLabels}` : "",
      `${sequence}concat=n=${REPEATS * 2 - 1}:v=0:a=1[out]`,
    ].filter(Boolean).join(";");
    await run("ffmpeg", [
      "-loglevel", "error", "-y", "-i", input,
      "-filter_complex", filter, "-map", "[out]",
      "-ac", "1", "-ar", "24000", "-c:a", "libopus", "-b:a", "32k", output,
    ], { maxBuffer: 1024 * 1024 });
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(input, { force: true });
    await rm(output, { force: true });
  }
}

let next = 0;
let done = 0;
let failed = 0;

async function worker() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    while (true) {
      const job = todo[next++];
      if (!job) break;
      try {
        console.log(`Generating ${job.id}: ${job.ipa}`);
        const mp3 = await downloadFromReader(page, job.ipa);
        const ogg = await toTelegramOgg(mp3, job.id);
        await writeFile(path.join(outDir, `${job.id}.ogg`), ogg);
        manifest[job.id] = job.hash;
        done++;
        if (done % 10 === 0) await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      } catch (error) {
        failed++;
        console.error(`word ${job.id} failed: ${String(error?.message ?? error).split("\n")[0]}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  } finally {
    await browser.close();
  }
}

await Promise.all(Array.from({ length: Math.min(WORKERS, Math.max(1, todo.length)) }, worker));
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`done: ${done} generated, ${failed} failed`);
