#!/usr/bin/env node
// Renders word cards into cards/<id>.png and keeps data/cards.json ({ id: hash }) in step with the sheet.
// Runs in GitHub Actions. By default only words that have a recording (a link in the sheet's "Ban" tab)
// get a card, because the card's QR code opens that recording. CARD_SCOPE=all renders every word.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderCard } from "./card.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHEET_ID = process.env.SHEET_ID || "1kXVA3CNgETqym5Vz3lBUu_2gZ01QNdx7ROtGVnIJp0c";
const BAN_TAB = process.env.BAN_TAB || "Ban";
const BOT_USERNAME = process.env.BOT_USERNAME || "Uploade33_bot";
const SCOPE = process.env.CARD_SCOPE || "recorded";
const MAX_PER_RUN = Number(process.env.MAX_CARDS || 500);
const CARD_VERSION = 4; // professional multilingual card with the Ⲭⲏⲙⲓ brand mark
const DICTIONARY = process.env.DICTIONARY_JSON || path.join(ROOT, "data", "dictionary.json");
const MANIFEST = process.env.CARDS_MANIFEST || path.join(ROOT, "data", "cards.json");
const CARDS_DIR = process.env.CARDS_DIR || path.join(ROOT, "cards");

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// id -> recording link, from the "Ban" tab written by the Apps Script.
export async function loadVoiceLinks() {
  if (process.env.BAN_CSV_FILE) return linksFromCsv(readFileSync(process.env.BAN_CSV_FILE, "utf8"));
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(BAN_TAB)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return linksFromCsv(await response.text());
  } catch (error) {
    console.warn(`Could not read the "${BAN_TAB}" tab (${error.message}); no recordings linked.`);
    return new Map();
  }
}

