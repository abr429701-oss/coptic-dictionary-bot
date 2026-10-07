// Builds a male, slow espeak-ng recording of every word from its IPA column.
// Usage: node scripts/gen_audio.mjs <outDir> [limit]
// Incremental: a word is regenerated only when its phonemes or the voice settings change.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import records from "../data/dictionary.json" with { type: "json" };
import { ipaForSpeech, ipaToEspeak, NEURAL_VOICE_VERSION } from "../src/neural-voice.js";

const run = promisify(execFile);
const outDir = path.resolve(process.argv[2] ?? "audio-out");
const limit = Number(process.argv[3] ?? 0) || Infinity;
const VOICE = "el+f3"; // Greek phonology, female variant
const SETTINGS = `${NEURAL_VOICE_VERSION}|${VOICE}|-s80 -p60 -g35 16k`;

await mkdir(outDir, { recursive: true });
const manifestPath = path.join(outDir, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, "utf8")) : {};

const jobs = [];
for (const record of records) {
  if (record.id == null) continue;
  const phonemes = ipaToEspeak(ipaForSpeech(record));
  if (!phonemes) continue;
  const hash = createHash("sha1").update(`${SETTINGS}|${phonemes}`).digest("hex").slice(0, 12);
  if (manifest[record.id] === hash && existsSync(path.join(outDir, `${record.id}.ogg`))) continue;
  jobs.push({ id: record.id, phonemes, hash });
}
const todo = jobs.slice(0, limit);
console.log(`${todo.length} to generate (${jobs.length} pending, ${records.length} words)`);

async function build({ id, phonemes, hash }) {
  const wav = path.join(tmpdir(), `coptic-${id}.wav`);
  const text = phonemes.split(" ").map((part) => `[[${part}]]`).join(" , ");
  try {
    // The word is spoken twice, slowly, with a short pause.
    await run("espeak-ng", ["-v", VOICE, "-s", "80", "-p", "60", "-g", "35", "-w", wav, `${text} , ${text}`]);
    await run("ffmpeg", ["-loglevel", "error", "-y", "-i", wav, "-ac", "1", "-c:a", "libopus", "-b:a", "16k", "-application", "voip", path.join(outDir, `${id}.ogg`)]);
    manifest[id] = hash;
  } catch (error) {
    console.error(`word ${id} failed: ${error.message.split("\n")[0]}`);
  } finally {
    await rm(wav, { force: true });
  }
}

let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < todo.length) await build(todo[next++]);
}));
await writeFile(manifestPath, JSON.stringify(manifest));
console.log("done");
