// "الحصول على الرقم الكودي" — fetch the student's code inside Telegram.
//
// The feature lives in apps-script/Code.gs (generateAndStoreCode, copied
// verbatim from the final registration project «المشروع النهائي للرقم
// الكودي»): code = 1234567 + last-8-digits of the phone, stored as [code,
// name, phone] in columns A/B/C of the "code" sheet of spreadsheet
// 1Cts5whXGJTaXTvjlbR7Mt31rQE5hPzkQavslHhYTxgI («تجميع الرقم الكودي») —
// appending only when the phone is new; an existing phone returns the
// same code without storing.
// The bot replicates that flow in chat: it asks for the name, then the
// phone, then POSTs {name, phone} to the bot's own Apps Script web app
// (the /setdrive URL or the APPS_SCRIPT_URL secret — see driveConfig in
// src/index.js) and shows the returned code with a ready WhatsApp link to
// 201207829388. The storage happens in Code.gs, exactly per the file's
// logic — the Worker never writes to the sheet itself (gviz is read-only).
// Code.gs answers through its json_() helper, so the bot gets real JSON
// (the standalone project's doPost returned a plain object, which a web
// app cannot return — verified live 2026-11-09, and nothing was stored).
export const GET_CODE_WHATSAPP_NUMBER = "201207829388";
// The example screenshot the success reply refers to ("الصورة المرفقة"):
// a WhatsApp chat with the admin showing the code message, so the student
// sees exactly what screenshot to send back. Hosted on R2 (public).
export const GET_CODE_EXAMPLE_PHOTO_URL = "https://pub-e39b5be260724e0ea1bbf6a7db089987.r2.dev/getcode-example.jpg";
// Where Code.gs stores the codes (documentation — the Worker never
// writes here; generateAndStoreCode in apps-script/Code.gs does).
export const GET_CODE_SHEET_ID = "1Cts5whXGJTaXTvjlbR7Mt31rQE5hPzkQavslHhYTxgI";

// The form strips non-digits as the user types (validateInput) and
// requires at least 8 digits (the code uses the last 8).
export function normalizeGetCodePhone(phone) {
  return String(phone ?? "").replace(/\D/gu, "");
}

export function getCodePhoneValid(phone) {
  return normalizeGetCodePhone(phone).length >= 4;
}

