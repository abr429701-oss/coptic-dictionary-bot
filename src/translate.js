// translate.js — Arabic → Coptic sentence translator (v1).
// Admin-only, Telegram-only, hidden from users. Sources:
//   data/translate/grammar-rules.md (36 sections, merged from both grammar books)
//   data/translate/book1.json + book2.json (structured rules from the other model)
//   data/dictionary.json (reverse index for nouns/verbs + gender from `kind`).
// Verified against book 1 itself: present/past/future prefix tables + Ϯ→ⲓ / ⲕ̀→ⲭ̀ notes.
//
// v1 scope (honest limits): simple sentences only — nominal sentences,
// pronoun-subject verbal sentences (present/past/future), negation,
// noun objects (form 1 + ⲛ̀/ⲙ̀/ⲉ̀, or form 2 direct), possessive suffixes,
// common prepositions, question words, imperative/prohibition, يوجد/عندي.
// Unknown words are reported, never guessed.

import records from "../data/dictionary.json" with { type: "json" };

// ---------- Arabic normalization ----------
export function normalizeArabic(s) {
  return String(s ?? "")
    .replace(/[ً-ْٰـ]/gu, "") // diacritics + tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/\u0654/g, "") // combining hamza: decomposed "أ" ≡ composed "أ"
    .replace(/\u0654/g, "") // combining hamza: decomposed "أ" ≡ composed "أ"
    .replace(/\u0654/g, "") // combining hamza: decomposed "أ" ≡ composed "أ"
    .replace(/\u0654/g, "") // combining hamza: decomposed "أ" ≡ composed "أ"
    .replace(/\u0654/g, "") // combining hamza: decomposed "أ" ≡ composed "أ"
    .replace(/\u0654/g, "") // combining hamza: decomposed "أ" ≡ composed "أ"
    // NOTE: ة is NOT mapped to ه — "كتابه" (his book, ه) must stay distinct
    // from "كتابة" (writing, ة); callers that need ة/ه tolerance handle it (R7).
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

// Normalize every key of a lookup table with normalizeArabic at load time, so
// keys written with un-normalized forms (على/متى/هؤلاء/اولئك…) match normalized input (R12/R25/R31).
function normalizeKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[normalizeArabic(k)] = v;
  return out;
}

// Phrasebook lookup, tolerant of ة/ه spelling (the key may be written either way).
function phraseLookup(norm) {
  return PHRASES[norm] ?? PHRASES[norm.replace(/ة/g, "ه")] ?? PHRASES[norm.replace(/ه/g, "ة")] ?? null;
}

function stripDefinite(w) {
  return w.startsWith("ال") && w.length > 3 ? w.slice(2) : w;
}

