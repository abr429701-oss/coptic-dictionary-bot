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
export const CERT_MAIN_SHEET_ID = "1V3N16W3523NQUQnLUq-a7_YPr9L-7lkHJq_AUefATcI";
export const CERT_CODES_SHEET_ID = "1w9bJFNZjyDf6NHl5b20fEN3Gh72vA4ZoF48sdh6FYRk";
export const CERT_SETTINGS_GID = "36067296";
export const CERT_EXAM_ICON_URL = "https://cdn-icons-png.flaticon.com/512/4201/4201973.png";

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

// Fetch one sheet tab live as CSV (public gviz endpoint, same pattern as
// /importsheet). `sheet` selects by tab name, `gid` by tab id.
export async function fetchCertSheetCsv(sheetId, { sheet = null, gid = null } = {}) {
  const params = new URLSearchParams({ tqx: "out:csv" });
  if (sheet) params.set("sheet", sheet);
  if (gid) params.set("gid", gid);
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?${params}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return parseCertCsv(await resp.text());
}

// Settings tab rows 2 and 3 (row 1 is the header): level 0 then level 1.
// Each row: [sheet, lookup col x5, "response cols,comma,separated"].
export function certSettingsFromRows(rows) {
  return [rows[1], rows[2]].map((row) => {
    if (!row) return null;
    return {
      sheet: String(row[0] ?? "").trim(),
      lookup: row.slice(1, 6).map((letter) => certLetterToIndex(letter)),
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

// Verify the derived image URL really serves an image (the Apps Script
// did the same check with its OAuth token, then without). Returns { url }
// or { url: null, error } with the Apps Script's own error wording.
export async function resolveCertImage(fileLink) {
  const derived = certFileUrl(fileLink);
  if (!derived.url) return { url: null, error: derived.error };
  const isPresentation = String(fileLink).includes("presentation") || String(fileLink).includes("docs.google.com");
  try {
    const resp = await fetch(derived.url, { signal: AbortSignal.timeout(30000) });
    const contentType = resp.headers.get("content-type") || "";
    if (resp.ok && contentType.includes("image")) return { url: derived.url, error: null };
    if (isPresentation) {
      return { url: null, error: `تعذر جلب الشهادة. خوادم جوجل ترفض الوصول للرابط (رمز الخطأ: ${resp.status}). تأكد أن الرابط متاح للجميع.` };
    }
    return { url: null, error: "الملف محمي في جوجل درايف والسكريبت لا يملك صلاحية للوصول إليه." };
  } catch (e) {
    if (isPresentation) return { url: null, error: `حدث خطأ تقني: ${e instanceof Error ? e.message : "unknown"}` };
    return { url: null, error: "الملف محمي في جوجل درايف والسكريبت لا يملك صلاحية للوصول إليه." };
  }
}

// The Apps Script's checkCompletionStatus, verbatim: code13 (codes sheet)
// gives the name; USER says whether all exams are done; FINAL lists the
// missing exams. Returns a photo result to send, or null when the code
// is not handled here (unknown code, or exams done but no certificate row).
export async function checkCertCompletion(code, level) {
  const codesData = await fetchCertSheetCsv(CERT_CODES_SHEET_ID, { sheet: "code13" });
  let studentName = null;
  for (let i = 0; i < codesData.length; i++) {
    if (String(codesData[i][0] ?? "").trim() === code) {
      studentName = codesData[i][1] ? String(codesData[i][1]).trim() : "دارسنا العزيز";
      break;
    }
  }
  if (!studentName) return null;

  const examsSheetId = level === "0" ? CERT_MAIN_SHEET_ID : CERT_CODES_SHEET_ID;
  const examsData = await fetchCertSheetCsv(examsSheetId, { sheet: "USER" });
  let hasCompletedExams = false;
  for (let i = 0; i < examsData.length; i++) {
    if (String(examsData[i][0] ?? "").trim() === code) { hasCompletedExams = true; break; }
  }
  if (hasCompletedExams) return null;

  const finalData = await fetchCertSheetCsv(examsSheetId, { sheet: "FINAL" });
  let examNames;
  let examCols;
  if (level === "0") {
    examNames = [
      "الامتحان الأول", "الامتحان الثاني", "الامتحان الثالث",
      "الامتحان الرابع", "الامتحان الخامس", "الامتحان السادس",
      "الامتحان السابع", "الامتحان الثامن", "الامتحان التاسع", "الامتحان النهائي",
    ];
    examCols = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18];
  } else {
    examNames = ["الامتحان الأول", "الامتحان الثاني", "الامتحان الثالث", "الامتحان النهائي"];
    examCols = [0, 2, 4, 6];
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
//   { kind: "photo", url, caption } | { kind: "text", text }
//   { kind: "not-found" } (code nowhere) | { kind: "error", text } (sheets unreachable)
export async function lookupCertificate(code, level) {
  try {
    const settingsRows = await fetchCertSheetCsv(CERT_MAIN_SHEET_ID, { gid: CERT_SETTINGS_GID });
    const settings = certSettingsFromRows(settingsRows);
    const cfg = settings[Number(level)];
    if (!cfg || !cfg.sheet) return { kind: "error", text: "❌ تعذّر قراءة إعدادات الشهادات." };
    const data = await fetchCertSheetCsv(CERT_MAIN_SHEET_ID, { sheet: cfg.sheet });
    const row = findCertRow(data, cfg.lookup, code);
    if (row) {
      const message = buildCertReply(row, cfg.response);
      if (!message) return { kind: "text", text: "Row found. No data to send in range columns." };
      const linkColumnIndex = level === "0" ? certLetterToIndex("C") : certLetterToIndex("BT");
      const fileLink = row[linkColumnIndex];
      if (fileLink && String(fileLink).trim() !== "") {
        const image = await resolveCertImage(String(fileLink).trim());
        if (image.url) {
          let finalCaption = message;
          if (finalCaption.length > 1024) finalCaption = finalCaption.substring(0, 1020) + "...";
          return { kind: "photo", url: image.url, caption: finalCaption };
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
