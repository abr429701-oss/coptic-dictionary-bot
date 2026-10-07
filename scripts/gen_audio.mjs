// scripts/gen_audio.mjs
//
// Generate Coptic dictionary audio from the IPA column.
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
// Each word is pronounced THREE times with a natural pause.
//
// Default voice:
//   el
//
// "el" is the standard Modern Greek eSpeak-ng voice and is classified
// as male in the eSpeak-ng voice data.
//
// The Coptic pronunciation itself comes from the dictionary IPA;
// eSpeak is used for synthesis.

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

// -----------------------------------------------------------------------------
// Voice
// -----------------------------------------------------------------------------
//
// IMPORTANT:
//
// Do NOT use the old:
//   el+f3
//
// That was a female variant.
//
// We use the standard Greek voice:
//   el
//
// You can override it without changing the source code:
//
//   ESPEAK_VOICE=el node scripts/gen_audio.mjs audio-out
//
// -----------------------------------------------------------------------------

const VOICE =
  process.env.ESPEAK_VOICE ?? "el";

// -----------------------------------------------------------------------------
// Voice tuning
// -----------------------------------------------------------------------------

// Dictionary-friendly speed.
// 80 was too slow/artificial for the previous version.
const SPEED =
  Number(
    process.env.ESPEAK_SPEED ?? 125
  );

// Medium-low male pitch.
const PITCH =
  Number(
    process.env.ESPEAK_PITCH ?? 48
  );

// Small internal word gap.
const GAP =
  Number(
    process.env.ESPEAK_GAP ?? 8
  );

// Exactly three repetitions.
const REPETITIONS = 3;

// Opus quality.
const BITRATE =
  process.env.OPUS_BITRATE ?? "24k";

// Number of simultaneous generators.
const WORKERS =
  Math.max(
    1,
    Number(
      process.env.AUDIO_WORKERS ?? 4
    )
  );

// -----------------------------------------------------------------------------
// Versioned settings
// -----------------------------------------------------------------------------

const SETTINGS = [
  NEURAL_VOICE_VERSION,
  `voice=${VOICE}`,
  `speed=${SPEED}`,
  `pitch=${PITCH}`,
  `gap=${GAP}`,
  `repetitions=${REPETITIONS}`,
  `opus=${BITRATE}`,
  "mode=greco-bohairic",
].join("|");

// -----------------------------------------------------------------------------
// Output directory
// -----------------------------------------------------------------------------

await mkdir(outDir, {
  recursive: true,
});

const manifestPath =
  path.join(
    outDir,
    "manifest.json"
  );

const manifest =
  existsSync(manifestPath)
    ? JSON.parse(
        await readFile(
          manifestPath,
          "utf8"
        )
      )
    : {};

// -----------------------------------------------------------------------------
// Build three repetitions
// -----------------------------------------------------------------------------

function buildRepeatedSpeech(
  phonemes
) {
  // Treat the whole IPA word as one pronunciation unit.
  //
  // IMPORTANT:
  // We do NOT split the phoneme string and insert pauses between
  // individual phonemes.
  //
  // The word itself is repeated three times.
  const word =
    `[[${phonemes}]]`;

  return [
    word,
    word,
    word,
  ].join(" , ");
}

// -----------------------------------------------------------------------------
// Prepare jobs
// -----------------------------------------------------------------------------

const jobs = [];

for (const record of records) {
  if (record?.id == null) {
    continue;
  }

  const ipa =
    ipaForSpeech(
      record,
      {
        liturgical: true,
        preserveJinkim: true,
      }
    );

  if (!ipa) {
    continue;
  }

  const phonemes =
    ipaToEspeak(
      ipa,
      {
        // Do not automatically force stress.
        addStress: false,
      }
    );

  if (!phonemes) {
    continue;
  }

  const hash =
    createHash("sha1")
      .update(
        `${SETTINGS}|${ipa}|${phonemes}`
      )
      .digest("hex")
      .slice(0, 12);

  const output =
    path.join(
      outDir,
      `${record.id}.ogg`
    );

  // Skip files that are already current.
  if (
    manifest[record.id] === hash &&
    existsSync(output)
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

const todo =
  jobs.slice(0, limit);

console.log(
  `${todo.length} to generate ` +
  `(${jobs.length} pending, ` +
  `${records.length} words)`
);

console.log(
  `Voice: ${VOICE}`
);

console.log(
  `Speed: ${SPEED}`
);

console.log(
  `Pitch: ${PITCH}`
);

console.log(
  `Gap: ${GAP}`
);

console.log(
  `Repetitions: ${REPETITIONS}`
);

console.log(
  `Opus bitrate: ${BITRATE}`
);

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
    buildRepeatedSpeech(
      phonemes
    );

  try {
    console.log(
      `Generating ${id}: ` +
      `${ipa} -> ${phonemes}`
    );

    // -----------------------------------------------------------------------
    // eSpeak-ng
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
        maxBuffer:
          1024 * 1024,
      }
    );

    // -----------------------------------------------------------------------
    // FFmpeg
    // -----------------------------------------------------------------------
    //
    // 24 kbps Opus is used instead of the previous 16 kbps.
    // application=audio is appropriate for dictionary speech.
    //

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
        maxBuffer:
          1024 * 1024,
      }
    );

    manifest[id] = hash;
  } catch (error) {
    console.error(
      `word ${id} failed:`,
      error instanceof Error
        ? error.message
            .split("\n")[0]
        : String(error)
    );
  } finally {
    await rm(
      wav,
      {
        force: true,
      }
    );
  }
}

// -----------------------------------------------------------------------------
// Parallel generation
// -----------------------------------------------------------------------------

let next = 0;

await Promise.all(
  Array.from(
    {
      length: WORKERS,
    },
    async () => {
      while (true) {
        const index = next++;

        if (
          index >= todo.length
        ) {
          break;
        }

        await build(
          todo[index]
        );
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

console.log(
  "done"
);