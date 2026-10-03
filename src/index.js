import records from "../data/dictionary.json" with { type: "json" };
import welcomeImageBase64 from "./welcome-image.js";

const BOT_TITLE = "📖 القاموس القبطي البحيري";
const PAGE_SIZE = 1;
const MAX_MESSAGE_LENGTH = 3900;
const CALLBACK_DATA_MAX_BYTES = 64;
const DEFAULT_ADMIN_IDS = "813894692"; // owner chat id from data/owner_chat_id.txt; override with ADMIN_CHAT_ID
const BROADCAST_BATCH_SIZE = 25;
const BROADCAST_BATCH_DELAY_MS = 1200;
const FIRST_TIME_TEXT =
  "مرحبًا بك! يبدو أنك تستخدم البوت لأول مرة, الرجاء إدخال اسمك ثلاثي للبدء في استخدام القاموس القبطي الناطق";
const NAME_RETRY_TEXT = "الرجاء إدخال اسمك ثلاثيًا (ثلاث كلمات على الأقل) بالحروف فقط، مثل: مينا جرجس بشرى.";
const HELP_TEXT = `${BOT_TITLE}\n\nأهلًا بك في القاموس.\n\nاكتب الكلمة مباشرة، مثل:\nⲁⲛⲁⲩ\nwater\nماء\n\nسأبحث في القبطية والعربية والإنجليزية والنطق والتهجئة.\n\nاكتب حرفًا أو حرفين لتظهر لك اقتراحات بالكلمات التي تبدأ بهما.\n\n⌨️ لا يوجد كيبورد قبطي على جهازك؟ أرسل /keyboard لتكتب الكلمة بالأزرار.`;

const ACCENT_MAP = { ὲ: "ⲉ", έ: "ⲉ", ὶ: "ⲓ", ί: "ⲓ", ὸ: "ⲟ", ό: "ⲟ", ὼ: "ⲱ", ώ: "ⲱ", ὴ: "ⲏ", ή: "ⲏ", ὰ: "ⲁ", ά: "ⲁ", ὺ: "ⲩ", ύ: "ⲩ" };
const ALEF_MAP = { أ: "ا", إ: "ا", آ: "ا", ٱ: "ا", ى: "ي" };

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]/gu, "")
    .replace(/[أإآٱى]/gu, (char) => ALEF_MAP[char])
    .replace(/[ὲέὶίὸόὼώὴήὰάὺύ`]/gu, (char) => ACCENT_MAP[char] ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

// Build heavy structures only when first needed (cold starts and the user store never pay for them).
function lazy(build) {
  let value;
  let ready = false;
  return () => {
    if (!ready) {
      value = build();
      ready = true;
    }
    return value;
  };
}

// Search only the sheet's own text; never derived/generated fields.
const SEARCH_FIELDS = ["coptic", "greek", "pronunciation", "english", "phonetic"];

// Recordings are linked to the word's permanent id (data/word_ids.json), never to its row position.
const VOICE_PREFIX = "voiceid:";
const voiceKey = (id) => `${VOICE_PREFIX}${id}`;
const recordIndexById = lazy(() => {
  const map = new Map();
  records.forEach((record, index) => {
    if (record.id != null && !map.has(record.id)) map.set(record.id, index);
  });
  return map;
});

const ARABIC_LETTER = /[\u0600-\u06ff]/u;

// Lowercase/strip marks, then keep only letters/digits separated by single spaces.
function toTokens(normalized) {
  return normalized.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").trim();
}

function tokens(value) {
  return toTokens(normalize(value));
}

// True when `needle` (already tokenized) appears in `text` as whole word(s), never inside a longer word.
function hasWholeWords(text, needle) {
  return needle !== "" && ` ${text} `.includes(` ${needle} `);
}

const SUGGESTION_PAGE_SIZE = 10;
const SUGGESTION_TITLE = "اختر من الاقتراحات التالية:";
const SHORT_QUERY_MAX = 2;

function splitMeaning(value) {
  return String(value ?? "").split(/\s*[،,]\s*/u).map((part) => part.trim()).filter(Boolean);
}

// Normalized text, tokenized meanings and "word starts" per record, built once per isolate on first search.
const searchIndex = lazy(() => {
  const text = [];
  const meaning = [];
  const prefix = [];
  for (const record of records) {
    text.push(normalize(SEARCH_FIELDS.map((key) => record[key] ?? "").join(" ")));
    const parts = splitMeaning(record.meaning).map(normalize);
    meaning.push(parts.map(toTokens));
    const keys = [record.coptic, record.greek, record.english, record.phonetic].map(normalize);
    prefix.push(keys.concat(parts).filter(Boolean));
  }
  return { text, meaning, prefix };
});

function findPrefixMatches(normalizedQuery) {
  const matches = [];
  const { prefix } = searchIndex();
  for (let index = 0; index < prefix.length; index += 1) {
    const keys = prefix[index];
    for (let k = 0; k < keys.length; k += 1) {
      if (keys[k].startsWith(normalizedQuery)) {
        matches.push(index);
        break;
      }
    }
  }
  return matches;
}

// Index of the meaning part the query refers to (Arabic searches only); -1 means "show everything".
function matchedPartIndex(record, normalizedQuery) {
  if (!ARABIC_LETTER.test(normalizedQuery)) return -1;
  const needle = tokens(normalizedQuery);
  const parts = splitMeaning(record.meaning);
  const exact = parts.findIndex((part) => tokens(part) === needle);
  if (exact >= 0) return exact;
  return parts.findIndex((part) => normalize(part).startsWith(normalizedQuery) || hasWholeWords(tokens(part), needle));
}

// Suggestions show the word only; meanings appear after tapping.
function suggestionLabel(record) {
  const word = String(record.coptic ?? "").replaceAll("`", "").trim();
  return (word || String(record.english ?? "").trim() || "—").slice(0, 48);
}

function truncateBytes(value, maxBytes) {
  const encoder = new TextEncoder();
  let out = "";
  let used = 0;
  for (const char of String(value)) {
    const size = encoder.encode(char).length;
    if (used + size > maxBytes) break;
    out += char;
    used += size;
  }
  return out;
}

function pageCallback(page, query) {
  const prefix = `p|${page}|`;
  return prefix + truncateBytes(query, CALLBACK_DATA_MAX_BYTES - prefix.length);
}

function renderSuggestions(query, normalizedQuery, matches, requestedPage) {
  const totalPages = Math.max(1, Math.ceil(matches.length / SUGGESTION_PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, totalPages - 1));
  const slice = matches.slice(page * SUGGESTION_PAGE_SIZE, (page + 1) * SUGGESTION_PAGE_SIZE);
  const keyboard = slice.map((index) => {
    const part = matchedPartIndex(records[index], normalizedQuery);
    return [{
      text: suggestionLabel(records[index]),
      callback_data: part >= 0 ? `s|${index}|${part}` : `s|${index}`,
    }];
  });
  const navigation = [];
  if (page > 0) navigation.push({ text: "السابق", callback_data: pageCallback(page - 1, query) });
  if (page < totalPages - 1) navigation.push({ text: "التالي", callback_data: pageCallback(page + 1, query) });
  if (navigation.length) keyboard.push(navigation);
  return { text: SUGGESTION_TITLE, reply_markup: { inline_keyboard: keyboard } };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatRecord(record, partIndex = -1) {
  const parts = splitMeaning(record.meaning);
  const meaning = partIndex >= 0 && parts[partIndex] ? parts[partIndex] : parts.join("، ");
  const fields = [
    ["الكلمة", record.coptic],
    ["المعنى", meaning],
    ["النوع", record.kind],
    ["الأصل", record.origin],
  ];
  const lines = [];
  for (const [label, raw] of fields) {
    const value = String(raw ?? "").trim();
    if (value) lines.push(`<b>${label}:</b> ${escapeHtml(value)}`);
  }
  return lines.join("\n");
}

function findMatches(query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  const matches = [];
  if (ARABIC_LETTER.test(normalizedQuery)) {
    // Arabic: match the sheet's meanings only, as whole words/phrases (never inside a longer word).
    const needle = tokens(normalizedQuery);
    if (!needle) return [];
    const exact = [];
    const { meaning: meaningTokens } = searchIndex();
    for (let index = 0; index < meaningTokens.length; index += 1) {
      let found = false;
      let isExact = false;
      for (const item of meaningTokens[index]) {
        if (item === needle) { isExact = true; break; }
        if (hasWholeWords(item, needle)) found = true;
      }
      if (isExact) exact.push(index);
      else if (found) matches.push(index);
    }
    return exact.concat(matches);
  }
  const { text: allText } = searchIndex();
  for (let index = 0; index < allText.length; index += 1) {
    if (allText[index].includes(normalizedQuery)) matches.push(index);
  }
  return matches;
}

const TYPING_DELAY_MS = 0; // raise (e.g. 400) for a longer visible "typing…"

async function telegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    console.error(`Telegram ${method} failed`, result.description ?? response.status);
  }
  return result;
}

