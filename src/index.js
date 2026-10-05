import records from "../data/dictionary.json" with { type: "json" };
import cardManifest from "../data/cards.json" with { type: "json" };
import welcomeImageBase64 from "./welcome-image.js";

const BOT_TITLE = "📖 القاموس القبطي البحيري";
const PAGE_SIZE = 1;
const MAX_MESSAGE_LENGTH = 3900;
const CALLBACK_DATA_MAX_BYTES = 64;
const DEFAULT_ADMIN_IDS = "813894692"; // owner chat id from data/owner_chat_id.txt; override with ADMIN_CHAT_ID
const BROADCAST_BATCH_SIZE = 25;
const BROADCAST_BATCH_DELAY_MS = 1200;
const FIRST_TIME_TEXT =
  "مرحبًا بك! يبدو أنك تستخدم البوت لأول مرة, الرجاء إدخال اسمك ثلاثي للبدء في استخدام القاموس القبطي الناطق";
const NAME_RETRY_TEXT = "الرجاء إدخال اسمك ثلاثيًا (ثلاث كلمات على الأقل) بالحروف فقط، مثل: مينا جرجس بشرى.";
const HELP_TEXT = `${BOT_TITLE}\n\nأهلًا بك في القاموس.\n\nاكتب الكلمة مباشرة، مثل:\nⲁⲛⲁⲩ\nwater\nماء\n\nسأبحث في القبطية والعربية والإنجليزية والنطق والتهجئة.\n\nاكتب الكلمة أو أول حروفها لتظهر لك اقتراحات بالكلمات التي تبدأ بها.\n\n⌨️ لا يوجد كيبورد قبطي على جهازك؟ أرسل /keyboard لتكتب الكلمة بالأزرار.`;

const ACCENT_MAP = { ὲ: "ⲉ", έ: "ⲉ", ὶ: "ⲓ", ί: "ⲓ", ὸ: "ⲟ", ό: "ⲟ", ὼ: "ⲱ", ώ: "ⲱ", ὴ: "ⲏ", ή: "ⲏ", ὰ: "ⲁ", ά: "ⲁ", ὺ: "ⲩ", ύ: "ⲩ" };
const ALEF_MAP = { أ: "ا", إ: "ا", آ: "ا", ٱ: "ا", ى: "ي", ة: "ه" };

const PLAIN_ASCII = /^[\x20-\x5f\x61-\x7e]*$/u;
const MARK_CHARS = /[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]/u;
const MARK_CHARS_ALL = /[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]/gu;
const FOLD_CHARS = /[أإآٱىةὲέὶίὸόὼώὴήὰάὺύ`]/u;
const FOLD_CHARS_ALL = /[أإآٱىةὲέὶίὸόὼώὴήὰάὺύ`]/gu;
const FOLD_MAP = { ...ALEF_MAP, ...ACCENT_MAP, "`": "" };

// Hot path (the search index normalizes ~130k words): plain Latin text skips every regex, other text only
// runs the replacements it actually needs.
function normalize(value) {
  const text = String(value ?? "");
  if (PLAIN_ASCII.test(text)) return text.toLowerCase().replace(/\s+/gu, " ").trim();
  let out = text.normalize("NFKC").toLowerCase();
  if (MARK_CHARS.test(out)) out = out.replace(MARK_CHARS_ALL, "");
  if (FOLD_CHARS.test(out)) out = out.replace(FOLD_CHARS_ALL, (char) => FOLD_MAP[char] ?? "");
  return out.replace(/\s+/gu, " ").trim();
}

// Build heavy structures only when first needed (cold starts and the user store never pay for them).
function lazy(build) {
  let value;
  let ready = false;
  return () => {
    if (!ready) {
      value = build();
      ready = true;
    }
    return value;
  };
}

// Search only the sheet's own text; never derived/generated fields.
const SEARCH_FIELDS = ["coptic", "greek", "pronunciation", "english", "phonetic", "translation_en", "translation_fr", "translation_de"];

// Recordings are linked to the word's permanent id (data/word_ids.json), never to its row position.
const VOICE_PREFIX = "voiceid:";
const voiceKey = (id) => `${VOICE_PREFIX}${id}`;
const CARD_DISABLED_PREFIX = "card-disabled:";
const cardDisabledKey = (id) => `${CARD_DISABLED_PREFIX}${id}`;
const recordIndexById = lazy(() => {
  const map = new Map();
  records.forEach((record, index) => {
    if (record.id != null && !map.has(record.id)) map.set(record.id, index);
  });
  return map;
});

const ARABIC_LETTER = /[\u0600-\u06ff]/u;
const COPTIC_LETTER = /[\u2c80-\u2cff\u03e2-\u03ef]/u;
const LATIN_LETTER = /[a-z]/iu;

// Lowercase/strip marks, then keep only letters/digits separated by single spaces.
function toTokens(normalized) {
  return normalized.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").trim();
}

function tokens(value) {
  return toTokens(normalize(value));
}

// True when `needle` (already tokenized) appears in `text` as whole word(s), never inside a longer word.
function hasWholeWords(text, needle) {
  return needle !== "" && ` ${text} `.includes(` ${needle} `);
}

const SUGGESTION_PAGE_SIZE = 10;
const SUGGESTION_TITLE = "اختر من الاقتراحات التالية:";
const SHORT_QUERY_MAX = 2;
const UI_TEXT = {
  ar: { word: "الكلمة", meaning: "المعنى", kind: "النوع", origin: "الأصل", more: "هناك معنى آخر للكلمة التي بحثت بها", next: "اضغط هنا لعرضه", end: "انتهت المعاني المتاحة لهذه الكلمة", choose: "اختر من الاقتراحات التالية:", previous: "السابق", pageNext: "التالي", noResult: "القاموس قيد التطوير حاليًا وسيتم إضافة معنى هذه الكلمة لاحقًا" },
  en: { word: "Word", meaning: "Meaning", kind: "Part of speech", origin: "Origin", more: "There is another meaning for the word you searched", next: "Click here to view it", end: "No more meanings are available for this word", choose: "Choose from the following suggestions:", previous: "Previous", pageNext: "Next", noResult: "The dictionary is still under development; this word will be added later" },
  fr: { word: "Mot", meaning: "Sens", kind: "Nature", origin: "Origine", more: "Il existe un autre sens pour le mot recherché", next: "Cliquez ici pour l’afficher", end: "Il n’y a plus de sens disponible pour ce mot", choose: "Choisissez parmi les suggestions suivantes :", previous: "Précédent", pageNext: "Suivant", noResult: "Le dictionnaire est encore en développement ; ce mot sera ajouté plus tard" },
  de: { word: "Wort", meaning: "Bedeutung", kind: "Wortart", origin: "Herkunft", more: "Es gibt eine weitere Bedeutung für das gesuchte Wort", next: "Hier klicken, um sie anzuzeigen", end: "Für dieses Wort sind keine weiteren Bedeutungen verfügbar", choose: "Wählen Sie aus den folgenden Vorschlägen:", previous: "Zurück", pageNext: "Weiter", noResult: "Das Wörterbuch wird noch entwickelt; dieses Wort wird später hinzugefügt" },
};

const VALUE_TRANSLATIONS = {
  en: { "اسم": "noun", "فعل": "verb", "صفة": "adjective", "ظرف": "adverb", "حرف جر": "preposition", "أداة ربط": "conjunction", "رقم": "numeral", "ضمير": "pronoun", "حرف": "letter", "أداة": "particle", "أداة نفي": "negative particle", "جملة": "sentence", "بادئة": "prefix", "زائدة": "suffix", "أداة استفهام": "interrogative particle", "أداة تعريف": "definite article", "أداة تنكير": "indefinite article", "صيغة تفضيل": "comparative form", "حال": "adverbial", "اسم موصول": "relative noun", "قبطية": "Coptic", "يونانية": "Greek", "عبرية": "Hebrew", "لاتينية": "Latin", "آرامية": "Aramaic", "سريانية": "Syriac" },
  fr: { "اسم": "nom", "فعل": "verbe", "صفة": "adjectif", "ظرف": "adverbe", "حرف جر": "préposition", "أداة ربط": "conjonction", "رقم": "numéral", "ضمير": "pronom", "حرف": "lettre", "أداة": "particule", "أداة نفي": "particule négative", "جملة": "phrase", "بادئة": "préfixe", "زائدة": "suffixe", "أداة استفهام": "particule interrogative", "أداة تعريف": "article défini", "أداة تنكير": "article indéfini", "صيغة تفضيل": "comparatif", "حال": "adverbial", "اسم موصول": "nom relatif", "قبطية": "copte", "يونانية": "grec", "عبرية": "hébreu", "لاتينية": "latin", "آرامية": "araméen", "سريانية": "syriaque" },
  de: { "اسم": "Substantiv", "فعل": "Verb", "صفة": "Adjektiv", "ظرف": "Adverb", "حرف جر": "Präposition", "أداة ربط": "Konjunktion", "رقم": "Zahlwort", "ضمير": "Pronomen", "حرف": "Buchstabe", "أداة": "Partikel", "أداة نفي": "Verneinungspartikel", "جملة": "Satz", "بادئة": "Präfix", "زائدة": "Suffix", "أداة استفهام": "Fragepartikel", "أداة تعريف": "bestimmter Artikel", "أداة تنكير": "unbestimmter Artikel", "صيغة تفضيل": "Komparativ", "حال": "adverbial", "اسم موصول": "Relativnomen", "قبطية": "Koptisch", "يونانية": "Griechisch", "عبرية": "Hebräisch", "لاتينية": "Lateinisch", "آرامية": "Aramäisch", "سريانية": "Syrisch" },
};

function uiLanguage(searchKey = "") {
  const kind = searchKey ? scriptKind(normalize(searchKey)) : "ar";
  return UI_TEXT[kind] ? kind : "ar";
}

function uiTextFor(searchKey = "") {
  return UI_TEXT[uiLanguage(searchKey)] ?? UI_TEXT.ar;
}

function localizedValue(value, language) {
  const raw = String(value ?? "").trim();
  return VALUE_TRANSLATIONS[language]?.[raw] ?? raw;
}

function splitMeaning(value) {
  return String(value ?? "").split(/\s*[،,]\s*/u).map((part) => part.trim()).filter(Boolean);
}

// Normalized text, tokenized meanings and "word starts" per record, built once per isolate on first search.
const searchIndex = lazy(() => {
  const text = [];
  const meaning = [];
  const prefix = [];
  for (const record of records) {
    text.push(normalize(SEARCH_FIELDS.map((key) => record[key] ?? "").join(" ")));
    const parts = splitMeaning(record.meaning).map(normalize);
    meaning.push(parts.map(toTokens));
    const keys = [record.coptic, record.greek, record.english, record.phonetic].map(normalize);
    prefix.push(keys.concat(parts).filter(Boolean));
  }
  return { text, meaning, prefix };
});

function findPrefixMatches(normalizedQuery) {
  const matches = [];
  const { prefix } = searchIndex();
  for (let index = 0; index < prefix.length; index += 1) {
    const keys = prefix[index];
    for (let k = 0; k < keys.length; k += 1) {
      if (keys[k].startsWith(normalizedQuery)) {
        matches.push(index);
        break;
      }
    }
  }
  return matches;
}

// Index of the meaning part the query refers to (Arabic searches only); -1 means "show everything".
function matchedPartIndex(record, normalizedQuery) {
  if (!ARABIC_LETTER.test(normalizedQuery)) return -1;
  const needle = tokens(normalizedQuery);
  const parts = splitMeaning(record.meaning);
  const exact = parts.findIndex((part) => tokens(part) === needle);
  if (exact >= 0) return exact;
  return parts.findIndex((part) => normalize(part).startsWith(normalizedQuery) || hasWholeWords(tokens(part), needle));
}

