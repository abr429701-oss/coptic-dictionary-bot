// scripts/gen_audio_fish.mjs
//
// Human-sounding word audio with the Fish Audio API (https://fish.audio).
// The dictionary IPA is turned into Greek spelling (scripts/coptic-greek.mjs) and read by a
// Fish Audio voice. Output: <outDir>/<word id>.ogg (Ogg/Opus, ready for Telegram voice).
//
// Usage:  node scripts/gen_audio_fish.mjs <outDir> [limit]
//
// Required env:  FISH_API_KEY, FISH_VOICE_ID   (the voice "reference_id" you picked on fish.audio)
// Optional env:  FISH_MODEL (default s2.1-pro-free; use s1 / s2-pro if your account needs it)
//                FISH_ENDPOINT (override URL, for local tests)   FISH_PAUSE_MS (default 400)
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import records from "../data/dictionary.json" with { type: "json" };
import { ipaForSpeech, NEURAL_VOICE_VERSION } from "../src/neural-voice.js";
import { ipaToGreek } from "./coptic-greek.mjs";

const run = promisify(execFile);
const KEY = process.env.FISH_API_KEY ?? "";
const VOICE_ID = process.env.FISH_VOICE_ID ?? "";
const MODEL = process.env.FISH_MODEL ?? "s2.1-pro-free";
const ENDPOINT = process.env.FISH_ENDPOINT || "https://api.fish.audio/v1/tts";
const PAUSE_MS = Number(process.env.FISH_PAUSE_MS ?? 400);

if (!KEY || !VOICE_ID) {
  console.error("Set FISH_API_KEY and FISH_VOICE_ID first.");
  process.exit(1);
}

const outDir = path.resolve(process.argv[2] ?? "audio-out");
const limit = Number(process.argv[3] ?? 0) || Infinity;
const SETTINGS = [NEURAL_VOICE_VERSION, "fish", MODEL, VOICE_ID, "opus"].join("|");

await mkdir(outDir, { recursive: true });
const manifestPath = path.join(outDir, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, "utf8")) : {};

const jobs = [];
for (const record of records) {
  if (record?.id == null) continue;
  const ipa = ipaForSpeech(record, { liturgical: true, preserveJinkim: true });
  const greek = ipaToGreek(ipa);
  if (!greek) continue;
  const hash = createHash("sha1").update(`${SETTINGS}|${greek}`).digest("hex").slice(0, 12);
  if (manifest[record.id] === hash && existsSync(path.join(outDir, `${record.id}.ogg`))) continue;
  jobs.push({ id: record.id, greek, hash });
}
console.log(`${jobs.length} words pending (of ${records.length}); model ${MODEL}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function synth(text) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", model: MODEL },
      body: JSON.stringify({ text, reference_id: VOICE_ID, format: "opus" }),
      signal: AbortSignal.timeout(60000),
    });
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    if ([401, 402, 403].includes(response.status)) {
      throw Object.assign(new Error(`stopped (${response.status}): check the key, balance and voice id. ${detail}`), { fatal: true });
    }
    if (response.status === 429 || response.status >= 500) { await sleep(3000 * attempt); continue; }
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  throw new Error("too many retries");
}

// Telegram voice notes need Ogg/Opus. If the API returned another container, convert it.
async function toOgg(bytes, id) {
  if (new TextDecoder().decode(bytes.subarray(0, 4)) === "OggS") return bytes;
  const input = path.join(tmpdir(), `fish-${id}-${process.pid}.in`);
  const output = path.join(tmpdir(), `fish-${id}-${process.pid}.ogg`);
  try {
    await writeFile(input, bytes);
    await run("ffmpeg", ["-loglevel", "error", "-y", "-i", input, "-ac", "1", "-c:a", "libopus", "-b:a", "32k", output]);
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(input, { force: true });
    await rm(output, { force: true });
  }
}

let done = 0, failed = 0;
for (const job of jobs.slice(0, limit)) {
  try {
    const audio = await toOgg(await synth(job.greek), job.id);
    await writeFile(path.join(outDir, `${job.id}.ogg`), audio);
    manifest[job.id] = job.hash;
    done++;
    if (done % 25 === 0) await writeFile(manifestPath, JSON.stringify(manifest));
  } catch (error) {
    failed++;
    console.error(`word ${job.id} (${job.greek}) failed: ${error.message}`);
    if (error.fatal) break;
    if (failed >= 20 && done === 0) { console.error("Too many failures; stopping."); break; }
  }
  await sleep(PAUSE_MS);
}
await writeFile(manifestPath, JSON.stringify(manifest));
console.log(`done: ${done} generated, ${failed} failed`);
