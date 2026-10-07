// scripts/gen_audio.mjs
//
// Builds pre-recorded Coptic dictionary audio from the IPA column.
//
// Usage:
//   node scripts/gen_audio.mjs <outDir> [limit]
//
// Examples:
//   node scripts/gen_audio.mjs audio-out
//   node scripts/gen_audio.mjs audio-out 100
//
// Requirements:
//   - espeak-ng
//   - ffmpeg
//
// Output:
//   <id>.ogg
//
// Each word:
//   - is spoken 3 times
//   - has a short pause between repetitions
//   - uses the dictionary IPA
//   - uses a male Greek voice when available
//
// IMPORTANT:
// Verify the exact male Greek voice available in your GitHub Actions runner.
// You can override it with:
//   ESPEAK_VOICE=el+m3
//
// The default below is configurable because eSpeak-ng installations can
// contain different Greek voice variants.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import {
  mkdir,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";

import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import records from "../data/dictionary.json" with {
  type: "json"
};

import {
  ipaForSpeech,
  ipaToEspeak,
  NEURAL_VOICE_VERSION,
} from "../src/neural-voice.js";

const run = promisify(execFile);

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const outDir = path.resolve(
  process.argv[2] ?? "audio-out"
);

const limit =
  Number(process.argv[3] ?? 0) || Infinity;

// Male Greek voice.
//
// IMPORTANT:
// If your installed eSpeak-ng build does not contain "el+m3",
// set ESPEAK_VOICE to an available male Greek voice.
//
// Example:
//   ESPEAK_VOICE=el+m1 node scripts/gen_audio.mjs audio-out
//
const VOICE =
  process.env.ESPEAK_VOICE ?? "el+m3";

// Natural dictionary pronunciation.
const SPEED =
  Number(process.env.ESPEAK_SPEED ?? 125);

const PITCH =
  Number(process.env.ESPEAK_PITCH ?? 48);

// eSpeak gap parameter.
// Lower = less artificial spacing inside speech.
const GAP =
  Number(process.env.ESPEAK_GAP ?? 8);

// Three repetitions.
const REPETITIONS = 3;

// Pause between repetitions.
//
// This is deliberately longer than the eSpeak "gap" setting.
// It gives the listener a clear separation without sounding like
// three completely unrelated recordings.
const PAUSE_MS =
  Number(process.env.COPTIC_PAUSE_MS ?? 420);

// Output bitrate.
const BITRATE =
  process.env.OPUS_BITRATE ?? "24k";

// Versioned settings.
// Any change here automatically invalidates the corresponding cached audio.
const SETTINGS = [
  NEURAL_VOICE_VERSION,
  VOICE,
  `speed=${SPEED}`,
  `pitch=${PITCH}`,
  `gap=${GAP}`,
  `repetitions=${REPETITIONS}`,
  `pause=${PAUSE_MS}`,
  `opus=${BITRATE}`,
  "mode=greco-bohairic",
].join("|");

// -----------------------------------------------------------------------------
// Prepare output
// -----------------------------------------------------------------------------

await mkdir(outDir, {
  recursive: true,
});

const manifestPath =
  path.join(outDir, "manifest.json");

const manifest = existsSync(manifestPath)
  ? JSON.parse(
      await readFile(manifestPath, "utf8")
    )
  : {};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function escapeForLog(value) {
  return String(value)
    .replace(/\r?\n/gu, " ")
    .slice(0, 160);
}

function buildRepeatedSpeech(phonemes) {
  // Treat the entire IPA word as ONE pronunciation unit.
  //
  // The old code did:
  //
  //   phonemes.split(" ").map(...)
  //
  // That can create unintended pauses if spaces occur inside an IPA
  // representation.
  //
  // Instead, the entire phoneme string is spoken as one word.
  const word = `[[${phonemes}]]`;

  return Array.from(
    { length: REPETITIONS },
    () => word
  ).join(" , ");
}

// -----------------------------------------------------------------------------
// Build list of jobs
// -----------------------------------------------------------------------------

const jobs = [];