// Suggestions use the same language the user searched in; full meanings appear after tapping.
function suggestionLabel(record, normalizedQuery) {
  if (ARABIC_LETTER.test(normalizedQuery)) {
    const part = matchedPartIndex(record, normalizedQuery);
    const meanings = splitMeaning(record.meaning);
    return (meanings[part >= 0 ? part : 0] || meanings[0] || record.english || "—").trim().slice(0, 48);
  }
  if (COPTIC_LETTER.test(normalizedQuery)) return String(record.coptic ?? "").replaceAll("`", "").trim().slice(0, 48) || "—";
  const kind = scriptKind(normalizedQuery);
  if (kind === "fr") return String(record.translation_fr ?? "").trim().slice(0, 48) || "—";
  if (kind === "de") return String(record.translation_de ?? "").trim().slice(0, 48) || "—";
  if (kind === "en") return String(record.translation_en ?? record.english ?? "").trim().slice(0, 48) || String(record.phonetic ?? "").trim().slice(0, 48) || "—";
  return String(record.greek ?? record.coptic ?? record.english ?? "—").replaceAll("`", "").trim().slice(0, 48);
}

function truncateBytes(value, maxBytes) {
  const encoder = new TextEncoder();
  let out = "";
  let used = 0;
  for (const char of String(value)) {
    const size = encoder.encode(char).length;
    if (used + size > maxBytes) break;
    out += char;
    used += size;
  }
  return out;
}

function pageCallback(page, query) {
  const prefix = `p|${page}|`;
  return prefix + truncateBytes(query, CALLBACK_DATA_MAX_BYTES - prefix.length);
}

function renderSuggestions(query, normalizedQuery, matches, requestedPage) {
  const ui = uiTextFor(query);
  const totalPages = Math.max(1, Math.ceil(matches.length / SUGGESTION_PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, totalPages - 1));
  const slice = matches.slice(page * SUGGESTION_PAGE_SIZE, (page + 1) * SUGGESTION_PAGE_SIZE);
  const languageQuery = uiLanguage(query) === "ar" ? "" : truncateBytes(query, CALLBACK_DATA_MAX_BYTES - 18);
  const keyboard = slice.map((index) => {
    const part = matchedPartIndex(records[index], normalizedQuery);
    return [{
      text: suggestionLabel(records[index], normalizedQuery),
      callback_data: part >= 0 ? `s|${index}|${part}${languageQuery ? `|${languageQuery}` : ""}` : `s|${index}${languageQuery ? `|${languageQuery}` : ""}`,
    }];
  });
  const navigation = [];
  if (page > 0) navigation.push({ text: ui.previous, callback_data: pageCallback(page - 1, query) });
  if (page < totalPages - 1) navigation.push({ text: ui.pageNext, callback_data: pageCallback(page + 1, query) });
  if (navigation.length) keyboard.push(navigation);
  return { text: ui.choose, reply_markup: { inline_keyboard: keyboard } };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatRecord(record, partIndex = -1, searchedWord = "") {
  const parts = splitMeaning(record.meaning);
  const arabicPart = partIndex >= 0 && parts[partIndex] ? parts[partIndex] : parts.join("، ");
  // Show the user's searched word first. Any non-Coptic search (Arabic,
  // English, Greek, etc.) must show the Coptic headword as its counterpart;
  // only a Coptic search shows the Arabic meaning parts.
  const isCopticSearch = searchedWord === "" || scriptKind(normalize(searchedWord)) === "cop";
  const language = isCopticSearch ? "ar" : uiLanguage(searchedWord);
  const labels = UI_TEXT[language] ?? UI_TEXT.ar;
  const displayedWord = searchedWord || record.coptic;
  const fields = !isCopticSearch
    ? [
        [labels.word, displayedWord],
        [labels.meaning, record.coptic],
        [labels.kind, localizedValue(record.kind, language)],
        [labels.origin, localizedValue(record.origin, language)],
      ]
    : [
        [UI_TEXT.ar.word, displayedWord],
        [UI_TEXT.ar.meaning, arabicPart],
        [UI_TEXT.ar.kind, record.kind],
        [UI_TEXT.ar.origin, record.origin],
      ];
  const lines = [];
  for (const [label, raw] of fields) {
    const value = String(raw ?? "").trim();
    if (value) lines.push(`<b>${label}:</b> ${escapeHtml(value)}`);
  }
  return lines.join("\n");
}

const SAME_WORD_FIELDS = ["coptic", "greek", "english", "phonetic", "translation_en", "translation_fr", "translation_de"];

// Rows sharing a normalized coptic/greek/english/phonetic value, built once (instead of scanning every row per lookup).
const sameWordRows = lazy(() => {
  const map = new Map();
  records.forEach((record, row) => {
    for (const field of SAME_WORD_FIELDS) {
      const value = normalize(record[field] ?? "");
      if (!value) continue;
      const list = map.get(value);
      if (!list) map.set(value, [row]);
      else if (list[list.length - 1] !== row) list.push(row);
    }
  });
  return map;
});

// Every row that is the same dictionary word as `index`, in sheet order.
function groupRows(index) {
  const base = records[index];
  const rows = new Set();
  for (const field of SAME_WORD_FIELDS) {
    const value = normalize(base?.[field] ?? "");
    if (value) for (const row of sameWordRows().get(value) ?? []) rows.add(row);
  }
  return [...rows].sort((a, b) => a - b);
}

// Keep meanings separate. The first option is the meaning that matched the query;
// following options are exposed one at a time through an inline button.
function meaningOptions(index, normalizedQuery = "", preferredPart = -1) {
  const base = records[index];
  if (!base) return [];
  const group = groupRows(index).map((row) => ({ record: records[row], row }));
  const options = [];
  const add = (row, part) => {
    const partText = splitMeaning(records[row]?.meaning)[part] ?? "";
    const key = normalize(partText) || `${row}:${part}`;
    if (!options.some((item) => item.key === key)) options.push({ key, index: row, part });
  };
  const firstPart = preferredPart >= 0 ? preferredPart : matchedPartIndex(base, normalizedQuery);
  if (firstPart >= 0) add(index, firstPart);
  else if (splitMeaning(base.meaning).length) add(index, 0);
  for (const { record, row } of group) {
    const parts = splitMeaning(record.meaning);
    for (let part = 0; part < parts.length; part += 1) add(row, part);
  }
  return options;
}

// The button walks one fixed list of meanings: each meaning is shown once, and the last one has no button.
// callback: n|<word row>|<first meaning part>|<step to show next>  (the list is rebuilt the same way every time).
function moreMeaning(options, baseIndex, nextStep = 1, callbackFor = undefined, keepSize = false, language = "ar") {
  const text = UI_TEXT[language] ?? UI_TEXT.ar;
  if (options.length <= nextStep) {
    if (!keepSize) return {};
    return {
      notice: `\n\n<b>${text.end}</b>`,
      reply_markup: { inline_keyboard: [[{ text: language === "ar" ? "انتهت المعاني" : text.end.slice(0, 48), callback_data: "e" }]] },
    };
  }
  const firstPart = Math.max(0, options[0].part);
  const data = callbackFor?.(nextStep) ?? `n|${baseIndex}|${firstPart}|${nextStep}`;
  return {
    notice: `\n\n<b>${text.more}</b>`,
    reply_markup: { inline_keyboard: [[{ text: text.next, callback_data: data }]] },
  };
}

// ---- Search like the original Apps Script bot ----
// 1) the typed word is an exact word -> show it (other meanings behind one button, each shown once);
// 2) otherwise -> the unique words that start with what was typed, as buttons; tapping one shows it.
function scriptKind(key) {
  if (ARABIC_LETTER.test(key)) return "ar";
  if (COPTIC_LETTER.test(key)) return "cop";
  if (LATIN_LETTER.test(key)) {
    const normalized = normalize(key);
    for (const kind of ["fr", "de", "en"]) {
      if (wordIndex(kind).map.has(normalized) || prefixWords(kind, normalized, 1).length) return kind;
    }
    return "en";
  }
  return "other";
}

const WORD_FIELDS = {
  cop: ["coptic"],
  en: ["english", "phonetic", "translation_en"],
  fr: ["translation_fr"],
  de: ["translation_de"],
  other: ["greek", "pronunciation"],
};
const wordIndexes = {};

// Built lazily per script, so an Arabic search never pays for the Coptic/Latin words.
function wordIndex(kind) {
  if (wordIndexes[kind]) return wordIndexes[kind];
  const map = new Map();
  const add = (text, row) => {
    const label = String(text ?? "").replaceAll("`", "").trim();
    const key = normalize(label);
    if (!key) return;
    const entry = map.get(key);
    if (!entry) map.set(key, { key, label, rows: [row] });
    else if (entry.rows[entry.rows.length - 1] !== row) entry.rows.push(row);
  };
  records.forEach((record, row) => {
    if (kind === "ar") {
      for (const part of splitMeaning(record.meaning)) add(part, row);
    } else {
      for (const field of WORD_FIELDS[kind]) for (const part of splitMeaning(record[field])) add(part, row);
    }
  });
  const sorted = [...map.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  wordIndexes[kind] = { map, sorted };
  return wordIndexes[kind];
}

// Unique words starting with `key`, in sheet order.
function prefixWords(kind, key, limit = 5000) {
  const { sorted } = wordIndex(kind);
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid].key < key) low = mid + 1;
    else high = mid;
  }
  const found = [];
  for (let i = low; i < sorted.length && found.length < limit && sorted[i].key.startsWith(key); i += 1) found.push(sorted[i]);
  return found.sort((a, b) => a.rows[0] - b.rows[0]);
}

