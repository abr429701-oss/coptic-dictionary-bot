// src/neural-voice.js
//
// Coptic IPA -> Amazon Polly phonemes
//
// The dictionary IPA/pronunciation field is the primary pronunciation source.
// We do not reconstruct pronunciation from Coptic spelling when IPA exists.
//
// Target:
// Modern Greco-Bohairic pronunciation.
//
// Audio is prebuilt by scripts/gen_audio_ipa_reader.mjs using Miguel [US Spanish],
// except words whose Coptic spelling contains ϣ, which use Salli [US English].

import { isSingleWordOgg, repeatSingleWordOgg } from "./ogg-repeat.js";
export { isSingleWordOgg };
import audioManifest from "../data/audio-manifest.json" with { type: "json" };
import audioVersions from "../data/audio-versions.json" with { type: "json" };
// Admin-recorded human voices: word id -> file name. The recordings live in
// Telegram as file_ids (DO voice:<id>) and as local files in the WhatsApp
// port's data/recorded-voices/; this snapshot is the URL-addressable index
// for them. Update it when the admin records a new word (same export step
// that drops the .ogg into the WhatsApp port's recorded dir).
import recordedVoices from "../data/recorded-voices.json" with { type: "json" };

export const NEURAL_VOICE_VERSION = "ipa-miguel-salli-once-v1";
// Bump this whenever the external human-audio files are regenerated. This
// prevents Telegram file_ids from an older voice build being reused forever.
export const HUMAN_AUDIO_VERSION = "ipa-reader-joanna-v1";

// -----------------------------------------------------------------------------
// IPA normalization
// -----------------------------------------------------------------------------

const IPA_REPLACEMENTS = new Map([
  // Combining grave / Jinkim.
  // NEVER delete this automatically.
  ["\u0300", "\u0300"],

  // Latin accented vowels.
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

  // Greek letters sometimes present in pronunciation data.
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

  // Coptic letters.
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

  // ASCII representations sometimes found in IPA data.
  ["sh", "ʃ"],
  ["zh", "ʒ"],
  ["tsh", "tʃ"],
  ["ts", "tʃ"],
  ["ch", "tʃ"],
  ["dj", "dʒ"],
  ["dh", "ð"],
  ["th", "θ"],
  ["kh", "x"],
]);

