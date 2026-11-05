// src/security.js — TOTP (RFC 6238) two-factor auth for admins, extra admin
// password gate, and a central 2FA enforcement point for sensitive commands.
// Pure Web Crypto only (crypto.subtle HMAC-SHA1). No external dependencies.
//
// Storage (Durable Object via storeCall, same pattern as index.js):
//   "2fa:<adminId>" -> { secretBase32, enabled, lastVerifiedAt, failed, lockedUntil }
//   "adminpwd"      -> { salt, hash } (SHA-256, optional extra gate)
//   "lockdown"      -> { on, message, until }
//   "verifygate"    -> { on }  (new users must press a button before searching)
//   "captcha"       -> { on }
//   "ratewarn"      -> { threshold }
//   "logchannel"    -> chat id for admin logs
//   "welcomemedia"  -> { file_id, type, caption }
//   "leavemsg"      -> text
//   "antiflood"     -> { on, msgs, seconds }

const TWOFA_TTL_MS = 30 * 60 * 1000;
const TOTP_PERIOD_S = 30;
const TOTP_DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// ---------------------------------------------------------------------------
// Base32 (RFC 4648) — no padding on encode, padding tolerated on decode.
// ---------------------------------------------------------------------------
export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | (byte & 0xff);
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(input) {
  const clean = String(input ?? "").toUpperCase().replace(/=+$/u, "").replace(/\s+/gu, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32 char");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}
async function hmacSha1(keyBytes, counterBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, counterBytes);
  return new Uint8Array(sig);
}
function counterBytes(counter) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 0x100000000) >>> 0);
  view.setUint32(4, counter >>> 0);
  return new Uint8Array(buf);
}
export async function hotp(secretBytes, counter) {
  const hmac = await hmacSha1(secretBytes, counterBytes(counter));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}
export async function totpNow(secretBase32, nowMs = Date.now()) {
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(nowMs / 1000 / TOTP_PERIOD_S);
  return hotp(secret, counter);
}
// Verify with a ±1 period window (default). Returns true/false. Never throws.
export async function totpVerify(secretBase32, code, nowMs = Date.now(), window = 1) {
  try {
    const secret = base32Decode(secretBase32);
    const counter = Math.floor(nowMs / 1000 / TOTP_PERIOD_S);
    const expected = String(code ?? "").trim();
    if (!/^\d{6}$/u.test(expected)) return false;
    for (let off = -window; off <= window; off += 1) {
      if (await hotp(secret, counter + off) === expected) return true;
    }
    return false;
  } catch {
    return false;
  }
}
export function generateSecret(bytes = 20) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base32Encode(buf);
}
export function otpauthUri(secretBase32, label = "Coptic Dictionary Bot", issuer = "CopticDictAdmin") {
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_S}`;
}
function qrServerUrl(uri) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=${encodeURIComponent(uri)}`;
}

// Sensitive admin commands that require a fresh 2FA session when 2FA is on.
// Prefix match (so /ban <id>, /broadcast flow start, etc. are all covered).
const SENSITIVE_PREFIXES = [
  "/broadcast", "/ban", "/unban", "/admins", "/apikey", "/setcommands",
  "/maintenance", "/backup", "/export", "/voice_delete_all", "/voice_delete_many",
  "/purge", "/bulkedit", "/syncusers", "/setbotname", "/deleteword", "/resetuser",
  "/bulkadd", "/importusers", "/importsheet", "/bccancel", "/blockedusers",
  "/setdrive", "/setarchive", "/syncall", "/syncreset", "/resync", "/testbroadcast",
  "/massdm", "/announce", "/lockdown", "/purgeinactive", "/password", "/setrole",
  "/roles", "/targeted", "/rollout", "/clearcache", "/configexport", "/exportfull",
];
function isSensitive(text) {
  const t = String(text ?? "").split(/\s/u)[0]?.toLowerCase() ?? "";
  return SENSITIVE_PREFIXES.some((p) => t === p || t.startsWith(`${p}_`) || t.startsWith(`${p}@`));
}

function twofaKey(userId) { return `2fa:${userId}`; }