// Every meaning to show for an exact word, once each, in order.
function exactChain(kind, key) {
  const entry = wordIndex(kind).map.get(key);
  if (!entry) return [];
  const options = [];
  const seen = new Set();
  if (kind === "ar") {
    // Arabic search: one entry per row, showing ONLY the matched meaning part.
    // "More meanings" = the same Arabic word appearing in a DIFFERENT row (different Coptic word).
    // This prevents showing sibling comma-separated meanings (e.g. "قوة، شدة") as separate buttons.
    for (const row of entry.rows) {
      const matchedPart = matchedPartIndex(records[row], key);
      if (matchedPart < 0) continue;
      const partText = splitMeaning(records[row]?.meaning)[matchedPart] ?? "";
      const uniqueKey = `${normalize(records[row]?.coptic ?? row)}|${normalize(partText)}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      // The same Arabic translation may legitimately belong to several different
      // Coptic headwords. Keep each row as a separate option instead of merging
      // them by translation text, while duplicate rows for the same headword are
      // still collapsed.
      options.push({ key: uniqueKey, index: row, part: matchedPart });
    }
  } else if (kind === "cop") {
    for (const row of entry.rows) {
      for (const option of meaningOptions(row, "", -1)) {
        if (seen.has(option.key)) continue;
        seen.add(option.key);
        options.push(option);
      }
    }
  } else {
    for (const row of entry.rows) {
      const key = normalize(records[row]?.coptic ?? row);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ key, index: row, part: -1 });
    }
  }
  return options;
}

function chainCallback(key) {
  return (step) => {
    const data = `x|${step}|${key}`;
    return new TextEncoder().encode(data).length <= CALLBACK_DATA_MAX_BYTES ? data : null;
  };
}

function renderWordSuggestions(query, words, requestedPage) {
  const ui = uiTextFor(query);
  const totalPages = Math.max(1, Math.ceil(words.length / SUGGESTION_PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, totalPages - 1));
  const keyboard = words.slice(page * SUGGESTION_PAGE_SIZE, (page + 1) * SUGGESTION_PAGE_SIZE).map((word) => [{
    text: word.label.slice(0, 48),
    callback_data: `w|${truncateBytes(word.key, CALLBACK_DATA_MAX_BYTES - 2)}`,
  }]);
  const navigation = [];
  if (page > 0) navigation.push({ text: ui.previous, callback_data: pageCallback(page - 1, query) });
  if (page < totalPages - 1) navigation.push({ text: ui.pageNext, callback_data: pageCallback(page + 1, query) });
  if (navigation.length) keyboard.push(navigation);
  return { text: ui.choose, reply_markup: { inline_keyboard: keyboard } };
}

function findMatches(query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  const matches = [];
  if (ARABIC_LETTER.test(normalizedQuery)) {
    // Arabic: match the sheet's meanings only, as whole words/phrases (never inside a longer word).
    const needle = tokens(normalizedQuery);
    if (!needle) return [];
    const exact = [];
    const { meaning: meaningTokens } = searchIndex();
    for (let index = 0; index < meaningTokens.length; index += 1) {
      let found = false;
      let isExact = false;
      for (const item of meaningTokens[index]) {
        if (item === needle) { isExact = true; break; }
        if (hasWholeWords(item, needle)) found = true;
      }
      if (isExact) exact.push(index);
      else if (found) matches.push(index);
    }
    return exact.concat(matches);
  }
  const needle = toTokens(normalizedQuery);
  if (!needle) return [];
  const exact = [];
  const partial = [];
  for (let index = 0; index < records.length; index += 1) {
    const fields = SEARCH_FIELDS.flatMap((field) => splitMeaning(records[index]?.[field]).map(normalize));
    if (fields.some((field) => field === normalizedQuery)) exact.push(index);
    else if (fields.some((field) => hasWholeWords(toTokens(field), needle))) partial.push(index);
  }
  return exact.concat(partial);
}

const TYPING_DELAY_MS = 0; // raise (e.g. 400) for a longer visible "typing…"

async function telegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    console.error(`Telegram ${method} failed`, result.description ?? response.status);
  }
  return result;
}

async function fetchSpeech(spoken) {
  try {
    const ttsUrl = "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&ttsspeed=0.5&q=" + encodeURIComponent(spoken);
    const ttsResponse = await fetch(ttsUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; CopticDictionaryBot/1.0)" },
      signal: AbortSignal.timeout(6000),
    });
    const contentType = ttsResponse.headers.get("content-type") ?? "";
    if (!ttsResponse.ok || !contentType.includes("audio")) {
      console.error("TTS fetch failed", ttsResponse.status, contentType);
      return null;
    }
    const audio = await ttsResponse.arrayBuffer();
    return audio.byteLength ? audio : null;
  } catch (error) {
    console.error("Voice failed", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

function speechSpelling(record) {
  // Prefer the sheet's IPA pronunciation, converted to an English-friendly
  // phoneme spelling. Google Translate TTS does not parse IPA syntax itself.
  const ipa = String(record?.pronunciation || "").trim();
  const sheetSpelling = String(record?.english || record?.phonetic || "").trim();
  const usesIpa = Boolean(ipa);
  let word = (ipa || sheetSpelling).trim();
  word = word
    .replaceAll("`", "")
    .replaceAll("ü", "u")
    .replaceAll("ï", "i")
    .replaceAll("ō", "o")
    .replaceAll("ā", "a")
    .replaceAll("ē", "e")
    .replace(/ɑʊ|iː|oː|eː|tʃ|ʃ|ʒ|kʰ|tʰ|pʰ|ŋ|ɣ|x|ɑ|ː/gu, (symbol) => {
      if (!usesIpa) return symbol;
      return { "ɑʊ": "au", "iː": "ee", "oː": "oh", "eː": "eh", tʃ: "tsch", "ʃ": "sh", "ʒ": "j", "kʰ": "kh", "tʰ": "th", "pʰ": "ph", "ŋ": "ng", "ɣ": "gh", x: "kh", "ɑ": "a", "ː": "" }[symbol] ?? symbol;
    })
    .replace(/^i(?=[aeiou])/u, "y")
    .replace(/\s*\/\s*/gu, ", ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120);
  return word;
}

function spokenText(record) {
  const word = speechSpelling(record);
  // Generated speech is deliberately slow and repeated for pronunciation practice.
  return word ? `${word}, ${word}, ${word}` : "";
}

// Caption under the voice sent to the user: "<meaning>. <Coptic word>. <origin>. <gender>."
// The meaning is the one the user searched for (the whole meaning when they searched by Coptic/Latin text).
function voiceCaption(record, partIndex = -1, searchedWord = "") {
  const parts = splitMeaning(record?.meaning);
  const meaning = partIndex >= 0 && parts[partIndex] ? parts[partIndex] : parts.join("، ");
  const isCopticSearch = searchedWord === "" || scriptKind(normalize(searchedWord)) === "cop";
  const language = isCopticSearch ? "ar" : uiLanguage(searchedWord);
  const labels = UI_TEXT[language] ?? UI_TEXT.ar;
  const values = isCopticSearch
    ? [[UI_TEXT.ar.meaning, meaning], [UI_TEXT.ar.word, record?.coptic], [UI_TEXT.ar.origin, record?.origin], [UI_TEXT.ar.kind, record?.kind]]
    : [[labels.word, searchedWord || record?.coptic], [labels.meaning, record?.coptic], [labels.origin, localizedValue(record?.origin, language)], [labels.kind, localizedValue(record?.kind, language)]];
  return values.map(([label, value]) => `${label}: ${String(value ?? "").replace(/\s+/gu, " ").trim().replace(/\.+$/u, "")}`)
    .map((value) => String(value ?? "").replace(/\s+/gu, " ").trim().replace(/\.+$/u, ""))
    .filter(Boolean)
    .join(". ")
    .concat(".")
    .slice(0, 1000);
}

// Starts the lookup (admin recording) or speech generation right away, so it is ready when the text is sent.
function prepareWordVoice(env, record, media = null) {
  return (async () => {
    if (env.USERS && record?.id != null) {
      try {
        const saved = media ? { value: (await media).voice } : await storeCall(env, { op: "get", key: voiceKey(record.id) });
        if (saved?.value?.fileId) return { fileId: saved.value.fileId };
      } catch (error) {
        console.error("Recorded voice lookup failed", error instanceof Error ? error.message : "unknown error");
      }
    }
    const spoken = spokenText(record);
    if (!spoken) return null;
    const audio = await fetchSpeech(spoken);
    return audio ? { audio, spoken } : null;
  })();
}

async function sendPreparedVoice(env, chatId, record, prepared, partIndex = -1, searchedWord = "") {
  let voice = await prepared;
  if (!voice) return;
  if (voice.fileId) {
    const result = await telegram(env, "sendVoice", { chat_id: chatId, voice: voice.fileId });
    if (result?.ok) return;
    // The saved recording could not be sent: fall back to the generated speech.
    const spoken = spokenText(record);
    const audio = spoken ? await fetchSpeech(spoken) : null;
    if (!audio) return;
    voice = { audio, spoken };
  }
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("voice", new Blob([voice.audio], { type: "audio/mpeg" }), "word.mp3");
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendVoice`, { method: "POST", body: form });
    if (!response.ok) console.error("Telegram sendVoice failed", response.status);
  } catch (error) {
    console.error("Voice failed", error instanceof Error ? error.message : "unknown error");
  }
}

async function sendWordVoice(env, chatId, record) {
  return sendPreparedVoice(env, chatId, record, prepareWordVoice(env, record));
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

// ---- Drive archive (Google Apps Script web app) ----
// Config comes from the APPS_SCRIPT_URL secret, or from /setdrive <url> (stored in the user store).
const DRIVE_CONFIG_KEY = "drive-config";
const SYNC_DRIVE_BATCH = 5;

async function driveConfig(env) {
  // An explicit admin /setdrive URL is an override; the repository secret is only the fallback.
  if (env.USERS) {
    try {
      const saved = (await storeCall(env, { op: "get", key: DRIVE_CONFIG_KEY })).value;
      if (saved?.url) return saved;
    } catch (error) {
      console.error("Drive config lookup failed", error instanceof Error ? error.message : "unknown error");
    }
  }
  return env.APPS_SCRIPT_URL ? { url: env.APPS_SCRIPT_URL } : null;
}

async function callAppsScript(config, payload) {
  const response = await fetch(config.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    // Apps Script answers with an HTML page when the deployment is missing, private or outdated.
    throw new Error(`Apps Script returned ${response.status} (not JSON): check Deploy > New version and "Anyone" access`);
  }
  if (!response.ok || !result.ok) throw new Error(result.error || `Apps Script failed: ${response.status}`);
  return result;
}

// Uploads one saved recording to Drive and remembers the link. Returns { ok, error }.
async function uploadVoiceToDrive(env, { id, record, fileId, duration, by }) {
  const config = await driveConfig(env);
  if (!config) return { ok: false, error: "not configured" };
  try {
    const fileInfo = await telegram(env, "getFile", { file_id: fileId });
    const filePath = fileInfo?.ok ? fileInfo.result?.file_path : null;
    if (!filePath) throw new Error("Telegram did not return a file path");
    const audioResponse = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!audioResponse.ok) throw new Error(`Telegram file download failed: ${audioResponse.status}`);
    const result = await callAppsScript(config, {
      action: "upload",
      id,
      word: record?.coptic ?? "",
      audio_base64: arrayBufferToBase64(await audioResponse.arrayBuffer()),
      mime_type: "audio/ogg",
      file_id: fileId,
      duration: duration ?? "",
      by: by ?? null,
    });
    await storeCall(env, {
      op: "voicedrive",
      id,
      fileId,
      drive: { url: result.url ?? null, fileId: result.file_id ?? null, at: new Date().toISOString() },
    });
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.error("Voice archive failed", reason);
    return { ok: false, error: reason };
  }
}

// Runs work after the webhook has answered (so recording stays fast); in tests it is simply awaited.
async function inBackground(ctx, work) {
  if (ctx?.waitUntil) {
    ctx.waitUntil(work.catch((error) => console.error("Background task failed", error instanceof Error ? error.message : "unknown error")));
    return;
  }
  await work;
}

async function archiveAndReport(env, chatId, job) {
  const outcome = await uploadVoiceToDrive(env, job);
  if (outcome.ok || outcome.error === "not configured") return;
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: `⚠️ تم حفظ التسجيل لكن تعذّر رفع «${job.record?.coptic ?? ""}» إلى درايف:\n${outcome.error}\nسيبقى في قائمة الانتظار، أرسل /syncdrive لإعادة المحاولة.`.slice(0, 1000),
  });
}

async function driveStatusText(env) {
  const config = await driveConfig(env);
  if (!config) {
    return "☁️ لم يتم ربط جوجل درايف بعد.\nأرسل: /setdrive رابط_السكريبت";
  }
  const counts = await storeCall(env, { op: "voicepending", limit: 0 });
  const lines = [
    "☁️ <b>أرشيف جوجل درايف</b>",
    `✅ مرفوع: ${counts.uploaded}`,
    `⏳ في الانتظار: ${counts.pendingTotal}`,
    `🎙 إجمالي التسجيلات: ${counts.total}`,
  ];
  try {
    const ping = await callAppsScript(config, { action: "ping" });
    lines.push("", `📁 الفولدر: <a href="${escapeHtml(ping.folder?.url ?? "")}">${escapeHtml(ping.folder?.name ?? "")}</a>`);
    lines.push(`📄 الشيت: ${escapeHtml(ping.sheet?.name ?? "")} — ورقة ${escapeHtml(ping.sheet?.tab ?? "Ban")}`);
  } catch (error) {
    lines.push("", `❌ تعذّر الاتصال بالسكريبت: ${escapeHtml(error instanceof Error ? error.message : "unknown error")}`);
  }
  if (counts.pendingTotal) lines.push("", "أرسل /syncdrive لرفع المتبقي.");
  return lines.join("\n");
}

async function syncPendingVoices(env, chatId, by) {
  const config = await driveConfig(env);
  if (!config) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "لم يتم ربط جوجل درايف بعد. استخدم /setdrive أولًا." });
    return;
  }
  const batch = await storeCall(env, { op: "voicepending", limit: SYNC_DRIVE_BATCH });
  let uploaded = 0;
  let failure = "";
  for (const item of batch.pending) {
    const record = records[recordIndexById().get(item.id)];
    const outcome = await uploadVoiceToDrive(env, { id: item.id, record, fileId: item.fileId, duration: item.duration, by });
    if (outcome.ok) uploaded += 1;
    else {
      failure = outcome.error;
      break;
    }
  }
  const left = Math.max(0, batch.pendingTotal - uploaded);
  const lines = [`☁️ تم رفع ${uploaded} تسجيل.`, `⏳ المتبقي: ${left}`];
  if (failure) lines.push(`❌ توقف الرفع: ${failure}`);
  else if (left) lines.push("أرسل /syncdrive مرة أخرى لمتابعة الرفع.");
  else lines.push("🎉 كل التسجيلات مرفوعة.");
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n") });
}

async function setDriveConfig(env, message, argument) {
  const input = argument.trim();
  if (input.toLowerCase() === "reset") {
    await storeCall(env, { op: "put", key: DRIVE_CONFIG_KEY, value: null });
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "تم حذف رابط /setdrive. سيستخدم البوت سرّ APPS_SCRIPT_URL إن كان مضبوطًا." });
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: await driveStatusText(env), parse_mode: "HTML", disable_web_page_preview: true });
    return;
  }
  const url = input.split(/\s+/u)[0];
  if (!/^https:\/\/script\.google\.com\/(?:macros\/s\/[\w-]+|a\/[^/\s]+\/macros\/s\/[\w-]+)\/exec$/u.test(url ?? "")) {
    await telegram(env, "sendMessage", {
      chat_id: message.chat.id,
      text: "أرسل: /setdrive ثم رابط الويب آب المنتهي بـ exec",
    });
    return;
  }
  await storeCall(env, { op: "put", key: DRIVE_CONFIG_KEY, value: { url } });
  await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "تم حفظ رابط درايف. جارٍ الاختبار…" });
  await telegram(env, "sendMessage", { chat_id: message.chat.id, text: await driveStatusText(env), parse_mode: "HTML", disable_web_page_preview: true });
}

async function showTyping(env, chatId, delayMs = TYPING_DELAY_MS) {
  await telegram(env, "sendChatAction", { chat_id: chatId, action: "typing" });
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
}

// ---- Word cards (images drawn in GitHub Actions; see scripts/render_cards.mjs) ----
const CARDS_BASE_URL = "https://raw.githubusercontent.com/abr429701-oss/coptic-dictionary-bot/main/cards";

function cardHash(record) {
  return record?.id != null ? cardManifest[String(record.id)] ?? null : null;
}

function cardStorageKey(id, language = "ar") {
  return language === "ar" ? `card:${id}` : `card:${id}:${language}`;
}

// Only words that have a card pay for the extra lookup; it also carries the saved recording (one call).
function lookupMedia(env, record, language = "ar") {
  if (!cardHash(record)) return null;
  if (!env.USERS) return Promise.resolve({ voice: null, card: null });
  return storeCall(env, { op: "media", id: record.id, language }).catch((error) => {
    console.error("Media lookup failed", error instanceof Error ? error.message : "unknown error");
    return { voice: null, card: null };
  });
}

// Sends the entry text first, then the single supplied card image. The voice is sent by the caller.
async function sendCardEntry(env, chatId, record, text, media, replyMarkup = undefined, language = "ar") {
  // Word-card photos are disabled for now; dictionary results remain text + voice only.
  return false;
}

function cardRecord(query) {
  const clean = String(query ?? "").trim();
  if (!clean) return null;
  const normalized = normalize(clean);
  const exact = records.find((record) => [record.coptic, record.english, record.pronunciation]
    .some((value) => normalize(value) === normalized));
  return exact ?? records[findMatches(clean)[0]] ?? null;
}

async function setCardVisibility(env, chatId, query, visible) {
  const record = cardRecord(query);
  if (record?.id == null || !cardHash(record)) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "لم أجد بطاقة لهذه الكلمة. أرسل الكلمة كما هي أو تأكد أن لها بطاقة." });
    return;
  }
  if (visible) {
    await storeCall(env, { op: "delete", key: cardDisabledKey(record.id) });
    await telegram(env, "sendMessage", { chat_id: chatId, text: `✅ ستظهر بطاقة «${record.coptic}» مرة أخرى في البحث التالي.` });
    await sendSearch(env, chatId, record.coptic, 0);
    return;
  }
  await storeCall(env, { op: "put", key: cardDisabledKey(record.id), value: true });
  await storeCall(env, { op: "delete", key: `card:${record.id}` });
  await telegram(env, "sendMessage", { chat_id: chatId, text: `🗑️ تم إخفاء بطاقة «${record.coptic}». ستعود فقط عند تسجيل Voice جديد أو استخدام /card_show.` });
}

async function sendSearch(env, chatId, query, page = 0, messageId = undefined) {
  const cleanQuery = String(query ?? "").replace(/[\r\n]+/gu, " ").trim().slice(0, 160);
  const normalizedQuery = normalize(cleanQuery);
  const deliver = (payload) => messageId === undefined
    ? telegram(env, "sendMessage", { chat_id: chatId, ...payload })
    : telegram(env, "editMessageText", { chat_id: chatId, message_id: messageId, ...payload });

  if (normalizedQuery) {
    const kind = scriptKind(normalizedQuery);
    const isShortQuery = [...normalizedQuery.replace(/\s+/gu, "")].length <= SHORT_QUERY_MAX;
    if (messageId === undefined && !isShortQuery) {
      const chain = exactChain(kind, normalizedQuery);
      if (chain.length) return sendOption(env, chatId, chain, chain[0].index, 0, undefined, chainCallback(cleanQuery), cleanQuery);
    }
    const words = prefixWords(kind, normalizedQuery);
    if (words.length) {
      const view = renderWordSuggestions(cleanQuery, words, page);
      return deliver({ text: view.text, parse_mode: "HTML", reply_markup: view.reply_markup });
    }
  }
  const matches = findMatches(cleanQuery);
  if (!matches.length) {
    return deliver({ text: uiTextFor(cleanQuery).noResult });
  }
  if (matches.length > 1) {
    const view = renderSuggestions(cleanQuery, normalizedQuery, matches, page);
    return deliver({ text: view.text, parse_mode: "HTML", reply_markup: view.reply_markup });
  }
  const options = meaningOptions(matches[0], normalizedQuery);
  const selected = options[0] ?? { index: matches[0], part: matchedPartIndex(records[matches[0]], normalizedQuery) };
  const record = records[selected.index];
  const cardLanguage = uiLanguage(normalizedQuery);
  const media = messageId === undefined ? lookupMedia(env, record, cardLanguage) : null;
  const voice = prepareWordVoice(env, record, media);
  const more = moreMeaning(options, matches[0], 1, undefined, true, uiLanguage(normalizedQuery));
  const text = `${formatRecord(record, selected.part, normalizedQuery)}${more.notice ?? ""}`.slice(0, MAX_MESSAGE_LENGTH);
  if (await sendCardEntry(env, chatId, record, text, media, more.reply_markup, cardLanguage)) {
    await sendPreparedVoice(env, chatId, record, voice, selected.part, normalizedQuery);
    return undefined;
  }
  const response = await deliver({ text, parse_mode: "HTML", ...(more.reply_markup ? { reply_markup: more.reply_markup } : {}) });
  await sendPreparedVoice(env, chatId, record, voice, selected.part, normalizedQuery);
  return response;
}

async function sendRecord(env, chatId, index, partIndex = -1, searchKey = "") {
  const options = searchKey && scriptKind(normalize(searchKey)) !== "cop"
    ? [{ key: String(index), index, part: -1 }]
    : meaningOptions(index, "", partIndex);
  await sendOption(env, chatId, options, index, 0, { index, part: partIndex }, undefined, searchKey);
}

// Step n of the next-meaning button: shows meaning number `step` of the word's fixed list.
async function sendMeaningStep(env, chatId, baseIndex, firstPart, step) {
  const options = meaningOptions(baseIndex, "", firstPart);
  if (!options[step]) return;
  await sendOption(env, chatId, options, baseIndex, step, undefined, undefined, "", false);
}
async function sendOption(env, chatId, options, baseIndex, step, fallback = undefined, callbackFor = undefined, searchKey = "", sendVoice = true) {
  const selected = options[step] ?? fallback;
  const record = records[selected?.index];
  if (!record) return;
  const cardLanguage = uiLanguage(searchKey);
  const media = lookupMedia(env, record, cardLanguage);
  const voice = prepareWordVoice(env, record, media);
  const more = moreMeaning(options, baseIndex, step + 1, callbackFor ?? (searchKey ? chainCallback(searchKey) : undefined), true, uiLanguage(searchKey));
  const text = `${formatRecord(record, selected.part, searchKey)}${more.notice ?? ""}`.slice(0, MAX_MESSAGE_LENGTH);
  if (!(await sendCardEntry(env, chatId, record, text, media, more.reply_markup, cardLanguage))) {
    await telegram(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...(more.reply_markup ? { reply_markup: more.reply_markup } : {}) });
  }
  if (sendVoice) await sendPreparedVoice(env, chatId, record, voice, selected.part, searchKey);
}

// Registered users live in one SQLite-backed Durable Object (no extra Cloudflare token permission needed).
export class UserStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Run the one-time conversion before any request is served.
    state.blockConcurrencyWhile?.(() => this.migrateLegacyVoices());
  }

  // Recordings used to be stored as voice:<row number>, which breaks when rows move. Re-key them by word id.
  async migrateLegacyVoices() {
    const storage = this.state.storage;
    if (await storage.get("voice-ids-migrated")) return;
    const legacy = await storage.list({ prefix: "voice:" });
    for (const [key, value] of legacy) {
      const suffix = key.slice("voice:".length);
      if (/^\d+$/u.test(suffix)) {
        const id = records[Number(suffix)]?.id;
        if (id != null && !(await storage.get(voiceKey(id)))) await storage.put(voiceKey(id), value);
      }
      await storage.delete(key);
    }
    await storage.put("voice-ids-migrated", true);
  }

  async recipients(exclude = []) {
    const skip = new Set(exclude.map(String));
    const users = await this.state.storage.list({ prefix: "user:" });
    const ids = [];
    for (const [key, record] of users) {
      const id = key.slice("user:".length);
      if (!skip.has(id) && !record?.blocked) ids.push(id);
    }
    return ids;
  }

  async alarm() {
    const storage = this.state.storage;
    const job = await storage.get("broadcast");
    if (!job) return;
    const batch = job.queue.splice(0, BROADCAST_BATCH_SIZE);
    let delay = BROADCAST_BATCH_DELAY_MS;
    for (let i = 0; i < batch.length; i += 1) {
      const id = batch[i];
      const result = await telegram(this.env, "copyMessage", {
        chat_id: id,
        from_chat_id: job.fromChat,
        message_id: job.messageId,
      });
      if (result?.ok) {
        job.sent += 1;
      } else if (result?.error_code === 429) {
        // Telegram asked us to slow down: put the rest back and wait.
        job.queue.unshift(...batch.slice(i));
        delay = ((result.parameters?.retry_after ?? 5) + 1) * 1000;
        break;
      } else {
        job.failed += 1;
        if (result?.error_code === 403 || result?.error_code === 400) {
          const record = (await storage.get(`user:${id}`)) ?? {};
          await storage.put(`user:${id}`, { ...record, blocked: true });
        }
      }
    }
    if (job.queue.length) {
      await storage.put("broadcast", job);
      await storage.setAlarm(Date.now() + delay);
      return;
    }
    await storage.delete("broadcast");
    await telegram(this.env, "sendMessage", {
      chat_id: job.adminChat,
      text: `✅ اكتمل الإرسال الجماعي.\nوصلت إلى: ${job.sent}\nلم تصل (حظروا البوت أو حذفوه): ${job.failed}\nالإجمالي: ${job.total}`,
    });
  }

  async fetch(request) {
    const body = await request.json();
    const { op, key, value, userId, input, kb, exclude, fromChat, messageId, id, fileId, drive, limit, profile, cursor, language } = body;
    const storage = this.state.storage;
    if (op === "get") return Response.json({ value: (await storage.get(key)) ?? null });
    if (op === "put") {
      await storage.put(key, value);
      return Response.json({ ok: true });
    }
    if (op === "delete") {
      await storage.delete(key);
      return Response.json({ ok: true });
    }
    if (op === "register") {
      // Atomic "first contact" check so two quick messages never announce the same user twice.
      const existing = await storage.get(`user:${userId}`);
      const username = profile?.username ?? "";
      const tgName = profile?.tgName ?? "";
      if (!existing) {
        const created = { firstSeen: new Date().toISOString(), ...(username ? { username } : {}), ...(tgName ? { tgName } : {}) };
        await storage.put(`user:${userId}`, created);
        return Response.json({ created: true, user: created, total: (await storage.list({ prefix: "user:" })).size });
      }
      let user = existing.blocked ? { ...existing, blocked: false } : existing;
      let changed = false;
      if (profile && (username !== (existing.username ?? "") || tgName !== (existing.tgName ?? ""))) {
        user = { ...user, username, tgName };
        changed = true;
      }
      if (user !== existing) await storage.put(`user:${userId}`, user);
      return Response.json({ created: false, user, changed });
    }
    if (op === "userpage") {
      const size = limit ?? 40;
      const page = await storage.list({ prefix: "user:", ...(cursor ? { startAfter: cursor } : {}), limit: size });
      const users = [...page].map(([storedKey, record]) => ({ key: storedKey, id: storedKey.slice("user:".length), record }));
      return Response.json({ users, next: users.length === size ? users.at(-1).key : null });
    }
    if (op === "usage") {
      // Request counter per UTC day (flushed in batches by the Worker so it stays cheap).
      const dayKey = `usage:${profile?.day ?? id}`;
      const day = String(profile?.day ?? id);
      const total = ((await storage.get(dayKey)) ?? 0) + Number(limit ?? 0);
      await storage.put(dayKey, total);
      if (total === Number(limit ?? 0)) {
        // First write of a new day: forget counters older than 40 days.
        const old = [...(await storage.list({ prefix: "usage:" })).keys()].sort().slice(0, -40);
        for (const oldKey of old) await storage.delete(oldKey);
      }
      const alertKey = `usage-alert:${day}`;
      const alerted = (await storage.get(alertKey)) ?? 0;
      const level = USAGE_ALERT_LEVELS.filter((threshold) => total >= threshold).at(-1) ?? 0;
      if (level > alerted) {
        await storage.put(alertKey, level);
        return Response.json({ total, alert: level });
      }
      return Response.json({ total });
    }
    if (op === "usageReport") {
      const all = await storage.list({ prefix: "usage:" });
      const days = [...all].map(([storedKey, count]) => ({ day: storedKey.slice("usage:".length), count }))
        .sort((a, b) => (a.day < b.day ? 1 : -1));
      return Response.json({ days: days.slice(0, Number(limit ?? 8)) });
    }
    if (op === "voiceFiles") {
      const wanted = Array.isArray(body.ids) ? body.ids.slice(0, 50) : [];
      const entries = await Promise.all(wanted.map(async (wordId) => [wordId, (await storage.get(voiceKey(wordId)))?.fileId ?? null]));
      return Response.json({ files: Object.fromEntries(entries.filter(([, fileId]) => fileId)) });
    }
    if (op === "media") {
      // One call returns both the saved recording and the cached card photo of a word.
      const [voice, card, disabled] = await Promise.all([
        storage.get(voiceKey(id)), storage.get(cardStorageKey(id, language)), storage.get(cardDisabledKey(id)),
      ]);
      return Response.json({ voice: voice ?? null, card: card ?? null, disabled: disabled === true });
    }
    if (op === "bccount") return Response.json({ count: (await this.recipients(exclude)).length });
    if (op === "bcstatus") {
      const job = await storage.get("broadcast");
      return Response.json(job ? { running: true, total: job.total, sent: job.sent, failed: job.failed } : { running: false });
    }
    if (op === "voiceNext") {
      const voiced = await storage.list({ prefix: VOICE_PREFIX });
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (record.id == null || voiced.has(voiceKey(record.id))) continue;
        return Response.json({
          id: record.id,
          coptic: record.coptic ?? "",
          pronunciation: record.pronunciation ?? "",
          english: record.english ?? "",
          meaning: record.meaning ?? "",
          recorded: voiced.size,
          total: recordIndexById().size,
        });
      }
      return Response.json(null);
    }
    if (op === "voicedrive") {
      // Merge the Drive link into the saved recording, unless it was replaced by a newer one meanwhile.
      const current = await storage.get(voiceKey(id));
      if (current && current.fileId === fileId) await storage.put(voiceKey(id), { ...current, drive });
      return Response.json({ ok: Boolean(current) });
    }
    if (op === "voicepending") {
      const voiced = await storage.list({ prefix: VOICE_PREFIX });
      const pending = [];
      let pendingTotal = 0;
      for (const [key, value] of voiced) {
        if (value?.drive) continue;
        pendingTotal += 1;
        if (pending.length < (limit ?? 0)) {
          pending.push({ id: Number(key.slice(VOICE_PREFIX.length)), fileId: value.fileId, duration: value.duration ?? null });
        }
      }
      return Response.json({ pending, pendingTotal, total: voiced.size, uploaded: voiced.size - pendingTotal });
    }
    if (op === "bcstart") {
      if (await storage.get("broadcast")) return Response.json({ busy: true });
      const queue = await this.recipients(exclude);
      if (!queue.length) return Response.json({ started: false, total: 0 });
      await storage.put("broadcast", {
        queue, total: queue.length, sent: 0, failed: 0, fromChat, messageId, adminChat: fromChat,
      });
      await storage.setAlarm(Date.now() + 100);
      return Response.json({ started: true, total: queue.length });
    }
    const userKey = `user:${userId}`;
    if (op === "kbstep") {
      // Read-modify-write inside the object so rapid taps never overwrite each other.
      const user = (await storage.get(userKey)) ?? {};
      if (!user.kb) return Response.json({ active: false });
      const word = applyKeyboardAction(user.kb.word, input);
      await storage.put(userKey, { ...user, kb: { ...user.kb, word } });
      return Response.json({ active: true, word, previous: user.kb.word, msgId: user.kb.msgId });
    }
    if (op === "kbset") {
      const user = (await storage.get(userKey)) ?? {};
      const { kb: previous, ...rest } = user;
      await storage.put(userKey, kb ? { ...rest, kb } : rest);
      return Response.json({ ok: true, previous: previous ?? null });
    }
    return new Response("Bad request", { status: 400 });
  }
}

async function storeCall(env, payload) {
  const stub = env.USERS.get(env.USERS.idFromName("users"));
  const response = await stub.fetch("https://user-store/", { method: "POST", body: JSON.stringify(payload) });
  return response.json();
}

async function getUser(env, userId) {
  if (!env.USERS) return null;
  try {
    return (await storeCall(env, { op: "get", key: `user:${userId}` })).value ?? null;
  } catch (error) {
    console.error("User lookup failed", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

async function saveUser(env, userId, data) {
  if (!env.USERS) return false;
  try {
    await storeCall(env, { op: "put", key: `user:${userId}`, value: data });
    return true;
  } catch (error) {
    console.error("User save failed", error instanceof Error ? error.message : "unknown error");
    return false;
  }
}

function isValidFullName(value) {
  const name = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (name.length < 5 || name.length > 60) return false;
  if (!/^[\p{L}\p{M}' .-]+$/u.test(name)) return false;
  return name.split(" ").filter(Boolean).length >= 3;
}

async function sendWelcome(env, chatId, name) {
  const caption =
    `مرحبًا بك يا ${escapeHtml(name)} في القاموس الرقمي الناطق للغة القبطية, تفضل الان بكتابة أي كلمة للبحث عنها`;
  try {
    const bytes = Uint8Array.from(atob(welcomeImageBase64), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    form.append("photo", new Blob([bytes], { type: "image/jpeg" }), "welcome.jpg");
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: "POST", body: form });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.ok) return;
    console.error("Telegram sendPhoto failed", result.description ?? response.status);
  } catch (error) {
    console.error("Welcome photo failed", error instanceof Error ? error.message : "unknown error");
  }
  await telegram(env, "sendMessage", { chat_id: chatId, text: caption, parse_mode: "HTML" });
}

// ---- Coptic reply keyboard ----
// Tapping a button on a reply keyboard sends its text as a normal message. While a keyboard session is
// active, those taps are collected into a word (kept in the user's record), the tap message is deleted,
// and one "composition" message is edited in place. "بحث" then searches the collected word.
const COPTIC_KEY_ROWS = [
  ["ⲁ", "ⲃ", "ⲅ", "ⲇ", "ⲉ", "ⲍ"],
  ["ⲏ", "ⲑ", "ⲓ", "ⲕ", "ⲗ", "ⲙ"],
  ["ⲛ", "ⲝ", "ⲟ", "ⲡ", "ⲣ", "ⲥ"],
  ["ⲧ", "ⲩ", "ⲫ", "ⲭ", "ⲯ", "ⲱ"],
  ["ϣ", "ϥ", "ϧ", "ϩ", "ϫ", "ϭ", "ϯ"],
];
const JINKIM_COMBINING = "\u0300";
const KEY_JINKIM = "◌̀"; // dotted circle + combining grave: shows how the jinkim sits on a letter
const COPTIC_KEYS = new Set([...COPTIC_KEY_ROWS.flat(), "`", KEY_JINKIM]);
const KEY_SPACE = "␣ مسافة";
const KEY_BACK = "⌫ حذف";
const KEY_CLEAR = "🗑 مسح";
const KEY_SEARCH = "🔎 بحث";
const KEY_CLOSE = "✖️ إغلاق";
const KEYBOARD_CONTROLS = new Set([KEY_SPACE, KEY_BACK, KEY_CLEAR, KEY_SEARCH, KEY_CLOSE]);
const KEYBOARD_TITLE = "⌨️ الكيبورد القبطي\nاضغط الحروف لتكوين الكلمة ثم اضغط «🔎 بحث»";
const KEYBOARD_MAX_LENGTH = 40;

function keyboardReplyMarkup() {
  const rows = COPTIC_KEY_ROWS.map((row) => row.map((text) => ({ text })));
  rows.push([{ text: KEY_JINKIM }, { text: KEY_SPACE }, { text: KEY_BACK }, { text: KEY_CLEAR }]);
  rows.push([{ text: KEY_SEARCH }, { text: KEY_CLOSE }]);
  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "اضغط الحروف ثم 🔎 بحث",
  };
}

function keyboardText(word) {
  return `${KEYBOARD_TITLE}\n\n▸ ${word}▏`;
}

function isKeyboardInput(text) {
  return COPTIC_KEYS.has(text) || KEYBOARD_CONTROLS.has(text);
}

function applyKeyboardAction(word, input) {
  const current = String(word ?? "");
  if (input === KEY_BACK) return Array.from(current).slice(0, -1).join("");
  if (input === KEY_CLEAR) return "";
  if (input === KEY_SPACE) return current && !current.endsWith(" ") ? `${current} ` : current;
  if (input === KEY_JINKIM || input === "`") {
    // The jinkim marks the letter before it, and only once.
    return /[^\s\u0300]$/u.test(current) && Array.from(current).length < KEYBOARD_MAX_LENGTH
      ? current + JINKIM_COMBINING
      : current;
  }
  if (COPTIC_KEYS.has(input)) return Array.from(current).length < KEYBOARD_MAX_LENGTH ? current + input : current;
  return current;
}

async function startKeyboard(env, chatId, userId) {
  const sent = await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: keyboardText(""),
    reply_markup: keyboardReplyMarkup(),
  });
  await storeCall(env, { op: "kbset", userId, kb: { word: "", msgId: sent?.result?.message_id ?? null } });
}

async function handleKeyboardInput(env, message, userId) {
  const chatId = message.chat.id;
  const text = String(message.text ?? "").trim();
  const dropTap = () => telegram(env, "deleteMessage", { chat_id: chatId, message_id: message.message_id });

  if (text === KEY_CLOSE) {
    const state = await storeCall(env, { op: "kbset", userId, kb: null });
    await dropTap();
    if (state?.previous?.msgId) {
      await telegram(env, "deleteMessage", { chat_id: chatId, message_id: state.previous.msgId });
    }
    await telegram(env, "sendMessage", {
      chat_id: chatId,
      text: "تم إخفاء الكيبورد القبطي. أرسل /keyboard لإظهاره من جديد.",
      reply_markup: { remove_keyboard: true },
    });
    return;
  }

  const step = await storeCall(env, { op: "kbstep", userId, input: text });
  if (!step.active) {
    // A leftover keyboard button with no active session: start a fresh session.
    await dropTap();
    await startKeyboard(env, chatId, userId);
    return;
  }
  await dropTap();

  if (text === KEY_SEARCH) {
    const query = step.word.trim();
    if (!query) {
      await telegram(env, "sendMessage", { chat_id: chatId, text: "اكتب كلمة أولًا باستخدام الحروف ثم اضغط «🔎 بحث»." });
      return;
    }
    await showTyping(env, chatId);
    await sendSearch(env, chatId, query, 0);
    // Continue below the results with a fresh, empty composition message.
    const sent = await telegram(env, "sendMessage", { chat_id: chatId, text: keyboardText("") });
    await storeCall(env, { op: "kbset", userId, kb: { word: "", msgId: sent?.result?.message_id ?? null } });
    return;
  }

  if (step.word === step.previous) return;
  const edit = await telegram(env, "editMessageText", {
    chat_id: chatId,
    message_id: step.msgId,
    text: keyboardText(step.word),
  });
  if (!edit?.ok && !String(edit?.description ?? "").includes("not modified")) {
    // The composition message was deleted by the user: recreate it.
    const sent = await telegram(env, "sendMessage", { chat_id: chatId, text: keyboardText(step.word) });
    await storeCall(env, { op: "kbset", userId, kb: { word: step.word, msgId: sent?.result?.message_id ?? null } });
  }
}

function adminIds(env) {
  return String(env.ADMIN_CHAT_ID ?? DEFAULT_ADMIN_IDS).split(",").map((item) => item.trim()).filter(Boolean);
}

function isAdmin(env, userId) {
  return adminIds(env).includes(String(userId));
}

// Who recorded: full (three-part) name when registered, else the Telegram name; plus Telegram id and username.
function recorderInfo(from, user, userId) {
  return {
    name: String(user?.name || displayName(from)).trim(),
    id: String(userId ?? from?.id ?? ""),
    username: from?.username ?? "",
  };
}

function displayName(person) {
  return [person?.first_name, person?.last_name].filter(Boolean).join(" ").trim() || "بدون اسم";
}

async function notifyAdmins(env, text) {
  for (const id of adminIds(env)) {
    await telegram(env, "sendMessage", { chat_id: id, text, parse_mode: "HTML" });
  }
}

function voicePrompt(item) {
  if (!item) return "✅ اكتمل تسجيل النطق لكل كلمات القاموس.";
  const lines = [
    "🎙️ تسجيل نطق كلمة جديدة",
    `الكلمة: <b>${escapeHtml(item.coptic || "—")}</b>`,
  ];
  if (item.total) lines.push(`المسجّل: ${item.recorded ?? 0} من ${item.total}`);
  if (item.pronunciation) lines.push(`النطق المكتوب: ${escapeHtml(item.pronunciation)}`);
  if (item.english) lines.push(`الإنجليزية: ${escapeHtml(item.english)}`);
  if (item.meaning) lines.push(`المعنى: ${escapeHtml(String(item.meaning).split(/\s*[،,]\s*/u)[0])}`);
  lines.push("أرسل الآن Voice من تيليجرام لهذه الكلمة. لإيقاف الجلسة أرسل /record_stop.");
  return lines.join("\n");
}

function renderVoiceWordSuggestions(query) {
  const clean = String(query ?? "").replace(/[\r\n]+/gu, " ").trim().slice(0, 160);
  const normalized = normalize(clean);
  const candidates = [];
  if (ARABIC_LETTER.test(normalized)) {
    for (const index of findMatches(clean)) candidates.push(index);
  } else {
    const kind = scriptKind(normalized);
    for (const item of prefixWords(kind, normalized, 20)) candidates.push(...item.rows);
  }
  const seen = new Set();
  const keyboard = candidates.filter((index) => {
    const id = records[index]?.id;
    if (id == null || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 20).map((index) => [{
    text: String(records[index]?.coptic ?? "—").replaceAll("`", "").trim().slice(0, 48),
    callback_data: `vr|${records[index].id}`,
  }]);
  return {
    text: keyboard.length ? "اختر الكلمة التي تريد تسجيلها:" : "لم أجد كلمة بهذا البحث. جرّب بحثًا آخر:",
    reply_markup: keyboard.length ? { inline_keyboard: keyboard } : undefined,
  };
}

async function beginVoiceChoice(env, chatId, userId, user) {
  await saveUser(env, userId, { ...user, voicePick: true, voiceRec: undefined });
  await telegram(env, "sendMessage", { chat_id: chatId, text: "🔎 أرسل الكلمة التي تريد تسجيلها، وسأعرض لك اقتراحات القاموس." });
}

async function selectVoiceWord(env, chatId, userId, user, id) {
  const record = records[recordIndexById().get(Number(id))];
  if (!record) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "لم أجد هذه الكلمة، أعد البحث من فضلك." });
    return;
  }
  await saveUser(env, userId, { ...user, voicePick: false, voiceRec: { id: record.id, mode: "chosen" } });
  await telegram(env, "sendMessage", { chat_id: chatId, text: voicePrompt({ ...record, recorded: 0, total: 1 }), parse_mode: "HTML" });
}