async function fetchSpeech(spoken) {
  try {
    const ttsUrl = "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=" + encodeURIComponent(spoken);
    const ttsResponse = await fetch(ttsUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; CopticDictionaryBot/1.0)" },
      signal: AbortSignal.timeout(6000),
    });
    const contentType = ttsResponse.headers.get("content-type") ?? "";
    if (!ttsResponse.ok || !contentType.includes("audio")) {
      console.error("TTS fetch failed", ttsResponse.status, contentType);
      return null;
    }
    const audio = await ttsResponse.arrayBuffer();
    return audio.byteLength ? audio : null;
  } catch (error) {
    console.error("Voice failed", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

function spokenText(record) {
  return String(record?.phonetic || record?.english || "").trim().slice(0, 200);
}

// Starts the lookup (admin recording) or speech generation right away, so it is ready when the text is sent.
function prepareWordVoice(env, record) {
  return (async () => {
    if (env.USERS && record?.id != null) {
      try {
        const saved = await storeCall(env, { op: "get", key: voiceKey(record.id) });
        if (saved?.value?.fileId) return { fileId: saved.value.fileId };
      } catch (error) {
        console.error("Recorded voice lookup failed", error instanceof Error ? error.message : "unknown error");
      }
    }
    const spoken = spokenText(record);
    if (!spoken) return null;
    const audio = await fetchSpeech(spoken);
    return audio ? { audio, spoken } : null;
  })();
}

async function sendPreparedVoice(env, chatId, record, prepared) {
  let voice = await prepared;
  if (!voice) return;
  const word = String(record?.coptic ?? "").trim();
  if (voice.fileId) {
    const result = await telegram(env, "sendVoice", { chat_id: chatId, voice: voice.fileId, caption: `🔊 ${word}`.slice(0, 1000) });
    if (result?.ok) return;
    // The saved recording could not be sent: fall back to the generated speech.
    const spoken = spokenText(record);
    const audio = spoken ? await fetchSpeech(spoken) : null;
    if (!audio) return;
    voice = { audio, spoken };
  }
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", `🔊 ${word} — ${voice.spoken}`.slice(0, 1000));
    form.append("voice", new Blob([voice.audio], { type: "audio/mpeg" }), "word.mp3");
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendVoice`, { method: "POST", body: form });
    if (!response.ok) console.error("Telegram sendVoice failed", response.status);
  } catch (error) {
    console.error("Voice failed", error instanceof Error ? error.message : "unknown error");
  }
}

async function sendWordVoice(env, chatId, record) {
  return sendPreparedVoice(env, chatId, record, prepareWordVoice(env, record));
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

// ---- Drive archive (Google Apps Script web app) ----
// Config comes from the APPS_SCRIPT_URL secret (APPS_SCRIPT_SECRET is optional), or from /setdrive <url> (stored in the user store).
// No password is required: the web app only needs its /exec link.
const DRIVE_CONFIG_KEY = "drive-config";
const SYNC_DRIVE_BATCH = 5;

async function driveConfig(env) {
  if (env.APPS_SCRIPT_URL) return { url: env.APPS_SCRIPT_URL, secret: env.APPS_SCRIPT_SECRET ?? "" };
  if (!env.USERS) return null;
  try {
    const saved = (await storeCall(env, { op: "get", key: DRIVE_CONFIG_KEY })).value;
    return saved?.url ? saved : null;
  } catch (error) {
    console.error("Drive config lookup failed", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

async function callAppsScript(config, payload) {
  const response = await fetch(config.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...(config.secret ? { secret: config.secret } : {}), ...payload }),
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    // Apps Script answers with an HTML page when the deployment is missing, private or outdated.
    throw new Error(`Apps Script returned ${response.status} (not JSON): check Deploy > New version and "Anyone" access`);
  }
  if (!response.ok || !result.ok) throw new Error(result.error || `Apps Script failed: ${response.status}`);
  return result;
}

// Uploads one saved recording to Drive and remembers the link. Returns { ok, error }.
async function uploadVoiceToDrive(env, { id, record, fileId, duration, by }) {
  const config = await driveConfig(env);
  if (!config) return { ok: false, error: "not configured" };
  try {
    const fileInfo = await telegram(env, "getFile", { file_id: fileId });
    const filePath = fileInfo?.ok ? fileInfo.result?.file_path : null;
    if (!filePath) throw new Error("Telegram did not return a file path");
    const audioResponse = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!audioResponse.ok) throw new Error(`Telegram file download failed: ${audioResponse.status}`);
    const result = await callAppsScript(config, {
      action: "upload",
      id,
      word: record?.coptic ?? "",
      audio_base64: arrayBufferToBase64(await audioResponse.arrayBuffer()),
      mime_type: "audio/ogg",
      file_id: fileId,
      duration: duration ?? "",
      by: by ?? null,
    });
    await storeCall(env, {
      op: "voicedrive",
      id,
      fileId,
      drive: { url: result.url ?? null, fileId: result.file_id ?? null, at: new Date().toISOString() },
    });
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.error("Voice archive failed", reason);
    return { ok: false, error: reason };
  }
}

// Runs work after the webhook has answered (so recording stays fast); in tests it is simply awaited.
async function inBackground(ctx, work) {
  if (ctx?.waitUntil) {
    ctx.waitUntil(work.catch((error) => console.error("Background task failed", error instanceof Error ? error.message : "unknown error")));
    return;
  }
  await work;
}

async function archiveAndReport(env, chatId, job) {
  const outcome = await uploadVoiceToDrive(env, job);
  if (outcome.ok || outcome.error === "not configured") return;
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: `⚠️ تم حفظ التسجيل لكن تعذّر رفع «${job.record?.coptic ?? ""}» إلى درايف:\n${outcome.error}\nسيبقى في قائمة الانتظار، أرسل /syncdrive لإعادة المحاولة.`.slice(0, 1000),
  });
}

async function driveStatusText(env) {
  const config = await driveConfig(env);
  if (!config) {
    return "☁️ لم يتم ربط جوجل درايف بعد.\nأرسل: /setdrive رابط_السكريبت (بدون كلمة سر)";
  }
  const counts = await storeCall(env, { op: "voicepending", limit: 0 });
  const lines = [
    "☁️ <b>أرشيف جوجل درايف</b>",
    `✅ مرفوع: ${counts.uploaded}`,
    `⏳ في الانتظار: ${counts.pendingTotal}`,
    `🎙 إجمالي التسجيلات: ${counts.total}`,
  ];
  try {
    const ping = await callAppsScript(config, { action: "ping" });
    lines.push("", `📁 الفولدر: <a href="${escapeHtml(ping.folder?.url ?? "")}">${escapeHtml(ping.folder?.name ?? "")}</a>`);
    lines.push(`📄 الشيت: ${escapeHtml(ping.sheet?.name ?? "")} — ورقة ${escapeHtml(ping.sheet?.tab ?? "Ban")}`);
  } catch (error) {
    lines.push("", `❌ تعذّر الاتصال بالسكريبت: ${escapeHtml(error instanceof Error ? error.message : "unknown error")}`);
  }
  if (counts.pendingTotal) lines.push("", "أرسل /syncdrive لرفع المتبقي.");
  return lines.join("\n");
}

async function syncPendingVoices(env, chatId, by) {
  const config = await driveConfig(env);
  if (!config) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "لم يتم ربط جوجل درايف بعد. استخدم /setdrive أولًا." });
    return;
  }
  const batch = await storeCall(env, { op: "voicepending", limit: SYNC_DRIVE_BATCH });
  let uploaded = 0;
  let failure = "";
  for (const item of batch.pending) {
    const record = records[recordIndexById().get(item.id)];
    const outcome = await uploadVoiceToDrive(env, { id: item.id, record, fileId: item.fileId, duration: item.duration, by });
    if (outcome.ok) uploaded += 1;
    else {
      failure = outcome.error;
      break;
    }
  }
  const left = Math.max(0, batch.pendingTotal - uploaded);
  const lines = [`☁️ تم رفع ${uploaded} تسجيل.`, `⏳ المتبقي: ${left}`];
  if (failure) lines.push(`❌ توقف الرفع: ${failure}`);
  else if (left) lines.push("أرسل /syncdrive مرة أخرى لمتابعة الرفع.");
  else lines.push("🎉 كل التسجيلات مرفوعة.");
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n") });
}

async function setDriveConfig(env, message, argument) {
  const url = argument.split(/\s+/u)[0];
  if (!/^https:\/\/script\.google\.com\/(?:macros\/s\/[\w-]+|a\/[^/\s]+\/macros\/s\/[\w-]+)\/exec$/u.test(url ?? "")) {
    await telegram(env, "sendMessage", {
      chat_id: message.chat.id,
      text: "أرسل: /setdrive ثم رابط الويب آب المنتهي بـ exec (بدون كلمة سر).",
    });
    return;
  }
  await storeCall(env, { op: "put", key: DRIVE_CONFIG_KEY, value: { url, secret: "" } });
  await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "تم حفظ رابط درايف. جارٍ الاختبار…" });
  await telegram(env, "sendMessage", { chat_id: message.chat.id, text: await driveStatusText(env), parse_mode: "HTML", disable_web_page_preview: true });
}

async function showTyping(env, chatId, delayMs = TYPING_DELAY_MS) {
  await telegram(env, "sendChatAction", { chat_id: chatId, action: "typing" });
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function sendSearch(env, chatId, query, page = 0, messageId = undefined) {
  const cleanQuery = String(query ?? "").replace(/[\r\n]+/gu, " ").trim().slice(0, 160);
  const normalizedQuery = normalize(cleanQuery);
  const deliver = (payload) => messageId === undefined
    ? telegram(env, "sendMessage", { chat_id: chatId, ...payload })
    : telegram(env, "editMessageText", { chat_id: chatId, message_id: messageId, ...payload });

  if (normalizedQuery && Array.from(normalizedQuery).length <= SHORT_QUERY_MAX) {
    const prefixMatches = findPrefixMatches(normalizedQuery);
    if (prefixMatches.length) {
      const view = renderSuggestions(cleanQuery, normalizedQuery, prefixMatches, page);
      return deliver({ text: view.text, parse_mode: "HTML", reply_markup: view.reply_markup });
    }
  }
  const matches = findMatches(cleanQuery);
  if (!matches.length) {
    const text = `لم أجد نتائج لـ <b>${escapeHtml(cleanQuery)}</b>.\nجرّب القبطية أو العربية أو الإنجليزية أو تهجئة أقرب.`;
    return deliver({ text, parse_mode: "HTML" });
  }
  if (matches.length > 1) {
    const view = renderSuggestions(cleanQuery, normalizedQuery, matches, page);
    return deliver({ text: view.text, parse_mode: "HTML", reply_markup: view.reply_markup });
  }
  const record = records[matches[0]];
  const voice = prepareWordVoice(env, record);
  const text = formatRecord(record, matchedPartIndex(record, normalizedQuery)).slice(0, MAX_MESSAGE_LENGTH);
  const response = await deliver({ text, parse_mode: "HTML" });
  await sendPreparedVoice(env, chatId, record, voice);
  return response;
}

async function sendRecord(env, chatId, index, partIndex = -1) {
  const record = records[index];
  if (!record) return;
  const voice = prepareWordVoice(env, record);
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: formatRecord(record, partIndex).slice(0, MAX_MESSAGE_LENGTH),
    parse_mode: "HTML",
  });
  await sendPreparedVoice(env, chatId, record, voice);
}

// Registered users live in one SQLite-backed Durable Object (no extra Cloudflare token permission needed).
export class UserStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Run the one-time conversion before any request is served.
    state.blockConcurrencyWhile?.(() => this.migrateLegacyVoices());
  }

  // Recordings used to be stored as voice:<row number>, which breaks when rows move. Re-key them by word id.
  async migrateLegacyVoices() {
    const storage = this.state.storage;
    if (await storage.get("voice-ids-migrated")) return;
    const legacy = await storage.list({ prefix: "voice:" });
    for (const [key, value] of legacy) {
      const suffix = key.slice("voice:".length);
      if (/^\d+$/u.test(suffix)) {
        const id = records[Number(suffix)]?.id;
        if (id != null && !(await storage.get(voiceKey(id)))) await storage.put(voiceKey(id), value);
      }
      await storage.delete(key);
    }
    await storage.put("voice-ids-migrated", true);
  }

  async recipients(exclude = []) {
    const skip = new Set(exclude.map(String));
    const users = await this.state.storage.list({ prefix: "user:" });
    const ids = [];
    for (const [key, record] of users) {
      const id = key.slice("user:".length);
      if (!skip.has(id) && !record?.blocked) ids.push(id);
    }
    return ids;
  }

  async alarm() {
    const storage = this.state.storage;
    const job = await storage.get("broadcast");
    if (!job) return;
    const batch = job.queue.splice(0, BROADCAST_BATCH_SIZE);
    let delay = BROADCAST_BATCH_DELAY_MS;
    for (let i = 0; i < batch.length; i += 1) {
      const id = batch[i];
      const result = await telegram(this.env, "copyMessage", {
        chat_id: id,
        from_chat_id: job.fromChat,
        message_id: job.messageId,
      });
      if (result?.ok) {
        job.sent += 1;
      } else if (result?.error_code === 429) {
        // Telegram asked us to slow down: put the rest back and wait.
        job.queue.unshift(...batch.slice(i));
        delay = ((result.parameters?.retry_after ?? 5) + 1) * 1000;
        break;
      } else {
        job.failed += 1;
        if (result?.error_code === 403 || result?.error_code === 400) {
          const record = (await storage.get(`user:${id}`)) ?? {};
          await storage.put(`user:${id}`, { ...record, blocked: true });
        }
      }
    }
    if (job.queue.length) {
      await storage.put("broadcast", job);
      await storage.setAlarm(Date.now() + delay);
      return;
    }
    await storage.delete("broadcast");
    await telegram(this.env, "sendMessage", {
      chat_id: job.adminChat,
      text: `✅ اكتمل الإرسال الجماعي.\nوصلت إلى: ${job.sent}\nلم تصل (حظروا البوت أو حذفوه): ${job.failed}\nالإجمالي: ${job.total}`,
    });
  }

  async fetch(request) {
    const { op, key, value, userId, input, kb, exclude, fromChat, messageId, id, fileId, drive, limit } = await request.json();
    const storage = this.state.storage;
    if (op === "get") return Response.json({ value: (await storage.get(key)) ?? null });
    if (op === "put") {
      await storage.put(key, value);
      return Response.json({ ok: true });
    }
    if (op === "register") {
      // Atomic "first contact" check so two quick messages never announce the same user twice.
      const existing = await storage.get(`user:${userId}`);
      if (!existing) {
        const created = { firstSeen: new Date().toISOString() };
        await storage.put(`user:${userId}`, created);
        return Response.json({ created: true, user: created, total: (await storage.list({ prefix: "user:" })).size });
      }
      const user = existing.blocked ? { ...existing, blocked: false } : existing;
      if (existing.blocked) await storage.put(`user:${userId}`, user);
      return Response.json({ created: false, user });
    }
    if (op === "bccount") return Response.json({ count: (await this.recipients(exclude)).length });
    if (op === "bcstatus") {
      const job = await storage.get("broadcast");
      return Response.json(job ? { running: true, total: job.total, sent: job.sent, failed: job.failed } : { running: false });
    }
    if (op === "voiceNext") {
      const voiced = await storage.list({ prefix: VOICE_PREFIX });
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (record.id == null || voiced.has(voiceKey(record.id))) continue;
        return Response.json({
          id: record.id,
          coptic: record.coptic ?? "",
          pronunciation: record.pronunciation ?? "",
          english: record.english ?? "",
          meaning: record.meaning ?? "",
          recorded: voiced.size,
          total: recordIndexById().size,
        });
      }
      return Response.json(null);
    }
    if (op === "voicedrive") {
      // Merge the Drive link into the saved recording, unless it was replaced by a newer one meanwhile.
      const current = await storage.get(voiceKey(id));
      if (current && current.fileId === fileId) await storage.put(voiceKey(id), { ...current, drive });
      return Response.json({ ok: Boolean(current) });
    }
    if (op === "voicepending") {
      const voiced = await storage.list({ prefix: VOICE_PREFIX });
      const pending = [];
      let pendingTotal = 0;
      for (const [key, value] of voiced) {
        if (value?.drive) continue;
        pendingTotal += 1;
        if (pending.length < (limit ?? 0)) {
          pending.push({ id: Number(key.slice(VOICE_PREFIX.length)), fileId: value.fileId, duration: value.duration ?? null });
        }
      }
      return Response.json({ pending, pendingTotal, total: voiced.size, uploaded: voiced.size - pendingTotal });
    }
    if (op === "bcstart") {
      if (await storage.get("broadcast")) return Response.json({ busy: true });
      const queue = await this.recipients(exclude);
      if (!queue.length) return Response.json({ started: false, total: 0 });
      await storage.put("broadcast", {
        queue, total: queue.length, sent: 0, failed: 0, fromChat, messageId, adminChat: fromChat,
      });
      await storage.setAlarm(Date.now() + 100);
      return Response.json({ started: true, total: queue.length });
    }
    const userKey = `user:${userId}`;
    if (op === "kbstep") {
      // Read-modify-write inside the object so rapid taps never overwrite each other.
      const user = (await storage.get(userKey)) ?? {};
      if (!user.kb) return Response.json({ active: false });
      const word = applyKeyboardAction(user.kb.word, input);
      await storage.put(userKey, { ...user, kb: { ...user.kb, word } });
      return Response.json({ active: true, word, previous: user.kb.word, msgId: user.kb.msgId });
    }
    if (op === "kbset") {
      const user = (await storage.get(userKey)) ?? {};
      const { kb: previous, ...rest } = user;
      await storage.put(userKey, kb ? { ...rest, kb } : rest);
      return Response.json({ ok: true, previous: previous ?? null });
    }
    return new Response("Bad request", { status: 400 });
  }
}

async function storeCall(env, payload) {
  const stub = env.USERS.get(env.USERS.idFromName("users"));
  const response = await stub.fetch("https://user-store/", { method: "POST", body: JSON.stringify(payload) });
  return response.json();
}

async function getUser(env, userId) {
  if (!env.USERS) return null;
  try {
    return (await storeCall(env, { op: "get", key: `user:${userId}` })).value ?? null;
  } catch (error) {
    console.error("User lookup failed", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

async function saveUser(env, userId, data) {
  if (!env.USERS) return false;
  try {
    await storeCall(env, { op: "put", key: `user:${userId}`, value: data });
    return true;
  } catch (error) {
    console.error("User save failed", error instanceof Error ? error.message : "unknown error");
    return false;
  }
}

function isValidFullName(value) {
  const name = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (name.length < 5 || name.length > 60) return false;
  if (!/^[\p{L}\p{M}' .-]+$/u.test(name)) return false;
  return name.split(" ").filter(Boolean).length >= 3;
}

async function sendWelcome(env, chatId, name) {
  const caption =
    `مرحبًا بك يا ${escapeHtml(name)} في القاموس الرقمي الناطق للغة القبطية, تفضل الان بكتابة أي كلمة للبحث عنها`;
  try {
    // Upload the bundled image bytes directly: no dependency on Telegram fetching an external URL.
    const bytes = Uint8Array.from(atob(welcomeImageBase64), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    form.append("photo", new Blob([bytes], { type: "image/jpeg" }), "welcome.jpg");
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.ok) return;
    console.error("Telegram sendPhoto failed", result.description ?? response.status);
  } catch (error) {
    console.error("Welcome photo failed", error instanceof Error ? error.message : "unknown error");
  }
  await telegram(env, "sendMessage", { chat_id: chatId, text: caption, parse_mode: "HTML" });
}

// ---- Coptic reply keyboard ----
// Tapping a button on a reply keyboard sends its text as a normal message. While a keyboard session is
// active, those taps are collected into a word (kept in the user's record), the tap message is deleted,
// and one "composition" message is edited in place. "بحث" then searches the collected word.
const COPTIC_KEY_ROWS = [
  ["ⲁ", "ⲃ", "ⲅ", "ⲇ", "ⲉ", "ⲍ"],
  ["ⲏ", "ⲑ", "ⲓ", "ⲕ", "ⲗ", "ⲙ"],
  ["ⲛ", "ⲝ", "ⲟ", "ⲡ", "ⲣ", "ⲥ"],
  ["ⲧ", "ⲩ", "ⲫ", "ⲭ", "ⲯ", "ⲱ"],
  ["ϣ", "ϥ", "ϧ", "ϩ", "ϫ", "ϭ", "ϯ"],
];
const JINKIM_COMBINING = "\u0300";
const KEY_JINKIM = "◌̀"; // dotted circle + combining grave: shows how the jinkim sits on a letter
const COPTIC_KEYS = new Set([...COPTIC_KEY_ROWS.flat(), "`", KEY_JINKIM]);
const KEY_SPACE = "␣ مسافة";
const KEY_BACK = "⌫ حذف";
const KEY_CLEAR = "🗑 مسح";
const KEY_SEARCH = "🔎 بحث";
const KEY_CLOSE = "✖️ إغلاق";
const KEYBOARD_CONTROLS = new Set([KEY_SPACE, KEY_BACK, KEY_CLEAR, KEY_SEARCH, KEY_CLOSE]);
const KEYBOARD_TITLE = "⌨️ الكيبورد القبطي\nاضغط الحروف لتكوين الكلمة ثم اضغط «🔎 بحث»";
const KEYBOARD_MAX_LENGTH = 40;

function keyboardReplyMarkup() {
  const rows = COPTIC_KEY_ROWS.map((row) => row.map((text) => ({ text })));
  rows.push([{ text: KEY_JINKIM }, { text: KEY_SPACE }, { text: KEY_BACK }, { text: KEY_CLEAR }]);
  rows.push([{ text: KEY_SEARCH }, { text: KEY_CLOSE }]);
  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "اضغط الحروف ثم 🔎 بحث",
  };
}

function keyboardText(word) {
  return `${KEYBOARD_TITLE}\n\n▸ ${word}▏`;
}

function isKeyboardInput(text) {
  return COPTIC_KEYS.has(text) || KEYBOARD_CONTROLS.has(text);
}

function applyKeyboardAction(word, input) {
  const current = String(word ?? "");
  if (input === KEY_BACK) return Array.from(current).slice(0, -1).join("");
  if (input === KEY_CLEAR) return "";
  if (input === KEY_SPACE) return current && !current.endsWith(" ") ? `${current} ` : current;
  if (input === KEY_JINKIM || input === "`") {
    // The jinkim marks the letter before it, and only once.
    return /[^\s\u0300]$/u.test(current) && Array.from(current).length < KEYBOARD_MAX_LENGTH
      ? current + JINKIM_COMBINING
      : current;
  }
  if (COPTIC_KEYS.has(input)) return Array.from(current).length < KEYBOARD_MAX_LENGTH ? current + input : current;
  return current;
}

async function startKeyboard(env, chatId, userId) {
  const sent = await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: keyboardText(""),
    reply_markup: keyboardReplyMarkup(),
  });
  await storeCall(env, { op: "kbset", userId, kb: { word: "", msgId: sent?.result?.message_id ?? null } });
}

