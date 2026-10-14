import { readFile } from "node:fs/promises";

import records from "../data/dictionary.json" with { type: "json" };

const endpoint = process.env.APPS_SCRIPT_URL;
const secret = process.env.AUDIO_SYNC_SECRET;
const baseUrl = String(process.env.AUDIO_BASE_URL || "").replace(/\/+$/u, "");
const manifestPath = process.argv[2] || "data/audio-manifest.json";

if (!endpoint || !secret || !baseUrl) {
  throw new Error("APPS_SCRIPT_URL, AUDIO_SYNC_SECRET and AUDIO_BASE_URL are required");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const seen = new Set();
const audio = [];

for (const record of records) {
  const coptic = String(record?.coptic || "").normalize("NFC").replace(/`/gu, "").replace(/\s+/gu, " ").trim();
  const id = String(record?.id ?? "");
  const fileName = manifest[id];
  if (!coptic || !fileName || seen.has(coptic)) continue;
  seen.add(coptic);
  audio.push({ coptic, file_name: fileName, url: `${baseUrl}/${encodeURIComponent(fileName)}` });
}

const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "sync_github_audio", secret, audio }),
});

const body = await response.text();
if (!response.ok) throw new Error(`Apps Script HTTP ${response.status}: ${body.slice(0, 500)}`);
let result;
try { result = JSON.parse(body); } catch { throw new Error(`Invalid Apps Script response: ${body.slice(0, 500)}`); }
if (!result.ok) throw new Error(`Apps Script rejected audio sync: ${result.error || "unknown error"}`);
console.log(JSON.stringify(result));
