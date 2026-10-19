#!/usr/bin/env node
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = resolve(ROOT, "data/dictionary.json");
const OUTPUT = resolve(ROOT, "data/search-index.json");
const SEARCH_FIELDS = ["coptic", "pronunciation", "english", "phonetic", "translation_en", "translation_fr", "translation_de"];
const PLAIN_ASCII = /^[\x20-\x5f\x61-\x7e]*$/u;
const MARK_CHARS = /[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]/u;
const MARK_CHARS_ALL = /[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]/gu;
const FOLD_CHARS = /[أإآٱىةὲέὶίὸόὼώὴήὰάὺύ`]/u;
const FOLD_CHARS_ALL = /[أإآٱىةὲέὶίὸόὼώὴήὰάὺύ`]/gu;
const FOLD_MAP = {
  أ: "ا", إ: "ا", آ: "ا", ٱ: "ا", ى: "ي", ة: "ه",
  ὲ: "ⲉ", έ: "ⲉ", ὶ: "ⲓ", ί: "ⲓ", ὸ: "ⲟ", ό: "ⲟ",
  ὼ: "ⲱ", ώ: "ⲱ", ὴ: "ⲏ", ή: "ⲏ", ὰ: "ⲁ", ά: "ⲁ",
  ὺ: "ⲩ", ύ: "ⲩ", "`": "",
};

function normalize(value) {
  const text = String(value ?? "");
  if (PLAIN_ASCII.test(text)) return text.toLowerCase().replace(/\s+/gu, " ").trim();
  let out = text.normalize("NFKC").toLowerCase();
  if (MARK_CHARS.test(out)) out = out.replace(MARK_CHARS_ALL, "");
  if (FOLD_CHARS.test(out)) out = out.replace(FOLD_CHARS_ALL, (char) => FOLD_MAP[char] ?? "");
  return out.replace(/\s+/gu, " ").trim();
}

function toTokens(normalized) {
  return normalized.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").trim();
}

function splitMeaning(value) {
  return String(value ?? "").split(/\s*[،,]\s*/u).map((part) => part.trim()).filter(Boolean);
}

function emptyMap() {
  return Object.create(null);
}

function addRow(map, key, row) {
  if (!key) return;
  const rows = map[key];
  if (!rows) map[key] = [row];
  else if (rows[rows.length - 1] !== row) rows.push(row);
}

const records = JSON.parse(readFileSync(INPUT, "utf8"));
if (!Array.isArray(records) || records.length < 1000) {
  throw new Error(`Unexpected dictionary content: ${records?.length ?? "not an array"} records`);
}

const index = {
  meaning: [],
  prefixFirst: emptyMap(),
  prefixFirstTwo: emptyMap(),
  termTokens: [],
  textExact: emptyMap(),
  textFirst: emptyMap(),
  meaningExact: emptyMap(),
  meaningFirst: emptyMap(),
};
let postings = 0;

records.forEach((record, row) => {
  const terms = SEARCH_FIELDS.flatMap((field) => splitMeaning(record[field]).map(normalize))
    .filter(Boolean)
    .map((value) => ({ value, tokens: toTokens(value) }))
    .filter((term) => term.tokens);
  index.termTokens.push(terms.map((term) => term.tokens));
  const firstTerms = new Set();
  for (const term of terms) {
    addRow(index.textExact, term.value, row);
    const first = term.tokens.split(" ", 1)[0];
    if (first) firstTerms.add(first);
  }
  for (const first of firstTerms) addRow(index.textFirst, first, row);

  const parts = splitMeaning(record.meaning).map(normalize);
  const partTokens = parts.map(toTokens);
  index.meaning.push(partTokens);
  const firstParts = new Set();
  for (let i = 0; i < parts.length; i += 1) {
    addRow(index.meaningExact, partTokens[i], row);
    const first = partTokens[i]?.split(" ", 1)[0];
    if (first) firstParts.add(first);
  }
  for (const first of firstParts) addRow(index.meaningFirst, first, row);

  const prefixKeys = [record.coptic, record.english, record.phonetic].map(normalize).concat(parts).filter(Boolean);
  for (const key of prefixKeys) {
    const chars = Array.from(key);
    if (chars.length) addRow(index.prefixFirst, chars[0], row);
    if (chars.length > 1) addRow(index.prefixFirstTwo, chars.slice(0, 2).join(""), row);
  }
});

postings = Object.values(index.textExact).reduce((sum, rows) => sum + rows.length, postings);
postings = Object.values(index.textFirst).reduce((sum, rows) => sum + rows.length, postings);
postings = Object.values(index.meaningExact).reduce((sum, rows) => sum + rows.length, postings);
postings = Object.values(index.meaningFirst).reduce((sum, rows) => sum + rows.length, postings);
postings = Object.values(index.prefixFirst).reduce((sum, rows) => sum + rows.length, postings);
postings = Object.values(index.prefixFirstTwo).reduce((sum, rows) => sum + rows.length, postings);

const temp = `${OUTPUT}.tmp`;
const json = `${JSON.stringify(index)}\n`;
writeFileSync(temp, json, "utf8");
renameSync(temp, OUTPUT);
console.log(`Built search index for ${records.length.toLocaleString("en-US")} records; ${postings.toLocaleString("en-US")} postings; ${(Buffer.byteLength(json) / 1024 / 1024).toFixed(2)} MiB.`);