async function handleKeyboardInput(env, message, userId) {
  const chatId = message.chat.id;
  const text = String(message.text ?? "").trim();
  const dropTap = () => telegram(env, "deleteMessage", { chat_id: chatId, message_id: message.message_id });

  if (text === KEY_CLOSE) {
    const state = await storeCall(env, { op: "kbset", userId, kb: null });
    await dropTap();
    if (state?.previous?.msgId) {
      await telegram(env, "deleteMessage", { chat_id: chatId, message_id: state.previous.msgId });
    }
    await telegram(env, "sendMessage", {
      chat_id: chatId,
      text: "تم إخفاء الكيبورد القبطي. أرسل /keyboard لإظهاره من جديد.",
      reply_markup: { remove_keyboard: true },
    });
    return;
  }

  const step = await storeCall(env, { op: "kbstep", userId, input: text });
  if (!step.active) {
    // A leftover keyboard button with no active session: start a fresh session.
    await dropTap();
    await startKeyboard(env, chatId, userId);
    return;
  }
  await dropTap();

  if (text === KEY_SEARCH) {
    const query = step.word.trim();
    if (!query) {
      await telegram(env, "sendMessage", { chat_id: chatId, text: "اكتب كلمة أولًا باستخدام الحروف ثم اضغط «🔎 بحث»." });
      return;
    }
    await showTyping(env, chatId);
    await sendSearch(env, chatId, query);
    // Continue below the results with a fresh, empty composition message.
    const sent = await telegram(env, "sendMessage", { chat_id: chatId, text: keyboardText("") });
    await storeCall(env, { op: "kbset", userId, kb: { word: "", msgId: sent?.result?.message_id ?? null } });
    return;
  }

  if (step.word === step.previous) return;
  const edit = await telegram(env, "editMessageText", {
    chat_id: chatId,
    message_id: step.msgId,
    text: keyboardText(step.word),
  });
  if (!edit?.ok && !String(edit?.description ?? "").includes("not modified")) {
    // The composition message was deleted by the user: recreate it.
    const sent = await telegram(env, "sendMessage", { chat_id: chatId, text: keyboardText(step.word) });
    await storeCall(env, { op: "kbset", userId, kb: { word: step.word, msgId: sent?.result?.message_id ?? null } });
  }
}

