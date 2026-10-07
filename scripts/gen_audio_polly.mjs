// scripts/gen_audio_polly.mjs
//
// Word audio from the dictionary IPA with Amazon Polly, voice "Matthew" (US English).
// This is exactly what ipa-reader.com does behind the scenes: it sends the IPA to Polly inside an
// SSML <phoneme alphabet="ipa"> tag. Here we call Polly directly (official API, no scraping).
//
// Each file contains the word THREE times, slowly, with a short pause between repetitions,
// so the bot only has to play one voice message.
//
// Usage:  node scripts/gen_audio_polly.mjs <outDir> [limit]
// Dry run (no AWS, prints the IPA sent to Polly):  POLLY_DRY_RUN=10 node scripts/gen_audio_polly.mjs
//
// Env (credentials): AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (default us-east-1)
// Env (optional):    POLLY_VOICE=Matthew  POLLY_ENGINE=neural|standard  POLLY_RATE=70%
//                    POLLY_REPEATS=3  POLLY_BREAK_MS=700  POLLY_WORKERS=3
//                    POLLY_CHAR_BUDGET=900000 (per month, conservative)  POLLY_ENDPOINT (tests)
//
// Output: <outDir>/<word id>.ogg (Ogg/Opus, ready for Telegram) + manifest.json (incremental).
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import records from "../data/dictionary.json" with { type: "json" };
import { ipaForSpeech, NEURAL_VOICE_VERSION } from "../src/neural-voice.js";

const run = promisify(execFile);
const VOICE = process.env.POLLY_VOICE ?? "Matthew";
const ENGINE = process.env.POLLY_ENGINE ?? "neural";
const RATE = process.env.POLLY_RATE ?? "70%";
const REPEATS = Math.max(1, Number(process.env.POLLY_REPEATS ?? 3));
const BREAK_MS = Number(process.env.POLLY_BREAK_MS ?? 700);
const WORKERS = Math.max(1, Number(process.env.POLLY_WORKERS ?? 3));
const BUDGET = Number(process.env.POLLY_CHAR_BUDGET ?? 900000);
const DRY = Number(process.env.POLLY_DRY_RUN ?? 0);

// Coptic IPA (as written in the sheet) -> symbols the US English Polly voice accepts.
// Polly rejects phonemes it does not know, so everything is mapped to the closest US sound.
const MAP = {
  a: "ɑ", e: "ɛ", i: "i", o: "ɔ", u: "u", y: "i", ɔ: "ɔ",
  r: "ɹ", g: "ɡ", x: "h", ɣ: "ɡ", h: "h", ɲ: "nj", ʎ: "lj",
  p: "p", b: "b", t: "t", d: "d", k: "k", f: "f", v: "v", θ: "θ", ð: "ð",
  s: "s", z: "z", ʃ: "ʃ", ʒ: "ʒ", m: "m", n: "n", ŋ: "ŋ", l: "l", j: "j", w: "w",
};

export function ipaForPolly(ipa) {
  const words = String(ipa ?? "").replace(/\u0300/gu, " ").split(/\s+/u).filter(Boolean);
  return words
    .map((word) => {
      let out = "";
      for (let i = 0; i < word.length;) {
        const two = word.slice(i, i + 2);
        if (two === "dʒ" || two === "tʃ") { out += two; i += 2; continue; }
        out += MAP[word[i]] ?? "";
        i++;
      }
      return out;
    })
    .filter(Boolean);
}

export function buildSsml(tokens) {
  const once = tokens.map((t) => `<phoneme alphabet="ipa" ph="${t}"></phoneme>`).join(" ");
  const body = Array.from({ length: REPEATS }, () => once).join(` <break time="${BREAK_MS}ms"/> `);
  return `<speak><prosody rate="${RATE}">${body}</prosody></speak>`;
}

const SETTINGS = [NEURAL_VOICE_VERSION, "polly", VOICE, ENGINE, RATE, `x${REPEATS}`, `b${BREAK_MS}`].join("|");
const jobsAll = [];
for (const record of records) {
  if (record?.id == null) continue;
  const ipa = ipaForSpeech(record, { liturgical: true, preserveJinkim: true });
  const tokens = ipaForPolly(ipa);
  if (!tokens.length) continue;
  jobsAll.push({ id: record.id, ipa, tokens, ssml: buildSsml(tokens) });
}