// A ready WhatsApp chat with the admin, pre-filled with the student's
// code and name — tapping it opens the chat with the message ready to
// send. When the admin receives that message, that IS the proof the
// student completed the step (and the code in the message matches the
// sheet). A contact list cannot be checked from Telegram or a web page,
// so the arriving message — not the saved contact — is what gets
// verified.
export function buildGetCodeWhatsAppUrl(code, name) {
  const text = `تم التسجيل، الرقم الكودي الخاص بي: ${code}، اسمي: ${name}`;
  return `https://wa.me/${GET_CODE_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

// The reply, mirroring the form's success screen: the activation steps
// — save the admin number, open the WhatsApp chat from the link,
// screenshot it, and send the screenshot back here in the chat to
// complete the activation. It is sent as the caption of the example
// screenshot photo (GET_CODE_EXAMPLE_PHOTO_URL) — one photo message,
// not text + photo. Telegram captions cap at 1024 chars; the caller
// falls back to text + bare photo when the caption would be too long.
// NOTE (2026-11-28, user correction): the caption carries NO name and
// NO code — it starts directly with "لتفعيل اشتراكك". The student first
// sees their name + code in the activation reply after the screenshot
// is accepted (and in the returning-user greeting); the code itself
// reaches them through the pre-filled WhatsApp message draft in the
// wa.me link.
export function buildGetCodeReply(name, code) {
  return `لتفعيل اشتراكك، سجّل هذا الرقم +${GET_CODE_WHATSAPP_NUMBER} في جهات اتصالك أولاً، ثم اضغط على رابط الواتساب التالي:\n${buildGetCodeWhatsAppUrl(code, name)}\nلفتح المحادثة مع الرقم على الواتساب، ثم التقط Screenshot للشاشة على سبيل المثال مثل الشكل الموضح في الصورة المرفقة، ثم أرسلها هنا في الشات لإتمام التفعيل.`;
}

// Rejection texts for the screenshot OCR verification (2026-11-28).
// Both keep the wait open so the student can send a better screenshot.
export const GET_CODE_SCREENSHOT_UNSAVED_TEXT = `⚠️ الرقم ظاهر في السكرين مش مسجل في جهات اتصالك — سجّل الرقم +${GET_CODE_WHATSAPP_NUMBER} الأول في جهات اتصالك، وبعدين ابعت سكرين شوت تاني.`;
export const GET_CODE_SCREENSHOT_NO_CODE_TEXT = "⚠️ رسالة التسجيل مش ظاهرة في السكرين — اتأكد إنك بعت الرسالة على الواتساب، وبعدين ابعت سكرين شوت تاني.";

// Screenshot verification (2026-11-28): OCR.space free tier —
// POST https://api.ocr.space/parse/image, 25,000 requests/month,
// 500 requests/day per IP, 1 MB file limit, Engine 2 (default) with
// language auto-detection (Arabic + English + digits). A free API key
// is REQUIRED: register at https://ocr.space/ocrapi/freekey — the key
// is emailed. It is read from the OCR_SPACE_API_KEY wrangler secret
// (never hardcoded; the "helloworld" demo key is for testing only and
// is never used here). No key / oversize image / OCR error / empty
// text → "skipped": the caller FAILS OPEN and activates as before, so
// a legit student is never stranded by the OCR service being down.
// Privacy: the screenshot bytes are sent to OCR.space for text
// recognition — only the image, no other user data.
export const OCR_SPACE_API_URL = "https://api.ocr.space/parse/image";
export const OCR_SPACE_MAX_BYTES = 1048576; // free plan file limit: 1 MB

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
// Digits only, with Arabic-Indic / Persian digits folded to Western
// digits first (a phone rendered in an Arabic locale still reads as
// the same number).
export function normalizeOcrDigits(text) {
  return String(text ?? "")
    .replace(/[٠-٩]/gu, (d) => String(ARABIC_INDIC_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/gu, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/\D/gu, "");
}

// The user's rule (2026-11-28): the screenshot is REJECTED when the
// admin number shows as raw digits (unsaved); it is ACCEPTED only when
// the number shows saved as a contact name — in ANY language, so no
// specific name is ever checked: the absence of the phone digits is
// what proves the number is saved. A second check rejects screenshots
// that do not show the student's code at all (the registration message
// was not sent/shown). Whole-text digit concatenation is used so a
// number OCR splits with spaces ("+20 120 782 9388") is still caught.
export function checkScreenshotOcrText(ocrText, code) {
  const digits = normalizeOcrDigits(ocrText);
  if (digits.includes(GET_CODE_WHATSAPP_NUMBER) || digits.includes(GET_CODE_WHATSAPP_NUMBER.slice(2))) return { verdict: "unsaved-number" };
  const codeDigits = normalizeOcrDigits(code);
  if (!codeDigits || !digits.includes(codeDigits)) return { verdict: "no-code" };
  return { verdict: "ok" };
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// OCR one image (bytes) with OCR.space. Returns { text } on success,
// or { text: null, error } — the caller treats every error as "skipped"
// (fail open). `fetchImpl` exists so tests can stub the call.
export async function ocrScreenshotText(imageBytes, apiKey, fetchImpl = fetch) {
  if (!apiKey) return { text: null, error: "ocr-no-key" };
  if (!imageBytes || imageBytes.byteLength > OCR_SPACE_MAX_BYTES) return { text: null, error: "ocr-too-big" };
  try {
    const body = new URLSearchParams();
    body.set("apikey", String(apiKey));
    body.set("base64Image", `data:image/jpeg;base64,${bytesToBase64(imageBytes)}`);
    body.set("OCREngine", "2");
    body.set("isOverlayRequired", "false");
    const resp = await fetchImpl(OCR_SPACE_API_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(30000),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || data.IsErroredOnProcessing || (data.OCRExitCode !== undefined && data.OCRExitCode !== 1) || !Array.isArray(data.ParsedResults)) {
      return { text: null, error: "ocr-error" };
    }
    const text = data.ParsedResults.map((r) => String(r?.ParsedText ?? "")).join("\n");
    if (!text.trim()) return { text: null, error: "ocr-empty" };
    return { text, error: null };
  } catch {
    return { text: null, error: "ocr-unreachable" };
  }
}

// OCR + check in one step. Verdicts: "ok" (activate), "unsaved-number"
// / "no-code" (reject, wait stays open), "skipped" (no key, oversize,
// OCR error or empty text — the caller fails open and activates).
export async function verifyScreenshotOcr(imageBytes, code, apiKey, fetchImpl = fetch) {
  if (!apiKey) return { verdict: "skipped" };
  const { text, error } = await ocrScreenshotText(imageBytes, apiKey, fetchImpl);
  if (error || text == null) return { verdict: "skipped" };
  return checkScreenshotOcrText(text, code);
}

// POST {name, phone} to the bot's Apps Script web app (apps-script/Code.gs).
// `macroUrl` is the bot's Apps Script URL (driveConfig: the /setdrive URL
// or the APPS_SCRIPT_URL secret); without it there is nothing to call.
// Returns { code, message } on success, or { code: null, error } — the
// error is a short key the caller turns into the fallback (the
// instructions text), never a raw dump. `fetchImpl` exists so tests can
// stub the call.
export async function getCodeFromMacro(name, phone, macroUrl, fetchImpl = fetch) {
  const cleanPhone = normalizeGetCodePhone(phone);
  if (!macroUrl) return { code: null, error: "macro-unreachable" };
  try {
    const resp = await fetchImpl(macroUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: String(name ?? "").trim(), phone: cleanPhone }),
      signal: AbortSignal.timeout(30000),
    });
    const raw = await resp.text();
    let data = null;
    try { data = JSON.parse(raw); } catch { data = null; }
    if (!resp.ok || !data || data.success !== true || data.code === undefined || data.code === null) {
      return { code: null, error: "macro-unreadable" };
    }
    return { code: String(data.code), message: String(data.message ?? ""), error: null };
  } catch {
    return { code: null, error: "macro-unreachable" };
  }
}