function adminIds(env) {
  return String(env.ADMIN_CHAT_ID ?? DEFAULT_ADMIN_IDS).split(",").map((item) => item.trim()).filter(Boolean);
}

function isAdmin(env, userId) {
  return adminIds(env).includes(String(userId));
}

// Who recorded: full (three-part) name when registered, else the Telegram name; plus Telegram id and username.
function recorderInfo(from, user, userId) {
  return {
    name: String(user?.name || displayName(from)).trim(),
    id: String(userId ?? from?.id ?? ""),
    username: from?.username ?? "",
  };
}

function displayName(person) {
  return [person?.first_name, person?.last_name].filter(Boolean).join(" ").trim() || "بدون اسم";
}

async function notifyAdmins(env, text) {
  for (const id of adminIds(env)) {
    await telegram(env, "sendMessage", { chat_id: id, text, parse_mode: "HTML" });
  }
}

function voicePrompt(item) {
  if (!item) return "✅ اكتمل تسجيل النطق لكل كلمات القاموس.";
  const lines = [
    "🎙️ تسجيل نطق كلمة جديدة",
    `الكلمة: <b>${escapeHtml(item.coptic || "—")}</b>`,
  ];
  if (item.total) lines.push(`المسجّل: ${item.recorded ?? 0} من ${item.total}`);
  if (item.pronunciation) lines.push(`النطق المكتوب: ${escapeHtml(item.pronunciation)}`);
  if (item.english) lines.push(`الإنجليزية: ${escapeHtml(item.english)}`);
  if (item.meaning) lines.push(`المعنى: ${escapeHtml(String(item.meaning).split(/\s*[،,]\s*/u)[0])}`);
  lines.push("أرسل الآن Voice من تيليجرام لهذه الكلمة. لإيقاف الجلسة أرسل /record_stop.");
  return lines.join("\n");
}