export function createSecurity({ telegram, escapeHtml, storeCall, isAdmin, adminIds, logAdminAction, notifyAdmins }) {
  async function doGet(key, fallback = null) {
    if (!storeCall) return fallback;
    try { return (await storeCall({ op: "get", key })).value ?? fallback; } catch { return fallback; }
  }
  async function doPut(key, value) {
    if (!storeCall) return false;
    try { await storeCall({ op: "put", key, value }); return true; } catch { return false; }
  }
  async function get2fa(userId) {
    const v = await doGet(twofaKey(userId), null);
    return v && typeof v === "object" ? v : null;
  }
  async function set2fa(userId, patch) {
    const cur = (await get2fa(userId)) ?? {};
    const next = { ...cur, ...patch };
    await doPut(twofaKey(userId), next);
    return next;
  }
  // Central gate: returns { blocked: true, text } when a sensitive command is
  // used without a fresh 2FA session. Callers send `text` and stop.
  async function require2fa(env, userId, text) {
    if (!isAdmin(env, userId)) return { blocked: false };
    if (!isSensitive(text)) return { blocked: false };
    // /2fa verify itself is always allowed (so the admin can unlock).
    if (String(text).startsWith("/2fa")) return { blocked: false };
    const t = await get2fa(userId);
    if (!t?.enabled) return { blocked: false };
    const last = Number(t.lastVerifiedAt ?? 0);
    if (last && Date.now() - last < TWOFA_TTL_MS) return { blocked: false };
    if (Number(t.lockedUntil ?? 0) > Date.now()) {
      const mins = Math.ceil((Number(t.lockedUntil) - Date.now()) / 60000);
      return { blocked: true, text: `🔒 الحساب مقيد مؤقتًا بعد محاولات فاشلة. حاول بعد ${mins} دقيقة، أو استخدم رمز استعادة إن وضعته.` };
    }
    return { blocked: true, text: `🔐 هذا الأمر حساس ويتطلب مصادقة ثنائية حديثة.\nأرسل <code>/2fa verify &lt;الرمز المكوّن من 6 أرقام&gt;</code> من تطبيق المصادقة (Google Authenticator / Authy) ثم أعد الأمر. الجلسة تبقى موثوقة 30 دقيقة.` };
  }

  async function handleSetup(env, chatId, userId) {
    const secret = generateSecret();
    await set2fa(userId, { secretBase32: secret, enabled: false, lastVerifiedAt: 0, failed: 0, lockedUntil: 0 });
    const label = `CopticDict:${userId}`;
    const uri = otpauthUri(secret, label);
    await telegram(env, "sendPhoto", {
      chat_id: chatId,
      photo: qrServerUrl(uri),
      caption: `🔐 <b>إعداد المصادقة الثنائية (2FA)</b>\n\n1) امسح رمز QR بأي تطبيق مصادقة (Google Authenticator / Authy / 1Password).\n2) أو أدخل السر يدويًا:\n<code>${secret}</code>\n3) ثم أرسل: <code>/2fa verify &lt;الرمز المكوّن من 6 أرقام&gt;</code> للتفعيل.\n\n⚠️ احفظ السر في مكان آمن — إذا فقدت الوصول للتطبيق ستحتاجه لاستعادة الحساب. لا تشاركه مع أحد.`,
      parse_mode: "HTML",
    });
    await logAdminAction?.(env, userId, "2fa_setup_started");
    return true;
  }
  async function handleVerify(env, chatId, userId, code) {
    const t = await get2fa(userId);
    if (!t?.secretBase32) { await telegram(env, "sendMessage", { chat_id: chatId, text: "⚠️ لم تبدأ الإعداد بعد. أرسل /2fa setup أولًا." }); return true; }
    if (Number(t.lockedUntil ?? 0) > Date.now()) {
      const mins = Math.ceil((Number(t.lockedUntil) - Date.now()) / 60000);
      await telegram(env, "sendMessage", { chat_id: chatId, text: `🔒 محاولات فاشلة كثيرة. انتظر ${mins} دقيقة ثم أعد المحاولة.` });
      return true;
    }
    const ok = await totpVerify(t.secretBase32, code);
    if (!ok) {
      const failed = Number(t.failed ?? 0) + 1;
      const patch = { failed };
      if (failed >= 5) patch.lockedUntil = Date.now() + 15 * 60 * 1000;
      await set2fa(userId, patch);
      await telegram(env, "sendMessage", { chat_id: chatId, text: `❌ الرمز غير صحيح (محاولة ${failed}/5). تأكد من تطابق وقت هاتفك وتحقق من السر: <code>${t.secretBase32}</code>`, parse_mode: "HTML" });
      return true;
    }
    await set2fa(userId, { enabled: true, lastVerifiedAt: Date.now(), failed: 0, lockedUntil: 0 });
    await telegram(env, "sendMessage", { chat_id: chatId, text: "✅ تم تفعيل المصادقة الثنائية بنجاح! جلستك موثوقة لمدة 30 دقيقة. الأوامر الحساسة (بث، حظر، تعديل جماعي…) ستطلب رمزًا جديدًا بعد انتهائها." });
    await logAdminAction?.(env, userId, "2fa_enabled");
    await notifyAdmins?.(env, `🔐 تم تفعيل 2FA للأدمن <code>${escapeHtml(String(userId))}</code>`);
    return true;
  }
  async function handleOff(env, chatId, userId, code) {
    const t = await get2fa(userId);
    if (!t?.enabled) { await telegram(env, "sendMessage", { chat_id: chatId, text: "ℹ️ 2FA غير مفعل أصلاً على حسابك." }); return true; }
    if (!code) { await telegram(env, "sendMessage", { chat_id: chatId, text: "✏️ لإلغاء التفعيل أرسل: <code>/2fa off &lt;رمز حالي من 6 أرقام&gt;</code>", parse_mode: "HTML" }); return true; }
    if (!(await totpVerify(t.secretBase32, code))) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ الرمز غير صحيح — لم يتم إلغاء التفعيل." }); return true; }
    await doPut(twofaKey(userId), { enabled: false, secretBase32: null, lastVerifiedAt: 0 });
    await telegram(env, "sendMessage", { chat_id: chatId, text: "✅ تم إلغاء تفعيل المصادقة الثنائية. لم تعد الأوامر الحساسة تتطلب رمزًا." });
    await logAdminAction?.(env, userId, "2fa_disabled");
    return true;
  }
  async function handleStatus(env, chatId, userId) {
    const t = await get2fa(userId);
    if (!t?.enabled) { await telegram(env, "sendMessage", { chat_id: chatId, text: t?.secretBase32 ? "⏳ 2FA: بدأت الإعداد لكنك لم تُفعّل بعد. أرسل /2fa verify <رمز> للتفعيل، أو /2fa setup لإعادة التوليد." : "ℹ️ 2FA غير مفعل. فعّله بأمر /2fa setup لحماية الأوامر الحساسة." }); return true; }
    const last = Number(t.lastVerifiedAt ?? 0);
    const remain = last ? Math.max(0, Math.round((TWOFA_TTL_MS - (Date.now() - last)) / 60000)) : 0;
    await telegram(env, "sendMessage", { chat_id: chatId, text: `🔐 <b>حالة 2FA</b>: مفعّل ✅\nآخر تحقق ناجح: ${last ? new Date(last).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—"}\nالجلسة الموثوقة متبقٍّ عليها: ${remain} دقيقة`, parse_mode: "HTML" });
    return true;
  }

  // Entry point wired into the admin command block. Returns true if handled.
  async function handleAdmin({ env, chatId, userId, text }) {
    if (!isAdmin(env, userId)) return false;
    if (text === "/2fa" || text === "/2fa help" || text.startsWith("/2fa ")) {
      const parts = text.split(/\s+/u);
      const sub = (parts[1] ?? "").toLowerCase();
      const arg = parts.slice(2).join(" ").trim();
      if (sub === "setup") return handleSetup(env, chatId, userId);
      if (sub === "verify") { if (!arg) { await telegram(env, "sendMessage", { chat_id: chatId, text: "✏️ الاستخدام: /2fa verify <الرمز المكوّن من 6 أرقام>" }); return true; } return handleVerify(env, chatId, userId, arg); }
      if (sub === "off") return handleOff(env, chatId, userId, arg);
      if (sub === "status" || sub === "") return handleStatus(env, chatId, userId);
      await telegram(env, "sendMessage", { chat_id: chatId, text: "✏️ أوامر 2FA:\n/2fa setup — إعداد وتوليد السر ورمز QR\n/2fa verify <رمز> — التحقق وتفعيل/تجديد الجلسة 30 دقيقة\n/2fa off <رمز> — إلغاء التفعيل\n/2fa status — الحالة", parse_mode: "HTML" });
      return true;
    }
    return false;
  }

  return { handleAdmin, require2fa, totpVerify, generateSecret, otpauthUri, isSensitive };
}
