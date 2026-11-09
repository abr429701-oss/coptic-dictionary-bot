// Certificate results ("الحصول على شهادة المستوى الأول/الثاني").
//
// A faithful port of the Apps Script certificate bot's lookup logic
// (apps-script-project.zip: 03 doPost.js), reading the SAME Google Sheets
// live as CSV through the public gviz endpoint — the Worker has no
// SpreadsheetApp, and the sheets are all shared publicly, so no Google
// auth is needed. The dictionary bot's /broadcast already exists, so the
// Apps Script's broadcast + natiga registration are NOT ported (the bot
// already tracks its own users); the old Apps Script bot is untouched.
//
// Sheets (all live, by name — the main sheet holds the level sheets and
// the settings tab; the codes sheet holds code13 and the level-2 lists):
//   main  1V3N16W3523NQUQnLUq-a7_YPr9L-7lkHJq_AUefATcI : Sheet1, LEVEL2,
//         USER (L1), FINAL (L1), settings (gid 36067296)
//   codes 1w9bJFNZjyDf6NHl5b20fEN3Gh72vA4ZoF48sdh6FYRk : code13, USER (L2),
//         FINAL (L2)
// Flow (exactly as the Apps Script): the student's code is looked up in
// the level sheet (columns from the settings tab); if found, the reply is
// built from the response columns and the certificate link (C for level 1,
// BT for level 2) is sent as a photo. If not found, code13 gives the name,
// USER says whether all exams are done, and FINAL lists the missing exams.
// A code found nowhere gets "الرقم الكودي غير صحيح."
//
// Speed + reliability (2026-11-09, after the first live test): the level
// sheet and the completion sheets are fetched with a gviz `where` query
// (server-side filter, 0-1 rows back instead of the whole sheet), the
// three completion sheets are fetched in parallel, and the certificate
// image is downloaded ONCE in the Worker and uploaded to Telegram as
// bytes — never passed to Telegram as a Google URL (Telegram's fetch of
// a slow Google export hung the webhook with no timeout and nothing was
// ever sent). Any download failure answers with the Apps Script's own
// error wording instead of hanging.
export const CERT_MAIN_SHEET_ID = "1V3N16W3523NQUQnLUq-a7_YPr9L-7lkHJq_AUefATcI";
export const CERT_CODES_SHEET_ID = "1w9bJFNZjyDf6NHl5b20fEN3Gh72vA4ZoF48sdh6FYRk";
export const CERT_SETTINGS_GID = "36067296";
export const CERT_EXAM_ICON_URL = "https://cdn-icons-png.flaticon.com/512/4201/4201973.png";
// Telegram sendPhoto caps a photo at 10 MB; a certificate is far smaller,
// so anything bigger is a broken link, not a certificate.
export const CERT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

// Level 0 = المستوى الأول, level 1 = المستوى الثاني (same as the Apps Script).
export const CERT_LEVEL_LABELS = ["الحصول على شهادة المستوى الأول", "الحصول على شهادة المستوى الثاني"];
export const CERT_LEVEL_COMMANDS = ["/cert1", "/cert2"];

// Column letter(s) -> 0-based index, identical to the Apps Script helper.
export function certLetterToIndex(letter) {
  let column = 0;
  const upperLetter = String(letter ?? "").trim().toUpperCase();
  for (let i = 0; i < upperLetter.length; i++) {
    column = column * 26 + (upperLetter.charCodeAt(i) - 64);
  }
  return column - 1;
}