// eSpeak-ng phoneme mnemonics.
const ESPEAK = {
  ɔ: "O",
  ɣ: "Q",
  θ: "T",
  ð: "D",
  ʃ: "S",
  ʒ: "Z",
  ŋ: "N",
  ɲ: "J",
  ʎ: "L",
  ː: ":",
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function normalizeWhitespace(text) {
  return text.replace(/\s+/gu, " ").trim();
}

function normalizeIpaSymbols(text) {
  let result = text;

  // Multi-character phonemes first.
  result = result
    .replace(/tsh/giu, "tʃ")
    .replace(/dj/giu, "dʒ")
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
// IPA extraction
// -----------------------------------------------------------------------------

export function ipaForSpeech(
  record,
  {
    liturgical = true,
    preserveJinkim = true,
  } = {}
) {
  let text = String(record?.pronunciation ?? "")
    .normalize("NFC")
    .trim();

  if (!text) return "";

  // First pronunciation variant only.
  text = text.split(/\s*[\/,]\s*/u)[0];

  // Remove explanatory text such as "(alpha)".
  text = text.replace(/\([^)]*\)/gu, " ");

  text = normalizeIpaSymbols(text);

  // Punctuation that is not part of pronunciation.
  text = text
    .replace(/[|,;]/gu, " ")
    .replace(/[-–—…=.:'"]/gu, " ");

  // Common IPA normalization.
  text = text
    .replace(/ʊ/gu, "u")
    .replace(/ɑ/gu, "a")
    .replace(/ɒ/gu, "a")
    .replace(/q/gu, "k")
    .replace(/c/gu, "k");

  // Do not invent pronunciation rules here.
  // These transformations apply only when the IPA source already contains
  // aspirated phonemes.
  // The sheet sometimes writes a stray space around the aspiration mark ("sopʰ os").
  text = text.replace(/\s*ʰ\s*/gu, "ʰ");

  if (liturgical) {
    text = text
      .replace(/pʰ/gu, "f")
      .replace(/tʰ/gu, "θ")
      .replace(/kʰ/gu, "x");
  }

  // Jinkim is deliberately preserved.
  if (!preserveJinkim) {
    text = text.replace(/\u0300/gu, "");
  }

  // Allowed IPA.
  text = text.replace(
    /[^a-zɔɣθðxʃʒŋɲʎʰː\u0300\s]/gu,
    ""
  );

  return normalizeWhitespace(text).slice(0, 120);
}

// -----------------------------------------------------------------------------
// Jinkim
// -----------------------------------------------------------------------------

function handleJinkimForEspeak(text) {
  // Preserve the boundary represented by the combining grave.
  //
  // We do not simply delete it.
  return text
    .normalize("NFC")
    .replace(/\u0300/gu, " ");
}

// -----------------------------------------------------------------------------
// IPA -> eSpeak
// -----------------------------------------------------------------------------

export function ipaToEspeak(
  ipa,
  {
    // Default true keeps the original behaviour (and the unit tests).
    // scripts/gen_audio.mjs passes addStress: false explicitly, so audio is unchanged.
    addStress = true,
  } = {}
) {
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

    // Optional stress.
    //
    // Disabled by default because automatically forcing stress on the
    // first vowel can produce incorrect Coptic pronunciation.
    if (
      addStress &&
      !/[']/u.test(converted)
    ) {
      const chars = [...converted];

      const vowelIndex = chars.findIndex(
        (char) =>
          "aeiouO".includes(char)
      );

      if (vowelIndex >= 0) {
        chars.splice(vowelIndex, 0, "'");
        converted = chars.join("");
      }
    }

    return converted;
  });

  return convertedParts
    .join(" ")
    .trim()
    .slice(0, 160);
}

// -----------------------------------------------------------------------------
// Audio URL
// -----------------------------------------------------------------------------

// Hash of the voice a word was last built from (changes when its IPA, spelling or meaning changes).
export const audioVersion = (id) => String(audioVersions[String(id)] ?? "");

// With { bust: true } the URL carries the voice hash, so a rebuilt word is never served from a stale cache.
export const audioUrl = (env, id, { bust = false } = {}) => {
  const fileName = audioManifest[String(id)] || `${id}.ogg`;
  return `${(
    env?.AUDIO_BASE_URL ||
    "https://raw.githubusercontent.com/abr429701-oss/coptic-dictionary-bot/audio"
  ).replace(/\/+$/u, "")}/${encodeURIComponent(fileName)}${bust && audioVersion(id) ? `?v=${audioVersion(id)}` : ""}`;
};

// Messenger voice: only words with a prebuilt file on the audio branch get a
// voice attachment (the file is served by URL, never synthesized live). Null
// when the manifest has no entry for the word.
export const prebuiltAudioUrl = (env, id) => {
  if (id == null || !Object.hasOwn(audioManifest, String(id))) return null;
  return audioUrl(env, id, { bust: true });
};

// Admin-recorded human voice, URL form. The recordings have NO public URL
// today — Telegram serves them by file_id, the WhatsApp port from local
// disk — so this tier applies only once the files are hosted and
// RECORDED_AUDIO_BASE_URL is set (the R2 public bucket is the intended
// host; the deploy token currently lacks R2 Edit, so nothing is hosted
// yet). Without the base this returns null, never a dead URL: a word with
// a recording but no host falls through to its prebuilt voice.
export const recordedAudioUrl = (env, id) => {
  if (id == null || !Object.hasOwn(recordedVoices, String(id))) return null;
  const base = env?.RECORDED_AUDIO_BASE_URL;
  if (!base) return null;
  return `${String(base).replace(/\/+$/u, "")}/${encodeURIComponent(recordedVoices[String(id)])}`;
};

// Messenger voice resolution — Telegram's prepareWordVoice priority, URL
// form: recorded human first, then prebuilt Polly (Miguel/Salli), then
// Joanna (audio-human branch) only when HUMAN_AUDIO is on and there is no
// prebuilt file. In practice the prebuilt manifest covers every record
// that has an id, so the Joanna tier only fires for ids outside the
// dictionary. Null when the word has no voice at all.
export const messengerVoiceUrl = (env, record) => {
  if (!record || record.id == null) return null;
  return recordedAudioUrl(env, record.id)
    ?? prebuiltAudioUrl(env, record.id)
    ?? (humanAudioEnabled(env) ? humanAudioUrl(env, record.id) : null);
};

// -----------------------------------------------------------------------------
// Human-sounding audio (optional, built by scripts/gen_audio_fish.mjs into the
// "audio-human" branch). Only used when the Worker variable HUMAN_AUDIO is "on".
// -----------------------------------------------------------------------------

export const humanAudioEnabled = (env) => env?.HUMAN_AUDIO === "on";

export const humanAudioUrl = (env, id) =>
  `${(
    env?.AUDIO_HUMAN_BASE_URL ||
    "https://raw.githubusercontent.com/abr429701-oss/coptic-dictionary-bot/audio-human"
  ).replace(/\/+$/u, "")}/${encodeURIComponent(id)}.ogg?v=${encodeURIComponent(HUMAN_AUDIO_VERSION)}`;

export async function fetchHumanSpeech(env, record) {
  if (!humanAudioEnabled(env) || record?.id == null) return null;
  const url = humanAudioUrl(env, record.id);
  try {
    // Same two-layer cache as fetchOgg: RAM of this isolate first, then the edge cache —
    // raw.githubusercontent is touched at most once per word per colo.
    const mem = audioMemGet(url);
    if (mem) return mem;
    try {
      const cache = caches.default;
      const hit = await cache.match(url);
      if (hit) {
        const cachedAudio = await hit.arrayBuffer();
        if (cachedAudio.byteLength >= 4) { audioMemPut(url, cachedAudio); return cachedAudio; }
      }
    } catch { /* cache unavailable in this runtime */ }
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return null;
    if (response.body) {
      try { await cachePutAudio(url, response.clone()); } catch { /* non-critical */ }
    }
    const audio = await response.arrayBuffer();
    if (audio.byteLength < 4) return null;
    const magic = new TextDecoder().decode(new Uint8Array(audio, 0, 4));
    if (magic !== "OggS") return null;
    audioMemPut(url, audio);
    return audio;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Fetch prebuilt audio
// -----------------------------------------------------------------------------

// Audio lives on two GitHub branches. A word may exist on either one, and GitHub raw
// occasionally answers slowly or with a transient 5xx: one short attempt used to return
// null, so the voice never arrived even though its link existed. Now every candidate URL
// is retried, the branches are tried in order, and the timeout is long enough for a slow
// cold fetch.
const AUDIO_HUMAN_BASE = "https://raw.githubusercontent.com/abr429701-oss/coptic-dictionary-bot/audio-human";

function audioCandidates(env, id) {
  const urls = [];
  const add = (url) => { if (url && !urls.includes(url)) urls.push(url); };
  add(audioUrl(env, id, { bust: true }));
  add(audioUrl(env, id));
  add(`${(env?.AUDIO_HUMAN_BASE_URL || AUDIO_HUMAN_BASE).replace(/\/+$/u, "")}/${encodeURIComponent(`${id}.ogg`)}`);
  return urls;
}

async function fetchOgg(url, headers, timeoutMs) {
  // Two-layer cache, fastest first: RAM of this isolate (0 ms), then the edge cache
  // (a few ms, any user on this colo). raw.githubusercontent is touched at most once
  // per word per colo — its slow cold fetch (up to the 9s timeout) can no longer sit
  // between the user's question and the voice.
  const mem = audioMemGet(url);
  if (mem) return { ok: true, audio: mem };
  try {
    const cache = caches.default;
    const hit = await cache.match(url);
    if (hit) {
      const audio = await hit.arrayBuffer();
      if (audio.byteLength >= 4) { audioMemPut(url, audio); return { ok: true, audio }; }
    }
  } catch { /* cache unavailable in this runtime */ }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) return { ok: false, status: response.status };
  if (response.ok && response.body) {
    try { await cachePutAudio(url, response.clone()); } catch { /* non-critical */ }
  }
  const audio = await response.arrayBuffer();
  if (audio.byteLength < 4) return { ok: false, status: "tiny" };
  const magic = new TextDecoder().decode(new Uint8Array(audio, 0, 4));
  if (magic !== "OggS") return { ok: false, status: "not-ogg" };
  audioMemPut(url, audio);
  return { ok: true, audio };
}
async function cachePutAudio(url, response) {
  const cache = caches.default;
  await cache.put(url, new Response(response.body, { headers: { "content-type": "audio/ogg", "cache-control": "public, max-age=86400" } }));
}

// In-isolate memory cache: words fetched in this running instance are served from RAM
// (0 ms) on every later request in the same isolate, with a hard byte budget so the
// Worker never grows unbounded. Edge cache above covers cross-isolate reuse.
const AUDIO_MEM_MAX_BYTES = 24 * 1024 * 1024;
const audioMem = new Map(); // url -> ArrayBuffer
let audioMemBytes = 0;
function audioMemGet(url) {
  const hit = audioMem.get(url);
  if (hit) return hit;
}
function audioMemPut(url, audio) {
  if (audio.byteLength > AUDIO_MEM_MAX_BYTES / 4 || audioMem.has(url)) return;
  audioMem.set(url, audio);
  audioMemBytes += audio.byteLength;
  while (audioMemBytes > AUDIO_MEM_MAX_BYTES) {
    const oldest = audioMem.keys().next().value;
    const dropped = audioMem.get(oldest);
    audioMem.delete(oldest);
    audioMemBytes -= dropped?.byteLength ?? 0;
  }
}
// Test isolation: clears the in-isolate audio memory so one test's fetched word
// can never leak into another test that expects a fresh network outcome.
export function resetAudioCaches() {
  audioMem.clear();
  audioMemBytes = 0;
}

export async function fetchPrebuiltSpeech(env, record) {
  if (record?.id == null) return null;
  const headers = env?.GITHUB_AUDIO_TOKEN ? { authorization: `Bearer ${env.GITHUB_AUDIO_TOKEN}` } : {};
  const candidates = audioCandidates(env, record.id);
  const tryUrl = async (url) => {
    try {
      const result = await fetchOgg(url, headers, 9000);
      if (!result.ok) return null;
      // Files on GitHub hold the word once; the bot plays it several times in one voice message.
      try {
        return repeatSingleWordOgg(result.audio, {
          times: Number(env?.VOICE_REPEATS ?? 3),
          pauseMs: Number(env?.VOICE_REPEAT_PAUSE_MS ?? 700),
        });
      } catch {
        return result.audio;
      }
    } catch (error) {
      console.error("Prebuilt voice error:", url, error instanceof Error ? error.message : "unknown");
      return null;
    }
  };
  // Primary candidate (the /audio/ branch, cache-busted) is tried first alone: it covers
  // the vast majority of words, so the common path costs exactly one fetch.
  const primary = await tryUrl(candidates[0]);
  if (primary) return primary;
  // Hedged fallback: the remaining URLs are raced in PARALLEL instead of walked
  // sequentially (the old loop could burn ~55s across 3 URLs × 2 attempts × 9s
  // timeout + backoff before giving up). Worst case now: primary + one parallel wave.
  const rest = candidates.slice(1);
  if (!rest.length) return null;
  const results = await Promise.all(rest.map((url) => tryUrl(url)));
  return results.find((audio) => audio) ?? null;
}
