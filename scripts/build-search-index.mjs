#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = resolve(ROOT, "data/dictionary.json");
const OUTPUT = resolve(ROOT, "public/search-index");
const SEARCH_FIELDS = ["coptic", "pronunciation", "english", "phonetic", "translation_en", "translation_fr", "translation_de"];
const BUCKET_COUNT = 256;
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
const encoder = new TextEncoder();

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

function addMapRow(map, key, row) {
  if (!key) return;
  const rows = map.get(key) ?? [];
  if (rows.at(-1) !== row) rows.push(row);
  map.set(key, rows);
}

function bucketFor(key) {
  let hash = 0x811c9dc5;
  for (const byte of encoder.encode(key)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash & (BUCKET_COUNT - 1);
}

function hexKey(value) {
  return [...encoder.encode(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const records = JSON.parse(readFileSync(INPUT, "utf8"));
if (!Array.isArray(records) || records.length < 1000) {
  throw new Error(`Unexpected dictionary content: ${records?.length ?? "not an array"} records`);
}

rmSync(OUTPUT, { recursive: true, force: true });
const termDirectory = resolve(OUTPUT, "terms");
const prefixDirectory = resolve(OUTPUT, "prefix");
mkdirSync(termDirectory, { recursive: true });
mkdirSync(prefixDirectory, { recursive: true });

const buckets = Array.from({ length: BUCKET_COUNT }, () => ({
  textExact: emptyMap(),
  textFirst: emptyMap(),
  meaningExact: emptyMap(),
  meaningFirst: emptyMap(),
}));
const prefixFirst = new Map();
const prefixFirstTwo = new Map();
const addIndexedRow = (name, key, row) => addRow(buckets[bucketFor(key)][name], key, row);

records.forEach((record, row) => {
  const terms = SEARCH_FIELDS.flatMap((field) => splitMeaning(record[field]).map(normalize))
    .filter(Boolean)
    .map((value) => ({ value, tokens: toTokens(value) }))
    .filter((term) => term.tokens);
  const firstTerms = new Set();
  for (const term of terms) {
    addIndexedRow("textExact", term.value, row);
    const first = term.tokens.split(" ", 1)[0];
    if (first) firstTerms.add(first);
  }
  for (const first of firstTerms) addIndexedRow("textFirst", first, row);

  const parts = splitMeaning(record.meaning).map(normalize);
  const firstParts = new Set();
  for (const part of parts) {
    const tokens = toTokens(part);
    addIndexedRow("meaningExact", tokens, row);
    const first = tokens.split(" ", 1)[0];
    if (first) firstParts.add(first);
  }
  for (const first of firstParts) addIndexedRow("meaningFirst", first, row);

  const prefixKeys = [record.coptic, record.english, record.phonetic].map(normalize).concat(parts).filter(Boolean);
  for (const key of prefixKeys) {
    const chars = Array.from(key);
    if (chars.length) addMapRow(prefixFirst, chars[0], row);
    if (chars.length > 1) addMapRow(prefixFirstTwo, chars.slice(0, 2).join(""), row);
  }
});

let maxBucketBytes = 0;
for (let bucket = 0; bucket < BUCKET_COUNT; bucket += 1) {
  const filename = resolve(termDirectory, `${bucket.toString(16).padStart(2, "0")}.json`);
  const content = `${JSON.stringify(buckets[bucket])}\n`;
  writeFileSync(filename, content, "utf8");
  maxBucketBytes = Math.max(maxBucketBytes, Buffer.byteLength(content));
}
for (const [key, rows] of prefixFirst) writeFileSync(resolve(prefixDirectory, `${hexKey(key)}.json`), `${JSON.stringify(rows)}\n`, "utf8");
for (const [key, rows] of prefixFirstTwo) writeFileSync(resolve(prefixDirectory, `${hexKey(key)}.json`), `${JSON.stringify(rows)}\n`, "utf8");

let totalBytes = 0;
for (const directory of [termDirectory, prefixDirectory]) {
  for (const name of readdirSync(directory)) totalBytes += Buffer.byteLength(readFileSync(resolve(directory, name)));
}
console.log(`Built search shards for ${records.length.toLocaleString("en-US")} records: ${BUCKET_COUNT} term buckets, ${prefixFirst.size + prefixFirstTwo.size} prefix files, max term bucket ${(maxBucketBytes / 1024).toFixed(1)} KiB, ${(totalBytes / 1024 / 1024).toFixed(2)} MiB total.`);