async function nextVoicePrompt(env, chatId, userId, user) {
  const item = await storeCall(env, { op: "voiceNext" });
  if (!item) {
    await saveUser(env, userId, { ...user, voiceRec: undefined });
    await telegram(env, "sendMessage", { chat_id: chatId, text: voicePrompt(null), parse_mode: "HTML" });
    return;
  }
  await saveUser(env, userId, { ...user, voicePick: false, voiceRec: { id: item.id, mode: "sequential" } });
  await telegram(env, "sendMessage", { chat_id: chatId, text: voicePrompt(item), parse_mode: "HTML" });
}

async function beginVoiceRecording(env, chatId, userId, user) {
  await nextVoicePrompt(env, chatId, userId, user ?? {});
}

async function captureVoiceRecording(env, message, userId, user, ctx) {
  if (!message.voice) {
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "أرسل تسجيلًا كـ Voice من تيليجرام، وليس ملف Audio." });
    return;
  }
  // Older sessions stored a row number; map it to the word's permanent id once.
  const id = user.voiceRec?.id ?? records[Number(user.voiceRec?.index)]?.id;
  const record = records[recordIndexById().get(id)];
  if (id == null || !record) {
    await beginVoiceRecording(env, message.chat.id, userId, user);
    return;
  }
  await storeCall(env, {
    op: "put",
    key: voiceKey(id),
    value: { fileId: message.voice.file_id, duration: message.voice.duration ?? null, savedAt: new Date().toISOString() },
  });
  // A fresh recording explicitly reactivates the word's card.
  await storeCall(env, { op: "delete", key: cardDisabledKey(id) });
  const archive = archiveAndReport(env, message.chat.id, {
    id,
    record,
    fileId: message.voice.file_id,
    duration: message.voice.duration,
    by: recorderInfo(message.from, user, userId),
  });
  await telegram(env, "sendMessage", {
    chat_id: message.chat.id,
    text: `✅ تم حفظ تسجيل <b>${escapeHtml(record.coptic ?? "الكلمة")}</b>.`,
    parse_mode: "HTML",
  });
  if (user.voiceRec?.mode === "chosen") {
    await saveUser(env, userId, { ...user, voiceRec: undefined, voicePick: true });
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "🔎 أرسل كلمة أخرى للبحث عنها وتسجيلها، أو أرسل /record_stop." });
  } else {
    await nextVoicePrompt(env, message.chat.id, userId, user);
  }
  await inBackground(ctx, archive);
}