// 0-based index -> column letter(s), the inverse of certLetterToIndex.
export function certIndexToLetter(index) {
  let n = Number(index) + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

// Minimal RFC-4180 CSV parser: gviz quotes every field, so commas and
// newlines inside values (Arabic names, messages) must not split fields.
export function parseCertCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

// A gviz `tq` filter that returns only the rows whose code matches in ANY
// of the given column letters. Codes live in the sheets as numbers AND as
// text, and a string literal does not match a numeric cell (verified live
// 2026-11-09), so a numeric code is matched both ways; a non-numeric code
// is matched as a string only. Returns null when the code cannot be put
// safely into a query (control characters) — the caller then fetches the
// whole sheet and filters locally, exactly as before.
export function certWhereClause(columnLetters, code) {
  const cols = (columnLetters ?? []).map((c) => String(c ?? "").trim().toUpperCase()).filter((c) => /^[A-Z]+$/u.test(c));
  const value = String(code ?? "");
  if (!cols.length || !value || /[\u0000-\u001f]/u.test(value)) return null;
  const escaped = value.replace(/'/g, "''");
  const isNumeric = /^\d+$/u.test(value);
  const terms = cols.map((col) => (isNumeric ? `(${col} = ${value} or ${col} = '${escaped}')` : `(${col} = '${escaped}')`));
  return `select * where ${terms.join(" or ")}`;
}

// Fetch one sheet tab live as CSV (public gviz endpoint, same pattern as
// /importsheet). `sheet` selects by tab name, `gid` by tab id. With `where`
// the server filters the rows first (tiny reply); a failed filtered fetch
// falls back to the whole sheet, so a query problem degrades to the old
// slow path instead of an error.
export async function fetchCertSheetCsv(sheetId, { sheet = null, gid = null, where = null } = {}) {
  const fetchOnce = async (tq) => {
    const params = new URLSearchParams({ tqx: "out:csv" });
    if (sheet) params.set("sheet", sheet);
    if (gid) params.set("gid", gid);
    if (tq) params.set("tq", tq);
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?${params}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return parseCertCsv(await resp.text());
  };
  if (where) {
    try {
      return await fetchOnce(where);
    } catch {
      // Fall through to the unfiltered fetch.
    }
  }
  return fetchOnce(null);
}

// Settings tab rows 2 and 3 (row 1 is the header): level 0 then level 1.
// Each row: [sheet, lookup col x5, "response cols,comma,separated"].
// `lookupLetters` is kept alongside the indices so the level sheet can
// be fetched with a `where` query instead of downloading it whole.
export function certSettingsFromRows(rows) {
  return [rows[1], rows[2]].map((row) => {
    if (!row) return null;
    return {
      sheet: String(row[0] ?? "").trim(),
      lookup: row.slice(1, 6).map((letter) => certLetterToIndex(letter)),
      lookupLetters: row.slice(1, 6).map((letter) => String(letter ?? "").trim().toUpperCase()),
      response: String(row[6] ?? "").split(",").map((letter) => certLetterToIndex(letter)),
    };
  });
}

// First data row (header skipped) whose code matches in ANY lookup column.
export function findCertRow(data, lookupCols, code) {
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (lookupCols.some((colIdx) => row[colIdx] === code)) return row;
  }
  return null;
}

// Reply text from the response columns: non-empty values, one per line.
export function buildCertReply(row, responseCols) {
  return responseCols
    .map((colIdx) => row[colIdx])
    .filter((val) => val && String(val).trim() !== "")
    .join("\n");
}

// Derive a directly fetchable image URL from a certificate link, exactly
// like the Apps Script's getFileBlobFromUrl (which then downloaded the
// bytes): Slides / Google Docs links become the PNG export URL, other
// Drive links become the direct download URL. Returns { url } or { error }.
export function certFileUrl(fileLink) {
  const url = String(fileLink ?? "").trim();
  const exactMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/) || url.match(/id=([a-zA-Z0-9-_]+)/);
  let fileId = exactMatch?.[1] ?? null;
  if (!fileId) {
    const fallbackMatch = url.match(/([a-zA-Z0-9-_]{25,})/);
    if (fallbackMatch) fileId = fallbackMatch[0];
  }
  if (!fileId) {
    return {
      url: null,
      error: `تعذر استخراج الشهادة. البوت قرأ هذه البيانات من عمود الرابط:\n[ ${url} ]\nإذا لم يكن هذا رابطاً، فتأكد أنك تستخدم العمود الصحيح (C أو BT).`,
    };
  }
  if (url.includes("presentation") || url.includes("docs.google.com")) {
    return { url: `https://docs.google.com/presentation/d/${fileId}/export/png`, error: null };
  }
  return { url: `https://drive.google.com/uc?export=download&id=${fileId}`, error: null };
}

