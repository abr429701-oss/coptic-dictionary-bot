// "الحصول على الرقم الكودي" — fetch the student's code inside Telegram.
//
// The Apps Script project (project-1SY1UlKu.zip) is a web form: the
// student types their three-part name and phone, and generateAndStoreCode
// computes code = 123456 + last-4-digits of the phone, then stores
// [code, name, phone] in columns A/B/C of the "code" sheet of spreadsheet
// 1w9bJFNZjyDf6NHl5b20fEN3Gh72vA4ZoF48sdh6FYRk — appending only when the
// phone is new; an existing phone returns the same code without storing.
// The bot replicates that flow in chat: it asks for the name, then the
// phone, then POSTs {name, phone} to the macro's doPost endpoint and
// shows the returned code with a ready WhatsApp link to 201207829388.
// The storage happens in the macro, exactly per the file's logic — the
// Worker never writes to the sheet itself (gviz is read-only).
//
// Verified live 2026-11-09: a plain POST to the /exec URL returns HTTP 200
// with the Apps Script error page "The script completed but the returned
// value is not a supported return type" — doPost returns a plain object,
// which a web app cannot return — and nothing was stored (the "code"
// sheet stayed at 426 rows). The macro needs one line in doPost (wrap the
// result in ContentService JSON output) for the bot's POST to work; until
// then the bot falls back to the registration instructions text (the web
// form link), so the student is never stuck.
export const GET_CODE_MACRO_URL = "https://script.google.com/macros/s/AKfycbwrOHMki2z5bp2gAtVnsGWVUVnX9-q6gi5JMQwcHhqeXSR3AzEvA2KOeKPZ-sUK5t-5Ww/exec";
export const GET_CODE_WHATSAPP_NUMBER = "201207829388";
export const GET_CODE_SHEET_ID = "1w9bJFNZjyDf6NHl5b20fEN3Gh72vA4ZoF48sdh6FYRk";

// The form strips non-digits as the user types (validateInput) and
// requires at least 4 digits (the code uses the last 4).
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

// The reply, mirroring the form's success screen: name, code, and the
// note to save the number and message the admin on WhatsApp to activate
// the subscription.
export function buildGetCodeReply(name, code) {
  return `الاسم: ${name}\nالرقم الكودي الخاص بك هو: ${code}\n\nسجّل الرقم ${GET_CODE_WHATSAPP_NUMBER} في جهات اتصالك، وبعدين ابعت رسالة على الواتساب بالرابط ده عشان تفعّل اشتراكك:\n${buildGetCodeWhatsAppUrl(code, name)}`;
}

// POST {name, phone} to the macro's doPost. Returns { code, message } on
// success, or { code: null, error } — the error is a short key the caller
// turns into the fallback (the instructions text), never a raw dump.
// `fetchImpl` exists so tests can stub the macro.
export async function getCodeFromMacro(name, phone, fetchImpl = fetch) {
  const cleanPhone = normalizeGetCodePhone(phone);
  try {
    const resp = await fetchImpl(GET_CODE_MACRO_URL, {
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