async function stopVoiceRecording(env, chatId, userId, user) {
  await saveUser(env, userId, { ...user, voiceRec: undefined, voicePick: undefined });
  await telegram(env, "sendMessage", { chat_id: chatId, text: "⏸️ تم إيقاف جلسة التسجيل. أرسل /record لاستكمالها من أول كلمة غير مسجلة." });
}

// ---- User directory in the spreadsheet ("User" tab, written by the Apps Script) ----
const USERS_SYNC_CURSOR = "users-sync-cursor";
const USERS_SYNC_BATCH = 30;

function userSheetRow(id, record, from = {}) {
  const tgName = record?.tgName || displayNameOrEmpty(from);
  return {
    id: String(id),
    name: record?.name || tgName || "",
    username: record?.username || from?.username || "",
    joined_at: record?.firstSeen ?? "",
    registered_at: record?.registeredAt ?? "",
  };
}

function displayNameOrEmpty(person) {
  return [person?.first_name, person?.last_name].filter(Boolean).join(" ").trim();
}

async function pushUsers(env, rows) {
  const config = await driveConfig(env);
  if (!config || !rows.length) return { ok: false, skipped: true };
  try {
    await callAppsScript(config, { action: "users", users: rows });
    return { ok: true };
  } catch (error) {
    console.error("User sheet sync failed", error instanceof Error ? error.message : "unknown error");
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

async function syncUsersBatch(env, chatId) {
  const config = await driveConfig(env);
  if (!config) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "لم يتم ربط جوجل درايف بعد. استخدم /setdrive أولًا." });
    return;
  }
  const cursor = (await storeCall(env, { op: "get", key: USERS_SYNC_CURSOR })).value ?? null;
  const page = await storeCall(env, { op: "userpage", cursor, limit: USERS_SYNC_BATCH });
  const rows = [];
  for (const item of page.users) {
    let record = item.record ?? {};
    if (!record.tgName && !record.username) {
      // Older users: read their current Telegram profile once and remember it.
      const chat = await telegram(env, "getChat", { chat_id: item.id }).catch(() => null);
      if (chat?.ok && chat.result) {
        record = { ...record, tgName: displayNameOrEmpty(chat.result), username: chat.result.username ?? "" };
        await saveUser(env, item.id, record);
      }
    }
    rows.push(userSheetRow(item.id, record));
  }
  const outcome = await pushUsers(env, rows);
  if (!outcome.ok) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: `❌ تعذّرت مزامنة المستخدمين: ${outcome.error ?? "الربط غير مفعّل"}` });
    return;
  }
  if (page.next) await storeCall(env, { op: "put", key: USERS_SYNC_CURSOR, value: page.next });
  else await storeCall(env, { op: "put", key: USERS_SYNC_CURSOR, value: null });
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: page.next
      ? `👥 تمت مزامنة ${rows.length} مستخدم إلى ورقة User.\nأرسل /syncusers لمتابعة الباقي.`
      : `👥 تمت مزامنة ${rows.length} مستخدم. 🎉 كل المستخدمين الآن في ورقة User.`,
  });
}

