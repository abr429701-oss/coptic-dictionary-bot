// Accurate male pronunciation: the sheet's IPA column (C) is sent to a neural TTS
// as SSML <phoneme alphabet="ipa">, so the engine pronounces the sounds instead of
// guessing from English spelling. Needs AZURE_SPEECH_KEY + AZURE_SPEECH_REGION;
// without them the bot keeps using the old generated voice.

// Bump when the mapping/voice changes so cached Telegram file_ids are regenerated.
export const NEURAL_VOICE_VERSION = "v1";
export const DEFAULT_VOICE = "el-GR-NestorasNeural"; // male Greek: native x, ɣ, θ, ð, v, f
const DEFAULT_RATE = "-20%";

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

const escapeXml = (value) => value.replace(/[<>&"']/gu, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));

export function buildSsml(record, { voice = DEFAULT_VOICE, rate = DEFAULT_RATE, liturgical = true } = {}) {
  const ipa = ipaForSpeech(record, { liturgical });
  if (!ipa) return "";
  const lang = voice.split("-").slice(0, 2).join("-");
  const display = escapeXml(String(record?.english || record?.phonetic || "x").slice(0, 60));
  const words = ipa.split(" ").map((part) => `<phoneme alphabet="ipa" ph="${escapeXml(part)}">${display}</phoneme>`);
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">` +
    `<voice name="${voice}"><prosody rate="${rate}">${words.join(" <break time=\"120ms\"/> ")}</prosody></voice></speak>`;
}

// Returns an OGG/Opus ArrayBuffer (what Telegram sendVoice wants) or null.
export async function fetchNeuralSpeech(env, record) {
  if (!env?.AZURE_SPEECH_KEY || !env?.AZURE_SPEECH_REGION) return null;
  const ssml = buildSsml(record, {
    voice: env.AZURE_TTS_VOICE || DEFAULT_VOICE,
    rate: env.AZURE_TTS_RATE || DEFAULT_RATE,
    liturgical: env.TTS_PROFILE !== "reconstructed",
  });
  if (!ssml) return null;
  try {
    const response = await fetch(`https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "ogg-24khz-16bit-mono-opus",
        "User-Agent": "CopticDictionaryBot",
      },
      body: ssml,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error("Neural TTS failed", response.status);
      return null;
    }
    const audio = await response.arrayBuffer();
    return audio.byteLength ? audio : null;
  } catch (error) {
    console.error("Neural TTS error", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}
