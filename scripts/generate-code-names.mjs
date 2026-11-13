// Build-time fetch of the code -> student-name map for the learn app's
// exam code gate. Source: the "تجميع الرقم الكودي" sheet, tab "code"
// (columns: code, name, phone). Only code + name are kept — phones are
// never written to the app data. The sheet is public, so this fetch needs
// no credentials; on failure the committed codes.json is kept with a
// warning (the gate falls back to a generic greeting without a name).
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SHEET_ID = "1Cts5whXGJTaXTvjlbR7Mt31rQE5hPzkQavslHhYTxgI";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "learn-app", "codes.json");

// Minimal CSV parser: quoted fields, "" escapes, commas/newlines inside quotes.
export function parseCodeCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export function namesFromRows(rows) {
  const names = {};
  for (const row of rows) {
    const code = String(row[0] ?? "").trim();
    const name = String(row[1] ?? "").trim();
    if (!code || !name) continue;
    // The sheet's own header row can leak into the CSV — skip it.
    if (code === "الرقم الكودي" || name === "الاسم ثلاثي") continue;
    // A real name has at least one letter; junk rows (e.g. code "1" with
    // name "2") are skipped so the greeting never shows a number as a name.
    if (!/[\p{L}]/u.test(name)) continue;
    names[code] = name;
  }
  return names;
}

async function fetchText(url, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function main() {
  const offline = process.argv.includes("--offline");
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=code&headers=1&range=A1:B`;
  let names = null;
  if (!offline) {
    try {
      const csv = await fetchText(url);
      names = namesFromRows(parseCodeCsv(csv));
      if (Object.keys(names).length === 0) throw new Error("no names parsed");
    } catch (err) {
      console.error(`code-names: fetch failed (${err.message}) — keeping the committed codes.json`);
    }
  }
  if (!names) {
    if (!existsSync(OUT)) {
      console.error("code-names: no committed codes.json and the fetch failed");
      process.exit(1);
    }
    console.error("code-names: using existing learn-app/codes.json (possibly stale — re-run with network to refresh)");
    return;
  }
  const data = { version: 1, generatedAt: new Date().toISOString(), names };
  writeFileSync(OUT, JSON.stringify(data, null, 1) + "\n", "utf8");
  console.log(`code-names: wrote ${Object.keys(names).length} code -> name entries`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) await main();