for (const record of records) {
  if (record?.id == null) continue;

  const ipa = ipaForSpeech(record, {
    liturgical: true,
    preserveJinkim: true,
  });

  if (!ipa) continue;

  const phonemes = ipaToEspeak(ipa, {
    // DO NOT force first-vowel stress.
    addStress: false,
  });

  if (!phonemes) continue;

  const hash = createHash("sha1")
    .update(
      `${SETTINGS}|${ipa}|${phonemes}`
    )
    .digest("hex")
    .slice(0, 12);

  const outputPath = path.join(
    outDir,
    `${record.id}.ogg`
  );

  // Incremental generation.
  if (
    manifest[record.id] === hash &&
    existsSync(outputPath)
  ) {
    continue;
  }

  jobs.push({
    id: record.id,
    ipa,
    phonemes,
    hash,
  });
}

const todo = jobs.slice(0, limit);

console.log(
  `${todo.length} to generate ` +
  `(${jobs.length} pending, ${records.length} words)`
);

console.log(`Voice: ${VOICE}`);
console.log(`Speed: ${SPEED}`);
console.log(`Pitch: ${PITCH}`);
console.log(`Gap: ${GAP}`);
console.log(`Repetitions: ${REPETITIONS}`);
console.log(`Pause: ${PAUSE_MS}ms`);
console.log(`Opus bitrate: ${BITRATE}`);

// -----------------------------------------------------------------------------
// Generate one word
// -----------------------------------------------------------------------------

async function build({
  id,
  ipa,
  phonemes,
  hash,
}) {
  const wav =
    path.join(
      tmpdir(),
      `coptic-${id}-${process.pid}.wav`
    );

  const output =
    path.join(
      outDir,
      `${id}.ogg`
    );

  const text =
    buildRepeatedSpeech(phonemes);

  try {
    console.log(
      `Generating ${id}: ` +
      `${escapeForLog(ipa)} → ` +
      `${escapeForLog(phonemes)}`
    );

    // -----------------------------------------------------------------------
    // eSpeak-ng
    //
    // -s = speed
    // -p = pitch
    // -g = word gap
    // -w = WAV output
    //
    // The actual word is repeated three times by buildRepeatedSpeech().
    // -----------------------------------------------------------------------

    await run(
      "espeak-ng",
      [
        "-v",
        VOICE,

        "-s",
        String(SPEED),

        "-p",
        String(PITCH),

        "-g",
        String(GAP),

        "-w",
        wav,

        text,
      ],
      {
        maxBuffer: 1024 * 1024,
      }
    );

    // -----------------------------------------------------------------------
    // FFmpeg
    //
    // 24 kbps Opus is a better compromise than the old 16 kbps setting
    // for a dictionary voice.
    //
    // application=audio is preferable for ordinary speech/audio files.
    // -----------------------------------------------------------------------

    await run(
      "ffmpeg",
      [
        "-loglevel",
        "error",
        "-y",

        "-i",
        wav,

        "-ac",
        "1",

        "-ar",
        "24000",

        "-c:a",
        "libopus",

        "-b:a",
        BITRATE,

        "-application",
        "audio",

        output,
      ],
      {
        maxBuffer: 1024 * 1024,
      }
    );

    manifest[id] = hash;
  } catch (error) {
    console.error(
      `word ${id} failed:`,
      error instanceof Error
        ? error.message.split("\n")[0]
        : String(error)
    );
  } finally {
    await rm(wav, {
      force: true,
    });
  }
}

// -----------------------------------------------------------------------------
// Parallel generation
// -----------------------------------------------------------------------------

let next = 0;

const WORKERS =
  Math.max(
    1,
    Number(
      process.env.AUDIO_WORKERS ?? 4
    )
  );

await Promise.all(
  Array.from(
    { length: WORKERS },
    async () => {
      while (true) {
        const index = next++;

        if (index >= todo.length) {
          break;
        }

        await build(todo[index]);

        // Small delay prevents hammering the runner when generating
        // thousands of files.
        await sleep(20);
      }
    }
  )
);

// -----------------------------------------------------------------------------
// Save manifest
// -----------------------------------------------------------------------------

await writeFile(
  manifestPath,
  JSON.stringify(
    manifest,
    null,
    2
  ),
  "utf8"
);

console.log("done");