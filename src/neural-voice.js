// Male pronunciation generated from the sheet's IPA column (C) with espeak-ng.
// Audio is built ahead of time by GitHub Actions (scripts/gen_audio.mjs) into the
// "audio" branch as <word id>.ogg; the Worker only downloads it, so it needs no
// API key and almost no CPU. Words without a file keep the old generated voice.

// Bump when the mapping/voice changes so cached Telegram file_ids are regenerated.
export const NEURAL_VOICE_VERSION = "v3";

const ACCENTED = { "è": "e", "ì": "i", "ò": "o", "à": "a", "ὼ": "o", "ό": "o", "ο": "o", "ɔ": "ɔ", "ᴐ": "ɔ", "ↄ": "ɔ", "ͻ": "ɔ" };
const GREEK = { "α": "a", "ε": "e", "η": "i", "ι": "i", "ο": "o", "ω": "o", "υ": "i", "β": "v", "γ": "ɣ", "θ": "θ", "κ": "k", "λ": "l", "μ": "m", "ν": "n", "π": "p", "ρ": "r", "σ": "s", "ς": "s", "τ": "t", "χ": "x", "ϩ": "h", "ϧ": "x", "ϫ": "dʒ", "ϣ": "ʃ" };

// liturgical = the Greek-based Bohairic reading used in church (pʰ→f, tʰ→θ, kʰ→x).
// Set liturgical=false to keep the sheet's reconstructed aspirates (pʰ tʰ kʰ).
export function ipaForSpeech(record, { liturgical = true } = {}) {
  let text = String(record?.pronunciation ?? "").normalize("NFC").trim();
  if (!text) return "";
  text = text.split(/\s*[\/,]\s*/u)[0].replace(/\([^)]*\)/gu, " "); // first variant only, drop "(alpha)" glosses
  text = [...text].map((ch) => ACCENTED[ch] ?? GREEK[ch] ?? ch).join("").toLowerCase();
  text = text.replace(/`/gu, "").replace(/\s*ʰ\s*/gu, "ʰ").replace(/[-–…=.:'"]/gu, " ");
  text = text.replace(/tsh|tʃ/gu, "tʃ").replace(/sh/gu, "ʃ").replace(/kh/gu, "x").replace(/ch/gu, "tʃ");
  text = liturgical
    ? text.replace(/pʰ/gu, "f").replace(/tʰ/gu, "θ").replace(/kʰ/gu, "x")
    : text;
  text = text.replace(/ʊ/gu, "u").replace(/ɑ/gu, "a").replace(/q/gu, "k").replace(/c/gu, "k").replace(/y/gu, "j").replace(/w/gu, "u");
  return text.replace(/[^a-zɔɣθðxʃʒʰː\s]/gu, "").replace(/\s+/gu, " ").trim().slice(0, 100);
}

const ESPEAK = { "ɔ": "O", "ɣ": "Q", "θ": "T", "ð": "D", "ʃ": "S", "ʒ": "Z", "ŋ": "N", "ː": ":", "ʰ": "" };
const VOWELS = /[aeiouO]/u;

// IPA (as cleaned by ipaForSpeech) -> espeak-ng phoneme mnemonics, e.g. "tʃoːl" -> "tS'o:l".
export function ipaToEspeak(ipa) {
  return String(ipa).split(" ").filter(Boolean).map((part) => {
    const converted = part.replace(/dʒ/gu, "dZ").replace(/tʃ/gu, "tS").replace(/[ɔɣθðʃʒŋːʰ]/gu, (c) => ESPEAK[c]);
    const at = [...converted].findIndex((c) => VOWELS.test(c)); // stress the first vowel
    return at < 0 ? converted : `${converted.slice(0, at)}'${converted.slice(at)}`;
  }).join(" ");
}

export const audioUrl = (env, id) =>
  `${(env?.AUDIO_BASE_URL || "https://raw.githubusercontent.com/abr429701-oss/coptic-dictionary-bot/audio").replace(/\/+$/u, "")}/${id}.ogg`;

// Returns the prebuilt OGG/Opus ArrayBuffer for a word, or null if none exists.
export async function fetchPrebuiltSpeech(env, record) {
  if (record?.id == null) return null;
  try {
    const headers = env?.GITHUB_AUDIO_TOKEN ? { authorization: `Bearer ${env.GITHUB_AUDIO_TOKEN}` } : {};
    const response = await fetch(audioUrl(env, record.id), { headers, signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const audio = await response.arrayBuffer();
    const magic = new TextDecoder().decode(new Uint8Array(audio, 0, Math.min(4, audio.byteLength)));
    return magic === "OggS" ? audio : null; // only accept a real OGG file
  } catch (error) {
    console.error("Prebuilt voice error", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}