// Download the certificate image ONCE (the Apps Script downloaded the
// blob and uploaded it; the Worker now does the same) and return its
// bytes for a multipart sendPhoto upload. Returns { bytes, contentType,
// fileName } or { bytes: null, error } with the Apps Script's own error
// wording. Bounded (25s, 10 MB) and content-type checked, so a slow or
// broken Google link answers with text instead of hanging the webhook.
export async function fetchCertImageBytes(fileLink) {
  const derived = certFileUrl(fileLink);
  if (!derived.url) return { bytes: null, error: derived.error };
  const isPresentation = String(fileLink).includes("presentation") || String(fileLink).includes("docs.google.com");
  const driveError = "الملف محمي في جوجل درايف والسكريبت لا يملك صلاحية للوصول إليه.";
  try {
    const resp = await fetch(derived.url, { signal: AbortSignal.timeout(25000) });
    const contentType = resp.headers.get("content-type") || "";
    if (!resp.ok || !contentType.includes("image")) {
      if (isPresentation) {
        return { bytes: null, error: `تعذر جلب الشهادة. خوادم جوجل ترفض الوصول للرابط (رمز الخطأ: ${resp.status}). تأكد أن الرابط متاح للجميع.` };
      }
      return { bytes: null, error: driveError };
    }
    const declared = Number(resp.headers.get("content-length") || "0");
    if (declared > CERT_IMAGE_MAX_BYTES) return { bytes: null, error: "الشهادة كبيرة جدًا ولا يمكن إرسالها كصورة." };
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > CERT_IMAGE_MAX_BYTES) return { bytes: null, error: "الشهادة كبيرة جدًا ولا يمكن إرسالها كصورة." };
    return {
      bytes: new Uint8Array(buf),
      contentType: contentType.split(";")[0].trim() || "image/png",
      fileName: isPresentation ? "certificate.png" : "certificate.jpg",
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/timed out|timeout|aborted/iu.test(msg)) {
      return { bytes: null, error: "تعذّر تحميل الشهادة — خوادم جوجل بطيئة الآن. جرّب مرة أخرى بعد قليل." };
    }
    if (isPresentation) return { bytes: null, error: `حدث خطأ تقني: ${msg || "unknown"}` };
    return { bytes: null, error: driveError };
  }
}