function linksFromCsv(text) {
  const rows = parseCsv(text);
  const header = (rows[0] ?? []).map((cell) => cell.trim().toLowerCase());
  const idColumn = header.indexOf("id");
  const urlColumn = header.indexOf("drive_url");
  const links = new Map();
  if (idColumn < 0 || urlColumn < 0) return links; // not the Ban layout (e.g. the tab does not exist)
  for (const row of rows.slice(1)) {
    const id = String(row[idColumn] ?? "").trim();
    const link = String(row[urlColumn] ?? "").trim();
    if (/^\d+$/u.test(id) && /^https:\/\//u.test(link)) links.set(id, link);
  }
  return links;
}

const splitMeaning = (value) => String(value ?? "").split(/\s*[،,]\s*/u).map((part) => part.trim()).filter(Boolean);

const KIND_TRANSLATIONS = {
  en: { "اسم": "noun", "فعل": "verb", "صفة": "adjective", "حرف": "letter", "ظرف": "adverb" },
  fr: { "اسم": "nom", "فعل": "verbe", "صفة": "adjectif", "حرف": "lettre", "ظرف": "adverbe" },
  de: { "اسم": "Substantiv", "فعل": "Verb", "صفة": "Adjektiv", "حرف": "Buchstabe", "ظرف": "Adverb" },
};
const ORIGIN_TRANSLATIONS = {
  en: { "قبطية": "Coptic", "يونانية": "Greek", "عبرية": "Hebrew", "لاتينية": "Latin", "آرامية": "Aramaic", "سريانية": "Syriac" },
  fr: { "قبطية": "copte", "يونانية": "grec", "عبرية": "hébreu", "لاتينية": "latin", "آرامية": "araméen", "سريانية": "syriaque" },
  de: { "قبطية": "Koptisch", "يونانية": "Griechisch", "عبرية": "Hebräisch", "لاتينية": "Lateinisch", "آرامية": "Aramäisch", "سريانية": "Syrisch" },
};

// One card per word id and language: merges rows that share a spelling.
export function cardData(group, voiceLink, language = "ar") {
  const first = group[0];
  const meanings = [...new Set(group.flatMap((record) => splitMeaning(record.meaning)))];
  const pick = (key) => group.map((record) => String(record[key] ?? "").trim()).find(Boolean) ?? "";
  const kind = pick("gender") || pick("kind");
  const localizedKind = KIND_TRANSLATIONS[language]?.[kind] ?? kind;
  const word = language === "en" ? (pick("english") || String(first.coptic ?? "").trim())
    : language === "fr" ? (pick("translation_fr") || String(first.coptic ?? "").trim())
      : language === "de" ? (pick("translation_de") || String(first.coptic ?? "").trim())
        : String(first.coptic ?? "").trim();
  const meaning = language === "en" ? (String(first.coptic ?? "").trim() || pick("translation_en"))
    : language === "fr" ? (String(first.coptic ?? "").trim() || pick("translation_fr"))
      : language === "de" ? (String(first.coptic ?? "").trim() || pick("translation_de"))
        : meanings.join("، ");
  return {
    word,
    meaning,
    typeLabel: language === "ar" ? kind : localizedKind,
    origin: ORIGIN_TRANSLATIONS[language]?.[pick("origin")] ?? pick("origin"),
    qrText: voiceLink || `https://t.me/${BOT_USERNAME}`,
    dateText: formatCardDate(new Date()),
    language,
    logo: "Ⲭⲏⲙⲓ",
  };
}

const COPTIC_MONTHS = ["توت", "بابه", "هاتور", "كيهك", "طوبه", "أمشير", "برمهات", "برموده", "بشنس", "بؤونه", "أبيب", "مسرى", "النسيء"];
function formatCardDate(date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  const year = get("year"); const month = get("month"); const day = get("day");
  const a = Math.floor((14 - month) / 12); const y = year + 4800 - a; const m = month + 12 * a - 3;
  const jdn = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  const days = jdn - 1825029; const copticYear = Math.floor((4 * days + 1463) / 1461);
  const dayOfYear = days - (365 * (copticYear - 1) + Math.floor(copticYear / 4));
  const copticDay = (dayOfYear % 30) + 1; const copticMonth = Math.floor(dayOfYear / 30) + 1;
  return `${day}/${month}/${year}|${copticDay} ${COPTIC_MONTHS[copticMonth - 1]} ${copticYear}`;
}

const hashOf = (data) => createHash("sha1").update(JSON.stringify([CARD_VERSION, data])).digest("hex").slice(0, 10);

export async function main() {
  const records = JSON.parse(readFileSync(DICTIONARY, "utf8"));
  const links = await loadVoiceLinks();
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
  const groups = new Map();
  for (const record of records) {
    if (record.id == null || !String(record.coptic ?? "").trim()) continue;
    const key = String(record.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  mkdirSync(CARDS_DIR, { recursive: true });
  const next = {};
  let rendered = 0;
  let deferred = 0;
  for (const [id, group] of groups) {
    const voiceLink = links.get(id) ?? "";
    if (SCOPE !== "all" && !voiceLink) continue;
    const variants = ["ar", "en", "fr", "de"].map((language) => ({ language, data: cardData(group, voiceLink, language) }));
    if (!variants[0].data.word || !variants[0].data.meaning) continue;
    const hash = hashOf(variants.map(({ data }) => data));
    const filesReady = variants.every(({ language }) => existsSync(path.join(CARDS_DIR, language === "ar" ? `${id}.png` : `${id}-${language}.png`)));
    if (manifest[id] === hash && filesReady) { next[id] = hash; continue; }
    if (rendered >= MAX_PER_RUN) { deferred += 1; if (manifest[id]) next[id] = manifest[id]; continue; }
    for (const { language, data } of variants) {
      const file = path.join(CARDS_DIR, language === "ar" ? `${id}.png` : `${id}-${language}.png`);
      writeFileSync(file, renderCard(data));
    }
    next[id] = hash;
    rendered += 1;
  }
  for (const file of readdirSync(CARDS_DIR)) {
    const match = /^(\d+)(-(?:en|fr|de))?\.png$/u.exec(file);
    if (match && (match[2] || !(match[1] in next))) rmSync(path.join(CARDS_DIR, file));
  }
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => Number(a) - Number(b)));
  writeFileSync(MANIFEST, `${JSON.stringify(sorted)}\n`);
  console.log(`Cards: ${Object.keys(sorted).length} total, ${rendered} drawn, ${deferred} deferred to the next run.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