async function nextVoicePrompt(env, chatId, userId, user) {
  const item = await storeCall(env, { op: "voiceNext" });
  if (!item) {
    await saveUser(env, userId, { ...user, voiceRec: undefined });
    await telegram(env, "sendMessage", { chat_id: chatId, text: voicePrompt(null), parse_mode: "HTML" });
    return;
  }
  await saveUser(env, userId, { ...user, voiceRec: { id: item.id } });
  await telegram(env, "sendMessage", { chat_id: chatId, text: voicePrompt(item), parse_mode: "HTML" });
}

async function beginVoiceRecording(env, chatId, userId, user) {
  await nextVoicePrompt(env, chatId, userId, user ?? {});
}

async function captureVoiceRecording(env, message, userId, user, ctx) {
  if (!message.voice) {
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "أرسل تسجيلًا كـ Voice من تيليجرام، وليس ملف Audio." });
    return;
  }
  // Older sessions stored a row number; map it to the word's permanent id once.
  const id = user.voiceRec?.id ?? records[Number(user.voiceRec?.index)]?.id;
  const record = records[recordIndexById().get(id)];
  if (id == null || !record) {
    await beginVoiceRecording(env, message.chat.id, userId, user);
    return;
  }
  await storeCall(env, {
    op: "put",
    key: voiceKey(id),
    value: { fileId: message.voice.file_id, duration: message.voice.duration ?? null, savedAt: new Date().toISOString() },
  });
  const archive = archiveAndReport(env, message.chat.id, {
    id,
    record,
    fileId: message.voice.file_id,
    duration: message.voice.duration,
    by: recorderInfo(message.from, user, userId),
  });
  await telegram(env, "sendMessage", {
    chat_id: message.chat.id,
    text: `✅ تم حفظ تسجيل <b>${escapeHtml(record.coptic ?? "الكلمة")}</b>.`,
    parse_mode: "HTML",
  });
  await nextVoicePrompt(env, message.chat.id, userId, user);
  await inBackground(ctx, archive);
}