// Fully registered users are remembered briefly in this isolate (registration never goes backwards),
// so their searches do not wait for a user-store round trip.
const registeredCache = new Map();
const REGISTERED_CACHE_MS = 60000;

async function registerOnFirstContact(env, message, userId, ctx) {
  if (isAdmin(env, userId) || (message.chat.type ?? "private") !== "private" || !env.USERS) return undefined;
  const from = message.from ?? {};
  const cached = registeredCache.get(userId);
  if (cached && Date.now() - cached.at < REGISTERED_CACHE_MS) return cached.user;
  let result;
  try {
    result = await storeCall(env, { op: "register", userId, profile: { username: from.username ?? "", tgName: displayNameOrEmpty(from) } });
  } catch (error) {
    console.error("Register failed", error instanceof Error ? error.message : "unknown error");
    return undefined;
  }
  if (result?.created || result?.changed) {
    await inBackground(ctx, pushUsers(env, [userSheetRow(userId, result.user, from)]));
  }
  if (!result?.created) {
    if (result?.user?.name && !result.user.awaitingName) {
      if (registeredCache.size > 5000) registeredCache.clear();
      registeredCache.set(userId, { at: Date.now(), user: result.user });
    }
    return result?.user;
  }
  await notifyAdmins(env, [
    "🆕 <b>انضم مستخدم جديد إلى البوت</b>",
    `👤 الاسم: ${escapeHtml(displayName(from))}`,
    `🔗 المعرّف: ${from.username ? `@${escapeHtml(from.username)}` : "—"}`,
    `🆔 الرقم: <code>${escapeHtml(userId)}</code>`,
    `👥 إجمالي المستخدمين: ${Number(result.total ?? 0).toLocaleString("en-US")}`,
  ].join("\n"));
  return result.user;
}

