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
  const byArabic = new Map(); // normalized arabic first-meaning word → [{coptic, gender, kind, form}]
  for (const r of records) {
    const meaning = r.meaning ?? "";
    if (!meaning) continue;
    const first = normalizeArabic(meaning.split("،")[0].split(",")[0]).split(" ")[0];
    if (!first || first.length < 2) continue;
    const coptic = cleanCoptic(r.coptic ?? "").split(" ")[0].replace(/-$/, ""); // bound-form marker: ⲁϫⲉ- → ⲁϫⲉ (R30)
    if (!coptic) continue;
    const entry = { coptic, gender: genderFromRecord(r), kind: r.kind ?? "", form: verbFormFromKind(r.kind ?? "") };
    if (!byArabic.has(first)) byArabic.set(first, []);
    byArabic.get(first).push(entry);
  }
  INDEX = byArabic;
  return INDEX;
}
export function lookupArabic(word) {
  const idx = buildIndex();
  return idx.get(normalizeArabic(word)) ?? null;
}
// Function-word kinds (verbs, pronouns, particles, adverbs) are never nouns:
// "هو" must not return the ⲛ̀ⲑⲟϥ pronoun record, "ليس" must not return ⲉ̀ⲃⲏⲗ (R18/R23).
const FUNCTION_KINDS = /^(فعل|ضمير|حرف|أداة|ظرف|توكيد)/;
function lookupNoun(word) {
  const norm = normalizeArabic(word);
  const base = [norm];
  // hamzat waṣl: "المرأة" is ال + مرأة, but the word itself is "امرأة" (ا + مرأة) (R17)
  if (norm.startsWith("ال") && norm.length > 3) base.push("ا" + norm.slice(2));
  // accusative ـاً: "رجلا" → "رجل" (G1)
  if (norm.endsWith("ا") && norm.length > 2) base.push(norm.slice(0, -1));
  const cands = [...base];
  // ة → ه fallback: CURATED keys are written with ه, inputs may carry ة (كنيسة → كنيسه).
  // Only this direction: the reverse would re-create the R7 "كتابه" collision.
  for (const b of base) if (b.includes("ة")) cands.push(b.replace(/ة/g, "ه"));
  const uniq = [...new Set(cands)];
  // phase 1: curated entries for ALL spelling candidates first — a curated value
  // (e.g. كنيسه → ⲉⲕⲕⲗⲏⲥⲓⲁ, the book spelling) must beat a dictionary record
  // for the same word (e.g. ⲉⲕⲕ̀ⲗⲏⲥⲓⲁ with jinkim)
  for (const cand of uniq) {
    if (CURATED_NOUNS[cand]) return { ...CURATED_NOUNS[cand] };
    const bare = stripDefinite(cand);
    if (CURATED_NOUNS[bare]) return { ...CURATED_NOUNS[bare] };
  }
  // phase 2: dictionary
  for (const cand of uniq) {
    const bare = stripDefinite(cand);
    const hits = lookupArabic(bare);
    if (!hits) continue;
    const noun = hits.find((h) => h.kind.includes("اسم")) ?? hits.find((h) => !FUNCTION_KINDS.test(h.kind));
    if (noun) return { coptic: noun.coptic, gender: noun.gender };
  }
  return null;
}
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
const FUNCTION_WORDS = new Set(["لا", "لم", "لن", "ما", "في", "الي", "الى", "من", "مع", "علي", "على", "عن", "ان", "او", "ثم", "و", "هذا", "هذه", "ذلك", "تلك", "هؤلاء", "كل", "بعض", "غير", "بين", "بعد", "قبل", "حتي", "حتى", "بدون", "عند", "فوق", "تحت", "امام", "ليس", "يوجد", "سوف"].map(normalizeArabic));

export function analyzeVerbToken(token) {
  const t = normalizeArabic(token);
  if (FUNCTION_WORDS.has(t)) return null;
  let tense = null;
  let rest = t;
  if (rest.startsWith("سوف")) { tense = "future"; rest = rest.slice(3); }
  else if (/^س[ااتيون]/.test(rest)) { tense = "future"; rest = rest.slice(1); }
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
      const hit = lookupVerbStem(stem) ?? lookupVerbStem("ا" + stem) ?? lookupVerbStem(stem.replace(/ا$/, "")) ?? (stem.endsWith("ني") ? null : lookupVerbStem(stem.replace(/ي$/, "")));
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
      const hit = lookupVerbStem(stem);
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
  // possessive suffix (longest first)
  for (const suf of ["ها", "كم", "هم", "نا", "كي", "ي", "ك", "ه"]) {
    if (t.endsWith(suf) && t.length - suf.length >= 2) {
      const stem = t.slice(0, -suf.length);
      // ة → ت before a suffix: "كنيستي" = كنيسة + ي (R9)
      // ة → ت before a suffix: "كنيستي" = كنيسة + ي — the stem's final ت IS the ة (R9)
      const noun = lookupNoun(stem)
        ?? (stem.endsWith("ت") ? lookupNoun(stem.slice(0, -1) + "ه") ?? lookupNoun(stem.slice(0, -1) + "ة") : null)
        ?? lookupNoun(stem + "ة") ?? lookupNoun(stem + "ه");
      if (noun) {
        const pref = POSSESSIVE[suf][noun.gender] ?? POSSESSIVE[suf].m;
        return { text: `${pref}${noun.coptic}`, gender: noun.gender, definite: true, consumed: 0, accusative };
      }
    }
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
  } else if (DEMONSTRATIVE[rest[0]] && rest[1] && analyzeVerbToken(rest[1])?.verb) {
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
    if (ns && va && va.verb) { nounSubject = ns; i = 1; }
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
    if (a && a.verb) { verbInfo = a; verbIdx = j; break; }
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
    if (subjTok) unknown.push(subjTok);
    if (predTok) unknown.push(predTok);
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

export function formatTranslation(input) {
  const r = translateSentence(input);
  if (!r.ok) return r.error;
  if (!r.coptic) {
    return r.unknown.length ? `⚠️ كلمات غير معروفة: ${r.unknown.join("، ")}` : "مش فاهم الجملة — جرّب جملة أبسط.";
  }
  let out = r.coptic;
  if (r.unknown.length) out += `\n⚠️ كلمات غير معروفة: ${[...new Set(r.unknown)].join("، ")}`;
  return out;
}