// ---------- Coptic helpers ----------
export function cleanCoptic(s) {
  // strip parenthetical hints like (ⲡ) (ⲧ) (ⲛ) (ⲁⲗⲫⲁ); keep first word group
  return String(s ?? "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

function objectMarker(copticWord) {
  const first = cleanCoptic(copticWord).charAt(0);
  if (["ⲃ", "ⲙ", "ⲡ", "ϥ", "ⲫ", "Ⲃ", "Ⲙ", "Ⲡ", "Ϥ", "Ⲫ"].includes(first)) return "ⲙ̀";
  if (["ⲁ", "ⲉ", "ⲏ", "ⲓ", "ⲟ", "ⲩ", "ⲱ", "Ⲁ", "Ⲉ", "Ⲏ", "Ⲓ", "Ⲟ", "Ⲩ", "Ⲱ"].includes(first)) return "ⲉ̀";
  return "ⲛ̀";
}

// ---------- Pronouns / tense prefixes (book 1, verified) ----------
export const SUBJ_PRONOUNS = normalizeKeys({
  "انا": { person: "1s", separate: "ⲁⲛⲟⲕ" },
  "انت": { person: "2m", separate: "ⲛ̀ⲑⲟⲕ" },
  "انتي": { person: "2f", separate: "ⲛ̀ⲑⲟ" },
  "هو": { person: "3m", separate: "ⲛ̀ⲑⲟϥ" },
  "هي": { person: "3f", separate: "ⲛ̀ⲑⲟⲥ" },
  "نحن": { person: "1p", separate: "ⲁⲛⲟⲛ" },
  "انتم": { person: "2p", separate: "ⲛ̀ⲑⲱⲧⲉⲛ" },
  "هم": { person: "3p", separate: "ⲛ̀ⲑⲱⲟⲩ" },
});

// prefix + verb (present / past / future). ⲕ̀ → ⲭ̀ before ⲙ/ⲛ/ⲟⲩ and in future.
export const TENSE_PREFIX = {
  present: { "1s": "Ϯ", "2m": "ⲕ̀", "2f": "ⲧⲉ", "3m": "ϥ̀", "3f": "ⲥ̀", "1p": "ⲧⲉⲛ", "2p": "ⲧⲉⲧⲉⲛ", "3p": "ⲥⲉ" },
  past: { "1s": "ⲁⲓ", "2m": "ⲁⲕ", "2f": "ⲁⲣⲉ", "3m": "ⲁϥ", "3f": "ⲁⲥ", "1p": "ⲁⲛ", "2p": "ⲁⲣⲉⲧⲉⲛ", "3p": "ⲁⲩ" },
  future: { "1s": "ϯⲛⲁ", "2m": "ⲭ̀ⲛⲁ", "2f": "ⲧⲉⲣⲁ", "3m": "ϥ̀ⲛⲁ", "3f": "ⲥ̀ⲛⲁ", "1p": "ⲧⲉⲛⲛⲁ", "2p": "ⲧⲉⲧⲉⲛⲛⲁ", "3p": "ⲥⲉⲛⲁ" },
};
// past negation: ⲙ̀ⲡ- + pronoun (ⲙ̀ⲡⲓ ⲙ̀ⲡⲉⲕ ⲙ̀ⲡⲉ ⲙ̀ⲡⲉϥ ⲙ̀ⲡⲉⲥ ⲙ̀ⲡⲉⲛ ⲙ̀ⲡⲉⲧⲉⲛ ⲙ̀ⲡⲟⲩ)
export const PAST_NEG_PREFIX = { "1s": "ⲙ̀ⲡⲓ", "2m": "ⲙ̀ⲡⲉⲕ", "2f": "ⲙ̀ⲡⲉ", "3m": "ⲙ̀ⲡⲉϥ", "3f": "ⲙ̀ⲡⲉⲥ", "1p": "ⲙ̀ⲡⲉⲛ", "2p": "ⲙ̀ⲡⲉⲧⲉⲛ", "3p": "ⲙ̀ⲡⲟⲩ" };

function tensePrefix(tense, person, verb) {
  let p = TENSE_PREFIX[tense][person];
  // ⲕ̀ → ⲭ̀ before verbs starting with ⲙ/ⲛ/ⲟⲩ (present 2m only; future already ⲭ̀ⲛⲁ)
  if (tense === "present" && person === "2m" && /^[ⲙⲛⲟⲩ]/.test(verb)) p = "ⲭ̀";
  return p;
}

// ---------- Possessives (book 1 §8.4) ----------
// key: arabic suffix on noun → {m, f, pl} coptic prefix by possessed noun gender
export const POSSESSIVE = {
  "ي": { m: "ⲡⲁ", f: "ⲧⲁ", pl: "ⲛⲁ" },
  "ك": { m: "ⲡⲉⲕ", f: "ⲧⲉⲕ", pl: "ⲛⲉⲕ" },
  "كي": { m: "ⲡⲉ", f: "ⲧⲉ", pl: "ⲛⲉ" },
  "ه": { m: "ⲡⲉϥ", f: "ⲧⲉϥ", pl: "ⲛⲉϥ" },
  "ها": { m: "ⲡⲉⲥ", f: "ⲧⲉⲥ", pl: "ⲛⲉⲥ" },
  "نا": { m: "ⲡⲉⲛ", f: "ⲧⲉⲛ", pl: "ⲛⲉⲛ" },
  "كم": { m: "ⲡⲉⲧⲉⲛ", f: "ⲧⲉⲧⲉⲛ", pl: "ⲛⲉⲧⲉⲛ" },
  "هم": { m: "ⲡⲟⲩ", f: "ⲧⲟⲩ", pl: "ⲛⲟⲩ" },
};
export const HAVE_PREFIX = { "ي": "ⲟⲩⲛⲧⲏⲓ", "ك": "ⲟⲩⲛⲧⲁⲕ", "كي": "ⲟⲩⲛⲧⲉ", "ه": "ⲟⲩⲛⲧⲁϥ", "ها": "ⲟⲩⲛⲧⲁⲥ", "نا": "ⲟⲩⲛⲧⲁⲛ", "كم": "ⲟⲩⲛⲧⲉⲧⲉⲛ", "هم": "ⲟⲩⲛⲧⲟⲩ" };

// ---------- Prepositions (book 1 §31) ----------
export const PREPOSITIONS = normalizeKeys({
  "في": "ϧⲉⲛ", "الى": "ⲉ", "الي": "ⲉ", "من": "ⲉ̀ⲃⲟⲗϧⲉⲛ", "مع": "ⲛⲉⲙ",
  "ل": "ⲛⲁ", "لـ": "ⲛⲁ", "على": "ϩⲓϫⲉⲛ", "عن": "ⲉⲑⲃⲉ", "بعد": "ⲙⲉⲛⲉⲛⲥⲁ",
  "قبل": "ϩⲁϫⲱ", "حتى": "ϣⲁ", "بين": "ⲟⲩⲧⲉ", "ضد": "ⲟⲩⲃⲉ", "بدون": "ⲁϭⲛ",
  "عند": "ϩⲁⲣⲟ", "فوق": "ϩⲓ", "تحت": "ϧⲁ", "امام": "ⲙ̀ⲡⲉ̀ⲙ̀ⲑⲟ",
});

// ---------- Question words (book 1 §25) ----------
export const QUESTION_WORDS = normalizeKeys({
  "من": "ⲛⲓⲙ", "ماذا": "ⲁϣ", "ما": "ⲟⲩ", "اين": "ⲑⲱⲛ", "متى": "ⲑ̀ⲛⲁⲩ",
  "لماذا": "ⲉⲑⲃⲉ ⲟⲩ", "كيف": "ⲡⲱⲥ", "كم": "ⲟⲩⲏⲣ", "هل": "ⲙⲏ",
});

// ---------- Demonstratives (book 1 §8.5) ----------
export const DEMONSTRATIVE = normalizeKeys({
  "هذا": { adj: "ⲡⲁⲓ", pron: "ⲫⲁⲓ" }, "هذه": { adj: "ⲧⲁⲓ", pron: "ⲑⲁⲓ" },
  "هؤلاء": { adj: "ⲛⲁⲓ", pron: "ⲛⲁⲓ" }, "ذلك": { adj: "ⲫⲏ", pron: "ⲫⲏ" },
  "تلك": { adj: "ⲑⲏ", pron: "ⲑⲏ" }, "اولئك": { adj: "ⲛⲏⲉⲧ", pron: "ⲛⲏ" },
});

// ---------- Curated phrasebook (book examples only) ----------
export const PHRASES = normalizeKeys({
  "الله محبة": "Ⲫ̀ⲛⲟⲩϯ ⲟⲩⲁⲅⲁⲡⲏ ⲡⲉ",
  "انت هو بطرس": "ⲛ̀ⲑⲟⲕ ⲡⲉ Ⲡⲉⲧⲣⲟⲥ",
  "هو رجل حكيم": "ⲛ̀ⲑⲟϥ ⲟⲩⲣⲱⲙⲓ ⲛ̀ⲥⲁⲃⲉ ⲡⲉ",
  "ابانا الذي في السماوات": "Ⲡⲉⲛⲓⲱⲧ ⲉⲧϧⲉⲛ ⲛⲓⲫⲏⲟⲩⲓ",
  "ليتقدس اسمك": "ⲙⲁⲣⲉϥⲧⲟⲩⲃⲟ ⲛ̀ϫⲉ ⲡⲉⲕⲣⲁⲛ",
  "ان شاء الله": "ⲁⲣⲉϣⲁⲛ Ⲫ̀ⲛⲟⲩϯ ⲟⲩⲱϣ",
  "المجد لالهنا": "ⲡⲓⲱ̀ⲟⲩ ⲫⲁ ⲡⲉⲛⲛⲟⲩϯ ⲡⲉ",
  "لم يكن هو النور": "ⲛⲉ ⲛ̀ⲑⲟϥ ⲁⲛ ⲡⲉ ⲡⲓⲟⲩⲱⲓⲛⲓ",
  "كيف هذا": "ⲡⲱⲥ ⲫⲁⲓ",
  "سلام لك": "ϯⲣⲏⲛⲏ ⲛⲁⲕ",
});

// ---------- Curated verbs: arabic stem → forms (book 1 §10 tables + dictionary) ----------
// f1 = absolute form (verb + ⲛ̀/ⲙ̀/ⲉ̀ + noun object); f2 = direct-object form; f3 = pronoun-object form
export const CURATED_VERBS = normalizeKeys({
  "كتب": { f1: "ⲥ̀ϧⲁⲓ", f3: "ⲥ̀ϧⲏⲧ" },
  "احب": { f1: "ⲙⲉⲓ", f2: "ⲙⲉⲛⲣⲉ", f3: "ⲙⲉⲛⲣⲓⲧ" },
  "قال": { f1: "ϫⲱ", f2: "ϫⲉ", f3: "ϫⲟ" },
  "فعل": { f1: "ⲓⲣⲓ", f2: "ⲉⲣ", f3: "ⲟⲓ" },
  "صنع": { f1: "ⲓⲣⲓ", f2: "ⲉⲣ", f3: "ⲟⲓ" },
  "اعطي": { f1: "ϯ", f2: "ⲧⲁⲓⲉ", f3: "ⲧⲁⲓⲟ" },
  "راي": { f1: "ⲛⲁⲩ", f3: "ⲛⲁⲩ" },
  "سمع": { f1: "ⲥⲱⲧⲉⲙ", f2: "ⲥⲉⲧⲉⲙ" },
  "ذهب": { f1: "ϣⲉⲛⲁϥ" },
  "مشي": { f1: "ⲙⲟϣⲓ" },
  "اكل": { f1: "ⲟⲩⲱⲙ", f2: "ⲟⲩⲉⲙ", f3: "ⲟⲩⲟⲙ" },
  "شرب": { f1: "ⲥⲱ", f2: "ⲥⲉ" },
  "جلس": { f1: "ϩⲉⲙⲥⲓ" },
  "فتح": { f1: "ⲁⲟⲩⲱⲛ", f2: "ⲟⲩⲉⲛ" },
  "خلق": { f1: "ⲭⲁⲙⲓⲟ", f2: "ⲭⲁⲙⲓⲉ", f3: "ⲭⲁⲙⲓⲟ" },
  "بارك": { f1: "ⲥ̀ⲙⲟⲩ" },
  "صلي": { f1: "ⲧⲱⲃϩ" },
  "تكلم": { f1: "ⲥⲁϫⲓ" },
  "جاء": { f1: "ⲓ" },
  "اتي": { f1: "ⲓ" },
  "وجد": { f1: "ϫⲓⲙⲓ", f2: "ϫⲉⲙ", f3: "ϫⲉⲙ" },
  "ولد": { f1: "ⲙⲓⲥⲓ", f2: "ⲙⲉⲥ", f3: "ⲙⲁⲥ" },
  "طهر": { f1: "ⲧⲟⲩⲃⲟ", f2: "ⲧⲟⲩⲃⲉ", f3: "ⲧⲟⲩⲃⲟ" },
  "درس": { f1: "ⲉⲣⲙⲉⲗⲉⲧⲁⲛ" },
  "علم": { f1: "ϯⲥ̀ⲃⲱ" },
  "تعلم": { f1: "ⲥⲓⲥ̀ⲃⲱ" },
  "نظر": { f1: "ⲛⲁⲩ" },
  "قام": { f1: "ⲧⲱⲛ" },
  "مات": { f1: "ⲙⲟⲩ" },
  "عاش": { f1: "ⲱⲛϧ" },
  "نام": { f1: "ⲉⲛⲕⲟⲧ" },
  "استيقظ": { f1: "ⲧⲱⲛ" },
  "سكن": { f1: "ϣⲱⲡⲓ" },
  "اختبا": { f1: "ϩⲱⲡⲓ" },
  "اخذ": { f1: "ϭⲓ" },
  "خاف": { f1: "ⲉⲣϩⲟϯ" },
  "اعط": { f1: "ϯ" },
  // كان: the dictionary's first فعل hit is f3-only (ⲛⲁ), so bare كان came out
  // as ⲁϥⲛⲁ — the f1 form is the dictionary's own ϣⲱⲡⲓ (5th hit).
  "كان": { f1: "ϣⲱⲡⲓ" },
  // سار (to walk/proceed): the dictionary's only سار record is the phrasal
  // سار وراء "to follow" (ⲉⲣϩⲓⲫⲁϩⲟⲩ); plain سار takes مشي's form ⲙⲟϣⲓ.
  "سار": { f1: "ⲙⲟϣⲓ" },
});
// imperative special forms (book 1 §22): ⲁ- prefix verbs + ϯ family
export const IMPERATIVE_SPECIAL = normalizeKeys({
  "قل": "ⲁϫⲉ", "افعل": "ⲁⲣⲓ", "احضر": "ⲁⲛⲓ", "ارفع": "ⲁⲗⲓ",
  "افتح": "ⲁⲟⲩⲱⲛ", "انظر": "ⲁⲛⲁⲩ", "اعط": "ⲙⲟⲓ", "اعطي": "ⲙⲟⲓ",
  "كل": "ⲟⲩⲱⲙ", "خذ": "ϭⲓ", "قم": "ⲧⲱⲛ", "نم": "ⲉⲛⲕⲟⲧ", "امش": "ⲙⲟϣⲓ",
});

// Imperative + pronoun suffix: "أعطني" → ⲙⲟⲓ ⲛⲏⲓ (dative pronouns, book 1 §22) — R16.
const IMPERATIVE_PRONOUN = {
  "ني": "ⲛⲏⲓ", "ك": "ⲛⲁⲕ", "كي": "ⲛⲉ", "ه": "ⲛⲁϥ",
  "ها": "ⲛⲁⲥ", "نا": "ⲛⲁⲛ", "كم": "ⲛⲱⲧⲉⲛ", "هم": "ⲛⲁⲩ",
};
// Adjective linker: ⲙ̀ before labials (ⲃ ⲙ ⲡ ⲫ), else ⲛ̀ (book 1 §26) — R20.
function adjLinker(adjCoptic) {
  const first = cleanCoptic(adjCoptic).charAt(0);
  return ["ⲃ", "ⲙ", "ⲡ", "ⲫ"].includes(first) ? "ⲙ̀" : "ⲛ̀";
}
// Special definite articles (§4, attested forms only): ⲫ̀ⲣⲏ "the sun", ⲑ̀ⲙⲁⲩ "the mother".
// The book lists ⲫ̀/ⲑ̀ before ⲃ ⲓ ⲗ ⲙ ⲛ ⲟ ⲣ generally, but its own examples keep
// ⲡⲓ for ⲙⲁⲑⲏⲙⲁ/ⲣⲱⲙⲓ/ⲟⲩⲱⲓⲛⲓ, so the rule is applied only to the attested nouns — R10.
function definiteArticle(gender, bare) {
  if (gender === "m" && bare === "ⲣⲏ") return "ⲫ̀ⲣⲏ";
  if (gender === "f" && bare === "ⲙⲁⲩ") return "ⲑ̀ⲙⲁⲩ";
  return gender === "f" ? `ϯ${bare}` : gender === "pl" ? `ⲛⲓ${bare}` : `ⲡⲓ${bare}`;
}
// Adjective lookup key: strip the definite article and a trailing ة/ه/ا (حكيمة/حكيما → حكيم).
function adjKeyOf(token) {
  return stripDefinite(normalizeArabic(token)).replace(/[هة]$/, "").replace(/ا$/, "");
}

// ---------- Curated nouns: arabic → {coptic, gender m|f|pl} ----------
// gender from dictionary `kind` / (ⲡ)/(ⲧ)/(ⲛ) hints, checked live 27 Nov
export const CURATED_NOUNS = normalizeKeys({
  "الله": { coptic: "Ⲫ̀ⲛⲟⲩϯ", gender: "m", definite: true },
  "يسوع": { coptic: "Ⲓⲏⲥⲟⲩⲥ", gender: "m", proper: true },
  "المسيح": { coptic: "Ⲡⲓⲭⲣⲓⲥⲧⲟⲥ", gender: "m", definite: true },
  "مريم": { coptic: "Ⲙⲁⲣⲓⲁ", gender: "f", proper: true },
  "بطرس": { coptic: "Ⲡⲉⲧⲣⲟⲥ", gender: "m", proper: true },
  "بولس": { coptic: "Ⲡⲁⲩⲗⲟⲥ", gender: "m", proper: true },
  "موسي": { coptic: "Ⲙⲱⲩⲥⲏⲥ", gender: "m", proper: true },
  "يوحنا": { coptic: "Ⲓⲱⲁⲛⲛⲏⲥ", gender: "m", proper: true },
  "مينا": { coptic: "Ⲙⲏⲛⲁ", gender: "m", proper: true },
  "ابرام": { coptic: "Ⲁⲃⲣⲁⲙ", gender: "m", proper: true },
  "رجل": { coptic: "ⲣⲱⲙⲓ", gender: "m" },
  "امراه": { coptic: "ⲥϩⲓⲙⲓ", gender: "f" },
  "ولد": { coptic: "ⲁⲗⲟⲩ", gender: "m" },
  "بنت": { coptic: "ⲗⲓⲗⲟⲩ", gender: "f" },
  "ابن": { coptic: "ϣⲏⲣⲓ", gender: "m" },
  "اب": { coptic: "ⲓⲱⲧ", gender: "m" },
  "ام": { coptic: "ⲙⲁⲩ", gender: "f" },
  "اخ": { coptic: "ⲥⲟⲛ", gender: "m" },
  "اخت": { coptic: "ⲥⲱⲛⲓ", gender: "f" },
  // "زوجة" first resolves as the Rachel phrase record (Ⲣⲁⲭⲏⲗ) — the generic
  // wife record is ⲥϩⲓⲙⲓ (same as "امرأة"), so curate it: "زوجتي" = my wife.
  "زوجه": { coptic: "ⲥϩⲓⲙⲓ", gender: "f" },
  "انسان": { coptic: "ⲣⲱⲙⲓ", gender: "m" },
  "كتاب": { coptic: "ϫⲱⲱⲙ", gender: "m" },
  "درس": { coptic: "ⲙⲁⲑⲏⲙⲁ", gender: "m" },
  "كنيسه": { coptic: "ⲉⲕⲕⲗⲏⲥⲓⲁ", gender: "f" },
  "بيت": { coptic: "ⲏⲓ", gender: "m" },
  "خبز": { coptic: "ⲱⲓⲕ", gender: "m" },
  "ماء": { coptic: "ⲙⲱⲟⲩ", gender: "m" },
  "سماء": { coptic: "ⲫⲉ", gender: "f" },
  "ارض": { coptic: "ⲕⲁϩ", gender: "m" },
  "نور": { coptic: "ⲟⲩⲱⲓⲛⲓ", gender: "m" },
  "شمس": { coptic: "ⲣⲏ", gender: "m" },
  "قمر": { coptic: "ⲓⲟϩ", gender: "m" },
  "ليل": { coptic: "ⲉ̀ϫⲱⲣϩ", gender: "m" },
  "يوم": { coptic: "ⲉ̀ϩⲟⲟⲩ", gender: "m" },
  "سنه": { coptic: "ⲣⲟⲙⲡⲓ", gender: "f" },
  "قلب": { coptic: "ϩⲏⲧ", gender: "m" },
  "يد": { coptic: "ϫⲓϫ", gender: "f" },
  "عين": { coptic: "ⲃⲁⲗ", gender: "m" },
  "ملك": { coptic: "ⲟⲩⲣⲟ", gender: "m" },
  "خادم": { coptic: "ⲃⲱⲕ", gender: "m" },
  "معلم": { coptic: "ⲣⲉϥϯⲥ̀ⲃⲱ", gender: "m" },
  "تلميذ": { coptic: "ⲙⲁⲑⲏⲧⲏⲥ", gender: "m" },
  "كاهن": { coptic: "ⲟⲩⲏⲃ", gender: "m" },
  "شماس": { coptic: "ⲇⲓⲁⲕⲱⲛ", gender: "m" },
  "راهب": { coptic: "ⲙⲟⲛⲁⲭⲟⲥ", gender: "m" },
  "صلاه": { coptic: "ⲧⲱⲃϩ", gender: "m" },
  "محبه": { coptic: "ⲁⲅⲁⲡⲏ", gender: "f" },
  "اسم": { coptic: "ⲣⲁⲛ", gender: "m" },
  "كلمه": { coptic: "ⲥⲁϫⲓ", gender: "m" },
  "طريق": { coptic: "ⲙⲱⲓⲧ", gender: "m" },
  "باب": { coptic: "ⲣⲟ", gender: "m" },
  "حجر": { coptic: "ⲱⲛⲓ", gender: "m" },
  "شجره": { coptic: "ϣ̀ϣⲏⲛ", gender: "f" },
  "طعام": { coptic: "ϩ̀ⲣⲉ", gender: "m" },
  "رجال": { coptic: "ⲣⲱⲙⲓ", gender: "pl" },
  "نساء": { coptic: "ϩⲓⲟⲙⲓ", gender: "pl" },
  "اولاد": { coptic: "ⲁⲗⲱⲟⲩⲓ", gender: "pl" },
  "ايام": { coptic: "ⲉ̀ϩⲟⲟⲩ", gender: "pl" },
  "كتب": { coptic: "ϫⲱⲱⲙ", gender: "pl" },
  "صديق": { coptic: "ϣ̀ⲫⲉⲣ", gender: "m", plural: "ϣ̀ⲫⲉⲣⲓ" },
  "عالم": { coptic: "ⲕⲟⲥⲙⲟⲥ", gender: "m" }, // world (not astronomer/scholar)
});

// ---------- Curated adjectives ----------
// Adjectives as {m, f} (book 1 §26: ⲥⲁⲃⲉ/ⲥⲁⲃⲏ; -ⲓ → -ⲉ and -ⲉ → -ⲏ for the
// feminine; ⲛⲓϣϯ and the ⲉϥ-/stative forms are invariable) — R21.
export const CURATED_ADJ = normalizeKeys({
  "حكيم": { m: "ⲥⲁⲃⲉ", f: "ⲥⲁⲃⲏ" }, "جديد": { m: "ⲃⲉⲣⲓ", f: "ⲃⲉⲣⲉ" },
  "قديم": { m: "ⲁⲡⲁⲥ", f: "ⲁⲡⲁⲥ" }, "كبير": { m: "ⲛⲓϣϯ", f: "ⲛⲓϣϯ" },
  "صغير": { m: "ⲕⲟⲩϫⲓ", f: "ⲕⲟⲩϫⲉ" }, "صالح": { m: "ⲁⲅⲁⲑⲟⲥ", f: "ⲁⲅⲁⲑⲏ" },
  "مقدس": { m: "ⲉϥⲟⲩⲁⲃ", f: "ⲉϥⲟⲩⲁⲃ" }, "جميل": { m: "ⲥⲁⲓⲉ", f: "ⲥⲁⲓⲏ" },
  "طويل": { m: "ϭⲟⲥⲓ", f: "ϭⲟⲥⲉ" }, "قصير": { m: "ϣⲏⲣ", f: "ϣⲏⲣ" },
  "عظيم": { m: "ⲛⲓϣϯ", f: "ⲛⲓϣϯ" }, "حي": { m: "ⲱⲛϧ", f: "ⲱⲛϧ" },
  "ميت": { m: "ⲙⲟⲩⲧ", f: "ⲙⲟⲩⲧ" }, "طاهر": { m: "ⲧⲟⲩⲃⲟ", f: "ⲧⲟⲩⲃⲟ" },
  "صادق": { m: "ⲙⲉⲑⲙⲏⲓ", f: "ⲙⲉⲑⲙⲏⲓ" },
});


// Function words never enter the reverse index and never resolve as nouns/verbs (R7/R23 guards).
const FUNCTION_WORDS = new Set(["لا", "لم", "لن", "ما", "في", "الي", "الى", "من", "مع", "علي", "على", "عن", "ان", "او", "ثم", "و", "هذا", "هذه", "ذلك", "تلك", "هؤلاء", "كل", "بعض", "غير", "بين", "بعد", "قبل", "حتي", "حتى", "بدون", "عند", "فوق", "تحت", "امام", "ليس", "يوجد", "سوف"].map(normalizeArabic));
// Table words (question words, prepositions, demonstratives, pronouns) are grammar, not nouns:
// a later word in a gloss (e.g. متى) must not become a noun/verb entry.
const TABLE_WORDS = new Set([...Object.keys(QUESTION_WORDS), ...Object.keys(PREPOSITIONS), ...Object.keys(DEMONSTRATIVE), ...Object.keys(SUBJ_PRONOUNS)]);
// Bare stems that end in a plural/dual suffix but are NOT plurals (verified against the
// dictionary: the stripped stem IS reachable as a noun, so whole-word-first does not save them):
// الرحمن→رحم، شعبان→شعب، سليمان→سليم، نسرين→نسر، فرحان→فرح، عدنان→عدن، عمران→عمر، شمعون→شمع، سمعون→سمع.
// (حسين/شاهين/حنين/رمضان/عثمان/لقمان/مروان/غسان/زيدان need no entry: their stems are not in the
// dictionary, so stripping simply fails to match. بنات/أخوات are handled by the +ت stem variant.)
const NON_PLURAL = new Set(["رحمن", "رحمان", "شعبان", "سليمان", "نسرين", "فرحان", "عدنان", "عمران", "شمعون", "سمعون"].map(normalizeArabic));

// ---------- Dictionary reverse index (lazy) ----------
let INDEX = null;
function genderFromRecord(r) {
  const k = r.kind ?? "";
  if (k.includes("مؤنث")) return "f";
  if (k.includes("مذكر")) return "m";
  if (k.includes("جمع")) return "pl";
  const m = /\((ⲡ|ⲧ|ⲛ)\)/.exec(r.coptic ?? "");
  if (m) return m[1] === "ⲡ" ? "m" : m[1] === "ⲧ" ? "f" : "pl";
  return "m";
}
function verbFormFromKind(kind) {
  if (kind.includes("أداة المفعول")) return "f1";
  if (kind.includes("بدون أداة مفعول")) return "f2";
  if (kind.includes("ضميرية")) return "f3";
  return "f1";
}
function buildIndex() {
  if (INDEX) return INDEX;
  // key → {pos, entries[]}: every word of the FIRST meaning segment is indexed, not just
  // the first word (a word like صديق is never a first word). Priority: earlier position
  // wins; the first word still beats later words; within the same position, the first
  // record in file order wins.
  const byArabic = new Map();
  // pass 1: position-0 keys (the v1 index). A later gloss word that is a possessed form
  // of one of these (stem + ه/ها/ك/…) is a morphological form, not a lemma, and must
  // not become a key: "امه" in "قاتل امه" (matricide) must not beat أم + ه = "his mother".
  // The suffix ي is NOT in this guard — it is also the nisba adjective ending
  // (مصري/عربي/قبطي are real lemmas).
  const pos0 = new Set();
  for (const r of records) {
    const meaning = r.meaning ?? "";
    if (!meaning) continue;
    // first word of every comma-value: every synonym is a lemma (see buildIndex).
    for (const v of normalizeArabic(meaning).split(/[،,]/)) {
      const first = v.split(" ")[0];
      if (first && first.length >= 2) pos0.add(first);
    }
  }
  const POSSESSIVE_TAILS = ["ها", "كما", "هما", "كم", "هم", "هن", "نا", "ه", "ك"];
  const isPossessedForm = (w) => {
    for (const suf of POSSESSIVE_TAILS) {
      if (w.endsWith(suf) && w.length - suf.length >= 2) {
        const stem = w.slice(0, -suf.length);
        if (pos0.has(stem) || CURATED_NOUNS[stem]) return true;
      }
    }
    return false;
  };
  for (const r of records) {
    const meaning = r.meaning ?? "";
    if (!meaning) continue;
    // The meaning is a comma-separated synonym list ("مدرسة، معلمة"): index
    // every value's words, earlier values winning. Only the first value was
    // indexed before, so later synonyms (معلمة، صديقة) were invisible to lookup.
    const seg = normalizeArabic(meaning);
    const words = seg.split(/[،,]/).flatMap((v) => v.split(" ")).filter((w) => w.length >= 2);
    const coptic = cleanCoptic(r.coptic ?? "").split(" ")[0].replace(/-$/, ""); // bound-form marker: ⲁϫⲉ- → ⲁϫⲉ (R30)
    if (!coptic) continue;
    const entry = { coptic, gender: genderFromRecord(r), kind: r.kind ?? "", form: verbFormFromKind(r.kind ?? "") };
    words.forEach((w, p) => {
      if (p > 0) {
        // New (position > 0) entries only: function/table words never enter the index,
        // junk (parentheses, digits, references) is skipped, and verb/adjective records
        // at pos > 0 are gloss artifacts — a verb's later words must not hijack verb
        // lookup ("اليوم الاول" must not become a verbal sentence) and adjectives must
        // not hijack noun lookup. Position-0 entries are unchanged from v1.
        if (FUNCTION_WORDS.has(w) || TABLE_WORDS.has(w)) return;
        if (!/^[ء-ي]+$/u.test(w)) return;
        if (/^(فعل|صفة)/.test(r.kind ?? "")) return;
        if (isPossessedForm(w)) return;
      }
      const cur = byArabic.get(w);
      if (!cur) byArabic.set(w, { pos: p, entries: [entry] });
      else if (cur.pos === p) cur.entries.push(entry);
      else if (cur.pos > p) byArabic.set(w, { pos: p, entries: [entry] });
    });
  }
  INDEX = new Map([...byArabic].map(([k, v]) => [k, v.entries]));
  return INDEX;
}
export function lookupArabic(word) {
  const idx = buildIndex();
  return idx.get(normalizeArabic(word)) ?? null;
}
// Function-word kinds (verbs, pronouns, particles, adverbs) are never nouns:
// "هو" must not return the ⲛ̀ⲑⲟϥ pronoun record, "ليس" must not return ⲉ̀ⲃⲏⲗ (R18/R23).
const FUNCTION_KINDS = /^(فعل|ضمير|حرف|أداة|ظرف|توكيد)/;
// Curated plural form: a plural-stripped match uses entry.plural when present,
// else the singular form with the plural article (book 1 §5: plural by article alone).
function pluralizeCurated(entry, plural) {
  if (!plural) return { ...entry };
  return { ...entry, coptic: entry.plural ?? entry.coptic, gender: "pl", plural: true };
}
function lookupNoun(word) {
  const norm = normalizeArabic(word);
  // candidates: {w, plural} — whole word first, stripping only as a fallback.
  const cands = [];
  const seen = new Set();
  const push = (w, plural = false) => {
    if (!w || w.length < 2) return;
    const key = w + (plural ? "!" : "");
    if (seen.has(key)) return;
    seen.add(key);
    cands.push({ w, plural });
  };
  push(norm);
  // hamzat waṣl: "المرأة" is ال + مرأة, but the word itself is "امرأة" (ا + مرأة) (R17)
  if (norm.startsWith("ال") && norm.length > 3) push("ا" + norm.slice(2));
  // accusative ـاً: "رجلا" → "رجل" (G1)
  if (norm.endsWith("ا") && norm.length > 2) push(norm.slice(0, -1));
  // plural/dual stripping on the bare stems (after ال removal): ين/ون (sound masculine
  // plural), ان (dual), ات (sound feminine plural). For ات the stem may need its ة/ه/ت
  // back: كلمات → كلمة (stem+ة), بنات → بنت (stem+ت, tried before the bare stem so
  // "بن" does not win), أخوات → أخت. Whole word is always tried first (above).
  const bareStems = [stripDefinite(norm)];
  if (norm.startsWith("ال") && norm.length > 3) bareStems.push("ا" + norm.slice(2));
  for (const stem of bareStems) {
    if (NON_PLURAL.has(stem)) continue;
    for (const suf of ["ين", "ون", "ان", "ات"]) {
      if (stem.endsWith(suf) && stem.length - suf.length >= 2) {
        const base = stem.slice(0, -suf.length);
        if (suf === "ات") push(base + "ت", true);
        push(base, true);
        if (suf === "ات") { push(base + "ة", true); push(base + "ه", true); }
        // هات-plural: أمهات = أم + هات — the singular is the stem minus a trailing ه.
        if (suf === "ات" && base.endsWith("ه") && base.length - 1 >= 2) push(base.slice(0, -1), true);
      }
    }
  }
  // ة → ه fallback: CURATED keys are written with ه, inputs may carry ة (كنيسة → كنيسه).
  // Only this direction: the reverse would re-create the R7 "كتابه" collision.
  const withHe = [];
  for (const c of cands) if (c.w.includes("ة")) withHe.push({ w: c.w.replace(/ة/g, "ه"), plural: c.plural });
  cands.push(...withHe);
  // phase 1: curated entries for ALL spelling candidates first — a curated value
  // (e.g. كنيسه → ⲉⲕⲕⲗⲏⲥⲓⲁ, the book spelling) must beat a dictionary record
  // for the same word (e.g. ⲉⲕⲕ̀ⲗⲏⲥⲓⲁ with jinkim)
  for (const cand of cands) {
    if (CURATED_NOUNS[cand.w]) return pluralizeCurated(CURATED_NOUNS[cand.w], cand.plural);
    const bare = stripDefinite(cand.w);
    if (CURATED_NOUNS[bare]) return pluralizeCurated(CURATED_NOUNS[bare], cand.plural);
  }
  // phase 2: dictionary. A plural-stripped stem must match a NOUN kind only — the
  // fallback (non-function kinds) would let a صفة/verb stem hijack the plural.
  for (const cand of cands) {
    const bare = stripDefinite(cand.w);
    const hits = lookupArabic(bare);
    if (!hits) continue;
    const noun = hits.find((h) => h.kind.includes("اسم")) ?? (cand.plural ? null : hits.find((h) => !FUNCTION_KINDS.test(h.kind)));
    if (noun) return { coptic: noun.coptic, gender: cand.plural ? "pl" : noun.gender, plural: cand.plural || undefined };
  }
  // feminine -ة derivation (FALLBACK ONLY): when the feminine form has NO dictionary
  // record of its own, derive it from the masculine stem with feminine markers
  // (book 1 §6: gender is carried by the article, not the noun form). A dictionary
  // record for the feminine form itself always wins over this fallback (phase 2
  // above): المعلمة → ϯⲇⲓⲇⲁⲥⲕⲁⲗⲏ (record 26228),
  // الصديقة → ϯϣ̀ⲫⲏⲣⲓ (record 32385) — NOT the masculine stem.
  // The stem must be a genuine masculine NOUN — an adjective stem (جميل)
  // must not become a noun here.
  if (norm.endsWith("ة")) {
    const stem = norm.slice(0, -1);
    if (stem.length >= 2) {
      const masc = lookupNoun(stem);
      // the stem must be EXPLICITLY masculine — kind "اسم مذكر", or a curated
      // masculine noun. A bare kind "اسم" (e.g. the vocative "يا", which falls
      // back to "m") is NOT a masculine noun: deriving "يأة" from it demoted
      // the verb "يأتي" to a possessed noun (ⲧⲁⲔⲩⲣⲓⲉ) in "متى يأتي؟".
      const explicitM = (CURATED_NOUNS[stem] && CURATED_NOUNS[stem].gender === "m")
        || (lookupArabic(stem) || []).some((h) => h.kind.includes("اسم") && h.kind.includes("مذكر"));
      if (masc && masc.gender === "m" && explicitM) return { coptic: masc.coptic, gender: "f" };
    }
  }
  return null;
}
// Hollow verbs whose present stem differs from the past stem (book 1 §10):
// يقول ← قول (past قال)، يموت ← موت (مات)، يكون ← كون (كان)، يعيش ← عيش
// (عاش)، يجيء ← جيء (جاء)، يقوم ← قوم (قام)، يدور ← دور (دار). Present stems
// that already equal the past stem (ينام/يخاف/يزار/يصام/يقاد/يدار/يباع/
// ينال/يطار) need no entry. Only used after a present prefix is stripped —
// the bare stem (قول = "saying", موت = "death", دور = "role") stays a noun.
const HOLLOW_PRESENT = normalizeKeys({
  "قول": "قال", "موت": "مات", "كون": "كان", "عيش": "عاش",
  "جيء": "جاء", "قوم": "قام", "دور": "دار", "سير": "سار",
});
function lookupVerbStem(stem) {
  if (CURATED_VERBS[stem]) return { ...CURATED_VERBS[stem], curated: true };
  const hits = lookupArabic(stem);
  let dictHit = null;
  if (hits) {
    const v = hits.find((h) => h.kind.startsWith("فعل"));
    if (v) dictHit = { [v.form]: v.coptic, curated: false };
  }
  // hollow verbs in jussive/prohibition: خف → خاف، قل → قال، نم → نام — a CURATED hollow form
  // beats a dictionary hit on the bare 2-letter stem (which is usually a different verb) (R15).
  if (stem.length === 2) {
    const hollow = stem[0] + "ا" + stem[1];
    if (CURATED_VERBS[hollow]) return { ...CURATED_VERBS[hollow], curated: true };
  }
  return dictHit;
}

// ---------- Arabic verb form analysis ----------
// Returns {stem, tense, person} or null. Strips سوف/سـ, present prefixes, past suffixes.
export function analyzeVerbToken(token) {
  const t = normalizeArabic(token);
  if (FUNCTION_WORDS.has(t)) return null;
  // Bare token FIRST: the س future regex (/^س[ااتيون]/) also matches س-initial
  // stems (سار → "future" + "ار"), so the future prefix is only stripped when
  // the bare token does not resolve as a verb at all. No future form (ساكتب،
  // سيكتب، ستكتب…) exists as a dictionary key, so bare-first is safe.
  const bare = analyzeVerbBare(t, null);
  if (bare) return bare;
  if (t.startsWith("سوف")) return analyzeVerbBare(t.slice(3), "future");
  if (/^س[ااتيون]/.test(t)) return analyzeVerbBare(t.slice(1), "future");
  return null;
}
function analyzeVerbBare(rest, tense) {
  // present prefixes
  const presentMap = [
    [/^ا/, "1s"], [/^ن/, "1p"],
    [/^ت(.+)ون$/, "2p"], [/^ت(.+)ين$/, "2f"], [/^ت/, "2m"],
    [/^ي(.+)ون$/, "3p"], [/^ي(.+)ن$/, "3f"], [/^ي/, "3m"],
  ];
  for (const [re, person] of presentMap) {
    const m = re.exec(rest);
    if (m) {
      const stem = m[1] ?? rest.slice(1);
      // the ي-strip fallback must not fire on pronoun suffixes: "عطني" is أعط + ني, not "عطن" (R16)
      // a CURATED hollow target beats a direct hit that is f3-only ("يقوم":
      // direct lookup gives f3-only ⲥⲟⲩⲧⲱⲛ, curated قام gives the book form ⲧⲱⲛ).
      const hollow = HOLLOW_PRESENT[stem] ? lookupVerbStem(HOLLOW_PRESENT[stem]) : null;
      const hit = (hollow && hollow.curated ? hollow : null)
        ?? lookupVerbStem(stem) ?? hollow
        ?? lookupVerbStem("ا" + stem) ?? lookupVerbStem(stem.replace(/ا$/, "")) ?? (stem.endsWith("ني") ? null : lookupVerbStem(stem.replace(/ي$/, "")));
      if (hit) return { stem, verb: hit, tense: tense ?? "present", person };
    }
  }
  // past: bare stem or + suffix
  const pastMap = [
    [/^(.+)وا$/, "3p"], [/^(.+)نا$/, "1p"], [/^(.+)تم$/, "2p"], [/^(.+)تن$/, "2f"],
    [/^(.+)تي$/, "2f"], [/^(.+)ن$/, "3f"], [/^(.+)ت$/, "1s"], [/^(.+)$/, "3m"],
  ];
  for (const [re, person] of pastMap) {
    const m = re.exec(rest);
    if (m) {
      const stem = m[1];
      // geminate (doubled-final) verbs: "أحببت" → stem "أحبب" → "أحب" (past 1s
      // of أحب); "رددت" → "ردد" → "رد". The doubled letter is the conjugation,
      // not part of the stem.
      const hit = lookupVerbStem(stem)
        ?? (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2] ? lookupVerbStem(stem.slice(0, -1)) : null);
      if (hit) return { stem, verb: hit, tense: tense ?? "past", person };
    }
  }
  return null;
}

// ---------- Noun phrase ----------
// token → {coptic, gender, definite, possessive?, adj?} ; consumes following adjective token too
// ---------- Noun phrase ----------
// token → {coptic, gender, definite, possessive?, adj?} ; consumes following adjective token too
function parseNounToken(token, nextToken) {
  const res = parseNounTokenInner(token, nextToken);
  if (res) return res;
  const t = normalizeArabic(token);
  // leading conjunction و-: "واختي" → "اختي" (whole word tried first; never strip
  // when the remainder is a verb — "وذهب" is "and he went", not "gold")
  if (t.startsWith("و") && t.length > 2 && !analyzeVerbToken(t.slice(1))) {
    return parseNounTokenInner(t.slice(1), nextToken);
  }
  return null;
}
// noun+possessive reading of a token (or null): "معلمتي" → the ⲧⲁ- noun,
// "كتبنا" → the ⲛⲁ- noun, "أصدقائي" → the ⲛⲁ- plural. Shared by the
// possessive branch below and by the verb-scan guard (a lone possessed noun
// is not a verb). Hamza restore: normalizeArabic maps ئ→ي and ؤ→و, so the
// stem of "أصدقائي/أصدقاؤك" arrives as "اصدقاي/اصدقاو" — the final ي/و IS
// the ء: "اصدقاي/اصدقاو" → stem minus ي/و + "ء" = "اصدقاء" (the stem already
// ends with ا, so only the hamza is restored).
// Kinship stems (normalized) whose possessive reading always wins over a
// whole-word noun record: "أبي" is my father, never the ⲉ̀ϩ̀ⲣⲏⲓ fragment;
// "أمي" is my mother, never the illiterate-person record.
const KINSHIP_STEMS = new Set(["اب", "ام", "اخ", "اخت", "عم", "خال", "جد", "جده", "ابن", "ابنه", "زوج", "زوجه", "بنت", "ولد"]);
// Kinship stems whose dictionary first hit is the wrong sense: "جد" first
// resolves as "seriousness" (ⲙⲉⲧⲁⲧⲥⲉⲣϥⲓ) — the kinship path means the
// grandfather (ⲛⲓϣⲓⲱⲧ, "أب الأب أو الأم").
const KINSHIP_COPTIC = { "جد": "ⲛⲓϣⲓⲱⲧ" };
function possessiveNounOf(token) {
  const t = normalizeArabic(token);
  for (const suf of ["ها", "كم", "هم", "نا", "كي", "ي", "ك", "ه"]) {
    if (t.endsWith(suf) && t.length - suf.length >= 2) {
      const stem = t.slice(0, -suf.length);
      // The effective stem is the form that actually resolved: "زوجتي" strips
      // to "زوجت" but resolves as "زوجة" (stem "زوجه") — the kinship rule
      // needs the resolved form, not the raw strip.
      let noun = lookupNoun(stem);
      let eff = stem;
      if (!noun && stem.endsWith("ت")) {
        noun = lookupNoun(stem.slice(0, -1) + "ه") ?? lookupNoun(stem.slice(0, -1) + "ة");
        if (noun) eff = stem.slice(0, -1) + "ه";
      }
      if (!noun) {
        noun = lookupNoun(stem + "ة") ?? lookupNoun(stem + "ه");
        if (noun) eff = stem + "ه";
      }
      if (!noun && (stem.endsWith("اي") || stem.endsWith("او"))) {
        noun = lookupNoun(stem.slice(0, -1) + "ء");
        if (noun) eff = stem.slice(0, -1) + "ء";
      }
      if (noun) return { noun, suf, stem: eff };
    }
  }
  return null;
}
function parseNounTokenInner(token, nextToken) {
  let t = normalizeArabic(token);
  // accusative ـاً ("درسا", "رجلا"): strip the final ا; the object takes the article (G1)
  let accusative = false;
  if (t.endsWith("ا") && t.length > 2 && lookupNoun(t.slice(0, -1))) {
    accusative = true;
    t = t.slice(0, -1);
  }
  // whole word BEFORE stripping ال: "الله" is not ال + له
  const whole0 = lookupNoun(t);
  if (whole0 && (whole0.definite || whole0.proper)) {
    let text = whole0.coptic;
    let consumed = 0;
    if (nextToken) {
      const adj = CURATED_ADJ[adjKeyOf(nextToken)];
      if (adj) { const form = adj[whole0.gender] ?? adj.m; text = `${text} ${adjLinker(form)}${form}`; consumed = 1; }
    }
    return { text, gender: whole0.gender, definite: true, consumed, accusative };
  }
  // an accusative ـاً form ("رجلا") is INDEFINITE — definiteness comes only from ال (G1)
  let definite = false;
  if (t.startsWith("ال") && t.length > 3) { definite = true; t = t.slice(2); }
  // Kinship possessives first (only without ال): "أبي/أمي/عمي/خالي/جدي/زوجتي"
  // are hijacked by whole-word noun records ("عمى" blindness, "خالي" empty,
  // "جدي" kid-goat, "زوجتي" a Rachel phrase, "أمي" illiterate) — a kinship
  // stem's possessive reading always wins. "الجدي" (the kid, with ال) is
  // untouched: the definite flag guards it.
  if (!definite) {
    const possK = possessiveNounOf(t);
    if (possK && KINSHIP_STEMS.has(possK.stem)) {
      const copticK = KINSHIP_COPTIC[possK.stem] ?? possK.noun.coptic;
      const genderK = KINSHIP_COPTIC[possK.stem] ? "m" : possK.noun.gender;
      const prefK = POSSESSIVE[possK.suf][genderK] ?? POSSESSIVE[possK.suf].m;
      return { text: `${prefK}${copticK}`, gender: genderK, definite: true, consumed: 0, accusative };
    }
  }
  // whole word first: "الظلمة" is one word, not "ظلم + ـه"
  // (also try with the initial alif restored: "المرأة" -> stem "مراة", word "امرأة")
  const whole = lookupNoun(t) ?? lookupNoun("ا" + t);
  if (whole) {
    let text;
    if (whole.proper || whole.definite) text = whole.coptic;
    else if (definite) text = definiteArticle(whole.gender, whole.coptic);
    else text = whole.gender === "pl" ? `ϩⲁⲛ${whole.coptic}` : `ⲟⲩ${whole.coptic}`;
    let consumed = 0;
    if (nextToken) {
      const adj = CURATED_ADJ[adjKeyOf(nextToken)];
      if (adj) { const form = adj[whole.gender] ?? adj.m; text = `${text} ${adjLinker(form)}${form}`; consumed = 1; }
    }
    return { text, gender: whole.gender, definite, consumed, accusative };
  }
  // possessive suffix (longest first); ة → ت before a suffix: "كنيستي" = كنيسة + ي (R9)
  const poss = possessiveNounOf(t);
  if (poss) {
    const pref = POSSESSIVE[poss.suf][poss.noun.gender] ?? POSSESSIVE[poss.suf].m;
    return { text: `${pref}${poss.noun.coptic}`, gender: poss.noun.gender, definite: true, consumed: 0, accusative };
  }
  const noun = lookupNoun(t) ?? lookupNoun("ا" + t);
  if (!noun) return null;
  let text;
  if (noun.proper || noun.definite) text = noun.coptic;
  else if (definite) text = definiteArticle(noun.gender, noun.coptic);
  else text = noun.gender === "pl" ? `ϩⲁⲛ${noun.coptic}` : `ⲟⲩ${noun.coptic}`;
  // adjective follows? "رجل حكيم" → noun ⲛ̀/ⲙ̀ adj
  let consumed = 0;
  if (nextToken) {
    const adj = CURATED_ADJ[adjKeyOf(nextToken)];
    if (adj) { const form = adj[noun.gender] ?? adj.m; text = `${text} ${adjLinker(form)}${form}`; consumed = 1; }
  }
  return { text, gender: noun.gender, definite, consumed, accusative };
}

// ---------- Main translation ----------
export function translateSentence(input) {
  const raw = String(input ?? "").trim();
  const norm = normalizeArabic(raw).replace(/[؟?!.،,]+$/u, "");
  if (!norm) return { ok: false, error: "اكتب جملة بالعربي." };
  if (/[a-zA-Z\u2C80-\u2CFF\u03E2-\u03EF]/.test(norm)) return { ok: false, error: "اكتب الجملة بالعربي بس." };
  const tokens = norm.split(" ").filter(Boolean);
  if (tokens.length > 12) return { ok: false, error: "الجملة طويلة — جرّب جملة أقصر (حتى 12 كلمة)." };
  // 2nd-person feminine from the raw (pre-normalization) token: "أنتِ" loses its kasra in normalizeArabic (R4)
  const rawTokens = raw.replace(/[؟?!.،,]+$/u, "").split(/\s+/).filter(Boolean);
  const has2fSubject = rawTokens.some((t) => t.replace(/[أإآٱ]/g, "ا") === "انتِ");

  // 1. exact phrasebook hit
  const phrase = phraseLookup(norm);
  if (phrase) return { ok: true, coptic: phrase, unknown: [], via: "phrase" };

  const unknown = [];
  // 2. question?
  let qword = "";
  let body = tokens;
  for (let i = 0; i < Math.min(2, tokens.length); i++) {
    if (QUESTION_WORDS[tokens[i]] !== undefined) {
      // "من" + noun is the preposition من ("from"), not the question "who" (R11)
      if (tokens[i] === "من") {
        const nxt = tokens[i + 1];
        if (nxt && !SUBJ_PRONOUNS[nxt] && !DEMONSTRATIVE[nxt] && !analyzeVerbToken(nxt) && parseNounToken(nxt, null)) {
          continue;
        }
      }
      qword = QUESTION_WORDS[tokens[i]]; body = tokens.slice(i + 1); break;
    }
  }

  // 3. negation (before the verb, or after a subject pronoun: "أنا لا أحب")
  let neg = null;
  let rest = [...body];
  if (SUBJ_PRONOUNS[rest[0]] && ["لا", "لم", "لن", "ما"].includes(rest[1])) {
    neg = rest[1]; rest = [rest[0], ...rest.slice(2)];
  }
  if (rest[0] === "لا" || rest[0] === "لم" || rest[0] === "لن" || rest[0] === "ما") {
    neg = rest[0]; rest = rest.slice(1);
  }
  // noun subject + negation: "بطرس لم يسمع" — pull the neg word out, keep the noun (R3)
  if (!neg && rest.length >= 3 && ["لا", "لم", "لن", "ما"].includes(rest[1]) && !SUBJ_PRONOUNS[rest[0]] && parseNounToken(rest[0], null) && analyzeVerbToken(rest[2])) {
    neg = rest[1]; rest = [rest[0], ...rest.slice(2)];
  }
  // يوجد / ليس
  if (rest[0] === "يوجد") {
    const np = parseNounToken(rest[1] ?? "", rest[2]);
    if (np) return { ok: true, coptic: `${neg ? "ⲙ̀ⲙⲟⲛ" : "ⲟⲩⲟⲛ"} ${np.text}`, unknown, via: "exists" };
  }
  if (rest[0] === "ليس") {
    const np = parseNounToken(rest[1] ?? "", rest[2]);
    if (np) return { ok: true, coptic: `ⲙ̀ⲙⲟⲛ ${np.text}`, unknown, via: "exists" };
  }
  // عندي/عندك/عنده + noun
  const haveMatch = /^عند(ي|كي|ك|ه|ها|نا|كم|هم)$/.exec(rest[0] ?? "");
  if (haveMatch) {
    const np = parseNounToken(rest[1] ?? "", rest[2]);
    if (np && HAVE_PREFIX[haveMatch[1]]) {
      return { ok: true, coptic: `${HAVE_PREFIX[haveMatch[1]]} ${np.text}`, unknown, via: "have" };
    }
  }

  // 4. imperative / prohibition (no subject, verb first)
  const impTok = rest[0] ?? "";
  if (!neg && IMPERATIVE_SPECIAL[impTok]) {
    const tail = buildTail(rest.slice(1), { f1: IMPERATIVE_SPECIAL[impTok] }, unknown);
    const verb = IMPERATIVE_SPECIAL[impTok];
    if (neg === "لا") return { ok: true, coptic: `ⲙ̀ⲡⲉⲣ${verb}${tail}`, unknown, via: "prohibition" };
    return { ok: true, coptic: `${verb}${tail}`, unknown, via: "imperative" };
  }
  // imperative + pronoun suffix: "أعطني" → ⲙⲟⲓ ⲛⲏⲓ (R16)
  if (!neg) {
    for (const suf of ["ني", "ك", "كي", "ه", "ها", "نا", "كم", "هم"]) {
      if (impTok.endsWith(suf) && impTok.length - suf.length >= 2) {
        const stemTok = impTok.slice(0, -suf.length);
        const imp = IMPERATIVE_SPECIAL[stemTok] ?? (stemTok.startsWith("ا") ? lookupVerbStem(stemTok.slice(1))?.f1 : null);
        if (imp) {
          const tail = buildTail(rest.slice(1), { f1: imp }, unknown);
          return { ok: true, coptic: `${imp} ${IMPERATIVE_PRONOUN[suf]}${tail}`, unknown, via: "imperative" };
        }
      }
    }
  }
  if (!neg && impTok.startsWith("ا") && impTok.length > 2) {
    // a definite noun is not an imperative: "الأم" is not "اعلم" (R13)
    const asNoun = parseNounToken(impTok, null);
    if (!asNoun?.definite) {
      const stem = impTok.slice(1);
      const v = lookupVerbStem(stem) ?? lookupVerbStem(stem + "ي");
      if (v && v.f1) {
        const tail = buildTail(rest.slice(1), v, unknown);
        if (neg === "لا") return { ok: true, coptic: `ⲙ̀ⲡⲉⲣ${v.f1}${tail}`, unknown, via: "prohibition" };
        return { ok: true, coptic: `${v.f1}${tail}`, unknown, via: "imperative" };
      }
    }
  }
  // prohibition with present 2nd person: "لا تتكلم" → ⲙ̀ⲡⲉⲣ + infinitive
  if (neg === "لا" && rest[0]) {
    const a = analyzeVerbToken(rest[0]);
    if (a && a.verb && (a.person === "2m" || a.person === "2f" || a.person === "2p")) {
      const tail = buildTail(rest.slice(1), a.verb, unknown);
      return { ok: true, coptic: `ⲙ̀ⲡⲉⲣ${a.verb.f1 ?? a.verb.f2 ?? ""}${tail}`, unknown, via: "prohibition" };
    }
  }

  // 5. subject: pronoun or noun?
  let person = null;
  let subjectText = null;
  let subjectGender = "m";
  let nounSubject = null;
  let i = 0;
  let subjectAmbiguous2 = false;
  if (SUBJ_PRONOUNS[rest[0]]) {
    if (rest[0] === "انت" && has2fSubject) {
      // "أنتِ" with kasra (R4)
      person = "2f";
      subjectText = SUBJ_PRONOUNS["انتي"].separate;
      subjectGender = "f";
    } else {
      person = SUBJ_PRONOUNS[rest[0]].person;
      subjectText = SUBJ_PRONOUNS[rest[0]].separate;
      subjectGender = person === "2f" || person === "3f" ? "f" : person === "3p" ? "pl" : "m";
      subjectAmbiguous2 = rest[0] === "انت";
    }
    i = 1;
  } else if (DEMONSTRATIVE[rest[0]] && rest[1] && analyzeVerbToken(rest[1])?.verb && !possessiveNounOf(rest[1])) {
    // demonstrative pronoun as subject: "هؤلاء يكتبون الدرس" → ⲛⲁⲓ + verb (R17/R18)
    const d = DEMONSTRATIVE[rest[0]];
    nounSubject = {
      text: d.pron,
      gender: rest[0] === "هولاء" || rest[0] === "اوليك" ? "pl" : rest[0] === "هذه" || rest[0] === "تلك" ? "f" : "m",
      definite: true, consumed: 0,
    };
    i = 1;
  } else {
    const ns = parseNounToken(rest[0] ?? "", null);
    const va = rest[1] ? analyzeVerbToken(rest[1]) : null;
    // A curated adjective as the last token is the predicate, not a verb
    // ("النور جميل" is nominal) — do not consume the noun as the subject here,
    // or the nominal branch misreads the tokens (it expects i at the subject).
    const isPredAdj = rest.length === 2 && rest[1] && CURATED_ADJ[adjKeyOf(rest[1])];
    if (ns && va && va.verb && !isPredAdj) { nounSubject = ns; i = 1; }
  }

  // 6. find the verb (first token from i that is a known verb)
  let verbInfo = null;
  let verbIdx = -1;
  for (let j = i; j < rest.length; j++) {
    // a definite noun is not a verb: "الأم" is not the verb "لام" (R13/R18).
    // Only ال-initial tokens: "كتبنا" also parses as noun+possessive ("our books")
    // but after a pronoun subject it is the 1p-past verb ("we wrote") — and a verb
    // never takes ال, so ال is the unambiguous nominal marker.
    const asNoun = rest[j].startsWith("ال") ? parseNounToken(rest[j], null) : null;
    if (asNoun?.definite) continue;
    const a = analyzeVerbToken(rest[j]);
    if (a && a.verb) {
      // A curated adjective in predicate position is not a verb: "النور جميل"
      // (the light is beautiful), "هو جميل" (he is beautiful). With a following
      // object it IS the verb ("الرجل صالح القوم" = the man reconciled the people).
      if (CURATED_ADJ[adjKeyOf(rest[j])] && j === rest.length - 1 && (nounSubject || person || parseNounToken(rest[j - 1] ?? "", null))) continue;
      // a noun+possessive is not a verb: "معلمتي" alone is "my (female) teacher",
      // not the 2f-past of معلم — but only with no subject and no following token
      // ("معلمتي الدرس" = "you [f] taught the lesson"), or when the verb's person
      // conflicts with an established subject ("هي معلمتي" is nominal). A matching
      // subject ("نحن كتبنا") keeps the verb.
      const possNoun = possessiveNounOf(rest[j]);
      const noSubjLast = !person && !nounSubject && j === rest.length - 1;
      const personConflict = !!person && a.person !== person && !(subjectAmbiguous2 && a.person === "2f");
      if (possNoun && (noSubjLast || personConflict)) continue;
      verbInfo = a; verbIdx = j; break;
    }
  }

  // Arabic VSO: verb-initial + noun + object → the noun is the subject (R28)
  let tailStart = verbIdx + 1;
  if (verbInfo && !nounSubject && !person && verbIdx === i && rest[verbIdx + 1]) {
    const candNoun = parseNounToken(rest[verbIdx + 1], null);
    if (candNoun && rest.length > verbIdx + 2) {
      nounSubject = candNoun;
      tailStart = verbIdx + 2;
    }
  }

  // 7. no verb → nominal sentence: subject + predicate + ⲡⲉ/ⲧⲉ/ⲛⲉ
  if (!verbInfo) {
    // lone demonstrative after a question word: "من هذا؟" → ⲛⲓⲙ ⲫⲁⲓ
    if (qword && rest.length === 1 && DEMONSTRATIVE[rest[0]]) {
      return { ok: true, coptic: `${qword} ${DEMONSTRATIVE[rest[0]].pron}`, unknown, via: "question-demonstrative" };
    }
    // demonstrative adjective + noun: "هذا الرجل" → ⲡⲁⲓⲣⲱⲙⲓ (R17)
    if (rest.length === 2 && DEMONSTRATIVE[rest[0]]) {
      const n = parseNounToken(rest[1], null);
      if (n) {
        const bare = cleanCoptic(n.text).replace(/^(ⲡⲓ|ϯ|ⲛⲓ|ⲟⲩ|ϩⲁⲛ|ⲫ̀|ⲑ̀)/, "");
        let text = `${DEMONSTRATIVE[rest[0]].adj}${bare}`;
        if (qword) text = `${qword} ${text}`;
        return { ok: true, coptic: text, unknown, via: "demonstrative-np" };
      }
    }
    // bare noun phrase alone ("كتابي", "الكتاب الجديد")
    if (rest.length <= 2 && !subjectText && !DEMONSTRATIVE[rest[0]]) {
      const np0 = parseNounToken(rest[0] ?? "", rest[1]);
      // "الكتاب الجديد" (definite + definite) and "رجل حكيم" (indefinite + indefinite) are
      // noun phrases; "الكنيسة جديدة" (definite noun + bare adjective) is a nominal sentence (R19)
      const adjAgrees = rest.length === 2 && np0 && np0.consumed === 1 && normalizeArabic(rest[1]).startsWith("ال") === np0.definite;
      if (np0 && (rest.length === 1 || adjAgrees)) {
        let text = np0.text;
        if (qword) {
          if (qword === "ⲟⲩⲏⲣ") {
            // كم + bare noun, no article (R24)
            const bare = cleanCoptic(text).replace(/^(ⲡⲓ|ϯ|ⲛⲓ|ⲟⲩ|ϩⲁⲛ|ⲫ̀|ⲑ̀)/, "");
            text = `ⲟⲩⲏⲣ ⲛ̀${bare}`;
          } else {
            text = `${qword} ${text}`;
          }
        }
        return { ok: true, coptic: text, unknown, via: "noun-phrase" };
      }
    }
    // bare prepositional phrase alone ("في الكنيسة")
    if (PREPOSITIONS[rest[0]] && rest[1]) {
      const np0 = parseNounToken(rest[1], rest[2]);
      if (np0) {
        let text = `${PREPOSITIONS[rest[0]]} ${np0.text}`;
        if (qword) text = `${qword} ${text}`;
        return { ok: true, coptic: text, unknown, via: "prep-phrase" };
      }
    }
    // genitive (إضافة): indefinite NP + definite NP → NP1 (definite article) + ⲛ̀/ⲙ̀ + NP2.
    // book 1: Noun + ⲛ̀ (ⲙ̀ before βμπφψ) + noun — "the book of Mark", "the feast of Christ".
    // The first noun never takes ال in Arabic, so a definite NP1 rules the genitive out;
    // a dictionary proper noun (kind "اسم علم", e.g. مرقس) is apposition, not a genitive.
    if (!neg && rest.length === 2 && !SUBJ_PRONOUNS[rest[0]] && !SUBJ_PRONOUNS[rest[1]]) {
      const g1 = parseNounToken(rest[0], null);
      const g2 = parseNounToken(rest[1], null);
      const g1Hits = lookupArabic(stripDefinite(rest[0]));
      const g1Proper = g1Hits?.some((h) => (h.kind || "").includes("علم"));
      if (g1 && g2 && !g1.definite && !g1Proper && g2.definite) {
        const bare1 = cleanCoptic(g1.text).replace(/^(ⲟⲩ|ϩⲁⲛ)/, "");
        const first1 = definiteArticle(g1.gender, bare1);
        const link = objectMarker(g2.text) === "ⲙ̀" ? "ⲙ̀" : "ⲛ̀";
        let out = `${first1} ${link}${g2.text}`;
        if (qword) out = `${qword} ${out}`;
        return { ok: true, coptic: out, unknown, via: "genitive" };
      }
    }
    // conjunction و joining noun phrases (standalone or attached):
    // "أخي و أختي" / "أخي وأختي" → ⲡⲁⲥⲟⲛ ⲟⲩⲟϩ ⲧⲁⲥⲱⲛⲓ
    if (!neg) {
      const groups = [[]];
      let foundConj = false;
      for (const tok of rest) {
        if (tok === "و") { groups.push([]); foundConj = true; continue; }
        if (tok.startsWith("و") && tok.length > 2 && !lookupNoun(tok)) {
          const rem = tok.slice(1);
          if (!analyzeVerbToken(rem) && parseNounToken(rem, null)) { groups.push([rem]); foundConj = true; continue; }
        }
        groups[groups.length - 1].push(tok);
      }
      if (foundConj && groups.length >= 2 && groups.every((g) => g.length === 1)) {
        const texts = groups.map((g) => {
          const t = g[0];
          if (SUBJ_PRONOUNS[t]) return SUBJ_PRONOUNS[t].separate;
          const np = parseNounToken(t, null);
          return np ? np.text : null;
        });
        if (texts.every(Boolean)) {
          let out = texts.join(" ⲟⲩⲟϩ ");
          if (qword) out = `${qword} ${out}`;
          return { ok: true, coptic: out, unknown, via: "conjunction-np" };
        }
      }
    }
    const subjTok = rest[i];
    const predTok = rest[i + 1];
    let subj = nounSubject
      ? { text: nounSubject.text, gender: nounSubject.gender }
      : subjectText
      ? { text: subjectText, gender: subjectGender }
      : subjTok && DEMONSTRATIVE[subjTok]
        ? { text: DEMONSTRATIVE[subjTok].pron, gender: subjTok === "هذه" || subjTok === "تلك" ? "f" : subjTok === "هولاء" || subjTok === "اوليك" ? "pl" : "m" }
        : subjTok ? parseNounToken(subjTok, null) : null;
    if (!subj && subjTok && DEMONSTRATIVE[subjTok]) {
      subj = { text: DEMONSTRATIVE[subjTok].pron, gender: subjTok === "هذه" || subjTok === "تلك" ? "f" : subjTok === "هولاء" || subjTok === "اوليك" ? "pl" : "m" };
    }
    // locative: subject already consumed + PP ("أنا في الكنيسة", "الرجل في الكنيسة")
    if (subj && (subjectText || nounSubject) && subjTok && PREPOSITIONS[subjTok]) {
      const np0 = parseNounToken(rest[i + 1] ?? "", rest[i + 2]);
      if (np0) {
        let out = `${subj.text} ${PREPOSITIONS[subjTok]} ${np0.text}`;
        if (qword) out = `${qword} ${out}`;
        return { ok: true, coptic: out, unknown, via: "locative" };
      }
    }
    // locative: subject + PP ("أنا في الكنيسة")
    if (subj && predTok && PREPOSITIONS[predTok]) {
      const np0 = parseNounToken(rest[i + 2] ?? "", rest[i + 3]);
      if (np0) {
        let out = `${subj.text} ${PREPOSITIONS[predTok]} ${np0.text}`;
        if (qword) out = `${qword} ${out}`;
        return { ok: true, coptic: out, unknown, via: "locative" };
      }
    }
    // predicate position: try the adjective FIRST ("جديدة" is an adjective, not "جديد + ـه").
    // Predicate adjectives keep the masculine (citation) form: "الكنيسة جديدة" → ⲟⲩⲃⲉⲣⲓ.
    let pred = null;
    let copulaFirst = false;
    // pronoun subject + noun + adjective: the predicate is the noun+adj phrase (R22)
    if (subjectText && subjTok && predTok) {
      const subjNoun = parseNounToken(subjTok, null);
      if (subjNoun && CURATED_ADJ[adjKeyOf(predTok)]) {
        pred = parseNounToken(subjTok, predTok);
      }
    }
    if (!pred && predTok) {
      const adj0 = CURATED_ADJ[adjKeyOf(predTok)];
      if (adj0) pred = { text: `ⲟⲩ${adj0.m}`, gender: subj ? subj.gender : "m" };
    }
    if (!pred) pred = predTok ? parseNounToken(predTok, rest[i + 2]) : null;
    // subject already consumed ("أنا بطرس"): the remaining token IS the predicate
    if (!pred && subjectText && subjTok && !predTok) {
      pred = parseNounToken(subjTok, null);
      if (!pred) {
        const adj = CURATED_ADJ[adjKeyOf(subjTok)];
        if (adj) pred = { text: `ⲟⲩ${adj.m}`, gender: subj ? subj.gender : "m" };
      }
    }
    if (!pred && predTok) {
      const adj = CURATED_ADJ[adjKeyOf(predTok)];
      if (adj) pred = { text: `ⲟⲩ${adj.m}`, gender: subj ? subj.gender : "m" };
    }
    // "الله ليس محبة" — ليس between subject and predicate is a nominal negation (R23)
    if (!pred && !neg && predTok === "ليس" && rest[i + 2]) {
      pred = parseNounToken(rest[i + 2], rest[i + 3]);
      if (pred) neg = true;
    }
    // "هذا هو الرجل" — هو/هي between subject and predicate is a copula pronoun (R18)
    if (!pred && !neg && predTok && SUBJ_PRONOUNS[predTok] && rest[i + 2]) {
      pred = parseNounToken(rest[i + 2], rest[i + 3]);
      if (pred) copulaFirst = true;
    }
    // lone demonstrative after a question word: "من هذا؟" → ⲛⲓⲙ ⲫⲁⲓ
    // (must not fire when the remaining token became the predicate: "هل أنت بطرس؟")
    if (subj && !predTok && !pred && qword) {
      return { ok: true, coptic: `${qword} ${subj.text}`, unknown, via: "question-demonstrative" };
    }
    if (subj && pred) {
      const copula = subj.gender === "f" ? "ⲧⲉ" : subj.gender === "pl" ? "ⲛⲉ" : "ⲡⲉ";
      let out;
      // identification after a question word ("هل أنت بطرس؟" → ⲛ̀ⲑⲟⲕ ⲡⲉ Ⲡⲉⲧⲣⲟⲥ, R27):
      // pronoun subject + definite predicate takes the copula between subject and predicate
      if (copulaFirst || (qword && subjectText && pred.definite)) out = `${subj.text} ${copula} ${pred.text}`;
      else if (neg) out = `${subj.text} ${pred.text} ⲁⲛ ${copula}`;
      else out = `${subj.text} ${pred.text} ${copula}`;
      if (qword) out = `${qword} ${out}`;
      return { ok: true, coptic: out, unknown, via: "nominal" };
    }
    if (subjTok && !subj) unknown.push(subjTok);
    if (predTok && !pred) unknown.push(predTok);
    return { ok: true, coptic: null, unknown, via: "unknown" };
  }

  // 8. verbal sentence
  if (!person) person = verbInfo.person;
  else if (subjectAmbiguous2 && person === "2m" && verbInfo.person === "2f") person = "2f"; // the verb disambiguates أنت (R4)
  const tense = neg === "لم" ? "past" : neg === "لن" ? "future" : verbInfo.tense;
  const verb = verbInfo.verb;
  const form = verb.f1 ?? verb.f2 ?? verb.f3 ?? null;
  if (!form) return { ok: false, error: "الفعل ده مش في القاموس بصيغة مناسبة." };

  let verbPart;
  if (nounSubject) {
    // noun subject: present → noun + verb; past → ⲁ + noun + verb; future → noun + ⲛⲁ + verb
    if (neg === "لم") verbPart = `ⲙ̀ⲡⲉ ${nounSubject.text} ${form}`;
    else if (neg === "لن") verbPart = `${nounSubject.text} ⲛⲁ${form}`;
    else if (tense === "past") verbPart = `ⲁ ${nounSubject.text} ${form}`;
    else if (tense === "future") verbPart = `${nounSubject.text} ⲛⲁ${form}`;
    else verbPart = `${nounSubject.text} ${form}`;
  } else if (neg === "لم") {
    verbPart = `${PAST_NEG_PREFIX[person]}${form}`;
  } else if (neg === "لن") {
    // لن → future + ⲁⲛ (book 1 §14), not the old ⲛ̀ⲛⲁ- forms (R2)
    verbPart = `${tensePrefix("future", person, form)}${form}`;
  } else {
    verbPart = `${tensePrefix(tense, person, form)}${form}`;
  }

  const after = rest.slice(tailStart);
  const tail = buildTail(after, verb, unknown);
  let out = `${verbPart}${tail}`;
  if (neg === "لا" || neg === "لن") out += " ⲁⲛ";
  if (qword) {
    if (!nounSubject) {
      // question word + verb → ⲉⲧⲉ- before the verb (§25); past → ⲉⲧⲁ- (R26)
      if (neg === "لم") out = `${qword} ⲉⲧⲉ${out}`;
      else if (tense === "past") out = `${qword} ⲉⲧⲁ${out.slice(1)}`;
      else out = `${qword} ⲉⲧⲉ${out}`;
    } else {
      out = `${qword} ${out}`;
    }
  }
  return { ok: true, coptic: out, unknown, via: nounSubject ? "verbal-noun-subj" : "verbal" };
}

// tail builder for noun-subject sentences (object + PPs after verb)
// tail builder for noun-subject sentences (object + PPs after verb)
function buildTail(after, verb, unknown) {
  const parts = [];
  let k = 0;
  while (k < after.length) {
    const tok = after[k];
    if (tok === "و") {
      // standalone conjunction joining two objects: "أحب الله و أخي"
      const nxt = parseNounToken(after[k + 1] ?? "", after[k + 2]);
      if (nxt && !analyzeVerbToken(after[k + 1] ?? "")) { parts.push("ⲟⲩⲟϩ"); k += 1; continue; }
      unknown.push(tok); k += 1; continue;
    }
    if (PREPOSITIONS[tok]) {
      const np = parseNounToken(after[k + 1] ?? "", after[k + 2]);
      if (np) { parts.push(`${PREPOSITIONS[tok]} ${np.text}`); k += 2 + (np.consumed || 0); continue; }
      unknown.push(tok); k += 1; continue;
    }
    const np = parseNounToken(tok, after[k + 1]);
    if (np) {
      // object marker from the article: ⲡⲓ/ⲫ̀ → ⲙ̀, ϯ/ⲑ̀/ⲛⲓ → ⲛ̀; else stem-based (R1)
      const t = cleanCoptic(np.text);
      let marker;
      if (t.startsWith("ⲡⲓ") || t.startsWith("ⲫ̀")) marker = "ⲙ̀";
      else if (t.startsWith("ϯ") || t.startsWith("ⲑ̀") || t.startsWith("ⲛⲓ")) marker = "ⲛ̀";
      else marker = objectMarker(t.replace(/^(ⲟⲩ|ϩⲁⲛ)/, "").charAt(0) || "ⲁ");
      if (verb.f2 && !verb.f1) parts.push(np.text);
      else if (verb.f1 === "ⲛⲁⲩ") {
        // ⲛⲁⲩ takes ⲉ̀; before an indefinite article it attaches as ⲉ (R29)
        if (t.startsWith("ⲟⲩ") || t.startsWith("ϩⲁⲛ")) parts.push(`ⲉ${np.text}`);
        else if (np.accusative) {
          const bare = t.replace(/^(ⲡⲓ|ϯ|ⲛⲓ)/, "");
          parts.push(`ⲉ${np.gender === "pl" ? "ϩⲁⲛ" : "ⲟⲩ"}${bare}`);
        }
        else parts.push(`ⲉ̀ ${np.text}`);
      }
      else parts.push(`${marker} ${np.text}`);
      k += 1 + (np.consumed || 0);
      continue;
    }
    unknown.push(tok);
    k += 1;
  }
  return parts.length ? " " + parts.join(" ") : "";
}

// ---------- Foreign-language input (EN/FR/DE) ----------
// Gloss foreign → Arabic, then run the existing Arabic engine. Only the ARABIC
// word of a foreign word is ever taken from the reverse index — never its Coptic
// form — so the Arabic-side curation (كتاب→ϫⲱⲱⲙ, صديق→ϣ̀ⲫⲉⲣ, عالم→ⲕⲟⲥⲙⲟⲥ…)
// applies unchanged, and the gender always comes from the Arabic record's kind.
// A foreign word that resolves in no index is reported unknown, never guessed
// (same honesty rule as the Arabic side).
//
// Data (verified live 27 Nov 06:45 EET): english / translation_fr / translation_de
// each 16,726 non-empty of 16,764 records; 32 records have `meaning: undefined`
// and 38 have an empty field per language — both are guarded (no field → skipped;
// an entry whose Arabic word is empty is never picked). Index key counts (live):
// EN 13,510, FR 12,699, DE 16,055.

const FOREIGN_FIELD = { en: "english", fr: "translation_fr", de: "translation_de" };
let FOREIGN_INDEX = null;
function buildForeignIndex(lang) {
  if (FOREIGN_INDEX?.[lang]) return FOREIGN_INDEX[lang];
  const field = FOREIGN_FIELD[lang];
  const byWord = new Map();
  records.forEach((r, fi) => {
    const val = r[field];
    if (!val || typeof val !== "string") return;
    const coptic = cleanCoptic(r.coptic ?? "").split(" ")[0].replace(/-$/, "");
    if (!coptic) return;
    // the Arabic word: first word of the first meaning segment (normalized).
    // Empty when `meaning` is undefined — such an entry is never picked.
    const ar = normalizeArabic((r.meaning ?? "").split("،")[0].split(",")[0]).split(" ")[0] || "";
    const entry = { coptic, kind: r.kind ?? "", ar };
    val.split(/[،,]/).forEach((part, vp) => {
      const w = part.trim().split(/\s+/)[0]?.replace(/^[("']+|[)"'.,;:!?]+$/g, "").toLowerCase();
      if (!w || w.length < 2) return;
      if (!byWord.has(w)) byWord.set(w, []);
      byWord.get(w).push({ ...entry, pos: vp, fi });
    });
  });
  // priority: the value's POSITION in the field list beats file order (the same
  // "first segment only" discipline as the Arabic index). Without it, "book"
  // resolves to رؤيا (a later value of the revelation record) instead of كتاب,
  // and "world" to أرض instead of عالم.
  const idx = new Map();
  for (const [w, es] of byWord) {
    es.sort((a, b) => (a.pos - b.pos) || (a.fi - b.fi));
    idx.set(w, es);
  }
  FOREIGN_INDEX = { ...(FOREIGN_INDEX ?? {}), [lang]: idx };
  return idx;
}
export function foreignLookup(lang, word) {
  return buildForeignIndex(lang).get(String(word ?? "").toLowerCase()) ?? null;
}
// First entry of the wanted kind whose Arabic word the engine accepts.
// Verb entries are validated as verb stems (lookupVerbStem), noun entries as
// nouns (lookupNoun) — a later-value sense that is not a verb/noun (e.g. the
// "loved" → محبوب beloved entry, the DE "liebe" → حبيب entry) is skipped, and
// the stemmer then gets its turn.
function foreignVerbArabic(lang, word) {
  const es = foreignLookup(lang, word);
  if (!es) return null;
  for (const e of es) {
    if (!e.kind.startsWith("فعل") || !e.ar) continue;
    // Gendered فعل kinds ("فعل مذكر", "فعل مؤنث", "فعل مذكر ومؤنث", "فعل جمع")
    // are participles/adjectives, not finite verbs — only 28 records, e.g. the
    // DE "liebe" entry whose Arabic is حبيب (a noun, "beloved") and whose Coptic
    // is the f3 form ⲙⲉⲛⲣⲓⲧ. Skipping them lets the stemmer fall through to the
    // infinitive ("lieben" → أحب). Genuine verbs are kind "فعل" (5,033) or
    // "فعل، صيغة…" — "فعل أمر" (imperative) is kept.
    if (/^فعل (مذكر|مؤنث|جمع)/.test(e.kind)) continue;
    if (lookupVerbStem(e.ar)) return e.ar;
  }
  return null;
}
function foreignNounArabic(lang, word) {
  const w0 = String(word ?? "").toLowerCase();
  if (FOREIGN_LANG[lang].func.has(w0)) return null;
  if (FOREIGN_CURATED[lang]?.[w0]) return FOREIGN_CURATED[lang][w0];
  const es = foreignLookup(lang, word);
  if (!es) return null;
  for (const e of es) {
    if (!e.kind.includes("اسم") || !e.ar) continue;
    if (lookupNoun(e.ar)) return e.ar;
  }
  return null;
}

// Curated foreign → Arabic overrides (noun position only — the index's best sense
// is wrong for these, verified by probe 27 Nov). The verb position never uses
// this map: "light" as a verb is أشعل, not نور.
const FOREIGN_CURATED = {
  en: { friend: "صديق", father: "أب", mother: "أم", student: "تلميذ", water: "ماء", light: "نور" },
  fr: { monde: "عالم", "lumière": "نور", "père": "أب", "mère": "أم", professeur: "معلم", ami: "صديق" },
  de: { licht: "نور", freund: "صديق", vater: "أب", mutter: "أم" },
};
// Curated foreign → Arabic adjectives (all land in CURATED_ADJ — the engine only
// accepts adjectives from that table, so an adjective outside it is unknown).

const FOREIGN_ADJ = {
  en: { new: "جديد", old: "قديم", big: "كبير", small: "صغير", good: "صالح", holy: "مقدس", beautiful: "جميل", long: "طويل", short: "قصير", great: "عظيم", wise: "حكيم", true: "صادق", pure: "طاهر", living: "حي", dead: "ميت" },
  fr: { nouveau: "جديد", nouvelle: "جديد", vieux: "قديم", vieille: "قديم", grand: "كبير", grande: "كبير", petit: "صغير", petite: "صغير", bon: "صالح", bonne: "صالح", saint: "مقدس", sainte: "مقدس", beau: "جميل", belle: "جميل", long: "طويل", longue: "طويل", court: "قصير", courte: "قصير", sage: "حكيم", vrai: "صادق", vraie: "صادق", pur: "طاهر", pure: "طاهر", vivant: "حي", vivante: "حي", mort: "ميت", morte: "ميت" },
  de: { neu: "جديد", neue: "جديد", neues: "جديد", alt: "قديم", alte: "قديم", "groß": "كبير", "große": "كبير", klein: "صغير", kleine: "صغير", gut: "صالح", gute: "صالح", heilig: "مقدس", heilige: "مقدس", "schön": "جميل", "schöne": "جميل", lang: "طويل", lange: "طويل", kurz: "قصير", kurze: "قصير", weise: "حكيم", wahr: "صادق", wahre: "صادق", rein: "طاهر", reine: "طاهر", lebend: "حي", lebendig: "حي", tot: "ميت", tote: "ميت" },
};

// Broken Arabic plurals the engine already knows (the plural Coptic comes from
// the engine, so the gloss only needs the Arabic plural word).
const ARABIC_BROKEN_PLURALS = normalizeKeys({
  "كتاب": "كتب", "صديق": "أصدقاء", "أخ": "إخوة", "أخت": "أخوات", "رجل": "رجال",
  "امرأة": "نساء", "ولد": "أولاد", "بنت": "بنات", "يوم": "أيام", "بيت": "بيوت",
  "درس": "دروس", "كلمة": "كلمات", "نور": "أنوار", "عالم": "عوالم",
  "تلميذ": "تلاميذ", "طالب": "طلاب", "كاهن": "كهنة", "مدرسة": "مدارس",
  "كنيسة": "كنائس", "شجرة": "أشجار", "حجر": "أحجار", "طريق": "طرق",
});
function pluralizeArabicNoun(arNoun) {
  const s = normalizeArabic(arNoun);
  if (NON_PLURAL.has(s)) return s; // a name must never pluralize (رحمن، شعبان…)
  if (ARABIC_BROKEN_PLURALS[s]) return ARABIC_BROKEN_PLURALS[s];
  // Sound plural: the engine strips ون/ين/ات and applies the plural article, so
  // a (internally) regular plural always yields the right Coptic plural — the
  // gloss is never shown to the user, only its Coptic output is.
  if (s.endsWith("ة")) return s.replace(/ة$/, "") + "ات";
  return s + "ون";
}

// Past stem → present stem for hollow verbs (inverse of HOLLOW_PRESENT).
const HOLLOW_PAST_TO_PRESENT = Object.fromEntries(Object.entries(HOLLOW_PRESENT).map(([pres, past]) => [past, pres]));
// Doubled (geminate) verb stems: the 1s/2m/2f/1p/2p past doubles the final
// radical (أحب → أحببت، رد → رددت). The engine accepts the doubled form via
// its geminate rule, and the undoubled form too when a subject is present.
const GEMINATE_VERBS = new Set(["احب", "رد", "مد", "شد", "عد", "ضر", "سر", "مر", "فر", "قر", "حر", "بر", "جر", "شر", "صد", "عز", "هز", "مل", "حل", "دل", "ود", "جد"].map(normalizeArabic));
// Inflect an Arabic verb stem (past stem, e.g. كتب/أحب/قال) for the engine.
// Present keeps the full stem after the prefix ("يأحب" is ungrammatical Arabic
// but the engine resolves it via the direct stem lookup — the Coptic is right).
function inflectArabicVerb(stem, tense, person) {
  const s = normalizeArabic(stem);
  if (tense === "past") {
    const gem = GEMINATE_VERBS.has(s);
    const d = gem ? s + s.slice(-1) : s;
    switch (person) {
      case "1s": case "2m": return d + "ت";
      case "2f": return d + "تي";
      case "1p": return d + "نا";
      case "2p": return d + "تم";
      case "3m": return s;
      case "3f": return s + "ت";
      case "3p": return s + "وا";
      default: return s;
    }
  }
  const pres = HOLLOW_PAST_TO_PRESENT[s] ?? s;
  const pre = { "1s": "أ", "2m": "ت", "2f": "ت", "3m": "ي", "3f": "ت", "1p": "ن", "2p": "ت", "3p": "ي" }[person] ?? "ي";
  const suf = { "2f": "ين", "2p": "ون", "3p": "ون" }[person] ?? "";
  const form = pre + pres + suf;
  return tense === "future" ? "س" + form : form;
}

// ---------- Per-language grammar tables ----------
// Pronouns → person (the Arabic pronoun is emitted from AR_PRONOUN). Articles
// are definite vs indefinite only — the gender comes from the Arabic noun.
// Possessives → the Arabic suffix (FR son/sa/ses agree with the POSSESSED noun,
// not the possessor, so they default to "ه" — his — the common case).
const AR_PRONOUN = { "1s": "أنا", "2m": "أنت", "2f": "أنت", "3m": "هو", "3f": "هي", "1p": "نحن", "2p": "أنتم", "3p": "هم" };
const FOREIGN_LANG = {
  en: {
    pronouns: { i: "1s", you: "2m", he: "3m", she: "3f", it: "3m", we: "1p", they: "3p" },
    defArt: new Set(["the"]), indefArt: new Set(["a", "an"]),
    possessive: { my: "ي", your: "ك", his: "ه", her: "ها", our: "نا", their: "هم" },
    preps: { in: "في", to: "إلى", from: "من", with: "مع", on: "على", after: "بعد", before: "قبل", about: "عن", between: "بين", against: "ضد", without: "بدون", at: "عند", above: "فوق", under: "تحت", over: "فوق", behind: "خلف", beside: "بجانب", through: "خلال", into: "إلى", of: "عن" },
    questions: { who: "من", what: "ماذا", where: "أين", when: "متى", why: "لماذا", how: "كيف", which: "ماذا", whose: "من" },
    conj: "and", genitive: "of",
    be: new Set(["am", "is", "are", "was", "were", "be", "been"]),
    have: new Set(["have", "has", "had"]),
    futureAux: new Set(["will", "shall", "would"]),
    progAux: { am: "present", is: "present", are: "present", was: "past", were: "past" },
    dummyAux: { do: "present", does: "present", did: "past" },
    neg: new Set(["not", "never"]),
  },
  fr: {
    pronouns: { je: "1s", tu: "2m", il: "3m", elle: "3f", on: "3m", nous: "1p", vous: "2p", ils: "3p", elles: "3p" },
    defArt: new Set(["le", "la", "les"]),
    indefArt: new Set(["un", "une", "des", "du"]),
    possessive: { mon: "ي", ma: "ي", mes: "ي", ton: "ك", ta: "ك", tes: "ك", son: "ه", sa: "ه", ses: "ه", notre: "نا", nos: "نا", votre: "كم", vos: "كم", leur: "هم", leurs: "هم" },
    preps: { dans: "في", "à": "إلى", de: "عن", avec: "مع", sur: "على", "après": "بعد", avant: "قبل", entre: "بين", contre: "ضد", sans: "بدون", chez: "عند", en: "في", au: "إلى", aux: "إلى" },
    questions: { qui: "من", quoi: "ماذا", que: "ماذا", quel: "ماذا", quelle: "ماذا", quels: "ماذا", quelles: "ماذا", "où": "أين", ou: "أين", quand: "متى", pourquoi: "لماذا", comment: "كيف" },
    conj: "et",
    // "de" is the genitive marker after a noun phrase; "du"/"des" are the same
    // with the article fused. In the article position "du"/"des" are partitive
    // (indefinite) — see glossNP.
    genitive: new Set(["de", "du", "des"]),
    be: new Set(["suis", "es", "est", "sommes", "êtes", "sont", "être", "été"]),
    have: new Set(["ai", "as", "a", "avons", "avez", "ont", "avoir", "eu"]),
    goAux: new Set(["vais", "vas", "va", "allons", "allez", "vont", "aller"]),
    neg: new Set(["ne", "pas", "jamais", "plus", "non"]),
  },
  de: {
    pronouns: { ich: "1s", du: "2m", er: "3m", sie: "3f", es: "3m", wir: "1p", ihr: "2p", man: "3m" },
    defArt: new Set(["der", "die", "das", "den", "dem"]),
    indefArt: new Set(["ein", "eine", "einen", "einem", "einer", "eines"]),
    possessive: { mein: "ي", meine: "ي", meinen: "ي", meinem: "ي", meiner: "ي", dein: "ك", deine: "ك", deinen: "ك", deinem: "ك", deiner: "ك", sein: "ه", seine: "ه", seinen: "ه", seinem: "ه", seiner: "ه", unser: "نا", unsere: "نا", unseren: "نا", unserem: "نا", euer: "كم", eure: "كم", euren: "كم", eurem: "كم", eurer: "كم", ihr: "هم", ihre: "هم", ihren: "هم", ihrem: "هم", ihrer: "هم" },
    preps: { in: "في", zu: "إلى", von: "من", mit: "مع", auf: "على", nach: "بعد", vor: "قبل", "über": "فوق", unter: "تحت", zwischen: "بين", gegen: "ضد", ohne: "بدون", bei: "عند", hinter: "خلف", neben: "بجانب", durch: "خلال", an: "على", aus: "من", bis: "حتى", seit: "منذ", "für": "ل" },
    questions: { wer: "من", was: "ماذا", wo: "أين", wann: "متى", warum: "لماذا", wie: "كيف", welcher: "ماذا", welche: "ماذا", welches: "ماذا", welchen: "ماذا", wessen: "من" },
    conj: "und",
    // DE has no "of": the genitive is a bare article (der/die/das/des) after the
    // noun phrase, and it is ambiguous with the dative — see glossNP.
    genitiveArt: new Set(["der", "die", "das", "des", "den", "dem"]),
    be: new Set(["bin", "bist", "ist", "sind", "seid", "sein", "gewesen"]),
    have: new Set(["habe", "hast", "hat", "haben", "habt", "gehabt"]),
    becomeAux: new Set(["werde", "wirst", "wird", "werden", "werdet"]),
    neg: new Set(["nicht", "nie", "niemals"]),
  },
};
// Function words per language, for detection (a distinctive word decides; ties
// go to EN, then FR, then DE — the same order as the lookup-coverage fallback).
const EN_FUNC = new Set(["i", "you", "he", "she", "we", "they", "it", "the", "a", "an", "my", "your", "his", "her", "our", "their", "is", "are", "was", "were", "will", "would", "do", "does", "did", "have", "has", "had", "not", "and", "in", "to", "from", "with", "on", "after", "before", "who", "what", "where", "when", "why", "how", "this", "that", "these", "those", "of", "for", "by", "at", "as", "but", "or", "so", "if", "am", "be", "been", "there"]);
const FR_FUNC = new Set(["je", "tu", "il", "elle", "nous", "vous", "ils", "elles", "on", "le", "la", "les", "un", "une", "des", "du", "de", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "notre", "votre", "leur", "est", "sont", "suis", "es", "sommes", "êtes", "ai", "as", "a", "avons", "avez", "ont", "et", "dans", "à", "avec", "sur", "après", "avant", "qui", "quoi", "où", "quand", "pourquoi", "comment", "ce", "cette", "ces", "ne", "pas", "plus", "très", "y", "en"]);
const DE_FUNC = new Set(["ich", "du", "er", "sie", "wir", "ihr", "es", "man", "der", "die", "das", "ein", "eine", "einen", "einem", "einer", "mein", "dein", "sein", "unser", "euer", "ist", "sind", "bin", "bist", "seid", "habe", "hast", "hat", "haben", "habt", "und", "in", "zu", "von", "mit", "auf", "nach", "vor", "wer", "was", "wo", "wann", "warum", "wie", "dieser", "diese", "dieses", "nicht", "kein", "auch", "sehr", "den", "dem", "wird", "werden"]);

// ---------- Verb form resolution (word → {ar, tense, inf}) ----------
// Each stemmer tries candidates and validates them against the foreign index
// (foreignVerbArabic), so a wrong candidate simply does not validate.
const EN_IRREG_PAST = { wrote: "write", saw: "see", went: "go", came: "come", said: "say", did: "do", took: "take", gave: "give", ate: "eat", drank: "drink", knew: "know", found: "find", made: "make", thought: "think", brought: "bring", bought: "buy", caught: "catch", taught: "teach", spoke: "speak", read: "read", heard: "hear", kept: "keep", left: "leave", met: "meet", paid: "pay", ran: "run", sat: "sit", slept: "sleep", stood: "stand", understood: "understand", won: "win", lost: "lose", began: "begin", broke: "break", chose: "choose", drove: "drive", fell: "fall", flew: "fly", forgot: "forget", got: "get", grew: "grow", hid: "hide", led: "lead", lent: "lend", rode: "ride", rang: "ring", rose: "rise", sang: "sing", sent: "send", shook: "shake", shut: "shut", sold: "sell", spent: "spend", swam: "swim", threw: "throw", wore: "wear", built: "build", cut: "cut", hit: "hit", put: "put", set: "set", cost: "cost", hurt: "hurt", let: "let", fed: "feed", felt: "feel", held: "hold", laid: "lay", lay: "lie", lit: "light", meant: "mean", told: "tell", woke: "wake", swore: "swear", swept: "sweep", wept: "weep", dealt: "deal", dreamt: "dream", bent: "bend" };
const EN_IRREG_PART = { written: "write", seen: "see", gone: "go", come: "come", said: "say", done: "do", taken: "take", given: "give", eaten: "eat", drunk: "drink", known: "know", found: "find", made: "make", thought: "think", brought: "bring", bought: "buy", caught: "catch", taught: "teach", spoken: "speak", read: "read", heard: "hear", kept: "keep", left: "leave", met: "meet", paid: "pay", run: "run", sat: "sit", slept: "sleep", stood: "stand", understood: "understand", won: "win", lost: "lose", begun: "begin", broken: "break", chosen: "choose", driven: "drive", fallen: "fall", flown: "fly", forgotten: "forget", got: "get", gotten: "get", grown: "grow", hidden: "hide", led: "lead", lent: "lend", ridden: "ride", rung: "ring", risen: "rise", sung: "sing", sent: "send", shaken: "shake", shut: "shut", sold: "sell", spent: "spend", swum: "swim", thrown: "throw", worn: "wear", built: "build", cut: "cut", hit: "hit", put: "put", set: "set", cost: "cost", hurt: "hurt", let: "let", fed: "feed", felt: "feel", held: "hold", laid: "lay", lain: "lie", lit: "light", meant: "mean", told: "tell", woken: "wake", sworn: "swear", swept: "sweep", wept: "weep", dealt: "deal", dreamt: "dream", bent: "bend" };
// Function words per language: the union of every function-word class in the
// table (pronouns, possessives, articles, prepositions, conjunctions, question
// words, auxiliaries, existential/negation words). A function word must never
// resolve as a verb, noun or adjective — the dictionary contains stray records
// whose English/French/German gloss starts with one ("the" → a verb record,
// "and" → "اشتغل", "la" → "أمطر", "der" → adjective "عظيم").
for (const L of Object.values(FOREIGN_LANG)) {
  const f = new Set();
  // The table mixes shapes: objects (pronouns/possessive/questions/preps/aux),
  // Sets (articles/be/have/futureAux/genitive FR/genitiveArt DE), and bare
  // strings (conj EN "and"/FR "et"/DE "und", genitive EN "of").
  const addKeys = (o) => { if (o && typeof o === "object" && !(o instanceof Set)) for (const k of Object.keys(o)) f.add(k); };
  const addSet = (v) => { if (v instanceof Set) for (const w of v) f.add(w); };
  const addVal = (v) => { if (typeof v === "string") f.add(v); };
  addKeys(L.pronouns); addKeys(L.possessive); addKeys(L.questions); addKeys(L.preps);
  addKeys(L.dummyAux); addKeys(L.progAux); addKeys(L.goAux);
  addSet(L.defArt); addSet(L.indefArt); addSet(L.be); addSet(L.have); addSet(L.futureAux); addSet(L.becomeAux);
  addSet(L.genitive); addSet(L.genitiveArt); addVal(L.genitive); addVal(L.conj);
  for (const w of ["there", "il", "y", "a", "es", "gibt", "est", "ce", "que", "ne", "pas", "nicht", "kein", "keine", "no", "not", "will", "would", "can", "could", "shall", "should", "may", "might", "must", "do", "does", "did", "am", "is", "are", "was", "were", "been", "being", "have", "has", "had", "avoir", "être", "aller", "sein", "haben", "werden", "bin", "bist", "ist", "sind", "seid", "war", "waren", "habe", "hast", "hat", "haben", "hatte", "wird", "wirst", "werde", "werden", "worden", "gewesen", "gehabt"]) f.add(w);
  L.func = f;
}
// A foreign word resolves as a noun if it is curated, indexed as a noun, or
// its singular is (used so a preposed adjective is only read when the token is
// NOT a noun — "light" in "the light of the world" is the noun نور, not the
// adjective جميل).
function resolvesAsNoun(lang, w) {
  if (!w) return false;
  if (FOREIGN_CURATED[lang]?.[w]) return true;
  if (foreignNounArabic(lang, w)) return true;
  for (const sing of singularCandidates(lang, w)) {
    if (FOREIGN_CURATED[lang]?.[sing] || foreignNounArabic(lang, sing)) return true;
  }
  return false;
}


function enVerbForm(word) {
  const w = String(word ?? "").toLowerCase();
  if (FOREIGN_LANG.en.func.has(w)) return null;
  const direct = foreignVerbArabic("en", w);
  if (direct) return { ar: direct, tense: "present", inf: w };
  if (EN_IRREG_PAST[w]) { const ar = foreignVerbArabic("en", EN_IRREG_PAST[w]); if (ar) return { ar, tense: "past", inf: EN_IRREG_PAST[w] }; }
  if (EN_IRREG_PART[w]) { const ar = foreignVerbArabic("en", EN_IRREG_PART[w]); if (ar) return { ar, tense: "participle", inf: EN_IRREG_PART[w] }; }
  if (w.endsWith("ed") && w.length > 3) {
    for (const c of [w.slice(0, -2), w.slice(0, -1), w.slice(0, -3) + "y", w.slice(0, -3)]) {
      const ar = foreignVerbArabic("en", c);
      if (ar) return { ar, tense: "past", inf: c };
    }
  }
  if (w.endsWith("ing") && w.length > 4) {
    for (const c of [w.slice(0, -3), w.slice(0, -3) + "e", w.slice(0, -4), w.slice(0, -4) + "y"]) {
      const ar = foreignVerbArabic("en", c);
      if (ar) return { ar, tense: "present", inf: c };
    }
  }
  if (w.endsWith("s") && w.length > 2) {
    for (const c of [w.slice(0, -1), w.slice(0, -2), w.slice(0, -3) + "y"]) {
      const ar = foreignVerbArabic("en", c);
      if (ar) return { ar, tense: "present", inf: c };
    }
  }
  if (w === "has") { const ar = foreignVerbArabic("en", "have"); if (ar) return { ar, tense: "present", inf: "have" }; }
  if (w === "does") { const ar = foreignVerbArabic("en", "do"); if (ar) return { ar, tense: "present", inf: "do" }; }
  return null;
}
const FR_IRREG = { suis: "être", es: "être", est: "être", sommes: "être", êtes: "être", sont: "être", serai: "être", seras: "être", sera: "être", serons: "être", serez: "être", seront: "être", ai: "avoir", as: "avoir", a: "avoir", avons: "avoir", avez: "avoir", ont: "avoir", aurai: "avoir", auras: "avoir", aura: "avoir", aurons: "avoir", aurez: "avoir", auront: "avoir", vais: "aller", vas: "aller", va: "aller", allons: "aller", allez: "aller", vont: "aller", irai: "aller", iras: "aller", ira: "aller", irons: "aller", irez: "aller", iront: "aller", fais: "faire", fait: "faire", faisons: "faire", faites: "faire", font: "faire", dis: "dire", dit: "dire", disons: "dire", dites: "dire", disent: "dire", vois: "voir", voit: "voir", voyons: "voir", voyez: "voir", voient: "voir", viens: "venir", vient: "venir", venons: "venir", venez: "venir", viennent: "venir", peux: "pouvoir", peut: "pouvoir", pouvons: "pouvoir", pouvez: "pouvoir", peuvent: "pouvoir", veux: "vouloir", veut: "vouloir", voulons: "vouloir", voulez: "vouloir", veulent: "vouloir", sais: "savoir", sait: "savoir", savons: "savoir", savez: "savoir", savent: "savoir", prends: "prendre", prend: "prendre", prenons: "prendre", prenez: "prendre", prennent: "prendre", mets: "mettre", met: "mettre", mettons: "mettre", mettez: "mettre", mettent: "mettre", bois: "boire", boit: "boire", buvons: "boire", buvez: "boire", boivent: "boire", crois: "croire", croit: "croire", croyons: "croire", croyez: "croire", croient: "croire", écris: "écrire", écrit: "écrire", écrivons: "écrire", écrivez: "écrire", écrivent: "écrire", lis: "lire", lit: "lire", lisons: "lire", lisez: "lire", lisent: "lire", dors: "dormir", dort: "dormir", dormons: "dormir", dormez: "dormir", dorment: "dormir", sors: "sortir", sort: "sortir", sortons: "sortir", sortez: "sortir", sortent: "sortir", pars: "partir", part: "partir", partons: "partir", partez: "partir", partent: "partir", ouvre: "ouvrir", ouvres: "ouvrir", ouvrons: "ouvrir", ouvrez: "ouvrir", ouvrent: "ouvrir", offre: "offrir", offres: "offrir", offrons: "offrir", offrez: "offrir", offrent: "offrir", reçois: "recevoir", reçoit: "recevoir", recevons: "recevoir", recevez: "recevoir", reçoivent: "recevoir", connais: "connaître", connaît: "connaître", connaissons: "connaître", connaissez: "connaître", connaissent: "connaître", vis: "vivre", vit: "vivre", vivons: "vivre", vivez: "vivre", vivent: "vivre", meurs: "mourir", meurt: "mourir", mourons: "mourir", mourez: "mourir", meurent: "mourir", ris: "rire", rit: "rire", rions: "rire", riez: "rire", rient: "rire" };
const FR_PART = { écrit: "écrire", écrite: "écrire", écrits: "écrire", écrites: "écrire", fait: "faire", faite: "faire", faits: "faire", faites: "faire", dit: "dire", dite: "dire", dits: "dire", dites: "dire", vu: "voir", vue: "voir", vus: "voir", vues: "voir", pris: "prendre", prise: "prendre", prises: "prendre", mis: "mettre", mise: "mettre", mises: "mettre", eu: "avoir", eue: "avoir", eus: "avoir", été: "être", bu: "boire", bue: "boire", bus: "boire", cru: "croire", crue: "croire", crus: "croire", lu: "lire", lue: "lire", lus: "lire", su: "savoir", sue: "savoir", sus: "savoir", pu: "pouvoir", pue: "pouvoir", pus: "pouvoir", voulu: "vouloir", voulue: "vouloir", voulus: "vouloir", venu: "venir", venue: "venir", venus: "venir", allé: "aller", allée: "aller", allés: "aller", allées: "aller", né: "naître", née: "naître", nés: "naître", mort: "mourir", morte: "mourir", morts: "mourir", ouvert: "ouvrir", ouverte: "ouvrir", ouverts: "ouvrir", offert: "offrir", offerte: "offrir", offerts: "offrir", reçu: "recevoir", reçue: "recevoir", reçus: "recevoir", connu: "connaître", connue: "connaître", connus: "connaître", vécu: "vivre", vécue: "vivre", vécus: "vivre" };
function frVerbForm(word) {
  const w = String(word ?? "").toLowerCase();
  if (FOREIGN_LANG.fr.func.has(w)) return null;
  if (FR_IRREG[w]) { const ar = foreignVerbArabic("fr", FR_IRREG[w]); if (ar) return { ar, tense: "present", inf: FR_IRREG[w] }; }
  if (FR_PART[w]) { const ar = foreignVerbArabic("fr", FR_PART[w]); if (ar) return { ar, tense: "participle", inf: FR_PART[w] }; }
  const direct = foreignVerbArabic("fr", w);
  if (direct) return { ar: direct, tense: "present", inf: w };
  const fut = /^(.*)(rai|ras|ra|rons|rez|ront)$/.exec(w);
  if (fut) {
    for (const c of [fut[1], fut[1] + "e", fut[1] + "er"]) {
      const ar = foreignVerbArabic("fr", c);
      if (ar) return { ar, tense: "future", inf: c };
    }
  }
  const cands = [];
  if (/(ons|ez|ent)$/.test(w)) {
    const stem = w.replace(/(ons|ez|ent)$/, "");
    cands.push(stem + "er", stem + "ir", stem + "re", stem.replace(/iss$/, "") + "ir", stem.replace(/v$/, "") + "re");
  } else if (/(is|it)$/.test(w)) {
    const stem = w.replace(/(is|it)$/, "");
    cands.push(stem + "ir", stem + "re", stem + "er");
  } else if (w.endsWith("s")) {
    const stem = w.slice(0, -1);
    cands.push(stem + "er", stem + "ir", stem + "re", stem + "oir");
    // -er verbs lose "es" in the 2s ("aimes" -> aim -> aimer), not just "s".
    if (w.endsWith("es")) {
      const stem2 = w.slice(0, -2);
      cands.push(stem2 + "er", stem2 + "ir", stem2 + "re");
    }
  } else if (w.endsWith("e")) {
    const stem = w.slice(0, -1);
    cands.push(stem + "er", stem + "ir", stem + "re");
  } else if (w.endsWith("t")) {
    const stem = w.slice(0, -1);
    cands.push(stem + "re", stem + "ir", stem + "er");
  }
  for (const c of cands) {
    const ar = foreignVerbArabic("fr", c);
    if (ar) return { ar, tense: "present", inf: c };
  }
  if (/ées?$/.test(w)) {
    const stem = w.replace(/ées?$/, "");
    const ar = foreignVerbArabic("fr", stem + "er");
    if (ar) return { ar, tense: "participle", inf: stem + "er" };
  }
  if (w.endsWith("i")) {
    const ar = foreignVerbArabic("fr", w.slice(0, -1) + "ir");
    if (ar) return { ar, tense: "participle", inf: w.slice(0, -1) + "ir" };
  }
  if (w.endsWith("u")) {
    for (const c of [w.slice(0, -1) + "re", w.slice(0, -1) + "oir"]) {
      const ar = foreignVerbArabic("fr", c);
      if (ar) return { ar, tense: "participle", inf: c };
    }
  }
  return null;
}
const DE_IRREG = { bin: "sein", bist: "sein", ist: "sein", sind: "sein", seid: "sein", habe: "haben", hast: "haben", hat: "haben", haben: "haben", habt: "haben", werde: "werden", wirst: "werden", wird: "werden", werden: "werden", werdet: "werden", gehe: "gehen", gehst: "gehen", geht: "gehen", gehen: "gehen", komme: "kommen", kommst: "kommen", kommt: "kommen", kommen: "kommen", sehe: "sehen", siehst: "sehen", sieht: "sehen", sehen: "sehen", gebe: "geben", gibst: "geben", gibt: "geben", geben: "geben", nehme: "nehmen", nimmst: "nehmen", nimmt: "nehmen", nehmen: "nehmen", spreche: "sprechen", sprichst: "sprechen", spricht: "sprechen", sprechen: "sprechen", esse: "essen", isst: "essen", essen: "essen", trinke: "trinken", trinkst: "trinken", trinkt: "trinken", trinken: "trinken", lese: "lesen", liest: "lesen", lesen: "lesen", finde: "finden", findest: "finden", findet: "finden", finden: "finden", "weiß": "wissen", "weißt": "wissen", wissen: "wissen", sage: "sagen", sagst: "sagen", sagt: "sagen", sagen: "sagen", mache: "machen", machst: "machen", macht: "machen", machen: "machen", bleibe: "bleiben", bleibst: "bleiben", bleibt: "bleiben", bleiben: "bleiben", stehe: "stehen", stehst: "stehen", steht: "stehen", stehen: "stehen", liege: "liegen", liegst: "liegen", liegt: "liegen", liegen: "liegen", sitze: "sitzen", sitzt: "sitzen", sitzen: "sitzen", schlafe: "schlafen", "schläfst": "schlafen", "schläft": "schlafen", schlafen: "schlafen", helfe: "helfen", hilfst: "helfen", hilft: "helfen", helfen: "helfen", fahre: "fahren", "fährst": "fahren", "fährt": "fahren", fahren: "fahren", lasse: "lassen", "lässt": "lassen", lassen: "lassen", trage: "tragen", "trägst": "tragen", "trägt": "tragen", tragen: "tragen", fange: "fangen", "fängst": "fangen", "fängt": "fangen", fangen: "fangen", beginne: "beginnen", beginnst: "beginnen", beginnt: "beginnen", beginnen: "beginnen", gewinne: "gewinnen", gewinnst: "gewinnen", gewinnt: "gewinnen", gewinnen: "gewinnen", vergesse: "vergessen", vergisst: "vergessen", verstehen: "verstehen", verstehe: "verstehen", verstehst: "verstehen", versteht: "verstehen", bekomme: "bekommen", bekommst: "bekommen", bekommt: "bekommen", bekommen: "bekommen" };
const DE_PART = { gewesen: "sein", gehabt: "haben", geworden: "werden", gegangen: "gehen", gekommen: "kommen", gesehen: "sehen", gegeben: "geben", genommen: "nehmen", gesprochen: "sprechen", gegessen: "essen", getrunken: "trinken", geschrieben: "schreiben", gelesen: "lesen", gefunden: "finden", gewusst: "wissen", gesagt: "sagen", gemacht: "machen", geliebt: "lieben", geblieben: "bleiben", gestanden: "stehen", gelegen: "liegen", gesessen: "sitzen", geschlafen: "schlafen", geholfen: "helfen", gefahren: "fahren", gelassen: "lassen", getragen: "tragen", gefangen: "fangen", begonnen: "beginnen", gewonnen: "gewinnen", vergessen: "vergessen", verstanden: "verstehen", bekommen: "bekommen", "erzählt": "erzählen", verkauft: "verkaufen", "gehört": "hören", gefragt: "fragen", geantwortet: "antworten", gesucht: "suchen", gekauft: "kaufen", "geöffnet": "öffnen", geschlossen: "schließen", gelernt: "lernen", gearbeitet: "arbeiten", gespielt: "spielen", gewohnt: "wohnen" };
function deVerbForm(word) {
  const w = String(word ?? "").toLowerCase();
  if (FOREIGN_LANG.de.func.has(w)) return null;
  if (DE_IRREG[w]) { const ar = foreignVerbArabic("de", DE_IRREG[w]); if (ar) return { ar, tense: "present", inf: DE_IRREG[w] }; }
  if (DE_PART[w]) { const ar = foreignVerbArabic("de", DE_PART[w]); if (ar) return { ar, tense: "participle", inf: DE_PART[w] }; }
  const direct = foreignVerbArabic("de", w);
  if (direct) return { ar: direct, tense: "present", inf: w };
  const normUmlaut = (s) => s.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u");
  const wNorm = normUmlaut(w);
  // Present first: strip an ending (no ge- strip) and require the word to BE a
  // present form of the candidate infinitive (stem + e/st/t/en). Without this,
  // "gefällt" would resolve to "fallen" (ge- + -t strip) and "geschrieben" to a
  // present "schreiben" — both wrong. All stem-changing verbs are in DE_IRREG,
  // so a regular present form is exactly stem + ending (modulo umlaut).
  const presStems = new Set();
  for (const re of [/e$/, /st$/, /t$/, /en$/]) { const s = w.replace(re, ""); if (s && s !== w) presStems.add(s); }
  // Bare imperative stem ("schreib", "lieb"): the stem itself, +en/+n.
  if (w.length >= 3) presStems.add(w);
  for (const s of [...presStems]) {
    for (const v of new Set([s, normUmlaut(s), s.replace(/ie/g, "ei"), s.replace(/ie/g, "e")])) {
      for (const suf of ["en", "n"]) {
        const inf = v + suf;
        const ar = foreignVerbArabic("de", inf);
        if (!ar) continue;
        const stemC = normUmlaut(inf.replace(/(en|n)$/, ""));
        if (["e", "st", "t", "en", ""].some((e) => wNorm === stemC + e)) return { ar, tense: "present", inf };
      }
    }
  }
  // Participle: strip ge- and -t/-en (regular weak participles; the strong ones
  // are in DE_PART). "geschrieben" → schrieb → schreib → schreiben.
  if (w.startsWith("ge")) {
    const s = w.slice(2);
    const partStems = new Set([s]);
    for (const re of [/t$/, /en$/]) { const s2 = s.replace(re, ""); if (s2) partStems.add(s2); }
    for (const ps of [...partStems]) {
      for (const v of new Set([ps, normUmlaut(ps), ps.replace(/ie/g, "ei"), ps.replace(/ie/g, "e"), ps.replace(/i/, "e")])) {
        for (const suf of ["en", "n"]) {
          const ar = foreignVerbArabic("de", v + suf);
          if (ar) return { ar, tense: "participle", inf: v + suf };
        }
      }
    }
  }
  return null;
}
const VERB_FORM = { en: enVerbForm, fr: frVerbForm, de: deVerbForm };

// ---------- Plural stripping (foreign plural → singular token) ----------
const EN_IRREG_PLURAL = { men: "man", women: "woman", children: "child", feet: "foot", teeth: "tooth", people: "person", mice: "mouse", geese: "goose" };
function singularForm(lang, word) {
  const w = String(word ?? "").toLowerCase();
  if (lang === "en") {
    if (EN_IRREG_PLURAL[w]) return EN_IRREG_PLURAL[w];
    if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
    if (/(ches|shes|xes|zes|sses)$/.test(w)) return w.slice(0, -2);
    if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && w.length > 2) return w.slice(0, -1);
    return null;
  }
  if (lang === "fr") {
    if (w.endsWith("aux")) return w.slice(0, -3) + "al";
    if (w.endsWith("eaux")) return w.slice(0, -1);
    if (w.endsWith("s") && !w.endsWith("ss") && w.length > 2) return w.slice(0, -1);
    return null;
  }
  if (lang === "de") {
    if (w.endsWith("er") && w.length > 3) return w.slice(0, -2);
    if (w.endsWith("en") && w.length > 3) return w.slice(0, -2);
    if (w.endsWith("e") && w.length > 3) return w.slice(0, -1);
    if (w.endsWith("s") && w.length > 3) return w.slice(0, -1);
    return null;
  }
  return null;
}

// ---------- Tokenizer ----------
const FR_ELIDE = { j: "je", l: "le", d: "de", n: "ne", s: "se", c: "ce", qu: "que", m: "me", t: "te" };
const EN_CONTRACTIONS = {
  "won't": ["will", "not"], "can't": ["can", "not"], "shan't": ["shall", "not"],
  "don't": ["do", "not"], "doesn't": ["does", "not"], "didn't": ["did", "not"],
  "isn't": ["is", "not"], "aren't": ["are", "not"], "wasn't": ["was", "not"], "weren't": ["were", "not"],
  "haven't": ["have", "not"], "hasn't": ["has", "not"], "hadn't": ["had", "not"],
  "couldn't": ["could", "not"], "wouldn't": ["would", "not"], "shouldn't": ["should", "not"],
  "i'm": ["i", "am"], "you're": ["you", "are"], "he's": ["he", "is"], "she's": ["she", "is"], "it's": ["it", "is"],
  "we're": ["we", "are"], "they're": ["they", "are"], "that's": ["that", "is"], "there's": ["there", "is"],
  "i'll": ["i", "will"], "you'll": ["you", "will"], "he'll": ["he", "will"], "she'll": ["she", "will"], "we'll": ["we", "will"], "they'll": ["they", "will"],
  "i've": ["i", "have"], "you've": ["you", "have"], "we've": ["we", "have"], "they've": ["they", "have"],
  "i'd": ["i", "would"], "you'd": ["you", "would"], "he'd": ["he", "would"], "she'd": ["she", "would"], "we'd": ["we", "would"], "they'd": ["they", "would"],
};
const DE_CONTRACTED_PREP = { im: ["in", "dem"], am: ["an", "dem"], vom: ["von", "dem"], zum: ["zu", "dem"], zur: ["zu", "der"], ins: ["in", "das"], ans: ["an", "das"] };
function tokenizeForeign(raw) {
  const out = [];
  const chunks = String(raw ?? "").replace(/[؟?!.،,;:()\[\]"]/g, " ").split(/\s+/).filter(Boolean);
  for (let tok of chunks) {
    // hyphenated forms: "écris-tu" → écris, tu; "est-ce" → est, ce (the gloss
    // re-joins est + ce + que as the yes/no marker)
    const parts = tok.split("-").filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const low = p.toLowerCase();
      if (EN_CONTRACTIONS[low]) { out.push(...EN_CONTRACTIONS[low]); continue; }
      // DE contractions ("am" = an dem, "im" = in dem) are NOT expanded here:
      // the tokenizer is language-neutral and "am" is the English verb.
      // translateForeign expands them only when the language is German.
      const apos = p.indexOf("'");
      if (apos > 0) {
        const pre = p.slice(0, apos).toLowerCase(), rest = p.slice(apos + 1);
        if (FR_ELIDE[pre]) { out.push(FR_ELIDE[pre]); if (rest) out.push(rest); continue; }
        if (rest === "t" && pre.endsWith("n")) { out.push(pre.slice(0, -1)); out.push("not"); continue; }
        if (rest === "ll") { out.push(pre); out.push("will"); continue; }
        if (rest === "re") { out.push(pre); out.push("are"); continue; }
        if (rest === "ve") { out.push(pre); out.push("have"); continue; }
        if (rest === "d") { out.push(pre); out.push("would"); continue; }
        if (rest === "m") { out.push(pre); out.push("am"); continue; }
        if (rest === "s") {
          if (["he", "she", "it"].includes(pre)) { out.push(pre); out.push("is"); }
          else { out.push(pre); out.push("'s"); }
          continue;
        }
        out.push(p);
        continue;
      }
      out.push(p);
    }
  }
  return out;
}

// ---------- Language detection ----------
// Arabic letters → Arabic engine (unchanged). Latin → function-word score,
// ties to EN, then FR, then DE; no function words → lookup coverage EN → FR → DE.
export function detectForeignLanguage(input) {
  const s = String(input ?? "");
  if (/[\u0600-\u06FF]/.test(s)) return "ar";
  const tokens = tokenizeForeign(s).map((t) => t.toLowerCase());
  // Score = function words (x3) + verb forms (x2) + index hits (x1). The verb
  // coverage breaks ties between ambiguous function words: "du" is both the
  // FR article and the DE pronoun, but "liebst" is only a DE verb form, so
  // "liebst du Gott?" scores DE, not FR.
  let en = 0, fr = 0, de = 0, env = 0, frv = 0, dev = 0, eni = 0, fri = 0, dei = 0;
  for (const t of tokens) {
    if (EN_FUNC.has(t)) en++;
    if (FR_FUNC.has(t)) fr++;
    if (DE_FUNC.has(t)) de++;
    if (VERB_FORM.en(t)) env++;
    if (VERB_FORM.fr(t)) frv++;
    if (VERB_FORM.de(t)) dev++;
    if (foreignLookup("en", t) || FOREIGN_CURATED.en?.[t] || FOREIGN_ADJ.en?.[t]) eni++;
    if (foreignLookup("fr", t) || FOREIGN_CURATED.fr?.[t] || FOREIGN_ADJ.fr?.[t]) fri++;
    if (foreignLookup("de", t) || FOREIGN_CURATED.de?.[t] || FOREIGN_ADJ.de?.[t]) dei++;
  }
  const se = en * 3 + env * 2 + eni, sf = fr * 3 + frv * 2 + fri, sd = de * 3 + dev * 2 + dei;
  if (se || sf || sd) {
    if (se >= sf && se >= sd) return "en";
    if (sf >= sd) return "fr";
    return "de";
  }
  return "en";
}

// ---------- Adjective gloss (citation form, masculine) ----------
function glossAdj(lang, word) {
  const w = String(word ?? "").toLowerCase();
  if (FOREIGN_LANG[lang].func.has(w)) return null;
  if (FOREIGN_ADJ[lang]?.[w]) return FOREIGN_ADJ[lang][w];
  if (lang === "de") {
    for (const suf of ["en", "em", "er", "es", "e"]) {
      if (w.endsWith(suf) && w.length - suf.length >= 2 && FOREIGN_ADJ.de[w.slice(0, -suf.length)]) return FOREIGN_ADJ.de[w.slice(0, -suf.length)];
    }
  }
  const es = foreignLookup(lang, w);
  if (es) {
    for (const e of es) {
      if (!e.kind.startsWith("صفة") || !e.ar) continue;
      if (CURATED_ADJ[adjKeyOf(e.ar)]) return adjKeyOf(e.ar);
    }
  }
  return null;
}
function singularCandidates(lang, word) {
  const w = String(word ?? "").toLowerCase();
  if (lang === "en") {
    if (EN_IRREG_PLURAL[w]) return [EN_IRREG_PLURAL[w]];
    const out = [];
    if (w.endsWith("ies") && w.length > 4) out.push(w.slice(0, -3) + "y");
    if (/(ches|shes|xes|zes|sses)$/.test(w)) out.push(w.slice(0, -2));
    if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && w.length > 2) out.push(w.slice(0, -1));
    return out;
  }
  if (lang === "fr") {
    const irr = { yeux: "œil", cieux: "ciel", "aïeux": "aïeul", messieurs: "monsieur", madames: "madame", mademoiselles: "mademoiselle" };
    if (irr[w]) return [irr[w]];
    const out = [];
    if (w.endsWith("aux")) out.push(w.slice(0, -3) + "al");
    if (w.endsWith("eaux")) out.push(w.slice(0, -1));
    if (w.endsWith("s") && !w.endsWith("ss") && w.length > 2) out.push(w.slice(0, -1));
    return out;
  }
  if (lang === "de") {
    const out = [];
    const unUmlaut = (s) => s.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u");
    for (const suf of ["er", "en", "e", "s"]) {
      if (w.endsWith(suf) && w.length - suf.length >= 2) {
        out.push(w.slice(0, -suf.length));
        const u = unUmlaut(w.slice(0, -suf.length));
        if (u !== w.slice(0, -suf.length)) out.push(u);
      }
    }
    return out;
  }
  return [];
}
function isAlreadyDefinite(arNoun) {
  const s = normalizeArabic(arNoun);
  return s.startsWith("ال") || !!CURATED_NOUNS[s]?.proper || !!CURATED_NOUNS[s]?.definite;
}

// ---------- Noun phrase gloss ----------
// Returns { text, bareText, defText, next, gender, plural, definite, unknown }
// or null. `text` is the Arabic NP as the engine expects it (definite → ال,
// indefinite → bare, possessive → suffix, adjective → following token with
// definite agreement + feminine ة). `bareText` is the NP without its article
// (the first element of an إضافة); `defText` is the NP made definite (the
// second element of an إضافة, or the possessor after 's).
function glossNP(tokens, i, lang, opts = {}) {
  const L = FOREIGN_LANG[lang];
  const unknown = [];
  const low = (t) => String(t ?? "").toLowerCase();
  let j = i;
  let definite = !!opts.forceDefinite;
  let plural = false;
  let possSuffix = null;
  let adjAr = null;
  let adjTokIdx = -1;
  const t0 = low(tokens[j]);
  if (t0 && L.defArt.has(t0)) { definite = true; j++; }
  else if (t0 && L.indefArt.has(t0)) { definite = false; j++; }
  if (j < tokens.length && L.possessive[low(tokens[j])] !== undefined) { possSuffix = L.possessive[low(tokens[j])]; j++; }
  // Noun first: a token that resolves as a noun is the noun, never a preposed
  // adjective ("light" in "the light of the world" is نور, not جميل).
  if (j < tokens.length && !resolvesAsNoun(lang, low(tokens[j]))) {
    const a = glossAdj(lang, low(tokens[j]));
    if (a) { adjAr = a; adjTokIdx = j; j++; }
  }
  if (j >= tokens.length) return null;
  const nounTok = low(tokens[j]);
  let arNoun = FOREIGN_CURATED[lang]?.[nounTok] ?? null;
  if (!arNoun) {
    arNoun = foreignNounArabic(lang, nounTok);
    if (!arNoun) {
      for (const sing of singularCandidates(lang, nounTok)) {
        arNoun = FOREIGN_CURATED[lang]?.[sing] ?? foreignNounArabic(lang, sing);
        if (arNoun) { plural = true; break; }
      }
    }
  }
  if (!arNoun) return null;
  j++;
  if (!adjAr && j < tokens.length) {
    const a = glossAdj(lang, low(tokens[j]));
    if (a) { adjAr = a; adjTokIdx = j; j++; }
  }
  const noun = lookupNoun(arNoun);
  const gender = noun?.gender ?? "m";
  const nounPl = plural ? pluralizeArabicNoun(arNoun) : arNoun;
  const adjForm = (def) => {
    if (!adjAr) return "";
    const a = (gender === "f" || gender === "pl") ? adjAr + "ة" : adjAr;
    return def ? "ال" + a : a;
  };
  let text;
  if (possSuffix) {
    text = nounPl + possSuffix;
    // The engine's possessive branch does not consume a following adjective, so
    // an adjective on a possessed noun would surface as an Arabic unknown — drop
    // it here and report the FOREIGN word instead.
    if (adjAr) { unknown.push(tokens[adjTokIdx]); adjAr = null; }
  } else if (definite) {
    text = isAlreadyDefinite(arNoun) ? nounPl : "ال" + nounPl;
  } else {
    text = nounPl;
  }
  if (adjAr) text += " " + adjForm(definite);
  const bareText = nounPl + (adjAr ? " " + adjForm(false) : "");
  const defText = (possSuffix ? nounPl + possSuffix : isAlreadyDefinite(arNoun) ? nounPl : "ال" + nounPl) + (adjAr ? " " + adjForm(true) : "");
  const base = { text, bareText, defText, next: j, gender, plural, definite, unknown };
  // Genitive look-ahead (only when NP1 has no possessive — the Arabic إضافة's
  // first element is bare): "the light of the world" / "la lumière du monde" /
  // "das Licht der Welt" → "نور العالم". NP2 is forced definite (the Coptic
  // genitive's second noun is always definite).
  if (!possSuffix && j < tokens.length) {
    const gt = low(tokens[j]);
    let np2 = null;
    let consumed = 0;
    if (lang === "en" && gt === L.genitive) {
      np2 = glossNP(tokens, j + 1, lang, { allowGenitive: true, forceDefinite: true });
      consumed = np2 ? np2.next - j : 0;
    } else if (lang === "fr" && L.genitive.has(gt)) {
      np2 = glossNP(tokens, j + 1, lang, { allowGenitive: true, forceDefinite: true });
      consumed = np2 ? np2.next - j : 0;
    } else if (lang === "de" && opts.allowGenitive !== false && L.genitiveArt.has(gt)) {
      np2 = glossNP(tokens, j, lang, { allowGenitive: true, forceDefinite: true });
      consumed = np2 ? np2.next - j : 0;
    } else if (lang === "de" && opts.allowGenitive !== false) {
      // Genitive -s/-es on the possessor noun: "das Buch Gottes" -> "كتاب الله".
      for (const suf of ["es", "s"]) {
        if (!gt.endsWith(suf) || gt.length - suf.length < 2) continue;
        const stem = gt.slice(0, -suf.length);
        const ar2 = FOREIGN_CURATED.de?.[stem] ?? foreignNounArabic("de", stem);
        if (ar2) {
          np2 = { text: isAlreadyDefinite(ar2) ? ar2 : "ال" + ar2, next: j + 1, unknown: [] };
          consumed = 1;
          break;
        }
      }
    }
    if (np2 && consumed > 0) {
      return { ...base, text: `${bareText} ${np2.text}`, next: j + consumed, unknown: [...unknown, ...np2.unknown] };
    }
    // Possessive 's: "Peter's book" → NP2-bare + NP1-definite ("كتاب بطرس").
    if (low(tokens[j]) === "'s") {
      const np2b = glossNP(tokens, j + 1, lang, { allowGenitive: true });
      if (np2b) {
        return { ...base, text: `${np2b.bareText} ${defText}`, next: np2b.next, unknown: [...unknown, ...np2b.unknown] };
      }
    }
  }
  return base;
}

// Verbs that take a dative (indirect) object in German: after them a bare
// article + noun is the dative ("Ich gebe das Buch der Frau"), not a genitive.
const DE_DATIVE_VERBS = new Set(["geben", "zeigen", "sagen", "bringen", "schicken", "helfen", "danken", "folgen", "gehören", "gefallen", "antworten", "glauben", "schreiben", "erklären", "wünschen", "leihen", "senden", "bieten", "empfehlen", "erlauben", "verbieten", "versprechen", "zahlen", "schenken", "verkaufen", "kaufen", "holen", "nehmen"]);
// Adverbs the engine cannot place (it would read them as objects) — reported,
// not emitted.
const ADVERBS_UNKNOWN = new Set(["today", "yesterday", "tomorrow", "now", "here", "there", "always", "often", "sometimes", "usually", "soon", "already", "still", "just", "very", "really", "quickly", "slowly", "well", "fast", "together", "alone", "aujourd'hui", "hier", "demain", "maintenant", "ici", "là", "toujours", "souvent", "parfois", "habituellement", "bientôt", "déjà", "encore", "vite", "lentement", "bien", "ensemble", "seul", "heute", "gestern", "morgen", "jetzt", "dort", "immer", "oft", "manchmal", "gewöhnlich", "bald", "schon", "noch", "schnell", "langsam", "gut", "zusammen", "allein"]);

// ---------- Main gloss: foreign tokens → Arabic sentence ----------
function glossTokens(tokens, lang) {
  const L = FOREIGN_LANG[lang];
  const unknown = [];
  const low = (t) => String(t ?? "").toLowerCase();
  let i = 0;
  // Existential: "there is/are" / "il y a" / "es gibt" → يوجد + NP (negation ok).
  if (lang === "en" && low(tokens[0]) === "there" && L.be.has(low(tokens[1]))) {
    const neg = low(tokens[2]) === "not" || low(tokens[2]) === "no";
    const np = glossNP(tokens, neg ? 3 : 2, lang, { allowGenitive: true });
    if (!np) return { arabic: "", unknown: [...unknown, tokens[neg ? 3 : 2] ?? ""] };
    return { arabic: `${neg ? "لا " : ""}يوجد ${np.text}`, unknown: [...unknown, ...np.unknown] };
  }
  if (lang === "fr" && low(tokens[0]) === "il" && low(tokens[1]) === "y" && low(tokens[2]) === "a") {
    const neg = low(tokens[3]) === "pas" || low(tokens[3]) === "ne";
    const np = glossNP(tokens, neg ? 5 : 3, lang, { allowGenitive: true });
    if (!np) return { arabic: "", unknown: [...unknown, tokens[neg ? 5 : 3] ?? ""] };
    return { arabic: `${neg ? "لا " : ""}يوجد ${np.text}`, unknown: [...unknown, ...np.unknown] };
  }
  if (lang === "de" && low(tokens[0]) === "es" && low(tokens[1]) === "gibt") {
    const neg = /^kein/.test(low(tokens[2]));
    const np = glossNP(tokens, neg ? 3 : 2, lang, { allowGenitive: true });
    if (!np) return { arabic: "", unknown: [...unknown, tokens[neg ? 3 : 2] ?? ""] };
    return { arabic: `${neg ? "لا " : ""}يوجد ${np.text}`, unknown: [...unknown, ...np.unknown] };
  }
  // Question word.
  let qword = null;
  if (L.questions[low(tokens[0])] !== undefined) { qword = L.questions[low(tokens[0])]; i = 1; }
  // Yes/no question: FR "est-ce que", EN leading auxiliary (also after a
  // wh-word: "what does he write?" — the "هل" is not emitted then, a wh-word
  // already marks the question).
  let yesNo = false;
  if (lang === "fr" && low(tokens[i]) === "est" && low(tokens[i + 1]) === "ce" && low(tokens[i + 2]) === "que") { yesNo = true; i += 3; }
  let auxTense = null;
  if (lang === "en") {
    const a = low(tokens[i]);
    if (L.futureAux.has(a)) { yesNo = true; auxTense = "future"; i++; }
    else if (L.dummyAux[a] !== undefined) { yesNo = true; auxTense = L.dummyAux[a]; i++; }
    else if (L.progAux[a] !== undefined) { yesNo = true; auxTense = L.progAux[a]; i++; }
    else if (a === "have" || a === "has" || a === "had") { yesNo = true; auxTense = "past"; i++; }
  }
  // Verb-first, BEFORE the subject: the first token is a verb form and the next
  // is a pronoun (question: "Schreibst du…?"), an article, or nothing
  // (imperative: "Write the lesson!"). The next token must NOT be a verb or an
  // auxiliary — "love is beautiful" and "love conquers all" keep "love" as the
  // subject, and "Love God!" (next token a noun, not a verb) is an imperative.
  let verbFirst = false, imperative = false;
  {
    const vf0 = VERB_FORM[lang](low(tokens[i] ?? ""));
    const nxt = low(tokens[i + 1]);
    const nxtIsVerb = !!VERB_FORM[lang](nxt);
    const nxtIsAux = L.be.has(nxt) || L.have.has(nxt)
      || (lang === "en" && (L.futureAux.has(nxt) || L.dummyAux[nxt] !== undefined || L.progAux[nxt] !== undefined))
      || (lang === "fr" && L.goAux.has(nxt))
      || (lang === "de" && L.becomeAux.has(nxt));
    if (vf0 && !nxtIsVerb && !nxtIsAux && (!tokens[i + 1] || L.pronouns[nxt] !== undefined || L.defArt.has(nxt) || L.indefArt.has(nxt) || foreignNounArabic(lang, nxt))) {
      verbFirst = true;
      // A qword sentence is a question, never an imperative ("who writes…?").
      if (!qword && (!tokens[i + 1] || L.defArt.has(nxt) || L.indefArt.has(nxt) || foreignNounArabic(lang, nxt))) imperative = true;
      else if (!qword) yesNo = true;
    }
  }
  // Subject: pronoun or noun phrase (skipped for verb-first sentences).
  let person = null, subjectText = null, subjectGender = "m", subjectPlural = false;
  if (!verbFirst) {
    const t0 = low(tokens[i]);
    if (L.pronouns[t0] !== undefined) {
      person = L.pronouns[t0];
      if (lang === "de" && t0 === "sie" && tokens[i] === "Sie") person = "2m"; // formal Sie
      subjectText = AR_PRONOUN[person];
      subjectGender = person === "2f" || person === "3f" ? "f" : person === "3p" ? "pl" : "m";
      subjectPlural = person === "1p" || person === "2p" || person === "3p";
      i++;
    } else {
      const ns = glossNP(tokens, i, lang, { allowGenitive: true });
      if (ns) {
        subjectText = ns.text;
        subjectGender = ns.gender;
        subjectPlural = ns.plural;
        person = ns.plural ? "3p" : ns.gender === "f" ? "3f" : "3m";
        i = ns.next;
        unknown.push(...ns.unknown);
      }
    }
  }
  // Verb phrase: auxiliaries, negation, the verb.
  // Tokens consumed out of order by a scan-ahead (a DE end participle/infinitive)
  // are skipped by the tail loop.
  const skipIdx = new Set();
  let tense = auxTense ?? "present";
  let neg = false;
  let verbAr = null, verbInf = null;
  let isBe = false, isHave = false;
  let j = i;
  while (j < tokens.length) {
    const w = low(tokens[j]);
    if (L.neg.has(w)) { neg = true; j++; continue; }
    if (lang === "en") {
      if (L.futureAux.has(w)) { tense = "future"; j++; continue; }
      if (L.have.has(w)) {
        const nxt = VERB_FORM.en(low(tokens[j + 1] ?? ""));
        if (nxt) { tense = "past"; j++; continue; }
        isHave = true; j++; break;
      }
      if (L.progAux[w] !== undefined) {
        const nxt = VERB_FORM.en(low(tokens[j + 1] ?? ""));
        if (nxt && (nxt.tense === "present" || nxt.tense === "participle")) { tense = L.progAux[w]; j++; continue; }
        isBe = true; j++; break;
      }
      if (L.dummyAux[w] !== undefined) { tense = L.dummyAux[w]; j++; continue; }
      if (w === "can") { j++; continue; }
      if (w === "could") { tense = "past"; j++; continue; }
    }
    if (lang === "fr") {
      if (L.have.has(w)) {
        const nxt = VERB_FORM.fr(low(tokens[j + 1] ?? ""));
        if (nxt) { tense = "past"; j++; continue; }
        isHave = true; j++; break;
      }
      if (L.be.has(w)) {
        const nxt = VERB_FORM.fr(low(tokens[j + 1] ?? ""));
        if (nxt && nxt.tense === "participle") { tense = "past"; j++; continue; }
        isBe = true; j++; break;
      }
      if (L.goAux.has(w)) { tense = "future"; j++; continue; }
      if (w === "viens" && low(tokens[j + 1]) === "de") { tense = "past"; j += 2; continue; }
    }
    if (lang === "de") {
      if (L.have.has(w)) {
        const nxt = VERB_FORM.de(low(tokens[j + 1] ?? ""));
        if (nxt) { tense = "past"; j++; continue; }
        // Perfekt: the participle stands at the END ("ich habe die Lektion
        // geschrieben") — scan ahead, take it as the verb, skip it in the tail.
        let pk = -1, pv = null;
        for (let k = j + 1; k < tokens.length; k++) {
          const cand = VERB_FORM.de(low(tokens[k]));
          if (cand && cand.tense === "participle") { pk = k; pv = cand; break; }
        }
        if (pv) { verbAr = pv.ar; verbInf = pv.inf; tense = "past"; skipIdx.add(pk); j++; break; }
        isHave = true; j++; break;
      }
      if (L.be.has(w)) {
        const nxt = VERB_FORM.de(low(tokens[j + 1] ?? ""));
        if (nxt && nxt.tense === "participle") { tense = "past"; j++; continue; }
        let pk = -1, pv = null;
        for (let k = j + 1; k < tokens.length; k++) {
          const cand = VERB_FORM.de(low(tokens[k]));
          if (cand && cand.tense === "participle") { pk = k; pv = cand; break; }
        }
        if (pv) { verbAr = pv.ar; verbInf = pv.inf; tense = "past"; skipIdx.add(pk); j++; break; }
        isBe = true; j++; break;
      }
      if (L.becomeAux.has(w)) {
        tense = "future";
        // Futur: the infinitive stands at the END ("ich werde die Lektion
        // schreiben") — scan ahead for it.
        let fk = -1, fv = null;
        for (let k = j + 1; k < tokens.length; k++) {
          const cand = VERB_FORM.de(low(tokens[k]));
          if (cand) { fk = k; fv = cand; break; }
        }
        if (fv) { verbAr = fv.ar; verbInf = fv.inf; skipIdx.add(fk); j++; break; }
        j++; continue;
      }
    }
    const vf = VERB_FORM[lang](w);
    if (vf) {
      verbAr = vf.ar; verbInf = vf.inf;
      if (vf.tense === "past" || vf.tense === "participle") tense = "past";
      else if (vf.tense === "future") tense = "future";
      j++;
      break;
    }
    break;
  }
  // Negation right after the verb (FR pas/jamais, DE nicht/nie).
  if (j < tokens.length && L.neg.has(low(tokens[j]))) { neg = true; j++; }
  // Post-verbal subject (verb-first questions): "Schreibst du…?" / "Écris-tu…?"
  // Never for an imperative (the following NP is the OBJECT: "Write the lesson!")
  // nor for a wh-question (the wh-word is the subject; the NP is the object).
  if (!subjectText && !imperative && !qword && (verbFirst || yesNo) && verbAr) {
    const st = low(tokens[j]);
    if (L.pronouns[st] !== undefined) {
      person = L.pronouns[st];
      if (lang === "de" && st === "sie" && tokens[j] === "Sie") person = "2m";
      if (lang === "de" && st === "sie" && person === "3f" && verbInf && /en$/.test(verbInf)) person = "3p"; // "sie schreiben" = they
      subjectText = AR_PRONOUN[person];
      subjectGender = person === "2f" || person === "3f" ? "f" : person === "3p" ? "pl" : "m";
      subjectPlural = person === "1p" || person === "2p" || person === "3p";
      j++;
    } else {
      const ns = glossNP(tokens, j, lang, { allowGenitive: true });
      if (ns) {
        subjectText = ns.text;
        subjectGender = ns.gender;
        subjectPlural = ns.plural;
        person = ns.plural ? "3p" : ns.gender === "f" ? "3f" : "3m";
        j = ns.next;
        unknown.push(...ns.unknown);
      }
    }
  }
  // DE "sie": a plural verb form after "sie" means "they" (3p), not "she" (3f).
  if (lang === "de" && subjectText && low(tokens[i]) === "sie" && person === "3f" && verbInf && /en$/.test(verbInf)) {
    person = "3p"; subjectText = AR_PRONOUN["3p"]; subjectGender = "pl"; subjectPlural = true;
  }
  // A wh-word is the subject ("who writes…?" -> من + 3m verb). The qword itself
  // is emitted by the assembly, so only the person is set here.
  if (!subjectText && qword && (qword === "من" || qword === "ماذا")) person = "3m";
  if (!person) person = "3m";
  // Tail: objects, prepositional phrases, conjunctions.
  const tail = [];
  let sawObject = false;
  const deGenAllowed = lang !== "de" || !DE_DATIVE_VERBS.has(verbInf ?? "");
  while (j < tokens.length) {
    if (skipIdx.has(j)) { j++; continue; }
    const w = low(tokens[j]);
    if (w === L.conj) { tail.push("و"); j++; continue; }
    if (L.preps[w] !== undefined) {
      const np = glossNP(tokens, j + 1, lang, { allowGenitive: true });
      if (np) { tail.push(`${L.preps[w]} ${np.text}`); j = np.next; unknown.push(...np.unknown); sawObject = true; continue; }
      unknown.push(tokens[j]); j++; continue;
    }
    if (lang === "de" && sawObject && (L.defArt.has(w) || L.indefArt.has(w))) {
      const np = glossNP(tokens, j, lang, { allowGenitive: false });
      if (np) { tail.push(`ل ${np.text}`); j = np.next; unknown.push(...np.unknown); continue; }
    }
    if (lang === "de" && /^kein/.test(w)) {
      if (verbAr || isHave) { neg = true; j++; continue; }
      unknown.push(tokens[j]); j++; continue;
    }
    if (L.neg.has(w)) { neg = true; j++; continue; }
    if (ADVERBS_UNKNOWN.has(w)) { unknown.push(tokens[j]); j++; continue; }
    const np = glossNP(tokens, j, lang, { allowGenitive: deGenAllowed });
    if (np) { tail.push(np.text); j = np.next; unknown.push(...np.unknown); sawObject = true; continue; }
    // A bare article whose noun failed to resolve is not an unknown word.
    if (L.defArt.has(w) || L.indefArt.has(w)) { j++; continue; }
    unknown.push(tokens[j]); j++;
  }
  // Assemble in Arabic order: [question] [هل] [subject] [neg] [verb] [tail].
  // Negation takes the present verb form — the engine derives the tense from
  // لم/لن (past/future) and لا (present).
  const parts = [];
  if (qword) parts.push(qword);
  if (yesNo && !qword) parts.push("هل");
  if (isHave) {
    // "have" → عندي + NP; the subject pronoun is dropped (the engine only
    // handles عندي without a subject). Negation cannot be expressed through the
    // engine's have-branch, so a negated "have" is reported as unknown.
    if (neg) unknown.push(lang === "en" ? "not" : lang === "fr" ? "pas" : "nicht");
    parts.push("عندي", ...tail);
  } else if (isBe) {
    // Copula: the sentence is nominal (subject + predicate); a past copula
    // ("was") loses its past — the engine has no nominal past.
    if (subjectText) parts.push(subjectText);
    if (neg) parts.push("لا");
    parts.push(...tail);
  } else if (verbAr) {
    if (imperative) {
      // Arabic imperative: "ا" + stem ("اكتب"). A stem starting with أ has no
      // imperative form the engine accepts — fall back to the 2m present.
      if (normalizeArabic(verbAr).startsWith("ا") || normalizeArabic(verbAr).startsWith("أ")) parts.push(`أنت ${inflectArabicVerb(verbAr, "present", "2m")}`);
      else parts.push("ا" + normalizeArabic(verbAr));
      parts.push(...tail);
    } else {
      if (subjectText) parts.push(subjectText);
      if (neg) parts.push(tense === "past" ? "لم" : tense === "future" ? "لن" : "لا");
      parts.push(inflectArabicVerb(verbAr, neg ? "present" : tense, person));
      parts.push(...tail);
    }
  } else {
    // No verb: a bare noun phrase / nominal sentence.
    if (subjectText) parts.push(subjectText);
    parts.push(...tail);
  }
  return { arabic: parts.join(" ").replace(/\s+/g, " ").trim(), unknown: [...new Set(unknown)] };
}

// ---------- Entry point ----------
export function translateForeign(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: false, error: "اكتب جملة." };
  const lang = detectForeignLanguage(raw);
  if (lang === "ar") return translateSentence(raw);
  let tokens = tokenizeForeign(raw);
  if (lang === "de") {
    // German contracted prepositions ("am" = an dem) expand only for German —
    // the tokenizer must not expand "am", which is the English verb.
    tokens = tokens.flatMap((t) => DE_CONTRACTED_PREP[t.toLowerCase()] ?? [t]);
  }
  if (tokens.length > 12) return { ok: false, error: "الجملة طويلة — جرّب جملة أقصر (حتى 12 كلمة)." };
  const g = glossTokens(tokens, lang);
  if (!g.arabic) return { ok: true, coptic: null, unknown: g.unknown, via: "unknown" };
  const r = translateSentence(g.arabic);
  if (!r.ok) return r;
  const unknown = [...new Set([...g.unknown, ...r.unknown])];
  return { ok: true, coptic: r.coptic, unknown, via: r.via };
}

export function formatTranslation(input) {
  // Coptic letters → the reverse engine (target = the session target).
  if (/[\u2C80-\u2CFF\u03E2-\u03EF]/.test(String(input ?? ""))) return formatReverseTranslation(input, getReverseTarget());
  // Arabic letters → the existing Arabic engine, unchanged. Latin-script input
  // → the EN/FR/DE gloss (detection inside translateForeign).
  const r = /[\u0600-\u06FF]/.test(String(input ?? "")) ? translateSentence(input) : translateForeign(input);
  if (!r.ok) return r.error;
  if (!r.coptic) {
    return r.unknown.length ? `⚠️ كلمات غير معروفة: ${r.unknown.join("، ")}` : "مش فاهم الجملة — جرّب جملة أبسط.";
  }
  let out = r.coptic;
  if (r.unknown.length) out += `\n⚠️ كلمات غير معروفة: ${[...new Set(r.unknown)].join("، ")}`;
  return out;
}

// ---------- Reverse translation (Coptic → Arabic / English / French / German) ----------
// The forward engine is never touched: the reverse parser mirrors its sentence
// patterns (pronoun subjects, tense prefixes, possessives, articles, genitive,
// object markers, negation, copula, question words, prepositions) and resolves
// every Coptic word through the SAME curated tables and dictionary records, so
// forward and reverse agree. Unknown Coptic words are reported, never guessed.
// Verb meanings in the dictionary are past-tense 3rd-person masculine in
// Arabic: the reverse engine rebuilds the right person/tense from the Coptic
// prefix instead of pasting the past form (Ϯⲥ̀ϧⲁⲓ → "I write", not "I wrote").
//
// Session target (default Arabic). The parent (src/index.js) calls
// setReverseTarget when the user types en / fr / de / ar inside the session.
let REVERSE_TARGET = "ar";
export function setReverseTarget(lang) {
  const l = String(lang ?? "").toLowerCase();
  if (["ar", "en", "fr", "de"].includes(l)) REVERSE_TARGET = l;
  return REVERSE_TARGET;
}
export function getReverseTarget() { return REVERSE_TARGET; }
export function hasCoptic(s) { return /[\u2C80-\u2CFF\u03E2-\u03EF]/.test(String(s ?? "")); }

// Coptic lookup key: jinkim-insensitive + lowercase. The dictionary stores
// ⲉⲕⲕ̀ⲗⲏⲥⲓⲁ (with jinkim) while the forward engine writes ⲉⲕⲕⲗⲏⲥⲓⲁ, and
// proper nouns are capitalised (Ⲫ̀ⲛⲟⲩϯ) — both must resolve to one key.
export function normCoptic(s) {
  return String(s ?? "").replace(/\u0300/g, "").toLowerCase();
}
// Display Arabic word: strip diacritics but KEEP the hamza (NFC composes
// ا + U+0654 into أ), so "قرأ" displays as "قرأ", not "قرا".
function displayArabicWord(raw) {
  return String(raw ?? "").replace(/[ً-ْٰـ]/gu, "").normalize("NFC").trim();
}
// First word of a field's first value, cleaned for a gloss.
function firstGlossWord(val) {
  const w = String(val ?? "").split(/[،,]/)[0].trim().split(/\s+/)[0]?.replace(/^[("']+|[)"'.,;:!?]+$/g, "") ?? "";
  return w;
}

// ---------- Reverse indexes (lazy) ----------
// Coptic form → noun entry {ar, arPl, en, enPl, fr, frPl, de, dePl, gender, kind, proper, plural}.
// `ar` is the DISPLAY Arabic word (كنيسة, not the normalized key كنيسه).
let COPTIC_NOUN = null;
let COPTIC_VERB = null;
let COPTIC_ADJ = null;
function firstValueFirstWord(field) {
  return firstGlossWord(field);
}
// The curated Arabic keys are normalized (كنيسه, امراه, موسي, اب...): the
// display spelling differs for these. Only the keys that differ are listed.
const CURATED_AR_DISPLAY = {
  "كنيسه": "كنيسة", "امراه": "امرأة", "زوجه": "زوجة", "موسي": "موسى",
  "سنه": "سنة", "صلاه": "صلاة", "محبه": "محبة", "كلمه": "كلمة",
  "شجره": "شجرة", "ام": "أم", "اب": "أب", "اخ": "أخ", "اخت": "أخت",
  "اولاد": "أولاد", "ايام": "أيام", "ابرام": "إبرام", "انسان": "إنسان",
  "ارض": "أرض", "مشي": "مشى", "صلي": "صلى", "احب": "أحب", "اعطي": "أعطى",
  "راي": "رأى", "اكل": "أكل", "اخذ": "أخذ", "اتي": "أتى", "اختبا": "اختبأ",
};
function curatedDisplayAr(key) { return CURATED_AR_DISPLAY[key] ?? key; }
function buildCopticNounIndex() {
  if (COPTIC_NOUN) return COPTIC_NOUN;
  const idx = new Map();
  const byForm = new Map();
  for (const r of records) {
    const c = normCoptic(cleanCoptic(r.coptic ?? "").split(" ")[0].replace(/-$/, ""));
    if (!c) continue;
    if (!byForm.has(c)) byForm.set(c, []);
    byForm.get(c).push(r);
  }
  for (const [c, rs] of byForm) {
    // Prefer a singular noun record (اسم مذكر/مؤنث, or bare اسم); a جمع-only
    // form becomes a plural entry. Proper nouns (اسم علم) are kept, flagged.
    const isNoun = (r) => (r.kind ?? "").includes("اسم");
    const singular = rs.find((r) => isNoun(r) && !r.kind.includes("جمع"))
      ?? rs.find((r) => isNoun(r));
    if (!singular) continue;
    const arRaw = displayArabicWord(firstGlossWord(singular.meaning ?? "").split(" ")[0] ?? "");
    // The meaning's first word is the lemma; a phrase first word (e.g. the
    // vocative "يا") is not a noun.
    const arNorm = normalizeArabic(arRaw);
    if (!arRaw || arNorm.length < 2 || FUNCTION_WORDS.has(arNorm)) continue;
    const plural = singular.kind.includes("جمع");
    idx.set(c, {
      ar: arRaw, arPl: null,
      en: firstValueFirstWord(singular.english), enPl: null,
      fr: firstValueFirstWord(singular.translation_fr), frPl: null,
      de: firstValueFirstWord(singular.translation_de), dePl: null,
      gender: genderFromRecord(singular), kind: singular.kind ?? "",
      proper: (singular.kind ?? "").includes("علم"), plural,
    });
  }
  // Curated nouns override the dictionary (the record's first sense is often
  // wrong: ⲣⲱⲙⲓ → رجال, ⲙⲁⲩ → والدة, ⲕⲁϩ has no noun record at all, and
  // ϫⲱⲱⲙ is not in the dictionary). The record's en/fr/de are kept when they
  // exist; the Arabic display comes from the record when it matches the key.
  // First curated gloss wins for a form (رجل, not the later انسان → ⲣⲱⲙⲓ).
  const curatedSet = new Set();
  for (const [key, cur] of Object.entries(CURATED_NOUNS)) {
    const c = normCoptic(cur.coptic);
    // A plural key sharing the singular's form (كتاب/كتب → ϫⲱⲱⲙ, رجل/رجال →
    // ⲣⲱⲙⲓ) must not overwrite the singular entry: the plural is derived
    // from the singular by the renderers (ⲛⲓ + form → plural).
    if (cur.gender === "pl" && idx.has(c) && idx.get(c).gender !== "pl") continue;
    if (curatedSet.has(c)) continue;
    curatedSet.add(c);
    const rec = idx.get(c);
    const ar = rec && normalizeArabic(rec.ar) === key ? rec.ar : curatedDisplayAr(key);
    idx.set(c, {
      ar, arPl: null,
      // The curated gloss wins over the record's first value when both exist
      // (ϣ̀ⲫⲉⲣ → "Companion" in the record, "friend" curated).
      en: REVERSE_NOUN_GLOSS[c]?.en ?? rec?.en ?? "", enPl: null,
      fr: REVERSE_NOUN_GLOSS[c]?.fr ?? rec?.fr ?? "", frPl: null,
      de: REVERSE_NOUN_GLOSS[c]?.de ?? rec?.de ?? "", dePl: null,
      gender: cur.gender, kind: "", proper: !!cur.proper || !!cur.definite, plural: cur.gender === "pl",
    });
    if (cur.plural) {
      const pc = normCoptic(cur.plural);
      const prec = idx.get(pc);
      idx.set(pc, {
        ar: pluralizeArabicNounDisplay(key), arPl: null,
        en: REVERSE_NOUN_GLOSS[pc]?.en ?? prec?.en ?? "", enPl: null,
        fr: REVERSE_NOUN_GLOSS[pc]?.fr ?? prec?.fr ?? "", frPl: null,
        de: REVERSE_NOUN_GLOSS[pc]?.de ?? prec?.de ?? "", dePl: null,
        gender: "pl", kind: "", proper: false, plural: true,
      });
    }
  }
  COPTIC_NOUN = idx;
  return idx;
}
// Curated en/fr/de glosses for Coptic noun forms whose dictionary record is
// missing or whose first value is the wrong sense (ϣ̀ⲫⲉⲣ → "Companion", not
// "friend"; ϫⲱⲱⲙ has no record at all).
const REVERSE_NOUN_GLOSS = {
  [normCoptic("ϫⲱⲱⲙ")]: { en: "book", fr: "livre", de: "Buch" },
  [normCoptic("ϫⲱⲙ")]: { en: "book", fr: "livre", de: "Buch" },
  [normCoptic("ϣ̀ⲫⲉⲣ")]: { en: "friend", fr: "ami", de: "Freund" },
  [normCoptic("ϣ̀ⲫⲉⲣⲓ")]: { en: "friends", fr: "amis", de: "Freunde" },
  [normCoptic("ⲣⲱⲙⲓ")]: { en: "man", fr: "homme", de: "Mann" },
};
// Pluralize an Arabic noun for DISPLAY (keeps a leading أ: أستاذ → أستاذون).
function pluralizeArabicNounDisplay(word) {
  const pl = pluralizeArabicNoun(word);
  if (word.startsWith("أ") && pl.startsWith("ا")) return "أ" + pl.slice(1);
  return pl;
}
function buildCopticVerbIndex() {
  if (COPTIC_VERB) return COPTIC_VERB;
  const idx = new Map();
  for (const r of records) {
    const kind = r.kind ?? "";
    if (!kind.startsWith("فعل")) continue;
    // Participles/adjectives are not finite verb stems (same rule as the
    // forward foreignVerbArabic): "فعل مذكر/مؤنث/جمع", stative and descriptive forms.
    if (/^فعل (مذكر|مؤنث|جمع)/.test(kind)) continue;
    if (kind.includes("حالة") || kind.includes("وصفية")) continue;
    const c = normCoptic(cleanCoptic(r.coptic ?? "").split(" ")[0].replace(/-$/, ""));
    if (!c || idx.has(c)) continue;
    // The copula forms ⲡⲉ/ⲧⲉ/ⲛⲉ are verb records ("to be") but function as
    // the nominal copula in a sentence — the nominal parser handles them, so
    // they must not resolve as verbs here (or "ⲡⲓⲣⲱⲙⲓ ⲟⲩⲥⲁⲃⲉ ⲡⲉ" reads
    // ⲡⲉ as the verb كان and renders "ييكون").
    if (c === "ⲡⲉ" || c === "ⲧⲉ" || c === "ⲛⲉ") continue;
    const arRaw = displayArabicWord(firstGlossWord(r.meaning ?? "").split(" ")[0] ?? "");
    const ar = normalizeArabic(arRaw);
    if (!ar || ar.length < 2) continue;
    // The Arabic word must resolve as a verb stem, or the record is a phrase
    // whose first word is not a usable stem.
    if (!lookupVerbStem(ar)) continue;
    idx.set(c, {
      ar, arRaw,
      en: firstValueFirstWord(r.english), fr: firstValueFirstWord(r.translation_fr),
      de: firstValueFirstWord(r.translation_de), kind,
    });
  }
  // Curated verbs override (the dictionary often has only the f2/f3 form:
  // أحب has ⲙⲉⲛⲣⲉ/ⲙⲉⲛⲣⲓⲧ but no ⲙⲉⲓ; ϣⲉⲛⲁϥ has no record at all).
  for (const [stem, forms] of Object.entries(CURATED_VERBS)) {
    for (const f of [forms.f1, forms.f2, forms.f3]) {
      if (!f) continue;
      const c = normCoptic(f);
      const rec = idx.get(c);
      idx.set(c, {
        ar: stem, arRaw: rec?.arRaw ?? curatedDisplayAr(stem),
        en: rec?.en ?? "", fr: rec?.fr ?? "", de: rec?.de ?? "", kind: "curated",
      });
    }
  }
  COPTIC_VERB = idx;
  return idx;
}
function buildCopticAdjIndex() {
  if (COPTIC_ADJ) return COPTIC_ADJ;
  const idx = new Map();
  // Adjective glosses: invert FOREIGN_ADJ (foreign word → arabic) so an
  // Arabic adjective key resolves to its en/fr/de words.
  const adjGloss = {};
  for (const [lang, map] of Object.entries(FOREIGN_ADJ)) {
    for (const [w, ar] of Object.entries(map)) {
      const k = adjKeyOf(ar);
      if (!adjGloss[k]) adjGloss[k] = {};
      if (!adjGloss[k][lang]) adjGloss[k][lang] = w;
    }
  }
  for (const [key, forms] of Object.entries(CURATED_ADJ)) {
    const g = adjGloss[key] ?? {};
    for (const f of [forms.m, forms.f]) {
      idx.set(normCoptic(f), { ar: key, en: g.en ?? "", fr: g.fr ?? "", de: g.de ?? "" });
    }
  }
  COPTIC_ADJ = idx;
  return idx;
}

// ---------- Reverse verb glosses (Arabic stem → en/fr/de conjugation data) ----------
// Curated for the common verbs first (the dictionary's first EN/FR/DE value is
// often a conjugated or secondary sense: ⲙⲉⲓ → "wish", ⲥⲱⲧⲉⲙ → "Hears").
// Keys are normalized Arabic stems (normalizeKeys, like CURATED_VERBS).
// en: {inf, past, part}; fr: {inf, group?, pres?, part, fut?, aux?, refl?};
// de: {inf, pres23?, past, part, aux?, sep?, refl?}.
export const REVERSE_VERB_GLOSS = normalizeKeys({
  "كتب": { en: { inf: "write", past: "wrote", part: "written" }, fr: { inf: "écrire", pres: ["écris", "écris", "écrit", "écrivons", "écrivez", "écrivent"], part: "écrit", fut: "écrir" }, de: { inf: "schreiben", past: "schrieb", part: "geschrieben" } },
  "احب": { en: { inf: "love", past: "loved", part: "loved" }, fr: { inf: "aimer", group: "er", part: "aimé" }, de: { inf: "lieben", past: "liebte", part: "geliebt" } },
  "قال": { en: { inf: "say", past: "said", part: "said" }, fr: { inf: "dire", pres: ["dis", "dis", "dit", "disons", "dites", "disent"], part: "dit", fut: "dir" }, de: { inf: "sagen", past: "sagte", part: "gesagt" } },
  "فعل": { en: { inf: "do", past: "did", part: "done" }, fr: { inf: "faire", pres: ["fais", "fais", "fait", "faisons", "faites", "font"], part: "fait", fut: "fer" }, de: { inf: "machen", past: "machte", part: "gemacht" } },
  "صنع": { en: { inf: "make", past: "made", part: "made" }, fr: { inf: "faire", pres: ["fais", "fais", "fait", "faisons", "faites", "font"], part: "fait", fut: "fer" }, de: { inf: "machen", past: "machte", part: "gemacht" } },
  "اعطي": { en: { inf: "give", past: "gave", part: "given" }, fr: { inf: "donner", group: "er", part: "donné" }, de: { inf: "geben", pres23: "gib", past: "gab", part: "gegeben" } },
  "راي": { en: { inf: "see", past: "saw", part: "seen" }, fr: { inf: "voir", pres: ["vois", "vois", "voit", "voyons", "voyez", "voient"], part: "vu", fut: "verr" }, de: { inf: "sehen", pres23: "sieh", past: "sah", part: "gesehen" } },
  "سمع": { en: { inf: "hear", past: "heard", part: "heard" }, fr: { inf: "entendre", group: "re", part: "entendu" }, de: { inf: "hören", past: "hörte", part: "gehört" } },
  "ذهب": { en: { inf: "go", past: "went", part: "gone" }, fr: { inf: "aller", pres: ["vais", "vas", "va", "allons", "allez", "vont"], part: "allé", fut: "ir", aux: "être" }, de: { inf: "gehen", past: "ging", part: "gegangen", aux: "sein" } },
  "مشي": { en: { inf: "walk", past: "walked", part: "walked" }, fr: { inf: "marcher", group: "er", part: "marché" }, de: { inf: "laufen", pres23: "läuf", past: "lief", part: "gelaufen", aux: "sein" } },
  "اكل": { en: { inf: "eat", past: "ate", part: "eaten" }, fr: { inf: "manger", group: "er", part: "mangé" }, de: { inf: "essen", pres23: "iss", past: "aß", part: "gegessen" } },
  "شرب": { en: { inf: "drink", past: "drank", part: "drunk" }, fr: { inf: "boire", pres: ["bois", "bois", "boit", "buvons", "buvez", "boivent"], part: "bu", fut: "boir" }, de: { inf: "trinken", past: "trank", part: "getrunken" } },
  "جلس": { en: { inf: "sit", past: "sat", part: "sat" }, fr: { inf: "s'asseoir", pres: ["assieds", "assieds", "assied", "asseyons", "asseyez", "asseyent"], part: "assis", fut: "assiér", refl: true }, de: { inf: "sitzen", past: "saß", part: "gesessen" } },
  "فتح": { en: { inf: "open", past: "opened", part: "opened" }, fr: { inf: "ouvrir", pres: ["ouvre", "ouvres", "ouvre", "ouvrons", "ouvrez", "ouvrent"], part: "ouvert", fut: "ouvrir" }, de: { inf: "öffnen", past: "öffnete", part: "geöffnet" } },
  "خلق": { en: { inf: "create", past: "created", part: "created" }, fr: { inf: "créer", group: "er", part: "créé" }, de: { inf: "erschaffen", past: "erschuf", part: "erschaffen" } },
  "بارك": { en: { inf: "bless", past: "blessed", part: "blessed" }, fr: { inf: "bénir", group: "ir", part: "béni" }, de: { inf: "segnen", past: "segnete", part: "gesegnet" } },
  "صلي": { en: { inf: "pray", past: "prayed", part: "prayed" }, fr: { inf: "prier", group: "er", part: "prié" }, de: { inf: "beten", past: "betete", part: "gebetet" } },
  "تكلم": { en: { inf: "speak", past: "spoke", part: "spoken" }, fr: { inf: "parler", group: "er", part: "parlé" }, de: { inf: "sprechen", pres23: "sprich", past: "sprach", part: "gesprochen" } },
  "جاء": { en: { inf: "come", past: "came", part: "come" }, fr: { inf: "venir", pres: ["viens", "viens", "vient", "venons", "venez", "viennent"], part: "venu", fut: "viendr", aux: "être" }, de: { inf: "kommen", past: "kam", part: "gekommen", aux: "sein" } },
  "اتي": { en: { inf: "come", past: "came", part: "come" }, fr: { inf: "venir", pres: ["viens", "viens", "vient", "venons", "venez", "viennent"], part: "venu", fut: "viendr", aux: "être" }, de: { inf: "kommen", past: "kam", part: "gekommen", aux: "sein" } },
  "وجد": { en: { inf: "find", past: "found", part: "found" }, fr: { inf: "trouver", group: "er", part: "trouvé" }, de: { inf: "finden", past: "fand", part: "gefunden" } },
  "ولد": { en: { inf: "bear", past: "bore", part: "born" }, fr: { inf: "naître", pres: ["nais", "nais", "naît", "naissons", "naissez", "naissent"], part: "né", fut: "naîtr", aux: "être" }, de: { inf: "gebären", pres23: "gebier", past: "gebar", part: "geboren" } },
  "طهر": { en: { inf: "purify", past: "purified", part: "purified" }, fr: { inf: "purifier", group: "er", part: "purifié" }, de: { inf: "reinigen", past: "reinigte", part: "gereinigt" } },
  "درس": { en: { inf: "study", past: "studied", part: "studied" }, fr: { inf: "étudier", group: "er", part: "étudié" }, de: { inf: "studieren", past: "studierte", part: "studiert" } },
  "علم": { en: { inf: "teach", past: "taught", part: "taught" }, fr: { inf: "enseigner", group: "er", part: "enseigné" }, de: { inf: "lehren", past: "lehrte", part: "gelehrt" } },
  "تعلم": { en: { inf: "learn", past: "learned", part: "learned" }, fr: { inf: "apprendre", pres: ["apprends", "apprends", "apprend", "apprenons", "apprenez", "apprennent"], part: "appris", fut: "apprendr" }, de: { inf: "lernen", past: "lernte", part: "gelernt" } },
  "نظر": { en: { inf: "look", past: "looked", part: "looked" }, fr: { inf: "regarder", group: "er", part: "regardé" }, de: { inf: "sehen", pres23: "sieh", past: "sah", part: "gesehen" } },
  "قام": { en: { inf: "rise", past: "rose", part: "risen" }, fr: { inf: "se lever", group: "er", part: "levé", refl: true }, de: { inf: "aufstehen", past: "stand", part: "aufgestanden", aux: "sein", sep: "auf" } },
  "مات": { en: { inf: "die", past: "died", part: "died" }, fr: { inf: "mourir", pres: ["meurs", "meurs", "meurt", "mourons", "mourez", "meurent"], part: "mort", fut: "mourr", aux: "être" }, de: { inf: "sterben", pres23: "stirb", past: "starb", part: "gestorben", aux: "sein" } },
  "عاش": { en: { inf: "live", past: "lived", part: "lived" }, fr: { inf: "vivre", pres: ["vis", "vis", "vit", "vivons", "vivez", "vivent"], part: "vécu", fut: "vivr" }, de: { inf: "leben", past: "lebte", part: "gelebt" } },
  "نام": { en: { inf: "sleep", past: "slept", part: "slept" }, fr: { inf: "dormir", pres: ["dors", "dors", "dort", "dormons", "dormez", "dorment"], part: "dormi", fut: "dormir" }, de: { inf: "schlafen", pres23: "schläf", past: "schlief", part: "geschlafen" } },
  "استيقظ": { en: { inf: "wake up", past: "woke up", part: "woken up" }, fr: { inf: "se réveiller", group: "er", part: "réveillé", refl: true }, de: { inf: "aufwachen", past: "wachte", part: "aufgewacht", aux: "sein", sep: "auf" } },
  "سكن": { en: { inf: "live", past: "lived", part: "lived" }, fr: { inf: "habiter", group: "er", part: "habité" }, de: { inf: "wohnen", past: "wohnte", part: "gewohnt" } },
  "اختبا": { en: { inf: "hide", past: "hid", part: "hidden" }, fr: { inf: "se cacher", group: "er", part: "caché", refl: true }, de: { inf: "sich verstecken", past: "versteckte", part: "versteckt", refl: true } },
  "اخذ": { en: { inf: "take", past: "took", part: "taken" }, fr: { inf: "prendre", pres: ["prends", "prends", "prend", "prenons", "prenez", "prennent"], part: "pris", fut: "prendr" }, de: { inf: "nehmen", pres23: "nimm", past: "nahm", part: "genommen" } },
  "خاف": { en: { inf: "fear", past: "feared", part: "feared" }, fr: { inf: "craindre", pres: ["crains", "crains", "craint", "craignons", "craignez", "craignent"], part: "craint", fut: "craindr" }, de: { inf: "fürchten", past: "fürchtete", part: "gefürchtet" } },
  "كان": { en: { inf: "be", past: "was", part: "been" }, fr: { inf: "être", pres: ["suis", "es", "est", "sommes", "êtes", "sont"], part: "été", fut: "ser" }, de: { inf: "sein", pres: ["bin", "bist", "ist", "sind", "seid", "sind"], past: "war", part: "gewesen", aux: "sein" } },
  "سار": { en: { inf: "walk", past: "walked", part: "walked" }, fr: { inf: "marcher", group: "er", part: "marché" }, de: { inf: "gehen", past: "ging", part: "gegangen", aux: "sein" } },
  "قرا": { en: { inf: "read", past: "read", part: "read" }, fr: { inf: "lire", pres: ["lis", "lis", "lit", "lisons", "lisez", "lisent"], part: "lu", fut: "lir" }, de: { inf: "lesen", pres23: "lies", past: "las", part: "gelesen" } },
});
// Form-I hamza-initial verbs (أكل، أخذ، أتى…): the 1s present is آكل, not
// أحب-style. Form-IV أ-initial verbs (أحب، أعطى…) take the stem as the 1s
// present. Unknown أ-initial verbs default to form IV (the commoner case).
const FORM1_HAMZA = new Set(["اكل", "اخذ", "اتي", "امر", "اذن", "امن", "ابي"].map(normalizeArabic));
// Hollow ء-final verbs whose past suffixes move the hamza (جاء → جئت، جاؤوا).
const HOLLOW_HAMZA_PAST = new Set(["جاء", "ساء", "شاء", "باء"].map(normalizeArabic));

// ---------- Arabic display conjugation ----------
// Unlike inflectArabicVerb (internal gloss, never shown), this renders correct
// display Arabic: أحب (not أاحب), يقرأ, آكل, جئت, أحببت, سأكتب.
// stem: the DISPLAY past stem (أحب, قرأ, جاء, كتب...); person: 1s/2m/2f/3m/3f/1p/2p/3p.
function arabicPresentStem(stemRaw) {
  const norm = normalizeArabic(stemRaw);
  if (HOLLOW_PAST_TO_PRESENT[norm]) return HOLLOW_PAST_TO_PRESENT[norm];
  if (stemRaw.endsWith("ى")) {
    // ى-final: أعطى → عطي (drop the form-IV أ, ى → ي); رأى → رى (drop the medial أ).
    if (stemRaw.startsWith("أ")) return stemRaw.slice(1, -1) + "ي";
    const mid = stemRaw.slice(0, -1);
    return mid.replace(/أ/g, "") + "ى";
  }
  if (stemRaw.startsWith("أ") && !FORM1_HAMZA.has(norm)) return stemRaw.slice(1); // form IV: أحب → حب
  return stemRaw;
}
function arabicConjugate(stemRaw, tense, person) {
  const norm = normalizeArabic(stemRaw);
  const pres = arabicPresentStem(stemRaw);
  if (tense === "past") {
    const gem = GEMINATE_VERBS.has(norm);
    const d = gem ? stemRaw + stemRaw.slice(-1) : stemRaw;
    const hamzaFinal = stemRaw.endsWith("ء");
    const hollowHamza = HOLLOW_HAMZA_PAST.has(norm);
    switch (person) {
      case "3m": return stemRaw;
      case "3f": return stemRaw + "ت";
      case "3p": return hamzaFinal ? stemRaw.slice(0, -1) + "ؤوا" : stemRaw + "وا";
      case "1s": case "2m": return hollowHamza ? stemRaw.slice(0, -1) + "ئت" : d + "ت";
      case "2f": return (hollowHamza ? stemRaw.slice(0, -1) + "ئت" : d + "ت") + "ِ";
      case "1p": return (hollowHamza ? stemRaw.slice(0, -1) + "ئ" : d) + "نا";
      case "2p": return (hollowHamza ? stemRaw.slice(0, -1) + "ئ" : d) + "تم";
      default: return stemRaw;
    }
  }
  // present (future adds س- outside)
  const suf = (w) => {
    // ء-final present stems take ئ before ون/ين (يقرؤون، تقرئين، يجيئون).
    if (!w) return w;
    if (pres.endsWith("ء")) return pres.slice(0, -1) + "ئ" + w;
    return pres + w;
  };
  let form;
  switch (person) {
    case "1s":
      form = FORM1_HAMZA.has(norm) ? "آ" + pres.slice(1) : "أ" + pres;
      break;
    case "2m": case "3f": form = "ت" + pres; break;
    case "2f": form = "ت" + suf("ين"); break;
    case "3m": form = "ي" + pres; break;
    case "1p": form = "ن" + pres; break;
    case "2p": form = "ت" + suf("ون"); break;
    case "3p": form = "ي" + suf("ون"); break;
    default: form = "ي" + pres;
  }
  return tense === "future" ? "س" + form : form;
}
// Negation word + present-tense verb (لم/لن/لا all take the present form).
function arabicNegatedVerb(stemRaw, tense, person) {
  const neg = tense === "past" ? "لم" : tense === "future" ? "لن" : "لا";
  return `${neg} ${arabicConjugate(stemRaw, "present", person)}`;
}

// ---------- Foreign verb gloss resolution ----------
// Curated table first; otherwise the dictionary record's first en/fr/de value,
// cleaned to an infinitive (the forward stemmers recover it when the record's
// first value is a conjugated form, e.g. "Hears" → hear).
function cleanForeignInfinitive(lang, word) {
  let w = String(word ?? "").toLowerCase().trim().replace(/^to\s+/, "");
  if (!w) return "";
  if (lang === "en") {
    if (w === "does") return "do";
    if (w === "has") return "have";
    if (w === "is") return "be";
    if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
    if (/(ches|shes|xes|zes|sses)$/.test(w)) return w.slice(0, -2);
    if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && w.length > 2) return w.slice(0, -1);
    return w;
  }
  return w;
}
function verbGloss(lang, arStem, rec) {
  const cur = REVERSE_VERB_GLOSS[normalizeArabic(arStem)];
  if (cur?.[lang]) return cur[lang];
  const raw = lang === "en" ? rec?.en : lang === "fr" ? rec?.fr : rec?.de;
  if (!raw) return null;
  const stemmed = VERB_FORM[lang](raw.toLowerCase());
  const inf = stemmed?.inf ?? cleanForeignInfinitive(lang, raw);
  if (!inf) return null;
  if (lang === "en") return { inf, past: enRegularPast(inf), part: enRegularPast(inf) };
  if (lang === "fr") return { inf, group: frGroupOf(inf), part: frRegularPart(inf) };
  // Separable verbs (aufstehen, mitmachen…): the prefix goes to the end of the
  // clause in the present tense and before ge- in the participle (aufgestanden).
  const sep = DE_SEP_PREFIXES.find((p) => inf.startsWith(p) && inf.length > p.length + 2) ?? null;
  const base = sep ? inf.slice(sep.length) : inf;
  return { inf, past: deRegularPast(base), part: (sep ?? "") + deRegularPart(base), sep };
}
const DE_SEP_PREFIXES = ["zurück", "zusammen", "weiter", "auf", "ab", "an", "aus", "ein", "mit", "nach", "vor", "zu", "weg", "fest", "los", "her", "hin"];
function enRegularPast(inf) {
  if (/[^aeiou]y$/.test(inf)) return inf.slice(0, -1) + "ied";
  if (/e$/.test(inf)) return inf + "d";
  if (/([^aeiou])([aeiou])([^aeiouwx])$/.test(inf) && inf.length <= 5) return inf + inf.slice(-1) + "ed";
  return inf + "ed";
}
function frGroupOf(inf) {
  if (inf.endsWith("er")) return "er";
  if (inf.endsWith("ir")) return "ir";
  if (inf.endsWith("re")) return "re";
  return "er";
}
function frRegularPart(inf) {
  if (inf.endsWith("er")) return inf.slice(0, -2) + "é";
  if (inf.endsWith("ir")) return inf.slice(0, -1);
  if (inf.endsWith("re")) return inf.slice(0, -2) + "u";
  return inf;
}
function deRegularPast(inf) {
  const stem = deStemOf(inf);
  return stem + (/[td]$/.test(stem) ? "ete" : "te");
}
function deRegularPart(inf) {
  const stem = deStemOf(inf);
  return "ge" + stem + (/[td]$/.test(stem) ? "et" : "t");
}
function deStemOf(inf) {
  let s = String(inf ?? "").replace(/^(sich|se)\s+/, "");
  if (s.endsWith("en")) return s.slice(0, -2);
  if (s.endsWith("n")) return s.slice(0, -1);
  return s;
}

// ---------- Foreign noun pluralization + article gender ----------
// Coptic gender (m/f/pl from the dictionary kind) does NOT decide the French
// or German article: ⲟⲩⲱⲓⲛⲓ is masculine in Coptic but "la lumière" is
// feminine, "das Licht" neuter. These tables cover the common nouns; unknown
// words fall back to the Coptic gender (m → le/der, f → la/die, pl → les/die).
const FR_GENDER = { livre: "m", "église": "f", "leçon": "f", monde: "m", "lumière": "f", eau: "f", dieu: "m", ami: "m", amie: "f", "frère": "m", "sœur": "f", "père": "m", "mère": "f", professeur: "m", "élève": "m", maison: "f", mot: "m", nom: "m", jour: "m", nuit: "f", ciel: "m", terre: "f", soleil: "m", lune: "f", pain: "m", vin: "m", roi: "m", reine: "f", "prêtre": "m", moine: "m", disciple: "m", serviteur: "m", "maître": "m", enfant: "m", homme: "m", femme: "f", "garçon": "m", fille: "f", "évangile": "m", "étoile": "f", mer: "f", montagne: "f", "arbre": "m", pierre: "f", porte: "f", chemin: "m", "cœur": "m", main: "f", "œil": "m", parole: "f", "vérité": "f", vie: "f", mort: "f", amour: "m", paix: "f", "école": "f", temps: "m", "année": "f", "semaine": "f", voix: "f", "ténèbres": "f", "esprit": "m", "ange": "m", "apôtre": "m", "prophète": "m", "saint": "m", sainte: "f", "croix": "f", "prière": "f", "chanson": "f", "histoire": "f", "lettre": "f", "langue": "f", "ville": "f", "village": "m", "champ": "m", "fleur": "f", "oiseau": "m", "poisson": "m", "cheval": "m", "chien": "m", "chat": "m" };
const DE_GENDER = { buch: "n", kirche: "f", lektion: "f", welt: "f", licht: "n", wasser: "n", gott: "m", freund: "m", bruder: "m", schwester: "f", vater: "m", mutter: "f", lehrer: "m", "schüler": "m", haus: "n", wort: "n", name: "m", tag: "m", nacht: "f", himmel: "m", erde: "f", sonne: "f", mond: "m", brot: "n", wein: "m", "könig": "m", "königin": "f", priester: "m", "mönch": "m", "jünger": "m", diener: "m", meister: "m", kind: "n", mann: "m", frau: "f", junge: "m", "mädchen": "n", evangelium: "n", stern: "m", meer: "n", berg: "m", baum: "m", stein: "m", "tür": "f", weg: "m", herz: "n", hand: "f", auge: "n", wahrheit: "f", leben: "n", tod: "m", liebe: "f", frieden: "m", schule: "f", zeit: "f", jahr: "n", woche: "f", stimme: "f", finsternis: "f", geist: "m", engel: "m", apostel: "m", prophet: "m", heiliger: "m", heilige: "f", kreuz: "n", gebet: "n", lied: "n", geschichte: "f", brief: "m", sprache: "f", stadt: "f", dorf: "n", feld: "n", blume: "f", vogel: "m", fisch: "m", pferd: "n", hund: "m", katze: "f" };
const DE_PLURAL = { buch: "Bücher", licht: "Lichter", welt: "Welten", lektion: "Lektionen", kirche: "Kirchen", gott: "Götter", freund: "Freunde", bruder: "Brüder", schwester: "Schwestern", vater: "Väter", mutter: "Mütter", lehrer: "Lehrer", "schüler": "Schüler", haus: "Häuser", wort: "Worte", name: "Namen", tag: "Tage", nacht: "Nächte", himmel: "Himmel", erde: "Erden", sonne: "Sonnen", mond: "Monde", brot: "Brote", wein: "Weine", "könig": "Könige", "königin": "Königinnen", priester: "Priester", "mönch": "Mönche", "jünger": "Jünger", diener: "Diener", meister: "Meister", kind: "Kinder", mann: "Männer", frau: "Frauen", junge: "Jungen", "mädchen": "Mädchen", evangelium: "Evangelien", stern: "Sterne", meer: "Meere", berg: "Berge", baum: "Bäume", stein: "Steine", "tür": "Türen", weg: "Wege", herz: "Herzen", hand: "Hände", auge: "Augen", wahrheit: "Wahrheiten", leben: "Leben", tod: "Tode", liebe: "Lieben", frieden: "Frieden", schule: "Schulen", zeit: "Zeiten", jahr: "Jahre", woche: "Wochen", stimme: "Stimmen", finsternis: "Finsternisse", geist: "Geister", engel: "Engel", apostel: "Apostel", prophet: "Propheten", kreuz: "Kreuze", gebet: "Gebete", lied: "Lieder", geschichte: "Geschichten", brief: "Briefe", sprache: "Sprachen", stadt: "Städte", dorf: "Dörfer", feld: "Felder", blume: "Blumen", vogel: "Vögel", fisch: "Fische", pferd: "Pferde", hund: "Hunde", katze: "Katzen", wasser: "Wasser" };
const EN_PLURAL_IRREG = { man: "men", woman: "women", child: "children", foot: "feet", tooth: "teeth", person: "people", mouse: "mice", goose: "geese" };
function pluralizeEN(word) {
  const w = String(word ?? "");
  if (!w) return w;
  const low = w.toLowerCase();
  if (EN_PLURAL_IRREG[low]) return w[0] === w[0].toUpperCase() ? EN_PLURAL_IRREG[low][0].toUpperCase() + EN_PLURAL_IRREG[low].slice(1) : EN_PLURAL_IRREG[low];
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
  if (/(s|x|ch|sh)$/.test(w)) return w + "es";
  return w + "s";
}
function pluralizeFR(word) {
  const w = String(word ?? "");
  if (!w) return w;
  if (/[sxz]$/.test(w)) return w;
  if (w.endsWith("eau")) return w + "x";
  if (w.endsWith("al")) return w.slice(0, -2) + "aux";
  if (w === "œil") return "yeux";
  if (w === "ciel") return "cieux";
  return w + "s";
}
function pluralizeDE(word) {
  const w = String(word ?? "");
  if (!w) return w;
  const p = DE_PLURAL[w.toLowerCase()];
  if (p) return p;
  // Weak fallback: +e (often wrong for strong nouns — the table covers the common ones).
  return w + "e";
}
function frGenderOf(word, copticGender) {
  if (copticGender === "pl") return "pl";
  return FR_GENDER[String(word ?? "").toLowerCase()] ?? copticGender;
}
function deGenderOf(word, copticGender) {
  if (copticGender === "pl") return "pl";
  return DE_GENDER[String(word ?? "").toLowerCase()] ?? copticGender;
}

// ---------- Foreign verb conjugation ----------
// Returns {verb, aux?, sep?}: `verb` is the conjugated form (for the perfect /
// future the auxiliary is returned separately so the renderer can place the
// participle / infinitive after the object in EN/FR/DE order). `sep` is a
// separable DE prefix that goes to the end of the clause in the present tense.
const PERSON_IDX = { "1s": 0, "2m": 1, "2f": 1, "3m": 2, "3f": 2, "1p": 3, "2p": 4, "3p": 5 };
function conjugateEN(gloss, tense, person, neg) {
  if (!gloss) return { verb: "" };
  const inf = gloss.inf;
  const p3s = person === "3m" || person === "3f";
  if (inf === "be") {
    const pres = person === "1s" ? "am" : p3s ? "is" : "are";
    const past = person === "1s" || person === "3m" || person === "3f" ? "was" : "were";
    if (neg) {
      if (tense === "past") return { verb: past + " not" };
      if (tense === "future") return { verb: "will not be" };
      return { verb: pres + " not" };
    }
    if (tense === "past") return { verb: past };
    if (tense === "future") return { verb: "will be" };
    return { verb: pres };
  }
  if (neg) {
    if (tense === "past") return { verb: "didn't " + inf };
    if (tense === "future") return { verb: "won't " + inf };
    return { verb: (p3s ? "doesn't " : "don't ") + inf };
  }
  if (tense === "past") return { verb: gloss.past };
  if (tense === "future") return { verb: "will " + inf };
  return { verb: p3s ? enPresent3s(inf) : inf };
}
function enPresent3s(inf) {
  if (inf === "have") return "has";
  if (/[^aeiou]y$/.test(inf)) return inf.slice(0, -1) + "ies";
  if (/(s|x|ch|sh)$/.test(inf)) return inf + "es";
  return inf + "s";
}
function frPresentForm(gloss) {
  const inf = gloss.inf.replace(/^s['’]/, "").replace(/^se\s+/, "");
  if (gloss.pres) return gloss.pres;
  const group = gloss.group ?? frGroupOf(inf);
  if (group === "er") {
    let stem = inf.slice(0, -2);
    const endings = ["e", "es", "e", "ons", "ez", "ent"];
    // -ger → nous mangeons; -cer → nous commençons.
    const p1 = stem.endsWith("g") ? stem + "eons" : stem.endsWith("c") ? stem.slice(0, -1) + "çons" : stem + "ons";
    const forms = endings.map((e, i) => (i === 3 ? p1 : stem + e));
    // e → è before a single final consonant (lever → lève), except -eler/-eter
    // which double the consonant (appeler → appelle, jeter → jette).
    const m = /^(.*)(e)([bcdfgklmnpqrstvwxz])$/.exec(stem);
    if (m && !/(el|et)$/.test(stem)) {
      const alt = m[1] + "è" + m[3];
      forms[0] = alt + "e"; forms[1] = alt + "es"; forms[2] = alt + "e"; forms[5] = alt + "ent";
    } else if (/(el|et)$/.test(stem)) {
      const dbl = stem + stem.slice(-1);
      forms[0] = dbl + "e"; forms[1] = dbl + "es"; forms[2] = dbl + "e"; forms[5] = dbl + "ent";
    }
    return forms;
  }
  if (group === "ir") {
    const stem = inf.slice(0, -2);
    return [stem + "is", stem + "is", stem + "it", stem + "issons", stem + "issez", stem + "issent"];
  }
  const stem = inf.slice(0, -2); // -re
  return [stem + "s", stem + "s", stem, stem + "ons", stem + "ez", stem + "ent"];
}
function conjugateFR(gloss, tense, person, gender, plural, neg) {
  if (!gloss) return { verb: "" };
  const idx = PERSON_IDX[person] ?? 2;
  const refl = gloss.refl ? ["me", "te", "se", "nous", "vous", "se"][idx] : null;
  const reflForm = (v) => {
    if (!refl) return v;
    const r = /^[aeiouéèêh]/.test(v) ? refl.slice(0, -1) + "'" : refl;
    return `${r} ${v}`;
  };
  if (tense === "past") {
    const aux = gloss.aux === "être"
      ? ["suis", "es", "est", "sommes", "êtes", "sont"][idx]
      : ["ai", "as", "a", "avons", "avez", "ont"][idx];
    let part = gloss.part;
    if (gloss.aux === "être") {
      if (plural) part += gender === "f" ? "es" : "s";
      else if (gender === "f") part += "e";
    }
    if (neg) {
      const neAux = /^[aeiouéèêh]/.test(aux) ? `n'${aux}` : `ne ${aux}`;
      return { verb: `${neAux} pas ${reflForm(part)}` };
    }
    return { verb: reflForm(`${aux} ${part}`) };
  }
  if (tense === "future") {
    const stem = gloss.fut ?? (gloss.inf.endsWith("re") ? gloss.inf.slice(0, -1) : gloss.inf);
    const end = ["ai", "as", "a", "ons", "ez", "ont"][idx];
    const v = stem.replace(/^s['’]/, "").replace(/^se\s+/, "") + end;
    if (neg) {
      const full = reflForm(v);
      const ne = /^[aeiouéèêh]/.test(full) ? "n'" : "ne ";
      return { verb: `${ne}${full} pas` };
    }
    return { verb: reflForm(v) };
  }
  const v = frPresentForm(gloss)[idx];
  if (neg) {
    // "ne" elides only when the next word starts with a vowel — the reflexive
    // pronoun (me/te/se/nous/vous) starts with a consonant, so "ne m'assieds pas".
    const full = reflForm(v);
    const ne = /^[aeiouéèêh]/.test(full) ? "n'" : "ne ";
    return { verb: `${ne}${full} pas` };
  }
  return { verb: reflForm(v) };
}
function conjugateDE(gloss, tense, person, gender, plural, neg) {
  if (!gloss) return { verb: "" };
  const idx = PERSON_IDX[person] ?? 2;
  const inf = gloss.inf;
  const refl = gloss.refl ? ["mich", "dich", "sich", "uns", "euch", "sich"][idx] : null;
  // Separable prefix: "aufstehen" → stem "steh" + prefix "auf".
  let stem = deStemOf(inf);
  const sep = gloss.sep ?? null;
  if (sep && stem.startsWith(sep)) stem = stem.slice(sep.length);
  if (tense === "past") {
    const aux = gloss.aux === "sein"
      ? ["bin", "bist", "ist", "sind", "seid", "sind"][idx]
      : ["habe", "hast", "hat", "haben", "habt", "haben"][idx];
    const v = `${aux} ${gloss.part}`;
    return { verb: refl ? `${v} ${refl}` : v };
  }
  if (tense === "future") {
    const werd = ["werde", "wirst", "wird", "werden", "werdet", "werden"][idx];
    return { verb: refl ? `${werd} ${refl} ${inf}` : `${werd} ${inf}` };
  }
  // Present: full table for sein, else stem + endings.
  if (gloss.pres) return { verb: refl ? `${gloss.pres[idx]} ${refl}` : gloss.pres[idx], sep };
  const useStem = (idx === 1 || idx === 2) && gloss.pres23 ? gloss.pres23 : stem;
  const tEnd = /[td]$/.test(useStem);
  const sEnd = /[sßxz]$/.test(useStem);
  const endings = tEnd ? ["e", "est", "et", "en", "et", "en"] : sEnd ? ["e", "t", "t", "en", "t", "en"] : ["e", "st", "t", "en", "t", "en"];
  const v = useStem + endings[idx];
  return { verb: refl ? `${v} ${refl}` : v, sep };
}

// ---------- Reverse sentence parsing + rendering ----------
// Raw tokens keep the jinkim (ⲙ̀/ⲛ̀/ⲉ̀ object and genitive markers are only
// visible there); normalized tokens are used for every lookup.
const MARKER = "\u0300"; // jinkim
function rawIsMarker(t) { return !!t && (t === `ⲙ${MARKER}` || t === `ⲛ${MARKER}` || t === `ⲉ${MARKER}`); }
function rawStripMarker(t) {
  if (!t) return null;
  for (const m of [`ⲙ${MARKER}`, `ⲛ${MARKER}`, `ⲉ${MARKER}`]) if (t.startsWith(m)) return t.slice(m.length);
  return null;
}
// Subject pronouns (Coptic separate form → person), inverted from SUBJ_PRONOUNS.
const REVERSE_SUBJ_PRONOUN = { "ⲁⲛⲟⲕ": "1s", "ⲛⲑⲟⲕ": "2m", "ⲛⲑⲟ": "2f", "ⲛⲑⲟϥ": "3m", "ⲛⲑⲟⲥ": "3f", "ⲁⲛⲟⲛ": "1p", "ⲛⲑⲱⲧⲉⲛ": "2p", "ⲛⲑⲱⲟⲩ": "3p" };
const AR_SUBJ = { "1s": "أنا", "2m": "أنتَ", "2f": "أنتِ", "3m": "هو", "3f": "هي", "1p": "نحن", "2p": "أنتم", "3p": "هم" };
const EN_SUBJ = { "1s": "I", "2m": "you", "2f": "you", "3m": "he", "3f": "she", "1p": "we", "2p": "you", "3p": "they" };
const FR_SUBJ = { "1s": "je", "2m": "tu", "2f": "tu", "3m": "il", "3f": "elle", "1p": "nous", "2p": "vous", "3p": "ils" };
const DE_SUBJ = { "1s": "ich", "2m": "du", "2f": "du", "3m": "er", "3f": "sie", "1p": "wir", "2p": "ihr", "3p": "sie" };
// Possessive Coptic prefix → {person, nounGender}, inverted from POSSESSIVE.
const POSS_PERSON = { "ي": "1s", "ك": "2m", "كي": "2f", "ه": "3m", "ها": "3f", "نا": "1p", "كم": "2p", "هم": "3p" };
const REVERSE_POSSESSIVE = Object.entries(POSSESSIVE).flatMap(([suf, byGender]) =>
  Object.entries(byGender).map(([g, pref]) => [normCoptic(pref), { person: POSS_PERSON[suf], gender: g }])
).sort((a, b) => b[0].length - a[0].length);
// Prepositions (Coptic → ar/en/fr/de), inverted from PREPOSITIONS + glosses.
const PREP_GLOSS = {
  "ϧⲉⲛ": { ar: "في", en: "in", fr: "dans", de: "in", deCase: "dat" },
  "ⲉ": { ar: "إلى", en: "to", fr: "à", de: "nach", deCase: "dat" },
  "ⲉⲃⲟⲗϧⲉⲛ": { ar: "من", en: "from", fr: "de", de: "von", deCase: "dat" },
  "ⲛⲉⲙ": { ar: "مع", en: "with", fr: "avec", de: "mit", deCase: "dat" },
  "ⲛⲁ": { ar: "ل", en: "for", fr: "pour", de: "für", deCase: "acc" },
  "ϩⲓϫⲉⲛ": { ar: "على", en: "on", fr: "sur", de: "auf", deCase: "dat" },
  "ⲉⲑⲃⲉ": { ar: "عن", en: "about", fr: "de", de: "über", deCase: "acc" },
  "ⲙⲉⲛⲉⲛⲥⲁ": { ar: "بعد", en: "after", fr: "après", de: "nach", deCase: "dat" },
  "ϩⲁϫⲱ": { ar: "قبل", en: "before", fr: "avant", de: "vor", deCase: "dat" },
  "ϣⲁ": { ar: "حتى", en: "until", fr: "jusqu'à", de: "bis", deCase: "acc" },
  "ⲟⲩⲧⲉ": { ar: "بين", en: "between", fr: "entre", de: "zwischen", deCase: "dat" },
  "ⲟⲩⲃⲉ": { ar: "ضد", en: "against", fr: "contre", de: "gegen", deCase: "acc" },
  "ⲁϭⲛ": { ar: "بدون", en: "without", fr: "sans", de: "ohne", deCase: "acc" },
  "ϩⲁⲣⲟ": { ar: "عند", en: "at", fr: "chez", de: "bei", deCase: "dat" },
  "ϩⲓ": { ar: "فوق", en: "above", fr: "sur", de: "über", deCase: "dat" },
  "ϧⲁ": { ar: "تحت", en: "under", fr: "sous", de: "unter", deCase: "dat" },
  "ⲙⲡⲉⲙⲑⲟ": { ar: "أمام", en: "before", fr: "devant", de: "vor", deCase: "dat" },
};
// Question words (Coptic → ar/en/fr/de), inverted from QUESTION_WORDS.
const QWORD_GLOSS = {
  "ⲛⲓⲙ": { ar: "من", en: "Who", fr: "Qui", de: "Wer" },
  "ⲁϣ": { ar: "ماذا", en: "What", fr: "Que", de: "Was" },
  "ⲟⲩ": { ar: "ما", en: "What", fr: "Que", de: "Was" },
  "ⲑⲱⲛ": { ar: "أين", en: "Where", fr: "Où", de: "Wo" },
  "ⲑⲛⲁⲩ": { ar: "متى", en: "When", fr: "Quand", de: "Wann" },
  "ⲡⲱⲥ": { ar: "كيف", en: "How", fr: "Comment", de: "Wie" },
  "ⲟⲩⲏⲣ": { ar: "كم", en: "How many", fr: "Combien", de: "Wie viele" },
  "ⲙⲏ": { ar: "هل", en: null, fr: null, de: null },
};
// Demonstratives (adjective form → this/that), inverted from DEMONSTRATIVE.
const DEMONSTRATIVE_REVERSE = { "ⲡⲁⲓ": "this", "ⲧⲁⲓ": "this", "ⲛⲁⲓ": "this", "ⲫⲏ": "that", "ⲑⲏ": "that", "ⲛⲏⲉⲧ": "that" };
// Demonstrative pronouns (standalone "this/that"), inverted from DEMONSTRATIVE.
const DEM_PRONOUN = {
  "ⲫⲁⲓ": { word: "this", gender: "m" }, "ⲑⲁⲓ": { word: "this", gender: "f" }, "ⲛⲁⲓ": { word: "this", gender: "pl" },
  "ⲫⲏ": { word: "that", gender: "m" }, "ⲑⲏ": { word: "that", gender: "f" }, "ⲛⲏ": { word: "that", gender: "pl" },
};
// Copula (standalone token → gender). The forward engine has no nominal
// past: ⲛⲉ is the plural copula, present tense only.
const COPULA = { "ⲡⲉ": "m", "ⲧⲉ": "f", "ⲛⲉ": "pl" };
const HAVE_FORMS = { "ⲟⲩⲛⲧⲏⲓ": "1s", "ⲟⲩⲛⲧⲁⲕ": "2m", "ⲟⲩⲛⲧⲉ": "2f", "ⲟⲩⲛⲧⲁϥ": "3m", "ⲟⲩⲛⲧⲁⲥ": "3f", "ⲟⲩⲛⲧⲁⲛ": "1p", "ⲟⲩⲛⲧⲉⲧⲉⲛ": "2p", "ⲟⲩⲛⲧⲟⲩ": "3p" };
const HAVE_NEG_FORMS = { "ⲙⲟⲛⲧⲏⲓ": "1s", "ⲙⲟⲛⲧⲁⲕ": "2m", "ⲙⲟⲛⲧⲉ": "2f", "ⲙⲟⲛⲧⲁϥ": "3m", "ⲙⲟⲛⲧⲁⲥ": "3f", "ⲙⲟⲛⲧⲁⲛ": "1p", "ⲙⲟⲛⲧⲉⲧⲉⲛ": "2p", "ⲙⲟⲛⲧⲟⲩ": "3p" };

// Lowercase a foreign gloss for mid-sentence use (proper nouns keep their cap;
// German nouns are always capitalised, so DE never calls this).
function lowerForeign(w, proper) {
  const s = String(w ?? "");
  if (!s || proper) return s;
  return s[0].toLowerCase() + s.slice(1);
}
// Definite article + stem (ⲡⲓ/ϯ/ⲛⲓ; ⲫ̀/ⲑ̀ only when the rest is a known noun).
function stripCopticArticle(n) {
  if (n.startsWith("ⲡⲓ")) return { stem: n.slice(2), definite: true, gender: "m" };
  if (n.startsWith("ϯ")) return { stem: n.slice(1), definite: true, gender: "f" };
  if (n.startsWith("ⲛⲓ")) return { stem: n.slice(2), definite: true, gender: "pl" };
  if (n.startsWith("ⲫ") && buildCopticNounIndex().has(n.slice(1))) return { stem: n.slice(1), definite: true, gender: "m" };
  if (n.startsWith("ⲑ") && buildCopticNounIndex().has(n.slice(1))) return { stem: n.slice(1), definite: true, gender: "f" };
  return null;
}
// One token → noun phrase head (possessive / article / bare). Null if not a noun.
function parseReverseNPToken(tok) {
  const n = normCoptic(tok);
  const nouns = buildCopticNounIndex();
  for (const [pref, info] of REVERSE_POSSESSIVE) {
    if (n.startsWith(pref) && n.length > pref.length) {
      const e = nouns.get(n.slice(pref.length));
      if (e) return { head: e, definite: false, possessive: info.person, plural: e.plural || info.gender === "pl", gender: e.gender, genitive: null, adjective: null, demonstrative: null };
    }
  }
  const art = stripCopticArticle(n);
  if (art) {
    const e = nouns.get(art.stem);
    if (e) return { head: e, definite: true, possessive: null, plural: e.plural || art.gender === "pl", gender: e.gender, genitive: null, adjective: null, demonstrative: null };
  }
  const e = nouns.get(n);
  if (e) return { head: e, definite: false, possessive: null, plural: e.plural, gender: e.gender, genitive: null, adjective: null, demonstrative: null };
  return null;
}
// Try to read a noun phrase starting at tokens[i] (raw tokens). Handles an
// object/genitive marker attached to the first token, demonstratives, and a
// following genitive (ⲙ̀/ⲛ̀ + NP) or adjective linker (ⲛ̀/ⲙ̀ + adjective).
// Returns {np, next} or null. `unknown` collects tokens that look like words.
function parseReverseNP(rawTokens, i, unknown) {
  if (i >= rawTokens.length) return null;
  let tok = rawTokens[i];
  let stripped = rawStripMarker(tok);
  if (stripped !== null && stripped !== "") tok = stripped;
  // Demonstrative + noun.
  if (DEMONSTRATIVE_REVERSE[normCoptic(tok)]) {
    const rest = parseReverseNP(rawTokens, i + 1, unknown);
    if (rest) { rest.np.demonstrative = DEMONSTRATIVE_REVERSE[normCoptic(tok)]; return { np: rest.np, next: rest.next }; }
    return null;
  }
  const one = parseReverseNPToken(tok);
  if (!one) return null;
  let np = one, j = i + 1;
  // Genitive / adjective linker (at most one of each, in either order).
  for (let guard = 0; guard < 2 && j < rawTokens.length; guard++) {
    let linkTok = rawTokens[j], k = j;
    if (rawIsMarker(linkTok)) { k = j + 1; }
    else {
      const s = rawStripMarker(linkTok);
      if (s !== null && s !== "") { linkTok = s; k = j; }
      else {
        // No jinkim typed: a leading ⲙ/ⲛ whose remainder parses as an NP/adjective.
        const nn = normCoptic(linkTok);
        if ((nn.startsWith("ⲙ") || nn.startsWith("ⲛ")) && (parseReverseNPToken(nn.slice(1)) || buildCopticAdjIndex().has(nn.slice(1)))) { linkTok = nn.slice(1); k = j; }
        else break;
      }
    }
    if (k >= rawTokens.length) break;
    const adjWord = normCoptic(k === j ? linkTok : rawTokens[k]);
    const adj = buildCopticAdjIndex().get(adjWord);
    if (adj && !np.adjective) { np.adjective = adj; j = k + 1; continue; }
    const gen = parseReverseNP(k === j ? [linkTok, ...rawTokens.slice(k + 1)] : rawTokens, k === j ? 0 : k, unknown);
    if (gen && !np.genitive) { np.genitive = gen.np; j = k === j ? j + gen.next : gen.next; continue; }
    break;
  }
  return { np, next: j };
}
// Verb token → {person, tense, neg, stem (normalized Arabic), entry, imperative, prohibitive}.
// The remainder after stripping a prefix MUST be a known verb stem — that is
// what keeps bare ⲕ/ϥ/ⲥ-initial verbs from being misread as prefixed forms.
function parseReverseVerbToken(tok, allowRelative = true) {
  const n = normCoptic(tok);
  const verbs = buildCopticVerbIndex();
  const hit = (stem) => verbs.get(normCoptic(stem)) ?? null;
  const mk = (person, tense, neg, stem, extra = {}) => {
    const entry = hit(stem);
    if (!entry) return null;
    return { person, tense, neg, stem: entry.ar, entry, imperative: false, prohibitive: false, ...extra };
  };
  // Relative ⲉⲧⲉ- (present) / ⲉⲧⲁ- (past) + subject prefix + verb.
  if (allowRelative && (n.startsWith("ⲉⲧⲉ") || n.startsWith("ⲉⲧⲁ"))) {
    const inner = parseReverseVerbToken(n.slice(3), false);
    if (inner) return { ...inner, tense: n.startsWith("ⲉⲧⲁ") ? "past" : inner.tense };
  }
  // Prohibition ⲙ̀ⲡⲉⲣ- (before ⲙ̀ⲡⲉ 2f past-neg: longest first).
  if (n.startsWith("ⲙⲡⲉⲣ")) { const r = mk("2m", "present", true, n.slice(5), { prohibitive: true, imperative: true }); if (r) return r; }
  // Past negation ⲙ̀ⲡⲓ/ⲙ̀ⲡⲉⲕ/ⲙ̀ⲡⲉ/ⲙ̀ⲡⲉϥ/ⲙ̀ⲡⲉⲥ/ⲙ̀ⲡⲉⲛ/ⲙ̀ⲡⲉⲧⲉⲛ/ⲙ̀ⲡⲟⲩ (longest first).
  for (const [person, pref] of [["2p", "ⲙⲡⲉⲧⲉⲛ"], ["2m", "ⲙⲡⲉⲕ"], ["3m", "ⲙⲡⲉϥ"], ["3f", "ⲙⲡⲉⲥ"], ["1p", "ⲙⲡⲉⲛ"], ["1s", "ⲙⲡⲓ"], ["2f", "ⲙⲡⲉ"], ["3p", "ⲙⲡⲟⲩ"]]) {
    if (n.startsWith(pref)) { const r = mk(person, "past", true, n.slice(pref.length)); if (r) return r; }
  }
  // Future prefixes (longest first).
  for (const [person, pref] of [["2p", "ⲧⲉⲧⲉⲛⲛⲁ"], ["1p", "ⲧⲉⲛⲛⲁ"], ["1s", "ϯⲛⲁ"], ["2m", "ⲭⲛⲁ"], ["2f", "ⲧⲉⲣⲁ"], ["3m", "ϥⲛⲁ"], ["3f", "ⲥⲛⲁ"], ["3p", "ⲥⲉⲛⲁ"]]) {
    if (n.startsWith(pref)) { const r = mk(person, "future", false, n.slice(pref.length)); if (r) return r; }
  }
  // Noun-subject future marker ⲛⲁ + verb (person filled in by the sentence parser).
  if (n.startsWith("ⲛⲁ")) { const r = mk(null, "future", false, n.slice(2)); if (r) return r; }
  // Past prefixes (longest first).
  for (const [person, pref] of [["2p", "ⲁⲣⲉⲧⲉⲛ"], ["2f", "ⲁⲣⲉ"], ["1s", "ⲁⲓ"], ["2m", "ⲁⲕ"], ["3m", "ⲁϥ"], ["3f", "ⲁⲥ"], ["1p", "ⲁⲛ"], ["3p", "ⲁⲩ"]]) {
    if (n.startsWith(pref)) { const r = mk(person, "past", false, n.slice(pref.length)); if (r) return r; }
  }
  // Present prefixes (longest first). ⲭ̀ = 2m only before ⲙ/ⲛ/ⲟⲩ; ⲓ = 1s only
  // before a vowel-initial verb (Ϯ → ⲓ).
  for (const [person, pref] of [["2p", "ⲧⲉⲧⲉⲛ"], ["1p", "ⲧⲉⲛ"], ["2f", "ⲧⲉ"], ["1s", "ϯ"], ["2m", "ⲕ"], ["3m", "ϥ"], ["3f", "ⲥ"], ["3p", "ⲥⲉ"]]) {
    if (n.startsWith(pref)) { const r = mk(person, "present", false, n.slice(pref.length)); if (r) return r; }
  }
  if (n.startsWith("ⲭ") && /^[ⲙⲛⲟⲩ]/.test(n.slice(1))) { const r = mk("2m", "present", false, n.slice(1)); if (r) return r; }
  if (n.startsWith("ⲓ") && /^[ⲁⲉⲏⲓⲟⲩⲱ]/.test(n.slice(1))) { const r = mk("1s", "present", false, n.slice(1)); if (r) return r; }
  // Bare verb form (imperative, or a noun-subject verb — person filled in later).
  const bare = hit(n);
  if (bare) return { person: null, tense: "present", neg: false, stem: bare.ar, entry: bare, imperative: true, prohibitive: false };
  return null;
}

// Parse one Coptic clause (no ⲟⲩⲟϩ inside). Returns a sentence object or null.
// Shape: {kind, subjectPerson, subjectNP, verb, object, preps, qword, neg,
//          parts (for nominal), unknown[]}. kind: verbal | nominal | exists |
// have | list | word.
function parseReverseClause(rawTokens) {
  const unknown = [];
  const toks = rawTokens.map(normCoptic);
  let i = 0;
  // Trailing ⲁⲛ = present/future negation ("Ϯⲥ̀ϧⲁⲓ ⲁⲛ" = I do not write).
  let trailingNeg = false;
  if (toks.length > 1 && toks[toks.length - 1] === "ⲁⲛ") { trailingNeg = true; rawTokens = rawTokens.slice(0, -1); toks.pop(); }
  // Question word first (ⲉⲑⲃⲉ ⲟⲩ = why, two tokens).
  let qword = null;
  if (toks[0] === "ⲉⲑⲃⲉ" && toks[1] === "ⲟⲩ") { qword = "ⲉⲑⲃⲉ ⲟⲩ"; i = 2; }
  else if (QWORD_GLOSS[toks[0]]) { qword = toks[0]; i = 1; }
  // "من هذا؟" → ⲛⲓⲙ ⲫⲁⲓ (question word + demonstrative pronoun, no copula).
  if (qword === "ⲛⲓⲙ" && DEM_PRONOUN[toks[i]] && i + 1 === toks.length) {
    return { kind: "question-dem", dem: DEM_PRONOUN[toks[i]], qword, unknown };
  }
  // Question + copula + NP ("أين بطرس؟" → ⲑⲱⲛ ⲡⲉ Ⲡⲉⲧⲣⲟⲥ).
  if (qword && COPULA[toks[i]]) {
    const np = parseReverseNP(rawTokens, i + 1, unknown);
    if (np && np.next === toks.length) return { kind: "nominal-q", qword, np: np.np, unknown };
  }
  // Existential ⲟⲩⲟⲛ / ⲙ̀ⲙⲟⲛ + NP.
  if (toks[i] === "ⲟⲩⲟⲛ" || toks[i] === "ⲙⲙⲟⲛ") {
    const neg = toks[i] === "ⲙⲙⲟⲛ";
    const np = parseReverseNP(rawTokens, i + 1, unknown);
    if (np) return { kind: "exists", neg, np: np.np, qword, unknown };
    unknown.push(rawTokens[i + 1] ?? "");
    return { kind: "exists", neg, np: null, qword, unknown };
  }
  // Have ⲟⲩⲛⲧ... / ⲙⲟⲛⲧ... + NP.
  if (HAVE_FORMS[toks[i]] || HAVE_NEG_FORMS[toks[i]]) {
    const neg = !!HAVE_NEG_FORMS[toks[i]];
    const person = HAVE_FORMS[toks[i]] ?? HAVE_NEG_FORMS[toks[i]];
    const np = parseReverseNP(rawTokens, i + 1, unknown);
    if (np) return { kind: "have", neg, person, np: np.np, qword, unknown };
    unknown.push(rawTokens[i + 1] ?? "");
    return { kind: "have", neg, person, np: null, qword, unknown };
  }
  // Noun-subject past marker ⲁ / past-neg marker ⲙ̀ⲡⲉ before the subject NP.
  let nounPast = null;
  if (toks[i] === "ⲁ" && i + 1 < toks.length) { nounPast = "past"; i++; }
  else if (toks[i] === "ⲙⲡⲉ" && i + 1 < toks.length) { nounPast = "past-neg"; i++; }
  // Subject pronoun?
  let subjectPerson = REVERSE_SUBJ_PRONOUN[toks[i]] ?? null;
  let subjectNP = null;
  let j = i;
  let verbFirst = null;
  if (subjectPerson) j = i + 1;
  else if (DEM_PRONOUN[toks[i]]) {
    const dem = DEM_PRONOUN[toks[i]];
    subjectNP = { demPron: dem, head: null, definite: false, possessive: null, plural: dem.gender === "pl", gender: dem.gender, genitive: null, adjective: null, demonstrative: null };
    j = i + 1;
  }
  else {
    // Verb-first: a prefixed verb (Ϯⲙⲉⲓ, ⲁⲓⲥ̀ϧⲁⲓ, ϯⲛⲁⲥ̀ϧⲁⲓ) is a sentence,
    // not the noun its stem also spells — the 1s prefix Ϯ lowercases to the
    // article ϯ, so "Ϯⲙⲉⲓ" would otherwise read as the noun "the love".
    // A bare verb with a continuation (ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ = "write the
    // lesson!") also wins over its noun reading; alone it stays a word.
    verbFirst = parseReverseVerbToken(rawTokens[i]);
    if (verbFirst && (verbFirst.person !== null || i + 1 < toks.length)) {
      j = i; // the verb is at j; its subject comes from the prefix (or is imperative)
    } else {
      verbFirst = null;
      const np = parseReverseNP(rawTokens, i, unknown);
      if (np) { subjectNP = np.np; j = np.next; }
    }
  }
  // Copula: pronoun/NP subject + ⲡⲉ/ⲧⲉ/ⲛⲉ + NP ("ⲛ̀ⲑⲟⲕ ⲡⲉ Ⲡⲉⲧⲣⲟⲥ" = you are Peter).
  if ((subjectNP || subjectPerson) && COPULA[toks[j]]) {
    const pred = parseReverseNP(rawTokens, j + 1, unknown);
    if (pred) return { kind: "nominal", subjectPerson, subjectNP, pred: pred.np, tense: "present", neg: trailingNeg, qword, unknown };
  }
  // Trailing copula: subject + predicate (+ ⲁⲛ) + ⲡⲉ/ⲧⲉ/ⲛⲉ ("الكنيسة جديدة" → ⲟⲩⲃⲉⲣⲓ).
  if (subjectNP) {
    const predNP = parseReverseNP(rawTokens, j, unknown);
    if (predNP) {
      let k = predNP.next;
      let neg = trailingNeg;
      if (toks[k] === "ⲁⲛ") { neg = true; k++; }
      if (COPULA[toks[k]] && k === toks.length - 1) {
        return { kind: "nominal", subjectPerson, subjectNP, pred: predNP.np, tense: "present", neg, qword, unknown };
      }
    }
    // Predicate adjective: ⲟⲩ + adjective, then the copula.
    const adjTok = toks[j];
    if (adjTok?.startsWith("ⲟⲩ")) {
      const adj = buildCopticAdjIndex().get(adjTok.slice(2));
      if (adj) {
        let k = j + 1;
        let neg = trailingNeg;
        if (toks[k] === "ⲁⲛ") { neg = true; k++; }
        if (COPULA[toks[k]] && k === toks.length - 1) {
          return { kind: "nominal", subjectPerson, subjectNP, predAdj: adj, tense: "present", neg, qword, unknown };
        }
      }
    }
  }
  // Verb token next (with the subject pronoun's person, or the noun subject).
  let verb = verbFirst ?? (j < toks.length ? parseReverseVerbToken(rawTokens[j]) : null);
  if (verb) {
    if (verb.person === null) {
      if (subjectPerson) verb = { ...verb, person: subjectPerson, imperative: false };
      else if (subjectNP) verb = { ...verb, person: subjectNP.gender === "pl" ? "3p" : subjectNP.gender === "f" ? "3f" : "3m", imperative: false };
      else verb = { ...verb, person: "2m" }; // bare imperative
    }
    if (nounPast === "past") verb = { ...verb, tense: "past" };
    if (nounPast === "past-neg") verb = { ...verb, tense: "past", neg: true };
    if (trailingNeg && !verb.neg) verb = { ...verb, neg: true };
    // Object + prepositional phrases after the verb.
    let k = j + 1;
    let object = null;
    const preps = [];
    while (k < toks.length) {
      if (rawIsMarker(rawTokens[k])) { k++; continue; }
      const stripped = rawStripMarker(rawTokens[k]);
      if (stripped !== null && stripped !== "") {
        const np = parseReverseNP([stripped, ...rawTokens.slice(k + 1)], 0, unknown);
        if (np) { if (!object) object = np.np; k = k + np.next; continue; }
      }
      const prep = PREP_GLOSS[normCoptic(rawTokens[k])];
      // ⲛⲁⲩ + ⲉ + NP = "look at" (checked before the ⲉ preposition).
      if (verb.stem === "ⲛⲁⲩ" && normCoptic(rawTokens[k]) === "ⲉ") {
        const np = parseReverseNP(rawTokens, k + 1, unknown);
        if (np) { object = np.np; k = np.next; continue; }
      }
      if (prep) {
        const np = parseReverseNP(rawTokens, k + 1, unknown);
        if (np) { preps.push({ prep, np: np.np }); k = np.next; continue; }
      }
      const np = parseReverseNP(rawTokens, k, unknown);
      if (np) { if (!object) object = np.np; k = np.next; continue; }
      unknown.push(rawTokens[k]);
      k++;
    }
    return { kind: "verbal", subjectPerson: verb.person, subjectNP, verb, object, preps, qword, unknown };
  }
  // No verb: a bare NP (or two NPs) is a phrase, not a sentence.
  if (subjectNP) {
    if (j < toks.length) unknown.push(...rawTokens.slice(j));
    return { kind: "word", np: subjectNP, qword, unknown };
  }
  unknown.push(...rawTokens.slice(i));
  return { kind: "word", np: null, qword, unknown };
}
// Full input → sentence object (splits on ⲟⲩⲟϩ into joined clauses).
function parseReverseSentence(input) {
  const rawTokens = String(input ?? "").split(/\s+/).filter(Boolean);
  const clauses = [];
  let cur = [];
  for (const t of rawTokens) {
    if (normCoptic(t) === "ⲟⲩⲟϩ") { clauses.push(cur); cur = []; }
    else cur.push(t);
  }
  clauses.push(cur);
  const parsed = clauses.filter((c) => c.length).map(parseReverseClause);
  if (parsed.length <= 1) return parsed[0] ?? { kind: "word", np: null, qword: null, unknown: [] };
  return { kind: "list", parts: parsed, unknown: parsed.flatMap((p) => p.unknown ?? []) };
}

// ---------- Reverse NP rendering ----------
function renderDemPron(np, lang, kase = "nom") {
  const d = np.demPron; // {word: "this"|"that", gender: "m"|"f"|"pl"}
  const pl = d.gender === "pl";
  if (lang === "ar") return d.word === "this" ? (pl ? "هؤلاء" : d.gender === "f" ? "هذه" : "هذا") : (pl ? "أولئك" : d.gender === "f" ? "تلك" : "ذلك");
  if (lang === "en") return d.word === "this" ? (pl ? "these" : "this") : (pl ? "those" : "that");
  if (lang === "fr") return d.word === "this" ? (pl ? "ceux-ci" : d.gender === "f" ? "celle-ci" : "celui-ci") : (pl ? "ceux-là" : d.gender === "f" ? "celle-là" : "celui-là");
  // German demonstrative inflects by case (dieser/diesen/diesem/dieses…).
  const t = {
    nom: { m: "dieser", f: "diese", pl: "diese" }, acc: { m: "diesen", f: "diese", pl: "diese" },
    dat: { m: "diesem", f: "dieser", pl: "diesen" }, gen: { m: "dieses", f: "dieser", pl: "dieser" },
  };
  const j = {
    nom: { m: "jener", f: "jene", pl: "jene" }, acc: { m: "jenen", f: "jene", pl: "jene" },
    dat: { m: "jenem", f: "jener", pl: "jenen" }, gen: { m: "jenes", f: "jener", pl: "jener" },
  };
  return (d.word === "this" ? t : j)[kase][d.gender];
}
function arDefinite(w) { return w.startsWith("ال") ? w : "ال" + w; }
const AR_POSS_SUF = { "1s": "ي", "2m": "ك", "2f": "ك", "3m": "ه", "3f": "ها", "1p": "نا", "2p": "كم", "3p": "هم" };
function arPossessive(w, person) {
  const suf = AR_POSS_SUF[person];
  if (!suf) return w;
  if (w.endsWith("ة")) return w.slice(0, -1) + "ت" + suf;
  if (w.endsWith("اء")) return suf === "ي" ? w.slice(0, -1) + "ئي" : w.slice(0, -1) + "ؤ" + suf;
  return w + suf;
}
function arNounWord(np) {
  if (np.plural && np.head.gender !== "pl") return pluralizeArabicNounDisplay(np.head.ar);
  return np.head.ar;
}
function renderNP_AR(np, bare = false) {
  if (!np) return "";
  if (np.demPron) return renderDemPron(np, "ar");
  let w = arNounWord(np);
  if (np.possessive) w = arPossessive(w, np.possessive);
  else if (np.definite && !np.head.proper && !np.genitive && !bare) w = arDefinite(w);
  if (np.demonstrative) {
    if (!np.possessive && !w.startsWith("ال")) w = arDefinite(w);
    w = (np.demonstrative === "this" ? "هذا " : "ذلك ") + w;
    if (np.plural) w = (np.demonstrative === "this" ? "هؤلاء " : "أولئك ") + w.slice(w.indexOf(" ") + 1);
  }
  if (np.adjective) w += " " + np.adjective.ar;
  if (np.genitive) w += " " + renderNP_AR(np.genitive);
  return w;
}
const EN_POSS = { "1s": "my", "2m": "your", "2f": "your", "3m": "his", "3f": "her", "1p": "our", "2p": "your", "3p": "their" };
function enNounWord(np) {
  const w = lowerForeign(np.head.en || np.head.ar, np.head.proper);
  if (np.plural && np.head.gender !== "pl") return pluralizeEN(w);
  return w;
}
function renderNP_EN(np, bare = false) {
  if (!np) return "";
  if (np.demPron) return renderDemPron(np, "en");
  let w = enNounWord(np);
  if (np.adjective) w = lowerForeign(np.adjective.en || np.adjective.ar) + " " + w;
  let det = "";
  if (np.possessive) det = EN_POSS[np.possessive] + " ";
  else if (np.definite && !np.head.proper && !bare) det = "the ";
  if (np.demonstrative) det = (np.demonstrative === "this" ? (np.plural ? "these " : "this ") : (np.plural ? "those " : "that "));
  let s = det + w;
  if (np.genitive) s += " of " + renderNP_EN(np.genitive);
  return s;
}
const FR_POSS = {
  "1s": { m: "mon", f: "ma", pl: "mes" }, "2m": { m: "ton", f: "ta", pl: "tes" }, "2f": { m: "ton", f: "ta", pl: "tes" },
  "3m": { m: "son", f: "sa", pl: "ses" }, "3f": { m: "son", f: "sa", pl: "ses" },
  "1p": { m: "notre", f: "notre", pl: "nos" }, "2p": { m: "votre", f: "votre", pl: "vos" }, "3p": { m: "leur", f: "leur", pl: "leurs" },
};
const FR_ADJ_BEFORE = new Set(["beau", "bon", "grand", "petit", "nouveau", "ancien", "saint", "vieux", "jeune", "joli"]);
function frArticle(gender, word) {
  if (gender === "pl") return "les";
  if (/^[aeiouéèêàh]/.test(word)) return "l'";
  return gender === "f" ? "la" : "le";
}
function frDeForm(np) {
  // "de" + the NP: du / de la / des / de l' / de + possessive.
  if (np.possessive) return "de " + renderNP_FR(np);
  const g = frGenderOf(np.head.fr, np.head.gender);
  const gender = np.plural ? "pl" : g;
  let w = lowerForeign(np.head.fr || np.head.ar, np.head.proper);
  if (np.plural && np.head.gender !== "pl") w = pluralizeFR(w);
  if (gender === "pl") return "des " + w;
  if (/^[aeiouéèêàh]/.test(w)) return "de l'" + w;
  return gender === "f" ? "de la " + w : "du " + w;
}
function renderNP_FR(np, bare = false) {
  if (!np) return "";
  if (np.demPron) return renderDemPron(np, "fr");
  const g = frGenderOf(np.head.fr, np.head.gender);
  const gender = np.plural ? "pl" : g;
  let w = lowerForeign(np.head.fr || np.head.ar, np.head.proper);
  if (np.plural && np.head.gender !== "pl") w = pluralizeFR(w);
  let det = "";
  if (np.possessive) {
    det = FR_POSS[np.possessive][gender];
    if (gender === "f" && /^[aeiouéèêàh]/.test(w)) det = { ma: "mon", ta: "ton", sa: "son" }[det] ?? det;
    det += " ";
  } else if (np.definite && !np.head.proper && !bare) {
    det = frArticle(gender, w);
    if (!det.endsWith("'")) det += " ";
  }
  if (np.demonstrative) det = np.demonstrative === "this" ? (np.plural ? "ces " : "ce ") : (np.plural ? "ces " : "cet ");
  // Adjectives: the short common ones go before the noun, the rest after.
  let adjBefore = "", adjAfter = "";
  if (np.adjective) {
    const a = lowerForeign(np.adjective.fr || np.adjective.ar);
    const before = FR_ADJ_BEFORE.has(a);
    // ce + vowel-initial adjective → cet ("cet homme"); handled by det above only
    // for the plain noun — "ce bel homme" needs "cet": fix the demonstrative here.
    if (before) adjBefore = a + " ";
    else adjAfter = " " + a;
  }
  let s = det + adjBefore + w + adjAfter;
  if (np.genitive) s += " " + frDeForm(np.genitive);
  return s;
}
const DE_POSS_BASE = { "1s": "mein", "2m": "dein", "2f": "dein", "3m": "sein", "3f": "ihr", "1p": "unser", "2p": "euer", "3p": "ihr" };
function deArticle(gender, kase) {
  const t = {
    nom: { m: "der", f: "die", n: "das", pl: "die" }, acc: { m: "den", f: "die", n: "das", pl: "die" },
    dat: { m: "dem", f: "der", n: "dem", pl: "den" }, gen: { m: "des", f: "der", n: "des", pl: "der" },
  };
  return t[kase][gender];
}
function dePossessive(person, gender, kase) {
  const base = DE_POSS_BASE[person];
  const end = { nom: { m: "", f: "e", n: "", pl: "e" }, acc: { m: "en", f: "e", n: "", pl: "e" }, dat: { m: "em", f: "er", n: "em", pl: "en" }, gen: { m: "es", f: "er", n: "es", pl: "er" } }[kase][gender];
  return base + end;
}
function renderNP_DE(np, kase = "nom", bare = false) {
  if (!np) return "";
  if (np.demPron) return renderDemPron(np, "de", kase);
  const g = deGenderOf(np.head.de, np.head.gender);
  const gender = np.plural ? "pl" : g;
  let w = np.head.de || np.head.ar;
  w = w[0].toUpperCase() + w.slice(1);
  if (np.plural && np.head.gender !== "pl") w = pluralizeDE(w);
  if (kase === "dat" && gender === "pl" && !/[ns]$/.test(w)) w += "n";
  if (kase === "gen" && (gender === "m" || gender === "n")) {
    w = w === "Herz" ? "Herzens" : w === "Name" ? "Namens" : /[sßxz]$/.test(w) ? w + "es" : w + "s";
  }
  let det = "";
  if (np.possessive) det = dePossessive(np.possessive, gender, kase) + " ";
  else if (np.definite && !np.head.proper && !bare) det = deArticle(gender, kase) + " ";
  if (np.demonstrative) det = np.demonstrative === "this" ? (np.plural ? "diese " : "dieser ") : (np.plural ? "jene " : "jener ");
  let adj = "";
  if (np.adjective) {
    const a = np.adjective.de || "";
    const end = ((kase === "acc" && gender === "m") || kase === "dat" || kase === "gen" || gender === "pl") ? "en" : "e";
    // An adjective already ending in -e takes no extra -e (weise, not weisee);
    // with -en it takes only -n (weisen).
    adj = (a.endsWith("e") ? (end === "e" ? a : a + "n") : a + end) + " ";
  }
  let s = det + adj + w;
  if (np.genitive) s += " " + renderNP_DE(np.genitive, "gen");
  return s;
}
function renderNP(np, lang, kase, bare) {
  if (lang === "ar") return renderNP_AR(np, bare);
  if (lang === "en") return renderNP_EN(np, bare);
  if (lang === "fr") return renderNP_FR(np, bare);
  return renderNP_DE(np, kase ?? "nom", bare);
}

// ---------- Reverse sentence rendering ----------
function reverseVerbGloss(verb, lang) {
  return verbGloss(lang, verb.stem, verb.entry);
}
function renderVerbal_AR(s) {
  const v = s.verb;
  // The future drops the subject pronoun (سأكتب الدرس, not أنا سأكتب الدرس):
  // the س- prefix already carries the person, and the task pins the compact form.
  const subj = s.subjectNP ? renderNP_AR(s.subjectNP) : v.tense === "future" ? "" : AR_SUBJ[v.person];
  const verbText = v.neg
    ? arabicNegatedVerb(v.entry.arRaw, v.tense, v.person)
    : arabicConjugate(v.entry.arRaw, v.tense, v.person);
  const verbClean = verbText.replace(/[ً-ْ]/gu, "");
  let out = subj ? `${subj} ${verbClean}` : verbClean;
  if (s.object) out += ` ${renderNP_AR(s.object)}`;
  for (const pp of s.preps ?? []) out += ` ${pp.prep.ar} ${renderNP_AR(pp.np)}`;
  return out;
}
function renderVerbal_EN(s) {
  const v = s.verb;
  const gloss = reverseVerbGloss(v, "en");
  const c = conjugateEN(gloss, v.tense, v.person, v.neg);
  const subj = s.subjectNP ? renderNP_EN(s.subjectNP) : EN_SUBJ[v.person];
  let out = `${subj} ${c.verb}`;
  if (s.object) out += ` ${renderNP_EN(s.object)}`;
  for (const pp of s.preps ?? []) out += ` ${pp.prep.en} ${renderNP_EN(pp.np)}`;
  return out;
}
function renderVerbal_FR(s) {
  const v = s.verb;
  const gloss = reverseVerbGloss(v, "fr");
  const gender = s.subjectNP ? frGenderOf(s.subjectNP.head.fr, s.subjectNP.head.gender) : (v.person === "3f" ? "f" : "m");
  const plural = s.subjectNP ? !!s.subjectNP.plural : (v.person === "1p" || v.person === "2p" || v.person === "3p");
  const c = conjugateFR(gloss, v.tense, v.person, gender, plural, v.neg);
  let subj = s.subjectNP ? renderNP_FR(s.subjectNP) : FR_SUBJ[v.person];
  let verbText = c.verb;
  if (!s.subjectNP && v.person === "1s") {
    // "je" elides before a vowel (j'aime, j'écris) but not before "ne"/"n'"
    // (je n'aime pas) or a consonant (je sais).
    subj = verbText.startsWith("n'") ? "je" : /^[aeiouéèêh]/.test(verbText) ? "j'" : "je";
  }
  let out = subj === "j'" ? `j'${verbText}` : `${subj} ${verbText}`;
  if (s.object) out += ` ${renderNP_FR(s.object)}`;
  for (const pp of s.preps ?? []) out += ` ${pp.prep.fr} ${renderNP_FR(pp.np)}`;
  return out;
}
function renderVerbal_DE(s) {
  const v = s.verb;
  const gloss = reverseVerbGloss(v, "de");
  const gender = s.subjectNP ? deGenderOf(s.subjectNP.head.de, s.subjectNP.head.gender) : (v.person === "3f" ? "f" : "m");
  const plural = s.subjectNP ? !!s.subjectNP.plural : (v.person === "1p" || v.person === "2p" || v.person === "3p");
  const c = conjugateDE(gloss, v.tense, v.person, gender, plural, v.neg);
  const subj = s.subjectNP ? renderNP_DE(s.subjectNP, "nom") : DE_SUBJ[v.person];
  let out = `${subj} ${c.verb}`;
  if (s.object) out += ` ${renderNP_DE(s.object, "acc")}`;
  for (const pp of s.preps ?? []) out += ` ${pp.prep.de} ${renderNP_DE(pp.np, pp.prep.deCase)}`;
  if (v.neg && v.tense !== "past") out += " nicht";
  if (v.neg && v.tense === "past") out = out.replace(/ (\S+)$/, " nicht $1");
  if (c.sep && v.tense === "present") out += ` ${c.sep}`;
  return out;
}
// Lowercase the first letter of a rendered body, unless it starts with the
// English pronoun "I" or with a proper-noun subject (subjectNP present).
function lowerFirstBody(body, s) {
  if (!body || s.subjectNP?.head.proper || body.startsWith("I ") || body === "I") return body;
  return body[0].toLowerCase() + body.slice(1);
}
// Wh-questions invert in EN/FR/DE ("What does she write?", "Qu'est-ce qu'elle
// écrit ?", "Was schreibt sie?"). ⲛⲓⲙ is a subject question — no inversion
// ("Who writes the lesson?"). ⲟⲩⲏⲣ (how many) keeps the declarative order,
// since the noun it counts sits inside the object.
function renderWhQuestion_EN(s, qw, body) {
  const gloss = reverseVerbGloss(s.verb, "en");
  const subj = s.subjectNP ? renderNP_EN(s.subjectNP) : EN_SUBJ[s.verb.person];
  const subjLower = s.subjectNP?.head.proper ? subj : subj === "I" ? "I" : subj[0].toLowerCase() + subj.slice(1);
  const obj = s.object ? " " + renderNP_EN(s.object) : "";
  const preps = (s.preps ?? []).map((pp) => ` ${pp.prep.en} ${renderNP_EN(pp.np)}`).join("");
  if (s.qword === "ⲛⲓⲙ") {
    const c = conjugateEN(gloss, s.verb.tense, "3m", s.verb.neg);
    return `Who ${c.verb}${obj}${preps}?`;
  }
  if (s.qword === "ⲟⲩⲏⲣ") return `${qw} ${lowerFirstBody(body, s)}?`;
  const is3s = s.verb.person === "3m" || s.verb.person === "3f";
  let aux;
  if (s.verb.tense === "past") aux = s.verb.neg ? "didn't" : "did";
  else if (s.verb.tense === "future") aux = s.verb.neg ? "won't" : "will";
  else aux = s.verb.neg ? (is3s ? "doesn't" : "don't") : (is3s ? "does" : "do");
  return `${qw} ${aux} ${subjLower} ${gloss?.inf ?? ""}${obj}${preps}?`;
}
function renderWhQuestion_FR(s, qw, body) {
  if (s.qword === "ⲛⲓⲙ") {
    const gloss = reverseVerbGloss(s.verb, "fr");
    const c = conjugateFR(gloss, s.verb.tense, "3m", s.verb.person === "3f" ? "f" : "m", false, s.verb.neg);
    const obj = s.object ? " " + renderNP_FR(s.object) : "";
    return `Qui ${c.verb}${obj}?`;
  }
  if (s.qword === "ⲟⲩⲏⲣ") return `${qw} ${lowerFirstBody(body, s)}?`;
  const b = lowerFirstBody(body, s);
  const vowel = /^[aeiouéèêëàâîïôöùûü]/i.test(b);
  if (s.qword === "ⲁϣ" || s.qword === "ⲟⲩ") return vowel ? `Qu'est-ce qu'${b}?` : `Qu'est-ce que ${b}?`;
  return vowel ? `${qw} est-ce qu'${b}?` : `${qw} est-ce que ${b}?`;
}
function renderWhQuestion_DE(s, qw, body) {
  const gloss = reverseVerbGloss(s.verb, "de");
  if (gloss?.refl || s.qword === "ⲟⲩⲏⲣ") return `${qw} ${lowerFirstBody(body, s)}?`;
  const gender = s.subjectNP ? (DE_GENDER[s.subjectNP.head.en] ?? "m") : (s.verb.person === "3f" ? "f" : "m");
  const c = conjugateDE(gloss, s.verb.tense, s.qword === "ⲛⲓⲙ" ? "3m" : s.verb.person, gender, !!s.subjectNP?.plural, false);
  const parts = c.verb.split(" ");
  const v1 = parts[0];
  const v2 = parts.length > 1 ? parts.slice(1).join(" ") : (c.sep ?? "");
  const obj = s.object ? " " + renderNP_DE(s.object, "acc") : "";
  const preps = (s.preps ?? []).map((pp) => ` ${pp.prep.de} ${renderNP_DE(pp.np, pp.prep.deCase ?? "dat")}`).join("");
  const nicht = s.verb.neg ? " nicht" : "";
  if (s.qword === "ⲛⲓⲙ") return `Wer ${v1}${obj}${preps}${nicht}${v2 ? " " + v2 : ""}?`;
  const subj = s.subjectNP ? renderNP_DE(s.subjectNP) : DE_SUBJ[s.verb.person];
  const subjLower = s.subjectNP?.head.proper ? subj : subj[0].toLowerCase() + subj.slice(1);
  return `${qw} ${v1} ${subjLower}${obj}${preps}${nicht}${v2 ? " " + v2 : ""}?`;
}
function renderSentence(s, lang) {
  if (!s) return "";
  if (s.kind === "list") {
    const join = { ar: " و", en: " and", fr: " et", de: " und" }[lang];
    return s.parts.map((p) => renderSentence(p, lang)).filter(Boolean).join(join);
  }
  if (s.kind === "word") {
    if (!s.np) return "";
    return renderNP(s.np, lang);
  }
  if (s.kind === "nominal-q") {
    const np = renderNP(s.np, lang);
    const pl = !!s.np.plural;
    const qw = lang === "ar" ? (s.qword === "ⲉⲑⲃⲉ ⲟⲩ" ? "لماذا" : QWORD_GLOSS[s.qword].ar)
      : s.qword === "ⲉⲑⲃⲉ ⲟⲩ" ? { en: "Why", fr: "Pourquoi", de: "Warum" }[lang]
      : QWORD_GLOSS[s.qword][lang];
    if (lang === "ar") return `${qw} ${np}؟`;
    if (lang === "en") return `${qw} ${pl ? "are" : "is"} ${np}?`;
    if (lang === "fr") return `${qw} ${pl ? "sont" : "est"} ${np}?`;
    return `${qw} ${pl ? "sind" : "ist"} ${np}?`;
  }
  if (s.kind === "question-dem") {
    const d = s.dem;
    if (lang === "ar") return `من ${renderDemPron({ demPron: d }, "ar")}؟`;
    if (lang === "en") return `Who is ${renderDemPron({ demPron: d }, "en")}?`;
    if (lang === "fr") return d.word === "this" ? "Qui est-ce?" : "Qui est-ce là?";
    if (d.gender === "pl") return d.word === "this" ? "Wer sind diese?" : "Wer sind die da?";
    return d.word === "this" ? "Wer ist das?" : "Wer ist der da?";
  }
  if (s.kind === "exists") {
    if (!s.np) return "";
    if (lang === "ar") return `${s.neg ? "لا يوجد " : "يوجد "}${renderNP_AR(s.np, s.neg)}`;
    if (lang === "en") return s.np.plural ? `There are ${s.neg ? "no " : ""}${renderNP_EN(s.np, s.neg)}` : `There is ${s.neg ? "no " : ""}${renderNP_EN(s.np, s.neg)}`;
    if (lang === "fr") {
      if (!s.neg) return `Il y a ${renderNP_FR(s.np)}`;
      const bare = renderNP_FR(s.np, true);
      return `Il n'y a pas ${/^[aeiouéèêàh]/.test(bare) ? "d'" : "de "}${bare}`;
    }
    if (!s.neg) return `Es gibt ${renderNP_DE(s.np, "acc")}`;
    const g = deGenderOf(s.np.head.de, s.np.head.gender);
    const kein = s.np.plural ? "keine" : g === "m" ? "keinen" : g === "f" ? "keine" : "kein";
    return `Es gibt ${kein} ${renderNP_DE(s.np, "acc", true)}`;
  }
  if (s.kind === "have") {
    if (!s.np) return "";
    if (lang === "ar") return s.neg ? `ليس عندي ${renderNP_AR(s.np)}` : `عندي ${renderNP_AR(s.np)}`;
    if (lang === "en") return `${EN_SUBJ[s.person]} ${s.neg ? "don't have" : "have"} ${renderNP_EN(s.np)}`;
    if (lang === "fr") {
      const have = { "1s": "ai", "2m": "as", "2f": "as", "3m": "a", "3f": "a", "1p": "avons", "2p": "avez", "3p": "ont" }[s.person];
      const haveNeg = { "1s": "n'ai pas", "2m": "n'as pas", "2f": "n'as pas", "3m": "n'a pas", "3f": "n'a pas", "1p": "n'avons pas", "2p": "n'avez pas", "3p": "n'ont pas" }[s.person];
      if (s.person === "1s") return s.neg ? `je ${haveNeg} ${renderNP_FR(s.np)}` : `j'ai ${renderNP_FR(s.np)}`;
      return `${FR_SUBJ[s.person]} ${s.neg ? haveNeg : have} ${renderNP_FR(s.np)}`;
    }
    return `${DE_SUBJ[s.person]} ${s.neg ? "habe kein" : "habe"} ${renderNP_DE(s.np, "acc")}`;
  }
  if (s.kind === "nominal") {
    const subj = s.subjectNP ? renderNP(s.subjectNP, lang)
      : lang === "ar" ? AR_SUBJ[s.subjectPerson] : lang === "en" ? EN_SUBJ[s.subjectPerson]
      : lang === "fr" ? FR_SUBJ[s.subjectPerson] : DE_SUBJ[s.subjectPerson];
    const pred = s.predAdj
      ? lang === "ar" ? s.predAdj.ar : lang === "en" ? lowerForeign(s.predAdj.en || s.predAdj.ar)
      : lang === "fr" ? lowerForeign(s.predAdj.fr || s.predAdj.ar) : s.predAdj.de || s.predAdj.ar
      : renderNP(s.pred, lang);
    if (lang === "ar") return s.neg ? `${subj} ليس ${pred}` : `${subj} ${pred}`;
    // Copula agrees with the subject (You ARE Peter, not "You is Peter").
    const person = s.subjectPerson ?? (s.subjectNP ? (s.subjectNP.plural ? "3p" : s.subjectNP.gender === "f" ? "3f" : "3m") : "3m");
    if (lang === "en") {
      const cop = person === "1s" ? "am" : person === "3m" || person === "3f" ? "is" : "are";
      return `${subj} ${cop}${s.neg ? " not" : ""} ${pred}`;
    }
    if (lang === "fr") {
      const cop = { "1s": "suis", "2m": "es", "2f": "es", "3m": "est", "3f": "est", "1p": "sommes", "2p": "êtes", "3p": "sont" }[person];
      if (s.neg) {
        const neCop = /^[aeiouéèê]/.test(cop) ? `n'${cop}` : `ne ${cop}`;
        return `${subj} ${neCop} pas ${pred}`;
      }
      return `${subj} ${cop} ${pred}`;
    }
    const cop = { "1s": "bin", "2m": "bist", "2f": "bist", "3m": "ist", "3f": "ist", "1p": "sind", "2p": "seid", "3p": "sind" }[person];
    return `${subj} ${cop}${s.neg ? " nicht" : ""} ${pred}`;
  }
  // verbal
  let body;
  if (lang === "ar") body = renderVerbal_AR(s);
  else if (lang === "en") body = renderVerbal_EN(s);
  else if (lang === "fr") body = renderVerbal_FR(s);
  else body = renderVerbal_DE(s);
  if (s.qword) {
    if (lang === "ar") {
      let b = body;
      if (s.qword === "ⲛⲓⲙ" && !s.subjectNP) b = b.replace(/^(أنا|أنتَ|أنتِ|هو|هي|نحن|أنتم|أنتن|هم|هن) /, "");
      return `${s.qword === "ⲉⲑⲃⲉ ⲟⲩ" ? "لماذا" : QWORD_GLOSS[s.qword].ar} ${b}؟`;
    }
    const qw = s.qword === "ⲉⲑⲃⲉ ⲟⲩ" ? { en: "Why", fr: "Pourquoi", de: "Warum" }[lang] : QWORD_GLOSS[s.qword][lang];
    if (s.qword === "ⲙⲏ") {
      // Yes/no question: invert (EN). FR/DE use intonation ("J'aime Dieu ?").
      if (lang === "en") {
        const aux = s.verb.tense === "past" ? "Did" : s.verb.tense === "future" ? "Will" : (s.verb.person === "3m" || s.verb.person === "3f") ? "Does" : "Do";
        const gloss = reverseVerbGloss(s.verb, "en");
        const subj = s.subjectNP ? renderNP_EN(s.subjectNP) : EN_SUBJ[s.verb.person];
        const subjLower = subj === "I" ? "I" : subj[0].toLowerCase() + subj.slice(1);
        return `${aux} ${subjLower} ${gloss?.inf ?? ""}${s.object ? " " + renderNP_EN(s.object) : ""}?`;
      }
      return `${body}?`;
    }
    if (lang === "en") return renderWhQuestion_EN(s, qw, body);
    if (lang === "fr") return renderWhQuestion_FR(s, qw, body);
    return renderWhQuestion_DE(s, qw, body);
  }
  return body;
}
function capitalizeSentence(text, lang) {
  if (lang === "ar" || !text) return text;
  return text[0].toUpperCase() + text.slice(1);
}
// Coptic → Arabic / English / French / German. Returns {ok, text, unknown}.
export function translateReverse(input, target = "ar") {
  const lang = ["ar", "en", "fr", "de"].includes(target) ? target : "ar";
  const parsed = parseReverseSentence(input);
  // Sentence-case only for full sentences; a bare word/phrase keeps its gloss
  // casing (book / livre / Buch — German nouns stay capitalised on their own).
  const isSentence = (s) => ["verbal", "nominal", "exists", "have"].includes(s?.kind);
  const needsCap = isSentence(parsed) || (parsed.kind === "list" && isSentence(parsed.parts?.[0]));
  const text = needsCap ? capitalizeSentence(renderSentence(parsed, lang), lang) : renderSentence(parsed, lang);
  return { ok: !!text, text, unknown: parsed.unknown ?? [] };
}
// Format a reverse translation for display (mirrors formatTranslation).
export function formatReverseTranslation(input, target = "ar") {
  const r = translateReverse(input, target);
  if (!r.ok || !r.text) {
    const unk = r.unknown?.length ? `\n⚠️ كلمات غير معروفة: ${[...new Set(r.unknown)].join("، ")}` : "";
    return `لم أفهم الجملة القبطية.${unk}`;
  }
  let out = r.text;
  if (r.unknown.length) out += `\n⚠️ كلمات غير معروفة: ${[...new Set(r.unknown)].join("، ")}`;
  return out;
}

