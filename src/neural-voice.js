// src/neural-voice.js
//
// Coptic IPA -> eSpeak-ng phonemes
//
// The dictionary IPA/pronunciation field is the primary pronunciation source.
// We do not reconstruct pronunciation from Coptic spelling when IPA exists.
//
// Target:
// Modern Greco-Bohairic pronunciation.
//
// Audio is prebuilt by scripts/gen_audio.mjs.

export const NEURAL_VOICE_VERSION = "v7";

// -----------------------------------------------------------------------------
// IPA normalization
// -----------------------------------------------------------------------------

const IPA_REPLACEMENTS = new Map([
  // Combining grave / Jinkim.
  // NEVER delete this automatically.
  ["\u0300", "\u0300"],

  // Latin accented vowels.
  ["à", "a"],