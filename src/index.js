import records from "../data/dictionary.json" with { type: "json" };

const BOT_TITLE = "📖 القاموس القبطي البحيري";
const PAGE_SIZE = 1;
const MAX_MESSAGE_LENGTH = 3900;
const CALLBACK_DATA_MAX_BYTES = 64;
const DEFAULT_WELCOME_PHOTO_URL =
  "https://raw.githubusercontent.com/abr429701-oss/coptic-dictionary-bot/main/assets/welcome.jpg";
const FIRST_TIME_TEXT =
  "مرحبًا بك! يبدو أنك تستخدم البوت لأول مرة, الرجاء إدخال اسمك ثلاثي للبدء في استخدام القاموس القبطي الناطق";
const NAME_RETRY_TEXT = "الرجاء إدخال اسمك ثلاثيًا (ثلاث كلمات على الأقل) بالحروف فقط، مثل: مينا جرجس بشرى.";
const HELP_TEXT = `${BOT_TITLE}\n\nأهلًا بك في القاموس.\n\nاكتب الكلمة مباشرة، مثل:\nⲁⲛⲁⲩ\nwater\nماء\n\nسأبحث في القبطية والعربية والإنجليزية والنطق والتهجئة.\n\nاكتب حرفًا أو حرفين لتظهر لك اقتراحات بالكلمات التي تبدأ بهما.`;

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]/gu, "")
    .replace(/[أإآٱ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .replace(/\s+/gu, " ")
    .trim();
}

// Search only the sheet's own text; never derived/generated fields.
const SEARCH_FIELDS = ["coptic", "greek", "pronunciation", "english", "phonetic"];
const SEARCH_TEXT = records.map((record) => normalize(SEARCH_FIELDS.map((key) => record[key] ?? "").join(" ")));

const ARABIC_LETTER = /[\u0600-\u06ff]/u;

// Lowercase/strip marks, then keep only letters/digits separated by single spaces.
function tokens(value) {
  return normalize(value).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").trim();
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

const MEANING_TOKENS = records.map((record) => splitMeaning(record.meaning).map(tokens));

// Normalized "word starts" per record: Coptic/Greek/Latin forms and each Arabic meaning.
const PREFIX_KEYS = records.map((record) => {
  const keys = [record.coptic, record.greek, record.english, record.phonetic]
    .map((value) => normalize(value).replaceAll("`", ""));
  for (const part of splitMeaning(record.meaning)) keys.push(normalize(part));
  return keys.filter(Boolean);
});

function findPrefixMatches(normalizedQuery) {
  const matches = [];
  for (let index = 0; index < PREFIX_KEYS.length; index += 1) {
    const keys = PREFIX_KEYS[index];
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
    for (let index = 0; index < MEANING_TOKENS.length; index += 1) {
      let found = false;
      let isExact = false;
      for (const item of MEANING_TOKENS[index]) {
        if (item === needle) { isExact = true; break; }
        if (hasWholeWords(item, needle)) found = true;
      }
      if (isExact) exact.push(index);
      else if (found) matches.push(index);
    }
    return exact.concat(matches);
  }
  for (let index = 0; index < SEARCH_TEXT.length; index += 1) {
    if (SEARCH_TEXT[index].includes(normalizedQuery)) matches.push(index);
  }
  return matches;
}

const TYPING_DELAY_MS = 900;

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

async function sendWordVoice(env, chatId, record) {
  const spoken = String(record?.phonetic || record?.english || "").trim().slice(0, 200);
  if (!spoken) return;
  try {
    const ttsUrl = "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=" +
      encodeURIComponent(spoken);
    const ttsResponse = await fetch(ttsUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; CopticDictionaryBot/1.0)" },
      signal: AbortSignal.timeout(6000),
    });
    const contentType = ttsResponse.headers.get("content-type") ?? "";
    if (!ttsResponse.ok || !contentType.includes("audio")) {
      console.error("TTS fetch failed", ttsResponse.status, contentType);
      return;
    }
    const audio = await ttsResponse.arrayBuffer();
    if (!audio.byteLength) return;
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", `🔊 ${String(record.coptic ?? "").trim()} — ${spoken}`.slice(0, 1000));
    form.append("voice", new Blob([audio], { type: "audio/mpeg" }), "word.mp3");
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendVoice`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) console.error("Telegram sendVoice failed", response.status);
  } catch (error) {
    console.error("Voice failed", error instanceof Error ? error.message : "unknown error");
  }
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
  const text = formatRecord(record, matchedPartIndex(record, normalizedQuery)).slice(0, MAX_MESSAGE_LENGTH);
  const response = await deliver({ text, parse_mode: "HTML" });
  await sendWordVoice(env, chatId, record);
  return response;
}

async function sendRecord(env, chatId, index, partIndex = -1) {
  const record = records[index];
  if (!record) return;
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: formatRecord(record, partIndex).slice(0, MAX_MESSAGE_LENGTH),
    parse_mode: "HTML",
  });
  await sendWordVoice(env, chatId, record);
}

// Registered users live in one SQLite-backed Durable Object (no extra Cloudflare token permission needed).
export class UserStore {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const { op, key, value } = await request.json();
    if (op === "get") return Response.json({ value: (await this.state.storage.get(key)) ?? null });
    if (op === "put") {
      await this.state.storage.put(key, value);
      return Response.json({ ok: true });
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
  const photo = await telegram(env, "sendPhoto", {
    chat_id: chatId,
    photo: env.WELCOME_PHOTO_URL || DEFAULT_WELCOME_PHOTO_URL,
    caption,
    parse_mode: "HTML",
  });
  if (!photo?.ok) await telegram(env, "sendMessage", { chat_id: chatId, text: caption, parse_mode: "HTML" });
}

async function handleUpdate(update, env) {
  if (update.callback_query) {
    const callback = update.callback_query;
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
  if (text === "/start" || text.startsWith("/start ")) {
    if (!env.USERS) {
      // No user store bound: registration is unavailable, so fall back to the plain help text.
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: HELP_TEXT });
      return;
    }
    const user = await getUser(env, userId);
    if (user?.name) {
      await sendWelcome(env, message.chat.id, user.name);
      return;
    }
    await saveUser(env, userId, { ...user, awaitingName: true });
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: FIRST_TIME_TEXT });
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
      text: "اكتب الكلمة مباشرة للبحث، أو استخدم /start للمساعدة و/stats لعدد السجلات.",
    });
    return;
  }
  if (text) {
    const user = await getUser(env, userId);
    if (user?.awaitingName) {
      if (!isValidFullName(text)) {
        await telegram(env, "sendMessage", { chat_id: message.chat.id, text: NAME_RETRY_TEXT });
        return;
      }
      const name = text.replace(/\s+/gu, " ").trim();
      await saveUser(env, userId, { name, registeredAt: new Date().toISOString() });
      await sendWelcome(env, message.chat.id, name);
      return;
    }
    await showTyping(env, message.chat.id);
    await sendSearch(env, message.chat.id, text);
  }
}

export default {
  async fetch(request, env) {
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
      await handleUpdate(update, env);
      return new Response("ok", { status: 200 });
    } catch (error) {
      console.error("Webhook update failed", error instanceof Error ? error.message : "unknown error");
      // Return 200 so Telegram does not retry a malformed update indefinitely.
      return new Response("ok", { status: 200 });
    }
  },
};