async function stopVoiceRecording(env, chatId, userId, user) {
  await saveUser(env, userId, { ...user, voiceRec: undefined });
  await telegram(env, "sendMessage", { chat_id: chatId, text: "⏸️ تم إيقاف جلسة التسجيل. أرسل /record لاستكمالها من أول كلمة غير مسجلة." });
}

async function registerOnFirstContact(env, message, userId) {
  if (isAdmin(env, userId) || (message.chat.type ?? "private") !== "private" || !env.USERS) return undefined;
  let result;
  try {
    result = await storeCall(env, { op: "register", userId });
  } catch (error) {
    console.error("Register failed", error instanceof Error ? error.message : "unknown error");
    return undefined;
  }
  if (!result?.created) return result?.user;
  const from = message.from ?? {};
  await notifyAdmins(env, [
    "🆕 <b>انضم مستخدم جديد إلى البوت</b>",
    `👤 الاسم: ${escapeHtml(displayName(from))}`,
    `🔗 المعرّف: ${from.username ? `@${escapeHtml(from.username)}` : "—"}`,
    `🆔 الرقم: <code>${escapeHtml(userId)}</code>`,
    `👥 إجمالي المستخدمين: ${Number(result.total ?? 0).toLocaleString("en-US")}`,
  ].join("\n"));
  return result.user;
}