const BROADCAST_CONFIRM_MARKUP = {
  inline_keyboard: [[
    { text: "✅ تأكيد الإرسال", callback_data: "bc|go" },
    { text: "❌ إلغاء", callback_data: "bc|no" },
  ]],
};

async function beginBroadcast(env, chatId, userId, user) {
  const status = await storeCall(env, { op: "bcstatus" });
  if (status.running) {
    await telegram(env, "sendMessage", {
      chat_id: chatId,
      text: `⏳ يوجد إرسال جماعي جارٍ الآن: وصل ${status.sent} من ${status.total}. انتظر اكتماله أولًا.`,
    });
    return;
  }
  await saveUser(env, userId, { ...user, bc: "await" });
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: "📢 أرسل الآن الرسالة التي تريد إرسالها لجميع المستخدمين (نص أو صورة أو ملف…).\nلإلغاء العملية أرسل /cancel",
  });
}

async function captureBroadcast(env, message, userId, user) {
  const { count } = await storeCall(env, { op: "bccount", exclude: adminIds(env) });
  if (!count) {
    await saveUser(env, userId, { ...user, bc: undefined });
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "لا يوجد مستخدمون مسجّلون لإرسال الرسالة إليهم بعد." });
    return;
  }
  await saveUser(env, userId, { ...user, bc: { messageId: message.message_id } });
  await telegram(env, "sendMessage", {
    chat_id: message.chat.id,
    reply_to_message_id: message.message_id,
    text: `سيتم إرسال الرسالة أعلاه إلى ${count.toLocaleString("en-US")} مستخدم.\nهل تريد التأكيد؟`,
    reply_markup: BROADCAST_CONFIRM_MARKUP,
  });
}

async function handleBroadcastCallback(env, callback) {
  const answer = (extra = {}) => telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, ...extra });
  const userId = callback.from?.id;
  const chatId = callback.message?.chat?.id;
  if (!isAdmin(env, userId) || !chatId) return answer();
  const user = (await getUser(env, userId)) ?? {};
  const edit = (text) => telegram(env, "editMessageText", {
    chat_id: chatId,
    message_id: callback.message.message_id,
    text,
  });
  if (callback.data === "bc|no" || !user.bc?.messageId) {
    await saveUser(env, userId, { ...user, bc: undefined });
    await answer();
    await edit("تم إلغاء الإرسال الجماعي.");
    return;
  }
  const started = await storeCall(env, {
    op: "bcstart",
    exclude: adminIds(env),
    fromChat: chatId,
    messageId: user.bc.messageId,
  });
  await saveUser(env, userId, { ...user, bc: undefined });
  await answer();
  if (started.busy) await edit("⏳ يوجد إرسال جماعي جارٍ بالفعل.");
  else if (!started.started) await edit("لا يوجد مستخدمون لإرسال الرسالة إليهم.");
  else await edit(`🚀 بدأ الإرسال إلى ${started.total.toLocaleString("en-US")} مستخدم. سأرسل لك تقريرًا عند الانتهاء.`);
}

// ---- Daily request counter (compare with the free plan's 100,000 requests/day) ----
const DAILY_REQUEST_LIMIT = 100000;
const USAGE_ALERT_LEVELS = [50000, 80000, 95000, 100000];
const USAGE_FLUSH_EVERY = 20;
const USAGE_FLUSH_MS = 60000;
const usageState = { day: "", pending: 0, flushedAt: 0 };

function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function flushUsage(env, day, count) {
  try {
    const result = await storeCall(env, { op: "usage", profile: { day }, limit: count });
    if (result?.alert) {
      const percent = Math.round((result.total / DAILY_REQUEST_LIMIT) * 100);
      await notifyAdmins(env, `⚠️ <b>تنبيه الاستخدام</b>\nوصلت طلبات اليوم إلى ${Number(result.total).toLocaleString("en-US")} من ${DAILY_REQUEST_LIMIT.toLocaleString("en-US")} (${percent}%).\nعند الوصول للحد يتوقف البوت حتى تصفير العدّاد. أرسل /usage للتفاصيل.`);
    }
  } catch (error) {
    console.error("Usage count failed", error instanceof Error ? error.message : "unknown error");
  }
}

// Called for every request the Worker receives; sends one batched write per ~20 requests.
function countRequest(env, ctx) {
  if (!env.USERS) return;
  const day = utcDay();
  const now = Date.now();
  if (usageState.day && usageState.day !== day && usageState.pending) {
    const previous = { day: usageState.day, count: usageState.pending };
    usageState.pending = 0;
    inBackground(ctx, flushUsage(env, previous.day, previous.count));
  }
  usageState.day = day;
  usageState.pending += 1;
  if (usageState.pending >= USAGE_FLUSH_EVERY || now - usageState.flushedAt >= USAGE_FLUSH_MS) {
    const count = usageState.pending;
    usageState.pending = 0;
    usageState.flushedAt = now;
    inBackground(ctx, flushUsage(env, day, count));
  }
}

async function sendUsageReport(env, chatId) {
  if (!env.USERS) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "العدّاد يحتاج تخزين المستخدمين (Durable Object) وهو غير مفعّل." });
    return;
  }
  const report = await storeCall(env, { op: "usageReport", limit: 8 });
  const today = utcDay();
  const rows = report.days.map((item) => ({ ...item }));
  const todayRow = rows.find((item) => item.day === today);
  const pending = usageState.day === today ? usageState.pending : 0;
  if (todayRow) todayRow.count += pending;
  else rows.unshift({ day: today, count: pending });
  const used = rows.find((item) => item.day === today).count;
  const remaining = Math.max(0, DAILY_REQUEST_LIMIT - used);
  const nextReset = new Date(`${today}T00:00:00Z`);
  nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  const resetAt = new Intl.DateTimeFormat("ar-EG", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" }).format(nextReset);
  const fmt = (value) => Number(value).toLocaleString("en-US");
  const lines = [
    `📊 <b>طلبات البوت اليوم</b> (UTC ${today})`,
    `المستخدَم: <b>${fmt(used)}</b> من ${fmt(DAILY_REQUEST_LIMIT)} (${((used / DAILY_REQUEST_LIMIT) * 100).toFixed(1)}%)`,
    `المتبقي: <b>${fmt(remaining)}</b>`,
    `يتصفّر العدّاد الساعة ${resetAt} بتوقيت القاهرة`,
    "",
    "<b>آخر الأيام:</b>",
    ...rows.slice(0, 7).map((item) => `${item.day}: ${fmt(item.count)}`),
    "",
    "العدّاد تقديري وقد ينقص بضع عشرات من الطلبات. سأنبّهك تلقائيًا عند 50% و80% و95%.",
  ];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n"), parse_mode: "HTML" });
}

// ---- Inline mode: type @bot_username <word> in any chat ----
const INLINE_LIMIT = 20;
const INLINE_CACHE_SECONDS = 300;

function inlineArticle(index, normalizedQuery, fileId, audioUrl = "") {
  const record = records[index];
  const part = matchedPartIndex(record, normalizedQuery);
  const parts = splitMeaning(record.meaning);
  const meaning = part >= 0 && parts[part] ? parts[part] : parts.join("، ");
  const word = String(record.coptic ?? "").trim() || String(record.english ?? "").trim() || "—";
  const id = part >= 0 ? `${index}.${part}` : String(index);
  const text = formatRecord(record, part, normalizedQuery).slice(0, MAX_MESSAGE_LENGTH);
  if (fileId && text.length <= 1000) {
    // A recorded word is sent as the voice itself without a caption.
    return {
      type: "voice",
      id,
      voice_file_id: fileId,
      title: `🔊 ${word}${meaning ? ` — ${meaning}` : ""}`.slice(0, 100),
      parse_mode: "HTML",
    };
  }
  if (audioUrl && spokenText(record) && text.length <= 1000) {
    // No recording: Telegram fetches the generated speech (Google) from this Worker and sends it with the entry.
    return {
      type: "audio",
      id,
      audio_url: `${audioUrl}/tts/${index}.mp3`,
      title: `🔊 ${word}${meaning ? ` — ${meaning}` : ""}`.slice(0, 100),
      parse_mode: "HTML",
    };
  }
  const description = [meaning, String(record.kind ?? "").trim()].filter(Boolean).join(" — ");
  return {
    type: "article",
    id,
    title: word,
    description: description.slice(0, 120),
    input_message_content: { message_text: text, parse_mode: "HTML" },
  };
}

async function recordedVoices(env, indexes) {
  if (!env.USERS) return {};
  const ids = indexes.map((index) => records[index].id).filter((id) => id != null);
  if (!ids.length) return {};
  try {
    return (await storeCall(env, { op: "voiceFiles", ids })).files ?? {};
  } catch (error) {
    console.error("Inline voice lookup failed", error instanceof Error ? error.message : "unknown error");
    return {};
  }
}

async function answerInline(env, inlineQuery) {
  const raw = String(inlineQuery.query ?? "").replace(/[\r\n]+/gu, " ").trim().slice(0, 160);
  const normalizedQuery = normalize(raw);
  const answer = (results, cacheTime) => telegram(env, "answerInlineQuery", {
    inline_query_id: inlineQuery.id,
    results,
    cache_time: cacheTime,
    is_personal: false,
  });
  // Empty query: no list at all, so the bot's placeholder text (set in BotFather) is what the user sees.
  if (!normalizedQuery) {
    await answer([], 3600);
    return;
  }
  const short = Array.from(normalizedQuery).length <= SHORT_QUERY_MAX;
  let indexes = short ? findPrefixMatches(normalizedQuery) : findMatches(raw);
  if (!indexes.length && short) indexes = findMatches(raw);
  indexes = indexes.slice(0, INLINE_LIMIT);
  const voices = await recordedVoices(env, indexes);
  const audioBase = lastOrigin && (await speechAvailable()) ? lastOrigin : "";
  const results = indexes.map((index) => inlineArticle(index, normalizedQuery, voices[records[index].id], audioBase));
  const response = await answer(results, INLINE_CACHE_SECONDS);
  if (response && response.ok === false && results.some((item) => item.type === "voice" || item.type === "audio")) {
    // A stored recording was rejected by Telegram: answer again with text only.
    await answer(indexes.map((index) => inlineArticle(index, normalizedQuery, null)), INLINE_CACHE_SECONDS);
  }
}

let lastOrigin = "";
const speechHealth = { ok: false, checkedAt: 0 };

// Is Google's speech reachable from this Worker? Cached so inline answers do not probe every time.
async function speechAvailable() {
  const age = Date.now() - speechHealth.checkedAt;
  if (speechHealth.checkedAt && age < (speechHealth.ok ? 30 * 60000 : 5 * 60000)) return speechHealth.ok;
  speechHealth.ok = Boolean(await fetchSpeech("hello"));
  speechHealth.checkedAt = Date.now();
  return speechHealth.ok;
}

async function serveSpeech(request, ctx, index) {
  const spoken = spokenText(records[index]);
  if (!spoken) return new Response("Not found", { status: 404 });
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
  const cached = cache ? await cache.match(cacheKey) : undefined;
  if (cached) return cached;
  const audio = await fetchSpeech(spoken);
  if (!audio) return new Response("Speech unavailable", { status: 502 });
  const response = new Response(request.method === "HEAD" ? null : audio, {
    headers: { "content-type": "audio/mpeg", "content-length": String(audio.byteLength), "cache-control": "public, max-age=2592000" },
  });
  if (cache && request.method === "GET") await inBackground(ctx, cache.put(cacheKey, response.clone()));
  return response;
}