if (DRY) {
  for (const job of jobsAll.slice(0, DRY)) console.log(job.id, "|", job.ipa, "->", job.tokens.join(" "));
  console.log("\nExample SSML:\n" + jobsAll[0].ssml);
  process.exit(0);
}

const outDir = path.resolve(process.argv[2] ?? "audio-out");
const limit = Number(process.argv[3] ?? 0) || Infinity;
await mkdir(outDir, { recursive: true });
const manifestPath = path.join(outDir, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, "utf8")) : {};
const month = new Date().toISOString().slice(0, 7);
if (manifest._usage?.month !== month) manifest._usage = { month, chars: 0 };

const jobs = [];
for (const job of jobsAll) {
  job.hash = createHash("sha1").update(`${SETTINGS}|${job.tokens.join(" ")}`).digest("hex").slice(0, 12);
  if (manifest[job.id] === job.hash && existsSync(path.join(outDir, `${job.id}.ogg`))) continue;
  jobs.push(job);
}
console.log(`${jobs.length} words pending (of ${records.length}); voice ${VOICE} (${ENGINE}); usage so far ~${manifest._usage.chars} chars`);

const { PollyClient, SynthesizeSpeechCommand } = await import("@aws-sdk/client-polly");
const client = new PollyClient({
  region: process.env.AWS_REGION || "us-east-1",
  ...(process.env.POLLY_ENDPOINT ? { endpoint: process.env.POLLY_ENDPOINT } : {}),
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function synth(ssml) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const result = await client.send(new SynthesizeSpeechCommand({
        Text: ssml, TextType: "ssml", OutputFormat: "mp3", VoiceId: VOICE, Engine: ENGINE, SampleRate: "24000",
      }));
      return new Uint8Array(await result.AudioStream.transformToByteArray());
    } catch (error) {
      const name = error?.name ?? "";
      if (/AccessDenied|UnrecognizedClient|InvalidSignature|ExpiredToken|CredentialsProvider/iu.test(name + error?.message)) {
        throw Object.assign(new Error(`AWS credentials rejected (${name}). Check the secrets/region.`), { fatal: true });
      }
      if (/Throttl|ServiceFailure|ServiceUnavailable|TooManyRequests/iu.test(name) && attempt < 4) { await sleep(2000 * attempt); continue; }
      throw error;
    }
  }
}

async function toOgg(mp3, id) {
  const input = path.join(tmpdir(), `polly-${id}-${process.pid}.mp3`);
  const output = path.join(tmpdir(), `polly-${id}-${process.pid}.ogg`);
  try {
    await writeFile(input, mp3);
    await run("ffmpeg", ["-loglevel", "error", "-y", "-i", input, "-ac", "1", "-c:a", "libopus", "-b:a", "32k", output]);
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(input, { force: true });
    await rm(output, { force: true });
  }
}

let next = 0, done = 0, failed = 0, stop = false;
const todo = jobs.slice(0, limit);
async function worker() {
  while (!stop) {
    const job = todo[next++];
    if (!job) return;
    const cost = job.tokens.join("").length * REPEATS;
    if (manifest._usage.chars + cost > BUDGET) { console.log(`Monthly budget guard reached (${BUDGET}); stopping.`); stop = true; return; }
    try {
      const audio = await toOgg(await synth(job.ssml), job.id);
      await writeFile(path.join(outDir, `${job.id}.ogg`), audio);
      manifest[job.id] = job.hash;
      manifest._usage.chars += cost;
      if (++done % 25 === 0) await writeFile(manifestPath, JSON.stringify(manifest));
    } catch (error) {
      failed++;
      console.error(`word ${job.id} (${job.tokens.join(" ")}) failed: ${String(error.message).split("\n")[0]}`);
      if (error.fatal) { stop = true; return; }
      if (failed >= 20 && done === 0) { console.error("Too many failures; stopping."); stop = true; return; }
    }
    await sleep(100);
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
await writeFile(manifestPath, JSON.stringify(manifest));
console.log(`done: ${done} generated, ${failed} failed, usage ~${manifest._usage.chars}/${BUDGET} chars`);