const BROADCAST_CONFIRM_MARKUP = {
  inline_keyboard: [[
    { text: "✅ تأكيد الإرسال", callback_data: "bc|go" },
    { text: "❌ إلغاء", callback_data: "bc|no" },
  ]],
};

async function beginBroadcast(env, chatId, userId, user) {
  const status = await storeCall(env, { op: "bcstatus" });
  if (status.running) {
    await telegram(env, "sendMessage", {
      chat_id: chatId,
      text: `⏳ يوجد إرسال جماعي جارٍ الآن: وصل ${status.sent} من ${status.total}. انتظر اكتماله أولًا.`,
    });
    return;
  }
  await saveUser(env, userId, { ...user, bc: "await" });
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: "📢 أرسل الآن الرسالة التي تريد إرسالها لجميع المستخدمين (نص أو صورة أو ملف…).\nلإلغاء العملية أرسل /cancel",
  });
}

async function captureBroadcast(env, message, userId, user) {
  const { count } = await storeCall(env, { op: "bccount", exclude: adminIds(env) });
  if (!count) {
    await saveUser(env, userId, { ...user, bc: undefined });
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "لا يوجد مستخدمون مسجّلون لإرسال الرسالة إليهم بعد." });
    return;
  }
  await saveUser(env, userId, { ...user, bc: { messageId: message.message_id } });
  await telegram(env, "sendMessage", {
    chat_id: message.chat.id,
    reply_to_message_id: message.message_id,
    text: `سيتم إرسال الرسالة أعلاه إلى ${count.toLocaleString("en-US")} مستخدم.\nهل تريد التأكيد؟`,
    reply_markup: BROADCAST_CONFIRM_MARKUP,
  });
}

async function handleBroadcastCallback(env, callback) {
  const answer = (extra = {}) => telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, ...extra });
  const userId = callback.from?.id;
  const chatId = callback.message?.chat?.id;
  if (!isAdmin(env, userId) || !chatId) return answer();
  const user = (await getUser(env, userId)) ?? {};
  const edit = (text) => telegram(env, "editMessageText", {
    chat_id: chatId,
    message_id: callback.message.message_id,
    text,
  });
  if (callback.data === "bc|no" || !user.bc?.messageId) {
    await saveUser(env, userId, { ...user, bc: undefined });
    await answer();
    await edit("تم إلغاء الإرسال الجماعي.");
    return;
  }
  const started = await storeCall(env, {
    op: "bcstart",
    exclude: adminIds(env),
    fromChat: chatId,
    messageId: user.bc.messageId,
  });
  await saveUser(env, userId, { ...user, bc: undefined });
  await answer();
  if (started.busy) await edit("⏳ يوجد إرسال جماعي جارٍ بالفعل.");
  else if (!started.started) await edit("لا يوجد مستخدمون لإرسال الرسالة إليهم.");
  else await edit(`🚀 بدأ الإرسال إلى ${started.total.toLocaleString("en-US")} مستخدم. سأرسل لك تقريرًا عند الانتهاء.`);
}

