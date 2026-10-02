import records from "../data/dictionary.json" with { type: "json" };

const BOT_TITLE = "📖 القاموس القبطي البحيري";
const PAGE_SIZE = 1;
const MAX_MESSAGE_LENGTH = 3900;
const QUERY_PREFIX = "🔎 نتائج البحث عن: ";

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

const SEARCH_TEXT = records.map((record) => normalize(Object.values(record).join(" ")));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatRecord(record) {
  const fields = [
    ["الكلمة", "coptic"],
    ["المعنى", "meaning"],
    ["النوع", "kind"],
    ["الأصل", "origin"],
  ];
  const lines = [];
  for (const [label, key] of fields) {
    const value = String(record[key] ?? "").trim();
    if (value) lines.push(`<b>${label}:</b> ${escapeHtml(value)}`);
  }
  return lines.join("\n");
}

function findMatches(query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  const matches = [];
  for (let index = 0; index < SEARCH_TEXT.length; index += 1) {
    if (SEARCH_TEXT[index].includes(normalizedQuery)) matches.push(index);
  }
  return matches;
}

function render(query, matches, requestedPage) {
  const totalPages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, totalPages - 1));
  const start = page * PAGE_SIZE;
  const record = records[matches[start]];
  const heading = `${BOT_TITLE}\n🔎 <b>نتائج البحث عن:</b> ${escapeHtml(query)}\n` +
    `<b>النتائج:</b> ${matches.length.toLocaleString("en-US")} | <b>الصفحة:</b> ${page + 1}/${totalPages}\n\n`;
  const text = `${heading}${formatRecord(record)}`.slice(0, MAX_MESSAGE_LENGTH);
  const navigation = [];
  if (page > 0) navigation.push({ text: "السابق", callback_data: `p|${page - 1}` });
  if (page < totalPages - 1) navigation.push({ text: "التالي", callback_data: `p|${page + 1}` });
  return {
    page,
    record,
    text,
    reply_markup: navigation.length ? { inline_keyboard: [navigation] } : undefined,
  };
}

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

async function sendSearch(env, chatId, query, page = 0, messageId = undefined) {
  const cleanQuery = String(query ?? "").replace(/[\r\n]+/gu, " ").trim().slice(0, 160);
  const matches = findMatches(cleanQuery);
  if (!matches.length) {
    const text = `لم أجد نتائج لـ <b>${escapeHtml(cleanQuery)}</b>.\nجرّب القبطية أو العربية أو الإنجليزية أو تهجئة أقرب.`;
    if (messageId === undefined) {
      return telegram(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
    }
    return telegram(env, "editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML" });
  }
  const result = render(cleanQuery, matches, page);
  const payload = {
    chat_id: chatId,
    text: result.text,
    parse_mode: "HTML",
    ...(result.reply_markup ? { reply_markup: result.reply_markup } : {}),
  };
  const response = messageId === undefined
    ? await telegram(env, "sendMessage", payload)
    : await telegram(env, "editMessageText", { ...payload, message_id: messageId });
  await sendWordVoice(env, chatId, result.record);
  return response;
}

function queryFromMessage(message) {
  const text = String(message?.text ?? "");
  const line = text.split("\n").find((item) => item.startsWith(QUERY_PREFIX));
  return line ? line.slice(QUERY_PREFIX.length).trim() : "";
}

async function handleUpdate(update, env) {
  if (update.callback_query) {
    const callback = update.callback_query;
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });
    const match = /^p\|(\d{1,6})$/u.exec(callback.data ?? "");
    const query = queryFromMessage(callback.message);
    if (!match || !query || !callback.message?.chat?.id || !callback.message?.message_id) return;
    await sendSearch(env, callback.message.chat.id, query, Number(match[1]), callback.message.message_id);
    return;
  }

  const message = update.message;
  if (!message?.chat?.id) return;
  const text = String(message.text ?? "").trim();
  if (text === "/start" || text.startsWith("/start ") || text === "/help") {
    await telegram(env, "sendMessage", {
      chat_id: message.chat.id,
      text: `${BOT_TITLE}\n\nأهلًا بك في القاموس.\n\nاكتب الكلمة مباشرة، مثل:\nⲁⲛⲁⲩ\nwater\nماء\n\nسأبحث في القبطية والعربية والإنجليزية والنطق والتهجئة.`,
    });
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
  if (text) await sendSearch(env, message.chat.id, text);
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
