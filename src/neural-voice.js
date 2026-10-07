// src/neural-voice.js
//
// Coptic → IPA normalization → eSpeak-ng phonemes
//
// IMPORTANT:
// - The dictionary's IPA column is the primary pronunciation source.
// - We do NOT try to reconstruct pronunciation from Coptic spelling when IPA exists.
// - This module normalizes IPA conservatively and converts it to eSpeak-ng mnemonics.
// - Coptic Jinkim / grave marks are NOT blindly deleted.
//
// Target:
//   Modern Greco-Bohairic pronunciation
//
// Audio is prebuilt by scripts/gen_audio.mjs and stored in the "audio" branch.

export const NEURAL_VOICE_VERSION = "v6";

// -----------------------------------------------------------------------------
// Unicode / IPA normalization
// -----------------------------------------------------------------------------

const IPA_REPLACEMENTS = new Map([
  // Combining grave accent / Jinkim-related mark.
  // Keep it initially so we can make an informed decision about it later.
  ["\u0300", "\u0300"], // ̀

  // Common accented Latin vowels.
  ["à", "a"],
  ["á", "a"],
  ["â", "a"],
  ["ä", "a"],
  ["è", "e"],
  ["é", "e"],
  ["ê", "e"],
  ["ë", "e"],
  ["ì", "i"],
  ["í", "i"],
  ["î", "i"],
  ["ï", "i"],
  ["ò", "o"],
  ["ó", "o"],
  ["ô", "o"],
  ["ö", "o"],
  ["ù", "u"],
  ["ú", "u"],
  ["û", "u"],
  ["ü", "u"],

  // Greek/Coptic letters occasionally present in pronunciation data.
  ["α", "a"],
  ["Α", "a"],
  ["ε", "e"],
  ["Ε", "e"],
  ["η", "i"],
  ["Η", "i"],
  ["ι", "i"],
  ["Ι", "i"],
  ["ο", "o"],
  ["Ο", "o"],
  ["ω", "o"],
  ["Ω", "o"],
  ["υ", "i"],
  ["Υ", "i"],

  ["β", "v"],
  ["Β", "v"],
  ["γ", "ɣ"],
  ["Γ", "ɣ"],
  ["δ", "ð"],
  ["Δ", "ð"],
  ["θ", "θ"],
  ["Θ", "θ"],
  ["κ", "k"],
  ["Κ", "k"],
  ["λ", "l"],
  ["Λ", "l"],
  ["μ", "m"],
  ["Μ", "m"],
  ["ν", "n"],
  ["Ν", "n"],
  ["π", "p"],
  ["Π", "p"],
  ["ρ", "r"],
  ["Ρ", "r"],
  ["σ", "s"],
  ["ς", "s"],
  ["Σ", "s"],
  ["τ", "t"],
  ["Τ", "t"],
  ["χ", "x"],
  ["Χ", "x"],

  // Coptic-specific letters.
  ["ϩ", "h"],
  ["ϧ", "x"],
  ["ϫ", "dʒ"],
  ["ϣ", "ʃ"],

  // IPA variants.
  ["ᴐ", "ɔ"],
  ["ↄ", "ɔ"],
  ["ͻ", "ɔ"],
  ["ʊ", "u"],
  ["ɑ", "a"],
  ["ɒ", "a"],
  ["ɐ", "a"],
  ["ɪ", "i"],
  ["ʏ", "i"],
  ["ʉ", "u"],
  ["ɣ", "ɣ"],
  ["ɸ", "f"],
  ["β", "v"],

  // ASCII-style spellings sometimes found in IPA columns.
  ["sh", "ʃ"],
  ["zh", "ʒ"],
  ["ch", "tʃ"],
  ["tsh", "tʃ"],
  ["ts", "tʃ"],
  ["dj", "dʒ"],
  ["dh", "ð"],
  ["th", "θ"],
  ["kh", "x"],
]);

// eSpeak-ng phoneme mnemonics.
//
// These are intentionally conservative.
// IPA must be normalized before reaching this table.
const ESPEAK = {
  ɔ: "O",
  ɣ: "Q",
  θ: "T",
  ð: "D",
  ʃ: "S",
  ʒ: "Z",
  ŋ: "N",

  // IPA length mark.
  ː: ":",

  // Affricates are handled before single-character replacement.
  tʃ: "tS",
  dʒ: "dZ",

  // Common IPA symbols.
  ɲ: "J",
  ʎ: "L",
  j: "j",
  w: "w",
};

// -----------------------------------------------------------------------------
// Utility functions
// -----------------------------------------------------------------------------

function normalizeWhitespace(text) {
  return text.replace(/\s+/gu, " ").trim();
}