async function handleUpdate(update, env, ctx) {
  if (update.callback_query) {
    const callback = update.callback_query;
    if (String(callback.data ?? "").startsWith("bc|")) {
      await handleBroadcastCallback(env, callback);
      return;
    }
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });
    const pick = /^s\|(\d{1,6})(?:\|(\d{1,3}))?$/u.exec(callback.data ?? "");
    if (pick) {
      if (callback.message?.chat?.id) {
        await sendRecord(env, callback.message.chat.id, Number(pick[1]), pick[2] === undefined ? -1 : Number(pick[2]));
      }
      return;
    }
    const match = /^p\|(\d{1,6})\|(.+)$/su.exec(callback.data ?? "");
    if (!match || !callback.message?.chat?.id || !callback.message?.message_id) return;
    await sendSearch(env, callback.message.chat.id, match[2], Number(match[1]), callback.message.message_id);
    return;
  }

  const message = update.message;
  if (!message?.chat?.id) return;
  const text = String(message.text ?? "").trim();
  const userId = message.from?.id ?? message.chat.id;
  const isPrivate = (message.chat.type ?? "private") === "private";
  const known = await registerOnFirstContact(env, message, userId);
  if (isAdmin(env, userId) && isPrivate) {
    const admin = await getUser(env, userId);
    if (text === "/cancel" && admin?.bc) {
      await saveUser(env, userId, { ...admin, bc: undefined });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "تم إلغاء الإرسال الجماعي." });
      return;
    }
    if (text === "/broadcast") {
      await beginBroadcast(env, message.chat.id, userId, admin ?? {});
      return;
    }
    if (text === "/drive") {
      await telegram(env, "sendMessage", {
        chat_id: message.chat.id,
        text: await driveStatusText(env),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      return;
    }
    if (text === "/syncdrive") {
      await inBackground(ctx, syncPendingVoices(env, message.chat.id, recorderInfo(message.from, admin, userId)));
      return;
    }
    if (text === "/setdrive" || text.startsWith("/setdrive ")) {
      await setDriveConfig(env, message, text.slice("/setdrive".length).trim());
      return;
    }
    if (text === "/record" || text === "/record_voice") {
      await beginVoiceRecording(env, message.chat.id, userId, admin ?? {});
      return;
    }
    if (text === "/record_stop") {
      await stopVoiceRecording(env, message.chat.id, userId, admin ?? {});
      return;
    }
    if (admin?.voiceRec && (message.voice || message.audio)) {
      await captureVoiceRecording(env, message, userId, admin, ctx);
      return;
    }
    if (admin?.bc === "await" && !text.startsWith("/")) {
      await captureBroadcast(env, message, userId, admin);
      return;
    }
  }
  if (text === "/start" || text.startsWith("/start ")) {
    if (!env.USERS) {
      // No user store bound: registration is unavailable, so fall back to the plain help text.
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: HELP_TEXT });
      return;
    }
    const user = known ?? await getUser(env, userId);
    if (user?.name) {
      await sendWelcome(env, message.chat.id, user.name);
      return;
    }
    await saveUser(env, userId, { ...user, awaitingName: true });
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: FIRST_TIME_TEXT });
    return;
  }
  if (text === "/keyboard" || text === "/k") {
    await startKeyboard(env, message.chat.id, userId);
    return;
  }
  if (text === "/help") {
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: HELP_TEXT });
    return;
  }
  if (text === "/stats") {
    await telegram(env, "sendMessage", {
      chat_id: message.chat.id,
      text: `عدد سجلات القاموس المفهرسة: ${records.length.toLocaleString("en-US")}`,
    });
    return;
  }
  if (message.voice || message.audio) {
    await telegram(env, "sendMessage", {
      chat_id: message.chat.id,
      text: "البحث الصوتي غير متاح في الاستضافة المجانية الحالية. اكتب الكلمة نصيًا للبحث.",
    });
    return;
  }
  if (text.startsWith("/")) {
    await telegram(env, "sendMessage", {
      chat_id: message.chat.id,
      text: "اكتب الكلمة مباشرة للبحث، أو استخدم /keyboard للكيبورد القبطي و/start للمساعدة و/stats لعدد السجلات.",
    });
    return;
  }
  if (text) {
    const user = known ?? await getUser(env, userId);
    if (user?.awaitingName) {
      if (!isValidFullName(text)) {
        await telegram(env, "sendMessage", { chat_id: message.chat.id, text: NAME_RETRY_TEXT });
        return;
      }
      const name = text.replace(/\s+/gu, " ").trim();
      await saveUser(env, userId, { ...user, name, awaitingName: undefined, registeredAt: new Date().toISOString() });
      await sendWelcome(env, message.chat.id, name);
      if (!isAdmin(env, userId)) {
        await notifyAdmins(env, `✅ أكمل التسجيل: <b>${escapeHtml(name)}</b> (🆔 <code>${escapeHtml(userId)}</code>)`);
      }
      return;
    }
    if (user?.kb && isKeyboardInput(text)) {
      await handleKeyboardInput(env, message, userId);
      return;
    }
    if (KEYBOARD_CONTROLS.has(text)) {
      // Leftover keyboard button after a restart/close: reopen a session instead of searching the label.
      await handleKeyboardInput(env, message, userId);
      return;
    }
    await showTyping(env, message.chat.id);
    await sendSearch(env, message.chat.id, text);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response("Coptic dictionary bot is ready.", { status: 200 });
    }

    if (request.method === "POST" && url.pathname === "/__setup") {
      if (!env.TELEGRAM_BOT_TOKEN || !env.WEBHOOK_SECRET ||
          request.headers.get("x-setup-secret") !== env.WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      const result = await telegram(env, "setWebhook", {
        url: `${url.origin}/webhook`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
      });
      return Response.json(result, { status: result.ok ? 200 : 502 });
    }

    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }
    if (!env.TELEGRAM_BOT_TOKEN || !env.WEBHOOK_SECRET ||
        request.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const update = await request.json();
      await handleUpdate(update, env, ctx);
      return new Response("ok", { status: 200 });
    } catch (error) {
      console.error("Webhook update failed", error instanceof Error ? error.message : "unknown error");
      // Return 200 so Telegram does not retry a malformed update indefinitely.
      return new Response("ok", { status: 200 });
    }
  },
};
