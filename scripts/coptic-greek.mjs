// IPA (as cleaned by src/neural-voice.js -> ipaForSpeech) -> Greek spelling.
// TTS voices for Greek read this naturally. It is an APPROXIMATION: Greek has no
// /ʃ/ /ʒ/ /h/ /dʒ/ sounds, so those map to the closest Greek letters.
const MULTI = [
  ["dʒ", "τζ"], ["tʃ", "τσ"],
  ["ŋk", "γκ"], ["ŋg", "γκ"], ["ŋ", "νγ"], ["ɲ", "νι"], ["ʎ", "λι"],
];
const SINGLE = {
  a: "α", e: "ε", i: "ι", o: "ο", u: "ου", ɔ: "ω", y: "ι",
  p: "π", b: "μπ", t: "τ", d: "ντ", k: "κ", g: "γκ",
  f: "φ", v: "β", θ: "θ", ð: "δ", s: "σ", z: "ζ", x: "χ", ɣ: "γ", h: "χ", ʃ: "σ", ʒ: "ζ",
  m: "μ", n: "ν", l: "λ", r: "ρ", j: "ι", w: "ου",
};

export function ipaToGreek(ipa) {
  const text = String(ipa ?? "").replace(/\u0300/gu, "").replace(/[ʰː]/gu, "").trim().toLowerCase();
  let out = "";
  for (let i = 0; i < text.length;) {
    if (/\s/u.test(text[i])) { out += " "; i++; continue; }
    const pair = MULTI.find(([from]) => text.startsWith(from, i));
    if (pair) { out += pair[1]; i += pair[0].length; continue; }
    out += SINGLE[text[i]] ?? "";
    i++;
  }
  // Word-final sigma.
  return out.replace(/σ(?=\s|$)/gu, "ς").replace(/\s+/gu, " ").trim();
}