function removeUnsupportedPunctuation(text) {
  return text
    .replace(/[\/|,;]/gu, " ")
    .replace(/[()[\]{}]/gu, " ")
    .replace(/[-–—…=.:'"]/gu, " ");
}

function normalizeIpaSymbols(text) {
  let result = text;

  // Multi-character sequences MUST be normalized before individual characters.
  result = result
    .replace(/tsh/giu, "tʃ")
    .replace(/tʃ/gu, "tʃ")
    .replace(/dj/giu, "dʒ")
    .replace(/dʒ/gu, "dʒ")
    .replace(/sh/giu, "ʃ")
    .replace(/zh/giu, "ʒ")
    .replace(/kh/giu, "x")
    .replace(/ch/giu, "tʃ")
    .replace(/dh/giu, "ð")
    .replace(/th/giu, "θ");

  result = [...result]
    .map((char) => IPA_REPLACEMENTS.get(char) ?? char)
    .join("");

  return result;
}

// -----------------------------------------------------------------------------
// IPA extraction from dictionary record
// -----------------------------------------------------------------------------

export function ipaForSpeech(record, {
  liturgical = true,
  preserveJinkim = true,
} = {}) {
  let text = String(record?.pronunciation ?? "")
    .normalize("NFC")
    .trim();

  if (!text) return "";

  // Use only the first pronunciation variant.
  text = text.split(/\s*[\/,]\s*/u)[0];

  // Remove explanatory parenthetical material.
  text = text.replace(/\([^)]*\)/gu, " ");

  text = normalizeIpaSymbols(text);

  // Normalize punctuation after multi-character IPA processing.
  text = removeUnsupportedPunctuation(text);

  // Normalize common IPA conventions.
  text = text
    .replace(/ʊ/gu, "u")
    .replace(/ɑ/gu, "a")
    .replace(/ɒ/gu, "a")
    .replace(/q/gu, "k")
    .replace(/c/gu, "k")
    .replace(/y/gu, "j")
    .replace(/w/gu, "w");

  // Keep IPA length.
  // Do NOT remove the combining grave/Jinkim blindly.
  if (!preserveJinkim) {
    text = text.replace(/\u0300/gu, "");
  }

  // Current project mode:
  // Greek-influenced modern Bohairic pronunciation.
  //
  // IMPORTANT:
  // These transformations only apply to aspirated IPA already present
  // in the pronunciation column. We do not invent aspiration ourselves.
  if (liturgical) {
    text = text
      .replace(/pʰ/gu, "f")
      .replace(/tʰ/gu, "θ")
      .replace(/kʰ/gu, "x");
  }

  // Remove characters that are definitely not phonetic input.
  //
  // Combining grave is deliberately allowed.
  text = text.replace(
    /[^a-zɔɣθðxʃʒŋɲʎʰː\u0300\s]/gu,
    ""
  );

  return normalizeWhitespace(text).slice(0, 120);
}

// -----------------------------------------------------------------------------
// Jinkim handling
// -----------------------------------------------------------------------------

/**
 * Converts a combining grave/Jinkim mark into a short separator for eSpeak.
 *
 * We do NOT simply delete it.
 *
 * The exact phonetic interpretation of Jinkim depends on how the dictionary's
 * IPA column uses the mark. Therefore the safe TTS behavior is to preserve
 * the syllable boundary rather than invent a new vowel.
 */
function handleJinkimForEspeak(text) {
  return text
    .normalize("NFC")

    // Combining grave after a segment:
    // turn it into a small syllable boundary.
    .replace(/\u0300/gu, " ");
}

// -----------------------------------------------------------------------------
// IPA → eSpeak
// -----------------------------------------------------------------------------

const VOWELS = new Set([
  "a",
  "e",
  "i",
  "o",
  "u",
  "O",
]);

function isVowel(char) {
  return VOWELS.has(char);
}

/**
 * Converts normalized IPA into eSpeak-ng phoneme mnemonics.
 *
 * Stress is NOT automatically forced onto the first vowel.
 * This is intentional: blindly inserting first-vowel stress can damage
 * genuine Coptic stress patterns.
 */
export function ipaToEspeak(ipa, {
  addStress = false,
} = {}) {
  const input = String(ipa ?? "")
    .normalize("NFC")
    .trim();

  if (!input) return "";

  const parts = handleJinkimForEspeak(input)
    .split(/\s+/u)
    .filter(Boolean);

  const convertedParts = parts.map((part) => {
    let converted = part;

    // Multi-character phonemes first.
    converted = converted.replace(/dʒ/gu, "dZ");
    converted = converted.replace(/tʃ/gu, "tS");

    // Single IPA symbols.
    converted = converted.replace(
      /[ɔɣθðʃʒŋɲʎːʰ]/gu,
      (symbol) => {
        if (symbol === "ʰ") return "";
        return ESPEAK[symbol] ?? symbol;
      }
    );

    // Conservative stress handling:
    // only add stress when explicitly requested.
    if (addStress && !/[']/u.test(converted)) {
      const chars = [...converted];
      const index = chars.findIndex(isVowel);

      if (index >= 0) {
        chars.splice(index, 0, "'");
        converted = chars.join("");
      }
    }

    return converted;
  });

  return convertedParts.join(" ").trim().slice(0, 160);
}

// -----------------------------------------------------------------------------
// Audio URL
// -----------------------------------------------------------------------------

export const audioUrl = (env, id) =>
  `${(
    env?.AUDIO_BASE_URL ||
    "https://raw.githubusercontent.com/abr429701-oss/coptic-dictionary-bot/audio"
  ).replace(/\/+$/u, "")}/${encodeURIComponent(id)}.ogg`;

// -----------------------------------------------------------------------------
// Prebuilt audio
// -----------------------------------------------------------------------------

export async function fetchPrebuiltSpeech(env, record) {
  if (record?.id == null) return null;

  try {
    const headers = env?.GITHUB_AUDIO_TOKEN
      ? {
          authorization: `Bearer ${env.GITHUB_AUDIO_TOKEN}`,
        }
      : {};

    const response = await fetch(
      audioUrl(env, record.id),
      {
        headers,
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!response.ok) return null;

    const audio = await response.arrayBuffer();

    if (audio.byteLength < 4) return null;

    const magic = new TextDecoder().decode(
      new Uint8Array(audio, 0, 4)
    );

    return magic === "OggS" ? audio : null;
  } catch (error) {
    console.error(
      "Prebuilt voice error:",
      error instanceof Error ? error.message : "unknown error"
    );

    return null;
  }
}