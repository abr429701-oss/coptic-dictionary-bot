#!/usr/bin/env node
// Renders word cards into cards/<id>.png and keeps data/cards.json ({ id: hash }) in step with the sheet.
// Runs in GitHub Actions. By default only words that have a recording (a link in the sheet's "Ban" tab)
// get a card, because the card's QR code opens that recording. CARD_SCOPE=all renders every word.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderCards } from "./card.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHEET_ID = process.env.SHEET_ID || "1kXVA3CNgETqym5Vz3lBUu_2gZ01QNdx7ROtGVnIJp0c";
const BAN_TAB = process.env.BAN_TAB || "Ban";
const BOT_USERNAME = process.env.BOT_USERNAME || "Uploade33_bot";
const SCOPE = process.env.CARD_SCOPE || "recorded";
const MAX_PER_RUN = Number(process.env.MAX_CARDS || 500);
const CARD_VERSION = 2; // the supplied two-template design replaces the previous one-card layout
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

// One card per word id: merges rows that share a spelling.
export function cardData(group, voiceLink) {
  const first = group[0];
  const meanings = [...new Set(group.flatMap((record) => splitMeaning(record.meaning)))];
  const pick = (key) => group.map((record) => String(record[key] ?? "").trim()).find(Boolean) ?? "";
  return {
    word: String(first.coptic ?? "").trim(),
    meaning: meanings.join("، "),
    typeLabel: pick("gender") || pick("kind"),
    origin: pick("origin"),
    qrText: voiceLink || `https://t.me/${BOT_USERNAME}`,
  };
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
    const data = cardData(group, voiceLink);
    if (!data.word || !data.meaning) continue;
    const hash = hashOf(data);
    const files = [path.join(CARDS_DIR, `${id}-1.png`), path.join(CARDS_DIR, `${id}-2.png`)];
    if (manifest[id] === hash && files.every((file) => existsSync(file))) { next[id] = hash; continue; }
    if (rendered >= MAX_PER_RUN) { deferred += 1; if (manifest[id]) next[id] = manifest[id]; continue; }
    const renderedCards = renderCards(data);
    writeFileSync(files[0], renderedCards.first);
    writeFileSync(files[1], renderedCards.second);
    next[id] = hash;
    rendered += 1;
  }
  for (const file of readdirSync(CARDS_DIR)) {
    const match = /^(\d+)-(?:1|2)\.png$/u.exec(file);
    if (match && !(match[1] in next)) rmSync(path.join(CARDS_DIR, file));
  }
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => Number(a) - Number(b)));
  writeFileSync(MANIFEST, `${JSON.stringify(sorted)}\n`);
  console.log(`Cards: ${Object.keys(sorted).length} total, ${rendered} drawn, ${deferred} deferred to the next run.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