// The Apps Script's checkCompletionStatus, verbatim: code13 (codes sheet)
// gives the name; USER says whether all exams are done; FINAL lists the
// missing exams. The three sheets are fetched in parallel, each with a
// `where` filter on the code column(s). Returns a photo result to send,
// or null when the code is not handled here (unknown code, or exams done
// but no certificate row).
export async function checkCertCompletion(code, level) {
  const examsSheetId = level === "0" ? CERT_MAIN_SHEET_ID : CERT_CODES_SHEET_ID;
  const examCols = level === "0" ? [0, 2, 4, 6, 8, 10, 12, 14, 16, 18] : [0, 2, 4, 6];
  const examLetters = examCols.map((i) => certIndexToLetter(i));
  const [codesData, examsData, finalData] = await Promise.all([
    fetchCertSheetCsv(CERT_CODES_SHEET_ID, { sheet: "code13", where: certWhereClause(["A"], code) }),
    fetchCertSheetCsv(examsSheetId, { sheet: "USER", where: certWhereClause(["A"], code) }),
    fetchCertSheetCsv(examsSheetId, { sheet: "FINAL", where: certWhereClause(examLetters, code) }),
  ]);
  let studentName = null;
  for (let i = 0; i < codesData.length; i++) {
    if (String(codesData[i][0] ?? "").trim() === code) {
      studentName = codesData[i][1] ? String(codesData[i][1]).trim() : "دارسنا العزيز";
      break;
    }
  }
  if (!studentName) return null;

  let hasCompletedExams = false;
  for (let i = 0; i < examsData.length; i++) {
    if (String(examsData[i][0] ?? "").trim() === code) { hasCompletedExams = true; break; }
  }
  if (hasCompletedExams) return null;

  let examNames;
  if (level === "0") {
    examNames = [
      "الامتحان الأول", "الامتحان الثاني", "الامتحان الثالث",
      "الامتحان الرابع", "الامتحان الخامس", "الامتحان السادس",
      "الامتحان السابع", "الامتحان الثامن", "الامتحان التاسع", "الامتحان النهائي",
    ];
  } else {
    examNames = ["الامتحان الأول", "الامتحان الثاني", "الامتحان الثالث", "الامتحان النهائي"];
  }
  const examsStatus = new Array(examCols.length).fill(false);
  if (finalData) {
    for (let i = 0; i < finalData.length; i++) {
      for (let j = 0; j < examCols.length; j++) {
        if (finalData[i].length > examCols[j] && String(finalData[i][examCols[j]] ?? "").trim() === code) {
          examsStatus[j] = true;
        }
      }
    }
  }
  const hasAnyExam = examsStatus.some((status) => status === true);
  if (!hasAnyExam) {
    return {
      kind: "photo",
      url: CERT_EXAM_ICON_URL,
      caption: `عفوا <b>${studentName}</b>،\nيجب بدء حل الامتحانات الالكترونية وانهاءها للحصول على الشهادة. 📚✍️`,
    };
  }
  const missingExams = [];
  for (let j = 0; j < examCols.length; j++) {
    if (!examsStatus[j]) missingExams.push(examNames[j]);
  }
  const formattedMissingExams = missingExams.map((exam, index) => (index === 0 ? exam : exam.replace("الامتحان ", "")));
  return {
    kind: "photo",
    url: CERT_EXAM_ICON_URL,
    caption: `عفوا <b>${studentName}</b>،\nيجب حل ${formattedMissingExams.join(" و")} للحصول على الشهادة. 📚✍️`,
  };
}

// The full lookup (processSearch then checkCompletionStatus). Returns one
// result describing the single message to send:
//   { kind: "photo", bytes, contentType, fileName, caption } (upload bytes)
//   { kind: "photo", url, caption } (small icon by URL, as before)
//   { kind: "text", text }
//   { kind: "not-found" } (code nowhere) | { kind: "error", text } (sheets unreachable)
export async function lookupCertificate(code, level) {
  try {
    const settingsRows = await fetchCertSheetCsv(CERT_MAIN_SHEET_ID, { gid: CERT_SETTINGS_GID });
    const settings = certSettingsFromRows(settingsRows);
    const cfg = settings[Number(level)];
    if (!cfg || !cfg.sheet) return { kind: "error", text: "❌ تعذّر قراءة إعدادات الشهادات." };
    const data = await fetchCertSheetCsv(CERT_MAIN_SHEET_ID, { sheet: cfg.sheet, where: certWhereClause(cfg.lookupLetters, code) });
    const row = findCertRow(data, cfg.lookup, code);
    if (row) {
      const message = buildCertReply(row, cfg.response);
      if (!message) return { kind: "text", text: "Row found. No data to send in range columns." };
      const linkColumnIndex = level === "0" ? certLetterToIndex("C") : certLetterToIndex("BT");
      const fileLink = row[linkColumnIndex];
      if (fileLink && String(fileLink).trim() !== "") {
        const image = await fetchCertImageBytes(String(fileLink).trim());
        if (image.bytes) {
          let finalCaption = message;
          if (finalCaption.length > 1024) finalCaption = finalCaption.substring(0, 1020) + "...";
          return { kind: "photo", bytes: image.bytes, contentType: image.contentType, fileName: image.fileName, caption: finalCaption };
        }
        return { kind: "text", text: `${message}\n\n⚠️ ${image.error}` };
      }
      return { kind: "text", text: message };
    }
    const completion = await checkCertCompletion(code, level);
    if (completion) return completion;
    return { kind: "not-found" };
  } catch {
    return { kind: "error", text: "❌ تعذّر الوصول لشيت النتائج حاليًا. جرّب لاحقًا." };
  }
}
