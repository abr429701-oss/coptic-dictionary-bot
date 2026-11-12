// Build the in-app exam data from the 12 Google Forms.
//
// The exam questions are NOT fetched live by the app: a browser fetch to
// docs.google.com is blocked by CORS, and a Worker proxy would cost Worker
// requests (the user wants zero). So this script fetches each form's public
// viewform page once, at build time, parses the FB_PUBLIC_LOAD_DATA_ blob
// (questions, entry ids, options, images, response validation, confirmation
// text, submit URL) and writes learn-app/exams.json, which the app loads
// lazily only when a student opens an exam. The file is committed, so a
// build without network keeps the last good copy (with a loud warning);
// the data goes stale only if a teacher edits a form after the deploy —
// then re-running this script (next deploy) refreshes it.
//
// The code-question validation regexes are public in the form pages
// themselves (anyone opening a form can read every allowed code), so
// baking them into the app leaks nothing new. They are stored verbatim so
// the app's client-side check matches Google's exactly, quirks included
// (e.g. forms 1/10 also accept the literal "1"; form 12's pattern has an
// empty alternative, blocked only by the required flag).
//
// Usage: node scripts/generate-exam-data.mjs [--offline]
//   --offline: skip fetching, keep the committed exams.json (used by tests
//   when the network is unavailable).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LESSONS_PATH = resolve(root, "learn-app/lessons.json");
const EXAMS_PATH = resolve(root, "learn-app/exams.json");
const PUBLIC_PATH = resolve(root, "public/learn-app/exams.json");

const FORM_ID_RE = /\/forms\/d\/([A-Za-z0-9_-]+)\//u;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export function formIdsFromLessons(lessons) {
  const ids = [];
  for (const level of lessons.levels ?? []) {
    for (const lesson of level.lessons ?? []) {
      for (const item of lesson.items ?? []) {
        if (item.kind !== "url" || typeof item.url !== "string") continue;
        const m = item.url.match(FORM_ID_RE);
        if (m && !ids.includes(m[1])) ids.push(m[1]);
      }
    }
  }
  return ids;
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/gu, "")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .trim();
}

// Parse one fetched viewform page into the clean exam object the app needs.
// Structure of FB_PUBLIC_LOAD_DATA_ (verified against all 12 live forms):
//   data[1] = [label, questions, [confirmation, ...], ..., [flag, closedMessage], title, ...]
//   question q = [id, title, desc, type, [[entryId, options, required, ..., validation]], ..., image, ..., [null, titleHtml]]
//   type: 0 = short text, 2 = multiple choice, 4 = dropdown, 8 = section header
//   validation (text questions): g[4] = [[4, 301, [pattern]], errorText]
export function parseFormPage(html, formId) {
  const m = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);\s*<\/script>/su);
  if (!m) throw new Error(`no FB_PUBLIC_LOAD_DATA_ in form ${formId}`);
  const data = JSON.parse(m[1]);
  const f = data[1];
  if (!Array.isArray(f) || !Array.isArray(f[1])) throw new Error(`unexpected load-data shape in form ${formId}`);
  const title = typeof f[8] === "string" ? f[8].trim() : "";
  const label = typeof f[0] === "string" ? f[0].trim() : "";
  const confirmationMessage = Array.isArray(f[2]) && typeof f[2][0] === "string" ? f[2][0] : "";
  const closedMessage = Array.isArray(f[7]) && typeof f[7][1] === "string" ? f[7][1].trim() : "";
  const submitUrl = html.match(/<form[^>]*action="([^"]*formResponse[^"]*)"/u)?.[1] ?? "";
  const questions = f[1].map((q) => {
    const type = q[3];
    const titleHtml = Array.isArray(q[11]) ? q[11][1] : "";
    const link = typeof titleHtml === "string" ? titleHtml.match(/<a\s+href="([^"]+)"/u)?.[1] ?? null : null;
    const imageId = Array.isArray(q[9]) && Array.isArray(q[9][0]) && typeof q[9][0][0] === "string" ? q[9][0][0] : null;
    const base = { title: stripHtml(q[1]), type, imageId, link };
    if (type === 8 || !Array.isArray(q[4]) || !Array.isArray(q[4][0])) {
      return { ...base, typeName: "section", entryId: null, required: false, options: null, validation: null };
    }
    const g = q[4][0];
    const options = Array.isArray(g[1]) ? g[1].map((o) => o[0]) : null;
    let validation = null;
    if (Array.isArray(g[4]) && Array.isArray(g[4][0])) {
      // Validation tuple: [4, 301, [pattern], errorText]
      const pattern = Array.isArray(g[4][0][2]) ? g[4][0][2][0] : null;
      if (typeof pattern === "string") {
        validation = { kind: "regex", pattern, errorText: typeof g[4][0][3] === "string" ? g[4][0][3] : "" };
      }
    }
    const typeName = type === 0 ? "short text" : type === 2 ? "multiple choice" : type === 4 ? "dropdown" : "unknown";
    return { ...base, typeName, entryId: g[0], required: g[2] === 1, options, validation };
  });
  return { formId, title, label, confirmationMessage, closedMessage, submitUrl, questions };
}

async function fetchForm(formId, attempt = 0) {
  const url = `https://docs.google.com/forms/d/${formId}/viewform`;
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${formId}`);
  return await res.text();
}

async function main() {
  const offline = process.argv.includes("--offline");
  const lessons = JSON.parse(readFileSync(LESSONS_PATH, "utf-8"));
  const ids = formIdsFromLessons(lessons);
  if (!ids.length) throw new Error("no exam forms found in learn-app/lessons.json");
  let forms = null;
  if (!offline) {
    try {
      forms = [];
      for (const id of ids) {
        let html = null;
        let lastError = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try { html = await fetchForm(id, attempt); break; }
          catch (error) { lastError = error; }
        }
        if (html === null) throw lastError;
        const form = parseFormPage(html, id);
        if (!form.submitUrl) throw new Error(`no formResponse action in form ${id}`);
        if (!form.questions.length) throw new Error(`no questions in form ${id}`);
        forms.push(form);
        console.log(`exam-data: ${id} "${form.title}" — ${form.questions.length} questions`);
      }
    } catch (error) {
      console.warn(`exam-data: fetch failed (${error.message}); keeping the committed exams.json`);
      forms = null;
    }
  }
  if (forms === null) {
    if (!existsSync(EXAMS_PATH)) throw new Error("no committed learn-app/exams.json and the fetch failed");
    console.warn("exam-data: using existing learn-app/exams.json (possibly stale — re-run with network to refresh)");
    forms = JSON.parse(readFileSync(EXAMS_PATH, "utf-8")).forms;
  }
  const out = { generatedAt: new Date().toISOString(), forms };
  writeFileSync(EXAMS_PATH, `${JSON.stringify(out, null, 1)}\n`);
  mkdirSync(resolve(root, "public/learn-app"), { recursive: true });
  writeFileSync(PUBLIC_PATH, `${JSON.stringify(out, null, 1)}\n`);
  const answerable = forms.reduce((n, f) => n + f.questions.filter((q) => q.entryId !== null).length, 0);
  console.log(`exam-data: wrote ${forms.length} forms, ${answerable} answerable questions`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) main().catch((error) => { console.error(error.message); process.exit(1); });