async function sendBotInfo(env, chatId) {
  const [me, hook, speech] = await Promise.all([
    telegram(env, "getMe", {}),
    telegram(env, "getWebhookInfo", {}),
    fetchSpeech("hello").then(Boolean),
  ]);
  const info = hook?.result ?? {};
  const allowed = info.allowed_updates ?? [];
  const lines = [
    `🤖 <b>@${escapeHtml(me?.result?.username ?? "?")}</b>`,
    `البحث من المحادثات (inline): ${me?.result?.supports_inline_queries ? "مفعّل ✅" : "غير مفعّل ❌ — من @BotFather أرسل /setinline"}`,
    `الـ webhook يستقبل inline: ${allowed.includes("inline_query") ? "نعم ✅" : "لا ❌"}`,
    `طلبات معلّقة: ${info.pending_update_count ?? 0}`,
    `آخر خطأ في الـ webhook: ${info.last_error_message ? escapeHtml(info.last_error_message) : "لا يوجد"}`,
    `صوت جوجل (TTS) من السيرفر: ${speech ? "يعمل ✅" : "لا يعمل ❌ (جوجل ترفض الطلب)"}`,
    "",
    "نص البلاس هولدر (التلميح داخل خانة الكتابة) يُضبط من @BotFather ← /setinline ولا يمكن قراءته أو تغييره من الكود.",
  ];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n"), parse_mode: "HTML" });
}

async function handleUpdate(update, env, ctx) {
  if (update.inline_query) {
    await answerInline(env, update.inline_query);
    return;
  }
  if (update.callback_query) {
    const callback = update.callback_query;
    if (String(callback.data ?? "").startsWith("bc|")) {
      await handleBroadcastCallback(env, callback);
      return;
    }
    // Acknowledge the tap in the background so the answer is not delayed by a round trip.
    await inBackground(ctx, telegram(env, "answerCallbackQuery", { callback_query_id: callback.id }));
    const chatForPick = callback.message?.chat?.id;
    const voicePick = /^vr\|(\d+)$/u.exec(callback.data ?? "");
    if (voicePick) {
      if (chatForPick && isAdmin(env, callback.from?.id)) {
        const admin = await getUser(env, callback.from.id);
        await selectVoiceWord(env, chatForPick, callback.from.id, admin ?? {}, Number(voicePick[1]));
      }
      return;
    }
    const chainPick = /^x\|(\d{1,3})\|(.+)$/su.exec(callback.data ?? "");
    if (chainPick) {
      const chainQuery = chainPick[2];
      const normalizedChainQuery = normalize(chainQuery);
      const chain = exactChain(scriptKind(normalizedChainQuery), normalizedChainQuery);
      const step = Number(chainPick[1]);
      if (chatForPick && chain[step]) {
        const sendVoice = ARABIC_LETTER.test(normalizedChainQuery);
        await inBackground(ctx, sendOption(env, chatForPick, chain, chain[0].index, step, undefined, chainCallback(chainQuery), chainQuery, sendVoice));
      }
      return;
    }
    const wordPick = /^w\|(.+)$/su.exec(callback.data ?? "");
    if (wordPick) {
      if (chatForPick) {
        let key = wordPick[1];
        const kind = scriptKind(key);
        let chain = exactChain(kind, key);
        if (!chain.length) {
          // The button text was cut to fit Telegram's limit: take the first word that starts with it.
          const [first] = prefixWords(kind, key, 1);
          if (first) {
            key = first.key;
            chain = exactChain(kind, key);
          }
        }
        if (chain.length) {
          await inBackground(ctx, sendOption(env, chatForPick, chain, chain[0].index, 0, undefined, chainCallback(key), key));
        }
      }
      return;
    }
    const nextMeaning = /^n\|(\d{1,6})\|(\d{1,3})\|(\d{1,3})$/u.exec(callback.data ?? "");
    if (nextMeaning) {
      if (callback.message?.chat?.id) {
        await inBackground(ctx, sendMeaningStep(env, callback.message.chat.id, Number(nextMeaning[1]), Number(nextMeaning[2]), Number(nextMeaning[3])));
      }
      return;
    }
    // Buttons already sitting in old chats (m|...) still work: show that meaning, then follow the fixed list.
    const meaningPick = /^m\|(\d{1,6})\|(\d{1,6})\|(\d{1,3})$/u.exec(callback.data ?? "");
    if (meaningPick) {
      if (callback.message?.chat?.id) {
        await inBackground(ctx, sendRecord(env, callback.message.chat.id, Number(meaningPick[2]), Number(meaningPick[3]), callback.message.date));
      }
      return;
    }
    const pick = /^s\|(\d{1,6})(?:\|(\d{1,3}))?(?:\|(.+))?$/su.exec(callback.data ?? "");
    if (pick) {
      if (callback.message?.chat?.id) {
        await inBackground(ctx, sendRecord(env, callback.message.chat.id, Number(pick[1]), pick[2] === undefined ? -1 : Number(pick[2]), pick[3] ?? ""));
      }
      return;
    }
    const match = /^p\|(\d{1,6})\|(.+)$/su.exec(callback.data ?? "");
    if (!match || !callback.message?.chat?.id || !callback.message?.message_id) return;
    await inBackground(ctx, sendSearch(env, callback.message.chat.id, match[2], Number(match[1]), callback.message.message_id));
    return;
  }

  const message = update.message;
  if (!message?.chat?.id) return;
  const text = String(message.text ?? "").trim();
  const userId = message.from?.id ?? message.chat.id;
  const isPrivate = (message.chat.type ?? "private") === "private";
  const known = await registerOnFirstContact(env, message, userId, ctx);
  if (isAdmin(env, userId) && isPrivate) {
    const admin = await getUser(env, userId);
    if (text === "/cancel" && admin?.bc) {
      await saveUser(env, userId, { ...admin, bc: undefined });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "تم إلغاء الإرسال الجماعي." });
      return;
    }
    if (text === "/broadcast") {
      await beginBroadcast(env, message.chat.id, userId, admin ?? {});
      return;
    }
    if (text === "/drive") {
      await telegram(env, "sendMessage", {
        chat_id: message.chat.id,
        text: await driveStatusText(env),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      return;
    }
    if (text === "/syncdrive") {
      await inBackground(ctx, syncPendingVoices(env, message.chat.id, recorderInfo(message.from, admin, userId)));
      return;
    }
    if (text === "/botinfo") {
      await sendBotInfo(env, message.chat.id);
      return;
    }
    if (text === "/usage") {
      await sendUsageReport(env, message.chat.id);
      return;
    }
    if (text === "/syncusers") {
      await inBackground(ctx, syncUsersBatch(env, message.chat.id));
      return;
    }
    if (text === "/card_hide" || text.startsWith("/card_hide ")) {
      await setCardVisibility(env, message.chat.id, text.slice("/card_hide".length), false);
      return;
    }
    if (text === "/card_show" || text.startsWith("/card_show ")) {
      await setCardVisibility(env, message.chat.id, text.slice("/card_show".length), true);
      return;
    }
    if (text === "/setdrive" || text.startsWith("/setdrive ")) {
      await setDriveConfig(env, message, text.slice("/setdrive".length).trim());
      return;
    }
    if (text === "/record" || text === "/record_voice") {
      await beginVoiceRecording(env, message.chat.id, userId, admin ?? {});
      return;
    }
    if (text === "/record_choose" || text === "/record_select") {
      await beginVoiceChoice(env, message.chat.id, userId, admin ?? {});
      return;
    }
    if (text === "/record_stop") {
      await stopVoiceRecording(env, message.chat.id, userId, admin ?? {});
      return;
    }
    if (admin?.voiceRec && (message.voice || message.audio)) {
      await captureVoiceRecording(env, message, userId, admin, ctx);
      return;
    }
    if (admin?.voicePick && text && !text.startsWith("/")) {
      const view = renderVoiceWordSuggestions(text);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: view.text, ...(view.reply_markup ? { reply_markup: view.reply_markup } : {}) });
      return;
    }
    if (admin?.bc === "await" && !text.startsWith("/")) {
      await captureBroadcast(env, message, userId, admin);
      return;
    }
  }
  if (text === "/start" || text.startsWith("/start ")) {
    if (!env.USERS) {
      // No user store bound: registration is unavailable, so fall back to the plain help text.
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: HELP_TEXT });
      return;
    }
    const user = known ?? await getUser(env, userId);
    if (user?.name) {
      await sendWelcome(env, message.chat.id, user.name);
      return;
    }
    await saveUser(env, userId, { ...user, awaitingName: true });
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: FIRST_TIME_TEXT });
    return;
  }
  if (text === "/keyboard" || text === "/k") {
    await startKeyboard(env, message.chat.id, userId);
    return;
  }
  if (text === "/help") {
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: HELP_TEXT });
    return;
  }
  if (text === "/stats") {
    await telegram(env, "sendMessage", {
      chat_id: message.chat.id,
      text: `عدد سجلات القاموس المفهرسة: ${records.length.toLocaleString("en-US")}`,
    });
    return;
  }
  if (message.voice || message.audio) {
    await telegram(env, "sendMessage", {
      chat_id: message.chat.id,
      text: "البحث الصوتي غير متاح في الاستضافة المجانية الحالية. اكتب الكلمة نصيًا للبحث.",
    });
    return;
  }
  if (text.startsWith("/")) {
    await telegram(env, "sendMessage", {
      chat_id: message.chat.id,
      text: "اكتب الكلمة مباشرة للبحث، أو استخدم /keyboard للكيبورد القبطي و/start للمساعدة و/stats لعدد السجلات.",
    });
    return;
  }
  if (text) {
    const user = known ?? await getUser(env, userId);
    if (user?.awaitingName) {
      if (!isValidFullName(text)) {
        await telegram(env, "sendMessage", { chat_id: message.chat.id, text: NAME_RETRY_TEXT });
        return;
      }
      const name = text.replace(/\s+/gu, " ").trim();
      const completed = { ...user, name, awaitingName: undefined, registeredAt: new Date().toISOString() };
      await saveUser(env, userId, completed);
      await inBackground(ctx, pushUsers(env, [userSheetRow(userId, completed, message.from)]));
      await sendWelcome(env, message.chat.id, name);
      if (!isAdmin(env, userId)) {
        await notifyAdmins(env, `✅ أكمل التسجيل: <b>${escapeHtml(name)}</b> (🆔 <code>${escapeHtml(userId)}</code>)`);
      }
      return;
    }
    if (user?.kb && isKeyboardInput(text)) {
      await handleKeyboardInput(env, message, userId);
      return;
    }
    if (KEYBOARD_CONTROLS.has(text)) {
      // Leftover keyboard button after a restart/close: reopen a session instead of searching the label.
      await handleKeyboardInput(env, message, userId);
      return;
    }
    await inBackground(ctx, showTyping(env, message.chat.id));
    await sendSearch(env, message.chat.id, text, 0);
  }
}

export default {
  async fetch(request, env, ctx) {
    countRequest(env, ctx);
    const url = new URL(request.url);
    lastOrigin = url.origin;
    const speech = /^\/tts\/(\d{1,6})\.mp3$/u.exec(url.pathname);
    if (speech && (request.method === "GET" || request.method === "HEAD") && records[Number(speech[1])]) {
      return serveSpeech(request, ctx, Number(speech[1]));
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response("Coptic dictionary bot is ready.", { status: 200 });
    }

    if (request.method === "POST" && url.pathname === "/__setup") {
      if (!env.TELEGRAM_BOT_TOKEN || !env.WEBHOOK_SECRET ||
          request.headers.get("x-setup-secret") !== env.WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      const result = await telegram(env, "setWebhook", {
        url: `${url.origin}/webhook`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query", "inline_query"],
      });
      return Response.json(result, { status: result.ok ? 200 : 502 });
    }

    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }
    if (!env.TELEGRAM_BOT_TOKEN || !env.WEBHOOK_SECRET ||
        request.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const update = await request.json();
      await handleUpdate(update, env, ctx);
      return new Response("ok", { status: 200 });
    } catch (error) {
      console.error("Webhook update failed", error instanceof Error ? error.message : "unknown error");
      // Return 200 so Telegram does not retry a malformed update indefinitely.
      return new Response("ok", { status: 200 });
    }
  },
};
