import records from "../data/dictionary.json" with { type: "json" };
import { translateFieldValue } from "./field-translations.js";
import cardManifest from "../data/cards.json" with { type: "json" };
import welcomeImageBase64 from "./welcome-image.js";
import { createAdminExtras } from "./admin-extra.js";
import { createAdminExtras2 } from "./admin-extra2.js";

const BOT_TITLE = "📖 القاموس القبطي البحيري";
const PAGE_SIZE = 1;
const MAX_MESSAGE_LENGTH = 3900;
const CALLBACK_DATA_MAX_BYTES = 64;
const DEFAULT_ADMIN_IDS = "813894692"; // owner chat id from data/owner_chat_id.txt; override with ADMIN_CHAT_ID
const BROADCAST_BATCH_SIZE = 4;
const BROADCAST_BATCH_DELAY_MS = 1200;
const BROADCAST_DEFAULT_PER_USER_DELAY_MS = 5000;
const BROADCAST_MAX_TRANSIENT_RETRIES = 5;

// ============================================================================
// Batch 3 admin features: word of the day, favorites, keyword auto-replies,
// daily search limits, usage alerts, broadcast templates, broadcast opt-out,
// inactive-user purge, pin management, health check, per-admin notes, uptime,
// group join/leave notices, contact admin, users CSV export, score reset.
// ============================================================================
const AUTO_REPLY_KEY = "autoreply:list";
const SEARCH_LIMIT_KEY = "searchlimit:daily";
const ALERTS_KEY = "alerts:config";
const TEMPLATES_KEY = "templates:list";
const OPTOUT_KEY = "optout:list";
const NOTES_KEY = "admin:notes";
const BOT_STARTED_AT = Date.now();
globalThis.__copticBotStartedAt = BOT_STARTED_AT;
const BOT_VERSION = "1.1.0";
const wodCache = { value: null, at: 0 };
const autoReplyCache = { value: null, at: 0 };
const searchLimitCache = { value: null, at: 0 };
const alertsCache = { value: null, at: 0 };
const templatesCache = { value: null, at: 0 };
const optOutCache = { value: null, at: 0 };
const notesCache = { value: null, at: 0 };
const lastLookup = new Map(); // chatId -> last searched record summary (favorites source)
const contactCooldown = new Map(); // userId -> last /contact timestamp
const searchCounts = new Map(); // `${userId}:${day}` -> { day, count }

// ---- Batch 4 admin features: feature flags, blacklist, whitelist, custom messages, admin audit, slow mode ----
const FEATURE_FLAGS_KEY = "admin:features";
const BLACKLIST_KEY = "admin:blacklist";
const WHITELIST_KEY = "admin:whitelist";
const WHITELIST_MODE_KEY = "admin:whitelist:mode";
const BAN_MSG_KEY = "admin:banmsg";
const MAINT_MSG_KEY = "admin:maintmsg";
const ADMIN_AUDIT_KEY = "admin:audit:actions";
const SLOW_MODE_KEY = "admin:slowmode";
const BROADCAST_CTRL_KEY = "broadcast:control";
const featureFlagsCache = { value: null, at: 0 };
const blacklistCache = { value: null, at: 0 };
const whitelistCache = { value: null, at: 0 };
const whitelistModeCache = { value: null, at: 0 };
const banMsgCache = { value: null, at: 0 };
const maintMsgCache = { value: null, at: 0 };
const slowModeCache = { value: null, at: 0 };
const FEATURE_DEFAULTS = { audio: true, cards: true, voice_transcribe: true, inline_mode: true, keyboard: true, suggestions: true, gamify: true, contact: true, wod: true, autoreply: true };
const recentSearches = []; // ring buffer of { userId, name, query, at }
const RECENT_SEARCHES_MAX = 200;
const lastUserSearchAt = new Map(); // userId -> ts (slow mode)
function pushRecentSearch(userId, name, query) {
  recentSearches.push({ userId: String(userId), name: String(name ?? "").slice(0, 40), query: String(query ?? "").slice(0, 80), at: Date.now() });
  if (recentSearches.length > RECENT_SEARCHES_MAX) recentSearches.splice(0, recentSearches.length - RECENT_SEARCHES_MAX);
}
async function featureFlags(env) { const v = await cachedDoGet(env, FEATURE_FLAGS_KEY, featureFlagsCache, {}); return v && typeof v === "object" ? v : {}; }
async function featureEnabled(env, flag) { const flags = await featureFlags(env); return flags[flag] !== false; } // default ON unless explicitly false
async function setFeatureFlag(env, flag, on) { const flags = await featureFlags(env); flags[flag] = !!on; if (env.USERS) await storeCall(env, { op: "put", key: FEATURE_FLAGS_KEY, value: flags }); invalidateCache(featureFlagsCache); }
async function blacklistedWords(env) { const v = await cachedDoGet(env, BLACKLIST_KEY, blacklistCache, []); return Array.isArray(v) ? v : []; }
async function isBlacklistedWord(env, query) { const list = await blacklistedWords(env); const q = normalize(query); return list.some((w) => q === normalize(w) || q.includes(normalize(w))); }
async function addBlacklist(env, word) { const list = await blacklistedWords(env); if (!list.includes(String(word))) list.push(String(word).slice(0, 80)); if (env.USERS) await storeCall(env, { op: "put", key: BLACKLIST_KEY, value: list.slice(-200) }); invalidateCache(blacklistCache); }
async function removeBlacklist(env, word) { const list = (await blacklistedWords(env)).filter((w) => normalize(w) !== normalize(word)); if (env.USERS) await storeCall(env, { op: "put", key: BLACKLIST_KEY, value: list }); invalidateCache(blacklistCache); }
async function whitelistUsers(env) { const v = await cachedDoGet(env, WHITELIST_KEY, whitelistCache, []); return Array.isArray(v) ? v : []; }
async function whitelistModeOn(env) { const v = await cachedDoGet(env, WHITELIST_MODE_KEY, whitelistModeCache, false); return v === true; }
async function setWhitelistMode(env, on) { if (env.USERS) await storeCall(env, { op: "put", key: WHITELIST_MODE_KEY, value: !!on }); invalidateCache(whitelistModeCache); }
async function addWhitelistUser(env, id) { const list = await whitelistUsers(env); if (!list.includes(String(id))) list.push(String(id)); if (env.USERS) await storeCall(env, { op: "put", key: WHITELIST_KEY, value: list.slice(-1000) }); invalidateCache(whitelistCache); }
async function removeWhitelistUser(env, id) { const list = (await whitelistUsers(env)).filter((x) => x !== String(id)); if (env.USERS) await storeCall(env, { op: "put", key: WHITELIST_KEY, value: list }); invalidateCache(whitelistCache); }
async function customBanMessage(env) { const v = await cachedDoGet(env, BAN_MSG_KEY, banMsgCache, ""); return typeof v === "string" ? v : ""; }
async function setBanMessage(env, text) { if (env.USERS) await storeCall(env, { op: "put", key: BAN_MSG_KEY, value: String(text ?? "").slice(0, 500) }); invalidateCache(banMsgCache); }
async function customMaintenanceMessage(env) { const v = await cachedDoGet(env, MAINT_MSG_KEY, maintMsgCache, ""); return typeof v === "string" ? v : ""; }
async function setMaintenanceMessage(env, text) { if (env.USERS) await storeCall(env, { op: "put", key: MAINT_MSG_KEY, value: String(text ?? "").slice(0, 500) }); invalidateCache(maintMsgCache); }
async function logAdminAction(env, userId, action, detail = "") {
  if (!env.USERS) return;
  try {
    const prev = ((await storeCall(env, { op: "get", key: ADMIN_AUDIT_KEY })).value ?? []);
    const list = Array.isArray(prev) ? prev : [];
    list.unshift({ at: new Date().toISOString(), admin: String(userId), action: String(action).slice(0, 60), detail: String(detail ?? "").slice(0, 200) });
    await storeCall(env, { op: "put", key: ADMIN_AUDIT_KEY, value: list.slice(0, 200) });
  } catch { /* non-critical */ }
}
async function readAdminAudit(env) { if (!env.USERS) return []; const v = ((await storeCall(env, { op: "get", key: ADMIN_AUDIT_KEY })).value ?? []); return Array.isArray(v) ? v : []; }
async function slowModeConfig(env) { const v = await cachedDoGet(env, SLOW_MODE_KEY, slowModeCache, { on: false, seconds: 5 }); return v && typeof v === "object" ? v : { on: false, seconds: 5 }; }
async function setSlowModeConfig(env, cfg) { if (env.USERS) await storeCall(env, { op: "put", key: SLOW_MODE_KEY, value: cfg }); invalidateCache(slowModeCache); }
function invalidateAllCaches() {
  for (const c of [wodCache, autoReplyCache, searchLimitCache, alertsCache, templatesCache, optOutCache, notesCache, featureFlagsCache, blacklistCache, whitelistCache, whitelistModeCache, banMsgCache, maintMsgCache, slowModeCache, gamifyCache, apiKeyCache, rateLimitCache, bansCache, maintCache, aliasCache, motdCache]) { c.value = null; c.at = 0; }
  registeredCache.clear(); commandMenuReady.clear(); lastLookup.clear();
}
async function broadcastControlState(env) { if (!env.USERS) return { paused: false }; const v = ((await storeCall(env, { op: "get", key: BROADCAST_CTRL_KEY })).value ?? { paused: false }); return v && typeof v === "object" ? v : { paused: false }; }
async function setBroadcastControl(env, state) { if (env.USERS) await storeCall(env, { op: "put", key: BROADCAST_CTRL_KEY, value: state }); }

// ---- Batch 5 admin features: aliases, MOTD, manual points ----
const ALIAS_KEY = "alias:list";
const MOTD_KEY = "motd:text";
const aliasCache = { value: null, at: 0 };
const motdCache = { value: null, at: 0 };
async function aliasList(env) { const v = await cachedDoGet(env, ALIAS_KEY, aliasCache, {}); return v && typeof v === "object" ? v : {}; }
async function setAlias(env, trigger, target) {
  const all = await aliasList(env);
  if (target) all[normalize(trigger)] = String(target).slice(0, 80);
  else delete all[normalize(trigger)];
  if (env.USERS) await storeCall(env, { op: "put", key: ALIAS_KEY, value: all });
  invalidateCache(aliasCache);
}
async function motdText(env) { const v = await cachedDoGet(env, MOTD_KEY, motdCache, ""); return typeof v === "string" ? v : ""; }
async function setMotd(env, text) { if (env.USERS) await storeCall(env, { op: "put", key: MOTD_KEY, value: String(text ?? "").slice(0, 800) }); invalidateCache(motdCache); }
// MOTD is pushed once per UTC day to each user who sends /start.
async function maybeSendMotd(env, chatId, userId) {
  try {
    const text = await motdText(env);
    if (!text) return;
    const user = await getUser(env, userId);
    const today = utcDay();
    if (user?.motdSeen === today) return;
    await telegram(env, "sendMessage", { chat_id: chatId, text: `📢 <b>رسالة اليوم</b>\n\n${escapeHtml(text)}`, parse_mode: "HTML" });
    await saveUser(env, userId, { ...(user ?? {}), motdSeen: today });
  } catch (error) { console.error("MOTD failed", error instanceof Error ? error.message : "unknown error"); }
}
// Manual points awarding (merges into the same gamify score the leaderboard reads).
async function awardPoints(env, targetId, amount) {
  if (!env.USERS) return null;
  const key = "gamify:scores";
  const all = (await storeCall(env, { op: "get", key })).value ?? {};
  const entry = all[String(targetId)] ?? { points: 0, streak: 0, lastDay: "", name: "" };
  entry.points = Math.max(0, (entry.points ?? 0) + Number(amount));
  all[String(targetId)] = entry;
  await storeCall(env, { op: "put", key, value: all });
  return entry.points;
}

// ---- Batch 5 user features: favorites, quiz, voice preference, my stats ----
const quizState = new Map(); // chatId -> { correct, options, at }
const QUIZ_TTL_MS = 15 * 60000;
function pickQuizRecord() {
  for (let tries = 0; tries < 25; tries += 1) {
    const record = records[Math.floor(Math.random() * records.length)];
    if (record?._deleted) continue;
    const meaning = splitMeaning(record.meaning ?? "")[0] ?? "";
    if (meaning.length >= 2 && meaning.length <= 60) return { record, meaning };
  }
  return null;
}
async function beginQuiz(env, chatId) {
  const picked = pickQuizRecord();
  if (!picked) { await telegram(env, "sendMessage", { chat_id: chatId, text: "تعذّر تجهيز سؤال الآن، جرّب مرة أخرى." }); return; }
  const wrong = new Set();
  while (wrong.size < 3) { const other = pickQuizRecord(); if (other && normalize(other.meaning) !== normalize(picked.meaning)) wrong.add(other.meaning); }
  const options = [...wrong].map((m) => ({ m, correct: false }));
  options.splice(Math.floor(Math.random() * 4), 0, { m: picked.meaning, correct: true });
  quizState.set(String(chatId), { correct: options.findIndex((o) => o.correct), options, at: Date.now() });
  if (quizState.size > 500) { for (const [k, v] of quizState) if (Date.now() - v.at > QUIZ_TTL_MS) quizState.delete(k); }
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: `🧠 <b>اختبار سريع!</b>\nما معنى كلمة <b>${escapeHtml(String(picked.record.coptic ?? "").slice(0, 40))}</b> ؟`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [
      [options[0], options[1]].map((o, i) => ({ text: o.m.slice(0, 24), callback_data: `qz|${i}` })),
      [options[2], options[3]].map((o, i) => ({ text: o.m.slice(0, 24), callback_data: `qz|${i + 2}` })),
    ] },
  });
}
async function handleQuizAnswer(env, callback) {
  const answer = (extra = {}) => telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, ...extra });
  const chatId = String(callback.message?.chat?.id ?? "");
  const state = quizState.get(chatId);
  if (!state || Date.now() - state.at > QUIZ_TTL_MS) {
    await answer({ text: "⌛ انتهت صلاحية السؤال. أرسل /quiz لسؤال جديد.", show_alert: true });
    return;
  }
  const chosen = Number(String(callback.data ?? "").split("|")[1]);
  const won = chosen === state.correct;
  quizState.delete(chatId);
  await answer({ text: won ? `🎉 أحسنت! المعنى الصحيح: ${state.options[state.correct].m}` : `❌ خطأ. الصحيح: ${state.options[state.correct].m}`, show_alert: true });
  await telegram(env, "editMessageText", {
    chat_id: callback.message.chat.id,
    message_id: callback.message.message_id,
    text: won ? `🎉 <b>إجابة صحيحة!</b> (${escapeHtml(callback.from?.first_name ?? "")})\n✅ ${escapeHtml(state.options[state.correct].m)}\n\nسؤال جديد: /quiz` : `❌ <b>إجابة خاطئة</b> (${escapeHtml(callback.from?.first_name ?? "")})\n✅ الصحيح: ${escapeHtml(state.options[state.correct].m)}\n\nسؤال جديد: /quiz`,
    parse_mode: "HTML",
  });
}
// Per-user voice preference: the stored word card/voice stays, only auto-sending changes.
async function voiceAutoOn(env, chatId) {
  if (!env.USERS || Number(chatId) <= 0) return true; // groups and storage-less keep the default
  const user = await getUser(env, String(chatId));
  return user?.voiceOff !== true;
}
async function userFavorites(env, userId) { const user = await getUser(env, String(userId)); return Array.isArray(user?.favs) ? user.favs.slice(0, 50) : []; }
async function addFavorite(env, userId, entry) {
  const user = await getUser(env, String(userId)) ?? {};
  const favs = Array.isArray(user.favs) ? user.favs : [];
  if (favs.some((f) => normalize(f.word) === normalize(entry.word))) return false;
  favs.push({ word: String(entry.word).slice(0, 60), meaning: String(entry.meaning ?? "").slice(0, 60), at: new Date().toISOString() });
  await saveUser(env, String(userId), { ...user, favs: favs.slice(-50) });
  return true;
}
async function removeFavorite(env, userId, word) {
  const user = await getUser(env, String(userId)) ?? {};
  const favs = (Array.isArray(user.favs) ? user.favs : []).filter((f) => normalize(f.word) !== normalize(word));
  await saveUser(env, String(userId), { ...user, favs });
  return favs.length < (user.favs?.length ?? 0);
}
async function sendMyStats(env, chatId, userId, name) {
  const [scores, history] = await Promise.all([
    env.USERS ? storeCall(env, { op: "get", key: "gamify:scores" }).then((r) => r.value ?? {}).catch(() => ({})) : Promise.resolve({}),
    getUserHistory(env, userId),
  ]);
  const entry = scores[String(userId)] ?? {};
  const todayCount = searchCounts.get(`${userId}:${utcDay()}`)?.count ?? 0;
  const favs = await userFavorites(env, userId);
  const lines = [
    `📊 <b>إحصاءاتك يا ${escapeHtml(name)}</b>`,
    `🏆 نقاطك: <b>${Number(entry.points ?? 0).toLocaleString("en-US")}</b>`,
    `🔥 أطول سلسلة: ${Number(entry.streak ?? 0)} يومًا`,
    `🔎 عمليات بحث اليوم: ${todayCount}`,
    `🕘 آخر ${history.length} بحث مخزّن (/recent لعرضها)`,
    `⭐ كلماتك المفضلة: ${favs.length} (/myfav لعرضها)`,
  ];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n"), parse_mode: "HTML" });
}

// ---- Batch 6: group rules, warnings, temp bans, hidden cards, word info, search count ----
const RULES_KEY = "group:rules";
const rulesCache = { value: null, at: 0 };
async function rulesText(env) { const v = await cachedDoGet(env, RULES_KEY, rulesCache, ""); return typeof v === "string" ? v : ""; }
async function setRulesText(env, text) { if (env.USERS) await storeCall(env, { op: "put", key: RULES_KEY, value: String(text ?? "").slice(0, 1500) }); invalidateCache(rulesCache); }
async function userWarns(env, userId) { const user = await getUser(env, String(userId)); return Array.isArray(user?.warns) ? user.warns : []; }
async function addWarn(env, userId, reason) {
  const user = (await getUser(env, String(userId))) ?? {};
  const warns = Array.isArray(user.warns) ? user.warns : [];
  warns.push({ at: new Date().toISOString(), reason: String(reason ?? "").slice(0, 120) });
  await saveUser(env, String(userId), { ...user, warns });
  return warns.length;
}
async function resetWarns(env, userId) { const user = (await getUser(env, String(userId))) ?? {}; await saveUser(env, String(userId), { ...user, warns: [] }); }
const WARN_AUTOban = 3;
// Temp bans: an expiry timestamp inside the ban entry; isBanned clears expired bans lazily.
async function tempBanUser(env, userId, hours, reason = "") {
  await banUser(env, userId, reason || `حظر مؤقت ${hours} ساعة`);
  const set = await bannedSet(env);
  const entry = set[String(userId)];
  if (entry) {
    entry.until = new Date(Date.now() + hours * 3600000).toISOString();
    if (env.USERS) await storeCall(env, { op: "put", key: "bans:list", value: set });
    invalidateCache(bansCache);
  }
}
async function wordSearchCount(env, word) {
  const key = normalize(String(word)).slice(0, 80);
  const persisted = env.USERS ? ((await storeCall(env, { op: "get", key: "analytics:snapshot" })).value ?? {}) : {};
  const total = new Map(persisted.topWords ?? []).get(key) ?? 0;
  return Number(total) + (analyticsState.topWords.get(key) ?? 0);
}
async function sendWordInfo(env, chatId, query) {
  const matches = await findMatches(query, env);
  if (!matches.length) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ لم أجد هذه الكلمة في القاموس." }); return; }
  const idx = matches[0];
  const record = records[idx];
  const voiceIds = env.USERS ? new Set((await storeCall(env, { op: "voiceIds" })).ids ?? []) : new Set();
  const fields = Object.entries(record).filter(([k, v]) => k !== "_deleted" && String(v ?? "").trim()).slice(0, 15)
    .map(([k, v]) => `• <b>${escapeHtml(k)}:</b> ${escapeHtml(String(v).slice(0, 120))}`);
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: [`🔍 <b>معلومات الكلمة</b> (صف ${idx + 2})`, `🔊 صوت مسجل: ${voiceIds.has(Number(record.id)) ? "نعم ✅" : "لا ❌"}`, "", ...fields].join("\n").slice(0, 3800),
    parse_mode: "HTML",
  });
}
async function sendHiddenCards(env, chatId) {
  const entries = env.USERS ? ((await storeCall(env, { op: "listprefix", key: "card-disabled:" })).entries ?? []) : [];
  if (!entries.length) { await telegram(env, "sendMessage", { chat_id: chatId, text: "✅ لا توجد بطاقات مخفية." }); return; }
  const lines = entries.slice(0, 40).map(({ key }) => {
    const id = Number(key.slice("card-disabled:".length));
    const record = records.find((r) => r.id === id);
    return `• ${escapeHtml(String(record?.coptic ?? `id:${id}`).slice(0, 40))} — إظهار: /card_show ${escapeHtml(String(record?.coptic ?? id))}`;
  });
  await telegram(env, "sendMessage", { chat_id: chatId, text: `🖼 <b>البطاقات المخفية</b> (${entries.length}):\n${lines.join("\n")}\n\nلإظهار الكل: /unhideall`, parse_mode: "HTML" });
}

// ---- Word of the day ----
async function wordOfTheDayConfig(env) { return await cachedDoGet(env, "wod:config", wodCache, null); }
async function setWordOfTheDay(env, value) {
  if (env.USERS) await storeCall(env, { op: "put", key: "wod:config", value });
  invalidateCache(wodCache);
}
// Sends the configured word once per UTC day, then marks the day as sent.
async function sendWordOfTheDay(env, chatId, config) {
  const matches = await findMatches(config.word, env);
  if (matches[0] == null) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: `⚠️ كلمة اليوم «${escapeHtml(String(config.word).slice(0, 60))}» غير موجودة في القاموس. اضبطها بـ /setwod <كلمة>.`, parse_mode: "HTML" });
    return;
  }
  await setWordOfTheDay(env, { ...config, lastSent: utcDay() });
  await sendRecord(env, chatId, matches[0], -1, "");
}
async function autoWordOfTheDay(env, chatId, ctx) {
  try {
    const config = await wordOfTheDayConfig(env);
    if (!config?.word || !config?.chatId || Number(config.chatId) !== Number(chatId)) return;
    if (!await featureEnabled(env, "wod")) return;
    if (config.lastSent === utcDay()) return;
    await sendWordOfTheDay(env, chatId, config);
  } catch (error) {
    console.error("Word of the day auto-post failed", error instanceof Error ? error.message : "unknown error");
  }
}

// ---- Keyword auto-replies ----
async function autoReplies(env) { const v = await cachedDoGet(env, AUTO_REPLY_KEY, autoReplyCache, []); return Array.isArray(v) ? v : []; }
async function setAutoReplies(env, list) { if (env.USERS) await storeCall(env, { op: "put", key: AUTO_REPLY_KEY, value: list.slice(-50) }); invalidateCache(autoReplyCache); }

// ---- Daily search limit (0 = unlimited) ----
async function dailySearchLimit(env) { const v = await cachedDoGet(env, SEARCH_LIMIT_KEY, searchLimitCache, 0); return Number(v) > 0 ? Number(v) : 0; }
async function setDailySearchLimit(env, max) { if (env.USERS) await storeCall(env, { op: "put", key: SEARCH_LIMIT_KEY, value: Number(max) }); invalidateCache(searchLimitCache); }
function bumpSearchCount(userId) {
  const day = utcDay();
  const key = `${userId}:${day}`;
  const current = searchCounts.get(key);
  if (current?.day === day) { current.count += 1; return current.count; }
  searchCounts.set(key, { day, count: 1 });
  if (searchCounts.size > 20000) for (const [k, v] of searchCounts) if (v.day !== day) searchCounts.delete(k);
  return 1;
}

// ---- Usage alerts ----
async function alertsConfig(env) { const v = await cachedDoGet(env, ALERTS_KEY, alertsCache, null); return v && typeof v === "object" ? v : { threshold: 0 }; }
async function setAlertsConfig(env, value) { if (env.USERS) await storeCall(env, { op: "put", key: ALERTS_KEY, value }); invalidateCache(alertsCache); }
async function maybeAlertUsage(env) {
  try {
    const config = await alertsConfig(env);
    const threshold = Number(config?.threshold ?? 0);
    if (!env.USERS || threshold <= 0 || config?.lastAlertDay === utcDay()) return;
    const report = await storeCall(env, { op: "usageReport", limit: 1 });
    const count = Number(report.days?.find((d) => d.day === utcDay())?.count ?? 0);
    if (count < threshold) return;
    await setAlertsConfig(env, { ...config, lastAlertDay: utcDay() });
    await notifyAdmins(env, `🚨 <b>تنبيه استخدام</b>\nالطلبات اليوم: <b>${Number(count).toLocaleString("en-US")}</b>\nالحد المضبوط: ${Number(threshold).toLocaleString("en-US")}`);
  } catch (error) {
    console.error("Usage alert failed", error instanceof Error ? error.message : "unknown error");
  }
}

// ---- Broadcast templates ----
async function broadcastTemplates(env) { const v = await cachedDoGet(env, TEMPLATES_KEY, templatesCache, {}); return v && typeof v === "object" ? v : {}; }
async function saveBroadcastTemplate(env, name, entry) {
  const all = await broadcastTemplates(env);
  all[String(name).slice(0, 40)] = entry;
  if (env.USERS) await storeCall(env, { op: "put", key: TEMPLATES_KEY, value: all });
  invalidateCache(templatesCache);
}

// ---- Broadcast opt-out (user choice, honored by every broadcast start) ----
async function optOutList(env) { const v = await cachedDoGet(env, OPTOUT_KEY, optOutCache, []); return Array.isArray(v) ? v.map(String) : []; }
async function setOptOut(env, userId, optedOut) {
  const list = await optOutList(env);
  const sid = String(userId);
  const next = optedOut ? [...new Set([...list, sid])] : list.filter((x) => x !== sid);
  if (env.USERS) await storeCall(env, { op: "put", key: OPTOUT_KEY, value: next });
  invalidateCache(optOutCache);
}

// ---- Per-admin private notes ----
async function adminNotes(env) { const v = await cachedDoGet(env, NOTES_KEY, notesCache, {}); return v && typeof v === "object" ? v : {}; }
async function setAdminNote(env, userId, note) {
  const all = await adminNotes(env);
  const sid = String(userId);
  if (note) all[sid] = { note: String(note).slice(0, 500), at: new Date().toISOString() };
  else delete all[sid];
  if (env.USERS) await storeCall(env, { op: "put", key: NOTES_KEY, value: all });
  invalidateCache(notesCache);
}

function formatUptime(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return days > 0 ? `${days}ي ${hours}س ${minutes}د` : hours > 0 ? `${hours}س ${minutes}د` : `${minutes}د`;
}

// ---- Health check ----
async function sendHealthCheck(env, chatId) {
  const t0 = Date.now();
  const [me, hook, stats] = await Promise.all([
    telegram(env, "getMe", {}),
    telegram(env, "getWebhookInfo", {}),
    env.USERS ? storeCall(env, { op: "adminStats" }).catch(() => null) : Promise.resolve(null),
  ]);
  const info = hook?.result ?? {};
  const lines = [
    "❤️ <b>فحص صحة البوت</b>",
    `🕒 زمن الاستجابة: <b>${Date.now() - t0}ms</b>`,
    `🤖 الاتصال بـ Telegram: ${me?.ok ? "✅ سليم" : "❌ فشل"}`,
    `🔗 الويب هوك: ${info.url ? "مضبوط ✅" : "غير مضبوط ❌"}`,
    `📥 تحديثات معلّقة: ${Number(info.pending_update_count ?? 0)}`,
    `⚠️ آخر خطأ ويب هوك: ${info.last_error_message ? escapeHtml(info.last_error_message) : "لا يوجد"}`,
    `📚 سجلات القاموس: ${records.length.toLocaleString("en-US")}`,
    `💾 التخزين: ${stats ? "✅ يستجيب" : "❌ غير متاح"}`,
    `⏱ مدة تشغيل هذه النسخة: ${formatUptime(Date.now() - BOT_STARTED_AT)}`,
  ];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n"), parse_mode: "HTML" });
}

// ---- Contact admin (user) + admin reply ----
async function deliverContactMessage(env, message, userId, body) {
  const last = contactCooldown.get(String(userId)) ?? 0;
  if (Date.now() - last < 60000) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "⏳ أرسلت رسالة للتو. انتظر دقيقة قبل رسالة أخرى." }); return false; }
  contactCooldown.set(String(userId), Date.now());
  if (contactCooldown.size > 5000) contactCooldown.clear();
  const text = [
    "📬 <b>رسالة من مستخدم</b>",
    `👤 ${escapeHtml(displayName(message.from))}${message.from?.username ? ` (@${escapeHtml(message.from.username)})` : ""}`,
    `🆔 <code>${escapeHtml(String(userId))}</code>`,
    `💬 ${escapeHtml(String(body).slice(0, 1000))}`,
  ].join("\n");
  const replyMarkup = { inline_keyboard: [[{ text: "↩️ رد سريع على هذا المستخدم", callback_data: `replyto|${userId}` }]] };
  for (const id of adminIds(env)) {
    await telegram(env, "sendMessage", { chat_id: id, text, parse_mode: "HTML", reply_markup: replyMarkup }).catch(() => null);
  }
  await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ وصلت رسالتك إلى المشرفين، سيتم الرد عليك قريبًا." });
  return true;
}
async function handleContactAdmin(env, message, userId, text) {
  if (!await featureEnabled(env, "contact")) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "📭 خاصية التواصل مع الأدمن معطلة حاليًا." }); return; }
  const body = text.slice("/contact".length).trim();
  if (!body) {
    const user = (await getUser(env, userId)) ?? {};
    await saveUser(env, userId, { ...user, awaitingContact: true });
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ اكتب رسالتك الآن وستصل إلى إدارة البوت مباشرة. (/cancel للإلغاء)" });
    return;
  }
  await deliverContactMessage(env, message, userId, body);
}
async function sendReplyToUser(env, adminChatId, target, replyText) {
  const result = await telegram(env, "sendMessage", { chat_id: Number(target), text: `📬 رسالة من إدارة البوت:\n\n${escapeHtml(String(replyText).slice(0, 2500))}`, parse_mode: "HTML" });
  await telegram(env, "sendMessage", { chat_id: adminChatId, text: result?.ok ? "✅ تم إرسال الرد." : "❌ تعذّر الإرسال — ربما حظر المستخدم البوت." });
}
async function handleAdminReply(env, message, text) {
  const parts = text.split(/\s+/u);
  const target = parts[1] ?? "";
  const reply = text.slice("/reply".length + target.length + 1).trim();
  if (!/^\d+$/u.test(target) || !reply) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /reply <user_id> <نص الرد>\nأو اضغط زر «↩️ رد سريع» على رسالة المستخدم مباشرة." }); return; }
  await sendReplyToUser(env, message.chat.id, target, reply);
}

// ---- Template broadcast confirmation (tpl| callbacks) ----
async function handleTemplateCallback(env, callback) {
  const answer = (extra = {}) => telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, ...extra });
  const chatId = callback.message?.chat?.id;
  if (!isAdmin(env, callback.from?.id) || !chatId) return answer();
  const [, action, name = ""] = String(callback.data ?? "").split("|");
  const templates = await broadcastTemplates(env);
  const tpl = templates[name];
  if (action === "no" || !tpl?.messageId) {
    await answer();
    await telegram(env, "editMessageText", { chat_id: chatId, message_id: callback.message.message_id, text: "تم الإلغاء." });
    return;
  }
  const started = await storeCall(env, { op: "bcstart", exclude: [...adminIds(env), ...(await optOutList(env))], fromChat: tpl.chatId, messageId: tpl.messageId });
  await answer();
  await telegram(env, "editMessageText", {
    chat_id: chatId,
    message_id: callback.message.message_id,
    text: started.busy ? "⏳ يوجد إرسال جماعي جارٍ بالفعل." : !started.started ? "لا يوجد مستخدمون لإرسال الرسالة إليهم." : `🚀 بدأ الإرسال إلى ${Number(started.total).toLocaleString("en-US")} مستخدم. سأرسل تقريرًا عند الانتهاء.`,
  });
}
const FIRST_TIME_TEXT =
  "مرحبًا بك! يبدو أنك تستخدم البوت لأول مرة، الرجاء إدخال اسمك بدون رموز للبدء في استخدام القاموس القبطي الناطق.";
const NAME_RETRY_TEXT = "الرجاء إدخال اسمك صحيحاً بالحروف فقط بدون رموز ولا أرقام.";
const HELP_TEXT = `${BOT_TITLE}\n\nأهلًا بك في القاموس.\n\nاكتب الكلمة مباشرة، مثل:\nⲁⲛⲁⲩ\nwater\nماء\n\nسأبحث في القبطية والعربية والإنجليزية والفرنسية والألمانية والنطق.\n\nاكتب الكلمة أو أول حروفها لتظهر لك اقتراحات بالكلمات التي تبدأ بها.`;

const ACCENT_MAP = { ὲ: "ⲉ", έ: "ⲉ", ὶ: "ⲓ", ί: "ⲓ", ὸ: "ⲟ", ό: "ⲟ", ὼ: "ⲱ", ώ: "ⲱ", ὴ: "ⲏ", ή: "ⲏ", ὰ: "ⲁ", ά: "ⲁ", ὺ: "ⲩ", ύ: "ⲩ" };
const ALEF_MAP = { أ: "ا", إ: "ا", آ: "ا", ٱ: "ا", ى: "ي", ة: "ه" };

const PLAIN_ASCII = /^[\x20-\x5f\x61-\x7e]*$/u;
const MARK_CHARS = /[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]/u;
const MARK_CHARS_ALL = /[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]/gu;
const FOLD_CHARS = /[أإآٱىةὲέὶίὸόὼώὴήὰάὺύ`]/u;
const FOLD_CHARS_ALL = /[أإآٱىةὲέὶίὸόὼώὴήὰάὺύ`]/gu;
const FOLD_MAP = { ...ALEF_MAP, ...ACCENT_MAP, "`": "" };

// Hot path (the search index normalizes ~130k words): plain Latin text skips every regex, other text only
// runs the replacements it actually needs.
function normalize(value) {
  const text = String(value ?? "");
  if (PLAIN_ASCII.test(text)) return text.toLowerCase().replace(/\s+/gu, " ").trim();
  let out = text.normalize("NFKC").toLowerCase();
  if (MARK_CHARS.test(out)) out = out.replace(MARK_CHARS_ALL, "");
  if (FOLD_CHARS.test(out)) out = out.replace(FOLD_CHARS_ALL, (char) => FOLD_MAP[char] ?? "");
  return out.replace(/\s+/gu, " ").trim();
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

// Recordings are linked to the word's permanent id (data/word_ids.json), never to its row position.
import { audioUrl, audioVersion, fetchHumanSpeech, fetchPrebuiltSpeech, isSingleWordOgg, HUMAN_AUDIO_VERSION, NEURAL_VOICE_VERSION } from "./neural-voice.js";
import { repeatSingleWordOgg } from "./ogg-repeat.js";
const VOICE_PREFIX = "voiceid:";
// The voice hash is part of the key, so a word whose voice was rebuilt is fetched and remembered again.
const neuralKey = (id) => `ttsid:${NEURAL_VOICE_VERSION}:${id}:${audioVersion(id)}`;
const humanKey = (id) => `ttsid:human:${HUMAN_AUDIO_VERSION}:${id}`;
const voiceKey = (id) => `${VOICE_PREFIX}${id}`;
const repeatedRecordingKey = (fileId) => `rep3:${fileId}`;
const CARD_DISABLED_PREFIX = "card-disabled:";
const cardDisabledKey = (id) => `${CARD_DISABLED_PREFIX}${id}`;
const recordIndexById = lazy(() => {
  const map = new Map();
  records.forEach((record, index) => {
    if (record.id != null && !map.has(record.id)) map.set(record.id, index);
  });
  return map;
});

const ARABIC_LETTER = /[\u0600-\u06ff]/u;
const COPTIC_LETTER = /[\u2c80-\u2cff\u03e2-\u03ef]/u;
const GREEK_LETTER = /[\u0370-\u03ff\u1f00-\u1fff]/u;
const LATIN_LETTER = /[a-z]/iu;

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
const MORE_BUTTON_TEXT = {
  ar: "اعرض المزيد من الكلمات",
  en: "Show more words",
  fr: "Afficher plus de mots",
  de: "Mehr Wörter anzeigen",
};
const UI_TEXT = {
  ar: { word: "الكلمة", meaning: "المعنى", kind: "النوع", origin: "الأصل", more: "هناك معنى آخر للكلمة التي بحثت بها", next: "اضغط هنا لعرضه", end: "انتهت المعاني المتاحة لهذه الكلمة", choose: "اختر من الاقتراحات التالية:", previous: "السابق", pageNext: "التالي", noResult: "لا توجد نتائج حالياً لهذه الكلمة." },
  en: { word: "Word", meaning: "Meaning", kind: "Part of speech", origin: "Origin", more: "There is another meaning for the word you searched", next: "Click here to view it", end: "No more meanings are available for this word", choose: "Choose from the following suggestions:", previous: "Previous", pageNext: "Next", noResult: "No results are currently available for this word." },
  fr: { word: "Mot", meaning: "Sens", kind: "Nature", origin: "Origine", more: "Il existe un autre sens pour le mot recherché", next: "Cliquez ici pour l’afficher", end: "Il n’y a plus de sens disponible pour ce mot", choose: "Choisissez parmi les suggestions suivantes :", previous: "Précédent", pageNext: "Suivant", noResult: "Aucun résultat n’est actuellement disponible pour ce mot." },
  de: { word: "Wort", meaning: "Bedeutung", kind: "Wortart", origin: "Herkunft", more: "Es gibt eine weitere Bedeutung für das gesuchte Wort", next: "Hier klicken, um sie anzuzeigen", end: "Für dieses Wort sind keine weiteren Bedeutungen verfügbar", choose: "Wählen Sie aus den folgenden Vorschlägen:", previous: "Zurück", pageNext: "Weiter", noResult: "Derzeit sind keine Ergebnisse für dieses Wort verfügbar." },
};


function uiLanguage(searchKey = "") {
  const kind = searchKey ? scriptKind(normalize(searchKey)) : "ar";
  if (kind === "el") return "en";
  return UI_TEXT[kind] ? kind : "ar";
}

function uiTextFor(searchKey = "") {
  return UI_TEXT[uiLanguage(searchKey)] ?? UI_TEXT.ar;
}

function localizedValue(value, language) {
  return translateFieldValue(value, language);
}

function splitMeaning(value) {
  return String(value ?? "").split(/\s*[،,]\s*/u).map((part) => part.trim()).filter(Boolean);
}

// Search data is generated in CI and split into small static assets so neither startup nor
// an individual request has to parse/build the full dictionary index.
const SEARCH_FIELDS = ["coptic", "pronunciation", "english", "translation_fr", "translation_de"];
const WORD_FIELDS = {
  cop: ["coptic"],
  el: [],
  en: ["english"],
  fr: ["translation_fr"],
  de: ["translation_de"],
  ar: ["meaning"],
  other: ["pronunciation"],
};
const SEARCH_INDEX_BUCKET_COUNT = 256;
const SEARCH_INDEX_ENCODER = new TextEncoder();
const SEARCH_INDEX_CACHE = new Map();
const SCRIPT_KIND_CACHE = new Map();
const EMPTY_INDEX_BUCKET = { textExact: {}, textFirst: {}, textTwoGram: {}, meaningExact: {}, meaningFirst: {}, meaningTwoGram: {} };
const MAX_CACHED_INDEX_ASSETS = 48;

function searchIndexBucket(key) {
  let hash = 0x811c9dc5;
  for (const byte of SEARCH_INDEX_ENCODER.encode(key)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash & (SEARCH_INDEX_BUCKET_COUNT - 1);
}

function cacheIndexAsset(cacheKey, promise) {
  SEARCH_INDEX_CACHE.delete(cacheKey);
  SEARCH_INDEX_CACHE.set(cacheKey, promise);
  while (SEARCH_INDEX_CACHE.size > MAX_CACHED_INDEX_ASSETS) {
    SEARCH_INDEX_CACHE.delete(SEARCH_INDEX_CACHE.keys().next().value);
  }
  promise.catch(() => {
    if (SEARCH_INDEX_CACHE.get(cacheKey) === promise) SEARCH_INDEX_CACHE.delete(cacheKey);
  });
  return promise;
}

async function loadIndexAsset(env, cacheKey, path, fallback, missingIsEmpty = false) {
  if (!env?.ASSETS) return fallback;
  const cached = SEARCH_INDEX_CACHE.get(cacheKey);
  if (cached) {
    SEARCH_INDEX_CACHE.delete(cacheKey);
    SEARCH_INDEX_CACHE.set(cacheKey, cached);
    return cached;
  }
  const pending = (async () => {
    const response = await env.ASSETS.fetch(`https://assets.local${path}`);
    if (response.status === 404 && missingIsEmpty) return fallback;
    if (!response.ok) throw new Error(`Search index asset failed (${response.status}): ${path}`);
    return response.json();
  })();
  return cacheIndexAsset(cacheKey, pending);
}

async function indexedRows(env, mapName, key) {
  const bucket = searchIndexBucket(key).toString(16).padStart(2, "0");
  const data = await loadIndexAsset(env, `terms:${bucket}`, `/search-index/terms/${bucket}.json`, EMPTY_INDEX_BUCKET);
  const map = data[mapName];
  return map && Object.hasOwn(map, key) ? map[key] : [];
}

async function findPrefixMatches(env, normalizedQuery) {
  const chars = Array.from(normalizedQuery);
  const key = chars.length === 1 ? chars[0] : chars.length === 2 ? chars.join("") : "";
  if (!key) return [];
  const assetKey = [...SEARCH_INDEX_ENCODER.encode(key)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return loadIndexAsset(env, `prefix:${assetKey}`, `/search-index/prefix/${assetKey}.json`, [], true);
}

async function wordEntries(env, kind, key) {
  const chars = Array.from(key);
  if (!chars.length) return [];
  const level = chars.length === 1 ? "one" : "two";
  const prefix = chars.slice(0, level === "one" ? 1 : 2).join("");
  const assetKey = [...SEARCH_INDEX_ENCODER.encode(prefix)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (level === "two") {
    return loadIndexAsset(env, `words:two:${kind}:${assetKey}`, `/search-index/words/two/${kind}/${assetKey}.json`, [], true);
  }
  const cacheKey = `words:one-built:${kind}:${assetKey}`;
  const cached = SEARCH_INDEX_CACHE.get(cacheKey);
  if (cached) {
    SEARCH_INDEX_CACHE.delete(cacheKey);
    SEARCH_INDEX_CACHE.set(cacheKey, cached);
    return cached;
  }
  const pending = (async () => {
    const rows = await loadIndexAsset(env, `words:rows-one:${kind}:${assetKey}`, `/search-index/words/rows-one/${kind}/${assetKey}.json`, [], true);
    const entries = new Map();
    for (const row of rows) {
      const record = records[row];
      const values = kind === "ar" ? splitMeaning(record?.meaning) : (WORD_FIELDS[kind] ?? []).flatMap((field) => splitMeaning(record?.[field]));
      for (const value of values) {
        const label = String(value ?? "").replaceAll("`", "").trim();
        const wordKey = normalize(label);
        if (!wordKey || !wordKey.startsWith(prefix)) continue;
        const entry = entries.get(wordKey);
        if (!entry) entries.set(wordKey, { key: wordKey, label, rows: [row] });
        else if (entry.rows[entry.rows.length - 1] !== row) entry.rows.push(row);
      }
    }
    return [...entries.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  })();
  return cacheIndexAsset(cacheKey, pending);
}

function cacheScriptKind(normalized, kind) {
  SCRIPT_KIND_CACHE.delete(normalized);
  SCRIPT_KIND_CACHE.set(normalized, kind);
  while (SCRIPT_KIND_CACHE.size > 512) SCRIPT_KIND_CACHE.delete(SCRIPT_KIND_CACHE.keys().next().value);
  return kind;
}

async function detectScriptKind(env, key) {
  const normalized = normalize(key);
  if (ARABIC_LETTER.test(normalized)) return "ar";
  if (COPTIC_LETTER.test(normalized)) return "cop";
  if (GREEK_LETTER.test(normalized)) return "el";
  if (!LATIN_LETTER.test(normalized)) return "other";
  const cached = SCRIPT_KIND_CACHE.get(normalized);
  if (cached) return cached;
  const kinds = ["fr", "de", "en"];
  const chars = Array.from(normalized);
  let found = "en";
  if (chars.length === 1) {
    const available = await Promise.all(kinds.map(async (kind) => {
      const initials = await loadIndexAsset(env, `word-initials:${kind}`, `/search-index/words/${kind}-initials.json`, [], true);
      return initials.includes(chars[0]);
    }));
    found = kinds.find((_, index) => available[index]) ?? "en";
  } else {
    const matches = await Promise.all(kinds.map(async (kind) => {
      const entries = await wordEntries(env, kind, normalized);
      return entries.some((entry) => entry.key === normalized || entry.key.startsWith(normalized));
    }));
    found = kinds.find((_, index) => matches[index]) ?? "en";
  }
  return cacheScriptKind(normalized, found);
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

function voiceRecordForSearch(record, searchKey) {
  if (scriptKind(normalize(searchKey)) !== "el" || record?.id == null) return record;
  const copticIndex = recordIndexById().get(record.id);
  return copticIndex == null ? record : records[copticIndex];
}

// Suggestions use the same language the user searched in; full meanings appear after tapping.
function suggestionLabel(record, normalizedQuery) {
  if (ARABIC_LETTER.test(normalizedQuery)) {
    const part = matchedPartIndex(record, normalizedQuery);
    const meanings = splitMeaning(record.meaning);
    return (meanings[part >= 0 ? part : 0] || meanings[0] || record.english || "—").trim().slice(0, 48);
  }
  if (COPTIC_LETTER.test(normalizedQuery)) return String(record.coptic ?? "").replaceAll("`", "").trim().slice(0, 48) || "—";
  const kind = scriptKind(normalizedQuery);
  if (kind === "el") return String(record.greek ?? "").replaceAll("`", "").trim().slice(0, 48) || "—";
  if (kind === "fr") return String(record.translation_fr ?? "").trim().slice(0, 48) || "—";
  if (kind === "de") return String(record.translation_de ?? "").trim().slice(0, 48) || "—";
  if (kind === "en") return String(record.english ?? "").trim().slice(0, 48) || "—";
  return String(record.greek ?? record.coptic ?? record.english ?? "—").replaceAll("`", "").trim().slice(0, 48);
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

function equalizeSuggestionLabels(labels) {
  // Telegram centers inline-button labels by default; do not add invisible padding that enlarges them.
  return labels.map((label) => String(label));
}
function renderSuggestions(query, normalizedQuery, matches, requestedPage) {
  const ui = uiTextFor(query);
  const totalPages = Math.max(1, Math.ceil(matches.length / SUGGESTION_PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, totalPages - 1));
  const slice = matches.slice(page * SUGGESTION_PAGE_SIZE, (page + 1) * SUGGESTION_PAGE_SIZE);
  const languageQuery = uiLanguage(query) === "ar" ? "" : truncateBytes(query, CALLBACK_DATA_MAX_BYTES - 18);
  const keyboard = slice.map((index) => {
    const part = matchedPartIndex(records[index], normalizedQuery);
    return [{
      text: suggestionLabel(records[index], normalizedQuery),
      callback_data: part >= 0 ? `s|${index}|${part}${languageQuery ? `|${languageQuery}` : ""}` : `s|${index}${languageQuery ? `|${languageQuery}` : ""}`,
    }];
  });
  const navigation = [];
  if (page > 0) navigation.push({ text: ui.previous, callback_data: pageCallback(page - 1, query) });
  if (page < totalPages - 1) navigation.push({ text: ui.pageNext, callback_data: pageCallback(page + 1, query) });
  if (navigation.length) keyboard.push(navigation);
  return { text: ui.choose, reply_markup: { inline_keyboard: keyboard } };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatRecord(record, partIndex = -1, searchedWord = "") {
  const parts = splitMeaning(record.meaning);
  const arabicPart = partIndex >= 0 && parts[partIndex] ? parts[partIndex] : parts.join("، ");
  // Show the user's searched word first. Any non-Coptic search (Arabic,
  // English, Greek, etc.) must show the Coptic headword as its counterpart;
  // only a Coptic search shows the Arabic meaning parts.
  const isCopticSearch = searchedWord === "" || scriptKind(normalize(searchedWord)) === "cop";
  const language = isCopticSearch ? "ar" : uiLanguage(searchedWord);
  const labels = UI_TEXT[language] ?? UI_TEXT.ar;
  // Headword shown to the user:
  //   - Coptic search -> the dictionary Coptic spelling (keeps jinkim/diacritics)
  //   - Arabic search -> the matching Arabic meaning FROM THE SHEET (keeps full tashkeel),
  //     not the user's bare typed query
  //   - other languages -> the user's typed query
  const displayedWord = isCopticSearch
    ? String(record.coptic ?? "").trim() || searchedWord
    : (language === "ar" ? arabicPart : searchedWord) || record.coptic;
  const fields = !isCopticSearch
    ? [
        [labels.word, displayedWord],
        [labels.meaning, record.coptic],
        [labels.kind, localizedValue(record.kind, language)],
        [labels.origin, localizedValue(record.origin, language)],
      ]
    : [
        [UI_TEXT.ar.word, displayedWord],
        [UI_TEXT.ar.meaning, arabicPart],
        [UI_TEXT.ar.kind, record.kind],
        [UI_TEXT.ar.origin, record.origin],
      ];
  const lines = [];
  for (const [label, raw] of fields) {
    const value = String(raw ?? "").trim();
    if (value) lines.push(`<b>${label}:</b> ${escapeHtml(value)}`);
  }
  return lines.join("\n");
}

const SAME_WORD_FIELDS = ["coptic", "english", "translation_fr", "translation_de"];

// Rows sharing a normalized Coptic or translation value, built once instead of scanning every row per lookup.
const sameWordRows = lazy(() => {
  const map = new Map();
  records.forEach((record, row) => {
    for (const field of SAME_WORD_FIELDS) {
      const value = normalize(record[field] ?? "");
      if (!value) continue;
      const list = map.get(value);
      if (!list) map.set(value, [row]);
      else if (list[list.length - 1] !== row) list.push(row);
    }
  });
  return map;
});

// Every row that is the same dictionary word as `index`, in sheet order.
function groupRows(index) {
  const base = records[index];
  const rows = new Set();
  for (const field of SAME_WORD_FIELDS) {
    const value = normalize(base?.[field] ?? "");
    if (value) for (const row of sameWordRows().get(value) ?? []) rows.add(row);
  }
  return [...rows].sort((a, b) => a - b);
}

// Keep meanings separate. The first option is the meaning that matched the query;
// following options are exposed one at a time through an inline button.
function meaningOptions(index, normalizedQuery = "", preferredPart = -1) {
  const base = records[index];
  if (!base) return [];
  const group = groupRows(index).map((row) => ({ record: records[row], row }));
  const options = [];
  const add = (row, part) => {
    const partText = splitMeaning(records[row]?.meaning)[part] ?? "";
    const key = normalize(partText) || `${row}:${part}`;
    if (!options.some((item) => item.key === key)) options.push({ key, index: row, part });
  };
  const firstPart = preferredPart >= 0 ? preferredPart : matchedPartIndex(base, normalizedQuery);
  if (firstPart >= 0) add(index, firstPart);
  else if (splitMeaning(base.meaning).length) add(index, 0);
  for (const { record, row } of group) {
    const parts = splitMeaning(record.meaning);
    for (let part = 0; part < parts.length; part += 1) add(row, part);
  }
  return options;
}

// The button walks one fixed list of meanings: each meaning is shown once, and the last one has no button.
// callback: n|<word row>|<first meaning part>|<step to show next>  (the list is rebuilt the same way every time).
function moreMeaning(options, baseIndex, nextStep = 1, callbackFor = undefined, keepSize = false, language = "ar") {
  // Keep a blank terminal button so the last result has the same visual footprint.
  if (options.length <= nextStep) {
    return { reply_markup: { inline_keyboard: [[{ text: "\u2007", callback_data: "noop" }]] } };
  }
  const firstPart = Math.max(0, options[0].part);
  const data = callbackFor?.(nextStep) ?? `n|${baseIndex}|${firstPart}|${nextStep}`;
  return {
    reply_markup: { inline_keyboard: [[{ text: MORE_BUTTON_TEXT[language] ?? MORE_BUTTON_TEXT.ar, callback_data: data }]] },
  };
}

// ---- Search like the original Apps Script bot ----
// 1) the typed word is an exact word -> show it (other meanings behind one button, each shown once);
// 2) otherwise -> the unique words that start with what was typed, as buttons; tapping one shows it.
function scriptKind(key) {
  if (ARABIC_LETTER.test(key)) return "ar";
  if (COPTIC_LETTER.test(key)) return "cop";
  if (GREEK_LETTER.test(key)) return "el";
  if (LATIN_LETTER.test(key)) {
    const normalized = normalize(key);
    return SCRIPT_KIND_CACHE.get(normalized) ?? "en";
  }
  return "other";
}

// Unique words starting with `key`, in sheet order.
async function prefixWords(env, kind, key, limit = 5000) {
  const sorted = await wordEntries(env, kind, key);
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid].key < key) low = mid + 1;
    else high = mid;
  }
  const found = [];
  for (let i = low; i < sorted.length && found.length < limit && sorted[i].key.startsWith(key); i += 1) found.push(sorted[i]);
  return found.sort((a, b) => a.rows[0] - b.rows[0]);
}

// Every meaning to show for an exact word, once each, in order.
// Sheet headwords often carry a gender marker, e.g. "ⲁⲃⲱⲕ (ⲡ)". A user typing the bare word
// must still land on that entry, so the exact lookup also accepts the headword without it.
function bareHeadword(value) {
  return normalize(value).replace(/\s*\([^)]*\)/gu, " ").replace(/\s+/gu, " ").trim();
}

async function exactChain(env, kind, key) {
  const entries = await wordEntries(env, kind, key);
  const entry = entries.find((item) => item.key === key) ?? entries.find((item) => item.key !== key && bareHeadword(item.key) === key);
  if (!entry) return [];
  const options = [];
  const seen = new Set();
  if (kind === "ar") {
    // Arabic search: one entry per row, showing ONLY the matched meaning part.
    // "More meanings" = the same Arabic word appearing in a DIFFERENT row (different Coptic word).
    // This prevents showing sibling comma-separated meanings (e.g. "قوة، شدة") as separate buttons.
    for (const row of entry.rows) {
      const matchedPart = matchedPartIndex(records[row], key);
      if (matchedPart < 0) continue;
      const partText = splitMeaning(records[row]?.meaning)[matchedPart] ?? "";
      const uniqueKey = `${normalize(records[row]?.coptic ?? row)}|${normalize(partText)}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      // The same Arabic translation may legitimately belong to several different
      // Coptic headwords. Keep each row as a separate option instead of merging
      // them by translation text, while duplicate rows for the same headword are
      // still collapsed.
      options.push({ key: uniqueKey, index: row, part: matchedPart });
    }
  } else if (kind === "cop") {
    for (const row of entry.rows) {
      for (const option of meaningOptions(row, "", -1)) {
        if (seen.has(option.key)) continue;
        seen.add(option.key);
        options.push(option);
      }
    }
  } else {
    for (const row of entry.rows) {
      const key = normalize(records[row]?.coptic ?? row);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ key, index: row, part: -1 });
    }
  }
  return options;
}

function chainCallback(key) {
  return (step) => {
    const data = `x|${step}|${key}`;
    return new TextEncoder().encode(data).length <= CALLBACK_DATA_MAX_BYTES ? data : null;
  };
}

function renderWordSuggestions(query, words, requestedPage) {
  const ui = uiTextFor(query);
  const totalPages = Math.max(1, Math.ceil(words.length / SUGGESTION_PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, totalPages - 1));
  const keyboard = words.slice(page * SUGGESTION_PAGE_SIZE, (page + 1) * SUGGESTION_PAGE_SIZE).map((word) => [{
    text: word.label.slice(0, 48),
    callback_data: `w|${truncateBytes(word.key, CALLBACK_DATA_MAX_BYTES - 2)}`,
  }]);
  const navigation = [];
  if (page > 0) navigation.push({ text: ui.previous, callback_data: pageCallback(page - 1, query) });
  if (page < totalPages - 1) navigation.push({ text: ui.pageNext, callback_data: pageCallback(page + 1, query) });
  if (navigation.length) keyboard.push(navigation);
  return { text: ui.choose, reply_markup: { inline_keyboard: keyboard } };
}

function recordHasWholeWords(record, fields, needle) {
  if (!record) return false;
  for (const field of fields) {
    for (const value of splitMeaning(record[field])) {
      if (hasWholeWords(tokens(value), needle)) return true;
    }
  }
  return false;
}

async function findMatches(query, env) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  if (ARABIC_LETTER.test(normalizedQuery)) {
    // Arabic: match the sheet's meanings only, as whole words/phrases (never inside a longer word).
    const needle = tokens(normalizedQuery);
    if (!needle) return [];
    const words = needle.split(" ");
    const candidateKey = words.slice(0, 2).join(" ");
    const [exact, candidates, phraseRows] = await Promise.all([
      indexedRows(env, "meaningExact", needle),
      indexedRows(env, "meaningFirst", words[0]),
      words.length > 1 ? indexedRows(env, "meaningTwoGram", candidateKey) : Promise.resolve(null),
    ]);
    const exactRows = new Set(exact);
    const phraseSet = phraseRows ? new Set(phraseRows) : null;
    const matches = [];
    for (const row of candidates) {
      if (exactRows.has(row)) continue;
      if (phraseSet && !phraseSet.has(row)) continue;
      if (words.length <= 2 || recordHasWholeWords(records[row], ["meaning"], needle)) matches.push(row);
    }
    return exact.concat(matches);
  }
  const needle = toTokens(normalizedQuery);
  if (!needle) return [];
  const words = needle.split(" ");
  const candidateKey = words.slice(0, 2).join(" ");
  const [exact, candidates, phraseRows] = await Promise.all([
    indexedRows(env, "textExact", normalizedQuery),
    indexedRows(env, "textFirst", words[0]),
    words.length > 1 ? indexedRows(env, "textTwoGram", candidateKey) : Promise.resolve(null),
  ]);
  const exactRows = new Set(exact);
  const phraseSet = phraseRows ? new Set(phraseRows) : null;
  const partial = [];
  for (const row of candidates) {
    if (exactRows.has(row)) continue;
    if (phraseSet && !phraseSet.has(row)) continue;
    if (words.length <= 2 || recordHasWholeWords(records[row], SEARCH_FIELDS, needle)) partial.push(row);
  }
  return exact.concat(partial);
}

const USER_COMMANDS = [
  { command: "start", description: "بدء استخدام القاموس" },
  { command: "keyboard", description: "لوحة مفاتيح قبطية لكتابة الكلمات" },
  { command: "learn", description: "بوت تعلم اللغة القبطية من الصفر" },
  { command: "contact", description: "إرسال رسالة إلى مشرفي البوت" },
  { command: "quiz", description: "اختبار سريع في المفردات" },
  { command: "fav", description: "حفظ آخر كلمة بحثت عنها" },
  { command: "myfav", description: "كلماتك المفضلة" },
  { command: "mystats", description: "إحصاءاتك ونقاطك" },
  { command: "recent", description: "آخر عمليات بحثك" },
  { command: "voiceon", description: "تشغيل إرسال النطق تلقائيًا" },
  { command: "voiceoff", description: "إيقاف إرسال النطق تلقائيًا" },
];
const ADMIN_COMMANDS = [
  ...USER_COMMANDS,
  { command: "admin", description: "لوحة تحكم الأدمن" },
  { command: "health", description: "فحص صحة البوت" },
  { command: "uptime", description: "مدة تشغيل البوت" },
  { command: "note", description: "ملاحظة خاصة للأدمن" },
  { command: "setwod", description: "ضبط كلمة اليوم" },
  { command: "feature", description: "مفاتيح تشغيل/إيقاف الميزات" },
  { command: "blacklist", description: "قائمة الكلمات المحظورة" },
  { command: "whitelist", description: "وضع القائمة البيضاء" },
  { command: "msg", description: "إرسال رسالة لمستخدم محدد" },
  { command: "integrity", description: "فحص سلامة القاموس" },
  { command: "topusers", description: "الأكثر نشاطًا" },
  { command: "livesearch", description: "عمليات البحث المباشرة" },
  { command: "adminaudit", description: "سجل إجراءات الأدمن" },
  { command: "slowmode", description: "الوضع البطيء العام" },
  { command: "clearcache", description: "مسح كل الكاش" },
  // ---- Extra admin pack (src/admin-extra.js) ----
  { command: "ping", description: "زمن استجابة البوت" },
  { command: "debug", description: "لقطة تشخيصية" },
  { command: "report", description: "تقرير إداري شامل" },
  { command: "syncstatus", description: "حالة مزامنة المستخدمين" },
  { command: "synctest", description: "اختبار اتصال الشيت" },
  { command: "usercount", description: "إحصاء المستخدمين" },
  { command: "growth", description: "نمو المستخدمين" },
  { command: "inactive", description: "المستخدمون الخاملون" },
  { command: "userlookup", description: "بحث عن مستخدم" },
  { command: "userdelete", description: "حذف مستخدم" },
  { command: "usernote", description: "ملاحظة عن مستخدم" },
  { command: "usernotes", description: "ملاحظات المستخدمين" },
  { command: "banlist", description: "قائمة المحظورين" },
  { command: "dicthealth", description: "صحة القاموس" },
  { command: "fieldreport", description: "امتلاء حقول القاموس" },
  { command: "randomword", description: "كلمة عشوائية" },
  { command: "wordsearch", description: "بحث إداري في القاموس" },
  { command: "topwords", description: "أكثر الكلمات بحثًا" },
  { command: "misses", description: "كلمات بلا نتائج" },
  { command: "exportcsv", description: "تصدير القاموس CSV" },
  { command: "exportfull", description: "نسخة احتياطية شاملة" },
  { command: "schedule", description: "جدولة رسالة" },
  { command: "schedules", description: "الرسائل المجدولة" },
  { command: "unschedule", description: "إلغاء رسالة مجدولة" },
  { command: "cleanup", description: "تنظيف البيانات القديمة" },
  { command: "limits", description: "الحدود والإعدادات" },
  { command: "cacheinfo", description: "حالة الكاش" },
  { command: "newhelp", description: "أوامر الأدمن الإضافية" },
  { command: "selfcheck", description: "فحص ذاتي شامل" },
  { command: "statuspage", description: "نص حالة جاهز للنشر" },
  { command: "sheetdiff", description: "فرق التخزين والشيت" },
  { command: "syncwatch", description: "مراقبة المزامنة التلقائية" },
  { command: "digest", description: "الملخص الإداري اليومي" },
  { command: "announce", description: "إعلان بمعاينة" },
  { command: "backupauto", description: "نسخة احتياطية يومية" },
  { command: "maintplan", description: "صيانة مجدولة" },
  { command: "exportaudit", description: "تصدير سجل الإجراءات" },
  { command: "exporterrors", description: "تصدير سجل الأخطاء" },
  { command: "exportmisses", description: "تصدير الكلمات المفقودة" },
  { command: "exportbans", description: "تصدير المحظورين" },
  { command: "trace", description: "تتبّع مستخدم" },
  { command: "usertimeline", description: "خط زمني لمستخدم" },
  { command: "adminscore", description: "أداء فريق الإدارة" },
  { command: "wordaudit", description: "تدقيق كلمة" },
  { command: "gapfill", description: "تعبئة حقول ناقصة" },
  { command: "searchstats", description: "إحصاءات البحث" },
  { command: "livewords", description: "الأكثر بحثًا الآن" },
  { command: "voicecoverage", description: "تغطية الأصوات" },
  { command: "a2help", description: "أوامر الحزمة الثانية" },
];
const commandMenuReady = new Set();

// Coptic inline-keyboard composer: users tap letters to build a Coptic word,
// then tap "بحث". The composed word lives in the message text itself, so no
// extra storage is needed. Letters are exactly those used in the dictionary
// (the archaic ⲋ is omitted because it never appears in the data).
const KEYBOARD_WORD_PREFIX = "الكلمة: ";
const KEYBOARD_EMPTY = "—";
const JINKIM = "\u0300";
const KEYBOARD_MAX_WORD = 48;
const COPTIC_KEYBOARD_ROWS = [
  ["\u2C81", "\u2C83", "\u2C85", "\u2C87", "\u2C89", "\u2C8D", "\u2C8F"],
  ["\u2C91", "\u2C93", "\u2C95", "\u2C97", "\u2C99", "\u2C9B", "\u2C9D"],
  ["\u2C9F", "\u2CA1", "\u2CA3", "\u2CA5", "\u2CA7", "\u2CA9", "\u2CAB"],
  ["\u2CAD", "\u2CAF", "\u2CB1", "\u03E3", "\u03E5", "\u03E7", "\u03E9"],
  ["\u03EB", "\u03ED", "\u03EF"],
];
function copticKeyboardMarkup() {
  const rows = COPTIC_KEYBOARD_ROWS.map((row) => row.map((ch) => ({ text: ch, callback_data: `kb|${ch}` })));
  rows.push([{ text: "\u25CC\u0300 جِنكِيم", callback_data: "kb|j" }]);
  rows.push([
    { text: "\u232B", callback_data: "kb|bs" },
    { text: "\uD83D\uDDD1 مسح", callback_data: "kb|cl" },
    { text: "\u2705 بحث", callback_data: "kb|go" },
    { text: "\u274C إغلاق", callback_data: "kb|xx" },
  ]);
  return { inline_keyboard: rows };
}
function keyboardComposerText(word) {
  const shown = word ? word : KEYBOARD_EMPTY;
  return `\u2328\uFE0F لوحة المفاتيح القبطية\nاضغط على الحروف لتكوين الكلمة، ثم اضغط \u2705 بحث.\n\n${KEYBOARD_WORD_PREFIX}${shown}\n\n\u232B حذف آخر حرف • \uD83D\uDDD1 مسح الكلمة • \u274C إغلاق`;
}
function extractKeyboardWord(text) {
  const line = String(text ?? "").split("\n").find((l) => l.startsWith(KEYBOARD_WORD_PREFIX));
  if (!line) return "";
  const word = line.slice(KEYBOARD_WORD_PREFIX.length).trim();
  return word === KEYBOARD_EMPTY ? "" : word;
}
async function handleKeyboardCallback(env, callback, action, ctx) {
  const message = callback.message;
  if (!message?.chat?.id || !message?.message_id) return;
  const chatId = message.chat.id;
  const messageId = message.message_id;
  const current = extractKeyboardWord(message.text);
  const edit = (text, markup) => telegram(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(markup ? { reply_markup: markup } : {}),
  });
  if (action === "xx") {
    await edit("تم إغلاق لوحة المفاتيح. أرسل /keyboard لفتحها مرة أخرى.", { inline_keyboard: [] });
    return;
  }
  if (action === "go") {
    if (!current) return;
    await edit(`\uD83D\uDD0E جارٍ البحث عن: ${current}`, { inline_keyboard: [] });
    await inBackground(ctx, sendSearch(env, chatId, current, 0, undefined, ctx));
    return;
  }
  let next = current;
  if (action === "bs") next = current.slice(0, -1);
  else if (action === "cl") next = "";
  else if (action === "j") { if (current) next = current + JINKIM; else return; }
  else next = current + action;
  if (next.length > KEYBOARD_MAX_WORD) next = next.slice(0, KEYBOARD_MAX_WORD);
  const text = keyboardComposerText(next);
  if (text !== message.text) await edit(text, copticKeyboardMarkup());
}
async function ensureCommandMenu(env, userId) {
  const admin = isAdmin(env, userId);
  const key = admin ? "admin" : "user";
  if (commandMenuReady.has(key)) return;
  const payload = { commands: admin ? ADMIN_COMMANDS : USER_COMMANDS, ...(admin ? { scope: { type: "chat", chat_id: Number(userId) } } : {}) };
  const result = await telegram(env, "setMyCommands", payload);
  if (result?.ok) commandMenuReady.add(key);
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
    if (result?.error_code === 403 || response.status === 403) {
      await markUserBlocked(env, payload?.chat_id, result.description ?? "Telegram returned 403").catch(() => {});
    }
  }
  return result;
}

// Caption under the voice sent to the user: "<meaning>. <Coptic word>. <origin>. <gender>."
// The meaning is the one the user searched for (the whole meaning when they searched by Coptic/Latin text).
function voiceCaption(record, partIndex = -1, searchedWord = "") {
  const parts = splitMeaning(record?.meaning);
  const meaning = partIndex >= 0 && parts[partIndex] ? parts[partIndex] : parts.join("، ");
  const isCopticSearch = searchedWord === "" || scriptKind(normalize(searchedWord)) === "cop";
  const language = isCopticSearch ? "ar" : uiLanguage(searchedWord);
  const labels = UI_TEXT[language] ?? UI_TEXT.ar;
  const values = isCopticSearch
    ? [[UI_TEXT.ar.meaning, meaning], [UI_TEXT.ar.word, record?.coptic], [UI_TEXT.ar.origin, record?.origin], [UI_TEXT.ar.kind, record?.kind]]
    : [[labels.word, searchedWord || record?.coptic], [labels.meaning, record?.coptic], [labels.origin, localizedValue(record?.origin, language)], [labels.kind, localizedValue(record?.kind, language)]];
  return values.map(([label, value]) => `${label}: ${String(value ?? "").replace(/\s+/gu, " ").trim().replace(/\.+$/u, "")}`)
    .map((value) => String(value ?? "").replace(/\s+/gu, " ").trim().replace(/\.+$/u, ""))
    .filter(Boolean)
    .join(". ")
    .concat(".")
    .slice(0, 1000);
}

// Admin recordings are made once; users get them repeated (same count and pause as the generated voice).
// The repeated version is uploaded once, then Telegram's file_id is remembered per recording.
async function repeatedRecording(env, fileId) {
  const times = Number(env?.VOICE_REPEATS ?? 3);
  if (!(times > 1)) return { fileId };
  try {
    if (env.USERS) {
      const cached = (await storeCall(env, { op: "get", key: repeatedRecordingKey(fileId) })).value;
      if (cached?.fileId) return { fileId: cached.fileId };
    }
    const info = await telegram(env, "getFile", { file_id: fileId });
    const filePath = info?.ok ? info.result?.file_path : null;
    if (!filePath) return { fileId };
    const response = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return { fileId };
    const original = await response.arrayBuffer();
    const repeated = repeatSingleWordOgg(original, { times, pauseMs: Number(env?.VOICE_REPEAT_PAUSE_MS ?? 700), requireMarker: false });
    if (repeated === original) return { fileId };
    return { audio: repeated, neural: true, repeatFor: fileId };
  } catch (error) {
    console.error("Repeating the recorded voice failed", error instanceof Error ? error.message : "unknown error");
    return { fileId };
  }
}

// Starts the lookup (admin recording) or speech generation right away, so it is ready when the text is sent.
// Generated Matthew audio from the audio-human branch is the default voice.
function prepareWordVoice(env, record, media = null, { skipRecorded = false } = {}) {
  return (async () => {
    if (!skipRecorded && env.USERS && record?.id != null) {
      try {
        const saved = media ? { value: (await media).voice } : await storeCall(env, { op: "get", key: voiceKey(record.id) });
        if (saved?.value?.fileId) return await repeatedRecording(env, saved.value.fileId);
      } catch (error) {
        console.error("Recorded voice lookup failed", error instanceof Error ? error.message : "unknown error");
      }
    }
    // New single-word Miguel files win over everything else; words without one yet fall back to the older voices.
    let fallbackVoice = null;
    if (record?.id != null) {
      try {
        const cached = env.USERS ? (await storeCall(env, { op: "get", key: neuralKey(record.id) })).value : null;
        if (cached?.fileId) return { fileId: cached.fileId, neural: true };
        const neural = await fetchPrebuiltSpeech(env, record);
        if (neural) {
          // Only the new single-word files are remembered by Telegram file_id; older files are never cached.
          const fresh = isSingleWordOgg(neural);
          const voice = { audio: neural, neural: true, wordId: record.id, cacheable: fresh };
          if (fresh) return voice;
          fallbackVoice = voice;
        }
      } catch (error) {
        console.error("Neural voice failed", error instanceof Error ? error.message : "unknown error");
      }
    }
    if (record?.id != null) {
      try {
        const cachedHuman = env.USERS ? (await storeCall(env, { op: "get", key: humanKey(record.id) })).value : null;
        if (cachedHuman?.fileId) return { fileId: cachedHuman.fileId, neural: true };
        const human = await fetchHumanSpeech(env, record);
        if (human) return { audio: human, neural: true, human: true, wordId: record.id };
      } catch (error) {
        console.error("Human voice failed", error instanceof Error ? error.message : "unknown error");
      }
    }
    if (fallbackVoice) return fallbackVoice;
    // No Google fallback: generated audio must come from the Polly Miguel
    // files published by GitHub Actions.
    return null;
  })();
}

// Text + voice can travel as ONE Telegram message (voice with the result as its caption),
// which is the only way both arrive at literally the same instant. VOICE_CAPTION=off
// restores the older two-message behaviour.
const voiceCaptionMode = (env) => String(env?.VOICE_CAPTION ?? "on") !== "off";

// Telegram caps captions at 1024 characters; anything longer is sent as its own message.
const CAPTION_MAX = 1024;

// Sends one prepared voice. `caption` is optional: when present the text and the voice travel
// as ONE Telegram message, so they appear at the same instant instead of as two separate updates.
async function sendPreparedVoice(env, chatId, record, prepared, partIndex = -1, searchedWord = "", caption = "", options = {}) {
  const chatText = String(caption ?? "").slice(0, CAPTION_MAX);
  let voice = await prepared;
  if (!voice) {
    // No audio at all for this word: never drop the answer, send the text so the user
    // knows the search worked and the voice is simply missing.
    if (options.textFallback) await telegram(env, "sendMessage", { chat_id: chatId, text: String(options.textFallback).slice(0, MAX_MESSAGE_LENGTH), parse_mode: "HTML" }).catch(() => null);
    return { ok: false, reason: "no-audio" };
  }
  if (voice.fileId) {
    const payload = { chat_id: chatId, voice: voice.fileId, ...(chatText ? { caption: chatText, parse_mode: "HTML" } : {}) };
    const result = await telegram(env, "sendVoice", payload);
    if (result?.ok) return { ok: true, fileId: voice.fileId, messageId: result.result?.message_id };
    // A remembered file_id can become invalid (old build, deleted file). Try one fresh send below.
    console.error("sendVoice by file_id failed", result?.description ?? "unknown");
    voice = { ...voice, fileId: undefined };
    if (!voice.audio) return { ok: false, reason: result?.description ?? "file_id rejected" };
  }
  const body = voice.audio;
  if (!body || !body.byteLength) return { ok: false, reason: "empty audio" };
  // The bytes are uploaded straight to Telegram: no redirect, no remote fetch, no silent failure.
  const mime = voice.neural || voice.human ? "audio/ogg" : "audio/mpeg";
  const filename = mime === "audio/ogg" ? "word.ogg" : "word.mp3";
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const form = new FormData();
      form.append("chat_id", String(chatId));
      if (chatText) { form.append("caption", chatText); form.append("parse_mode", "HTML"); }
      form.append("voice", new Blob([body], { type: mime }), filename);
      const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendVoice`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(20000),
      });
      const text = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      if (response.ok && parsed?.ok) {
        const sentId = parsed.result?.voice?.file_id;
        if (voice.repeatFor && env.USERS && sentId) {
          await storeCall(env, { op: "put", key: repeatedRecordingKey(voice.repeatFor), value: { fileId: sentId } }).catch(() => {});
        } else if (voice.neural && voice.cacheable !== false && voice.wordId != null && env.USERS && sentId) {
          // Remember Telegram's file_id so this word is uploaded once, then reused forever.
          await storeCall(env, { op: "put", key: voice.human ? humanKey(voice.wordId) : neuralKey(voice.wordId), value: { fileId: sentId } }).catch(() => {});
        }
        return { ok: true, fileId: sentId, messageId: parsed.result?.message_id };
      }
      lastError = parsed?.description || `HTTP ${response.status}`;
      if (response.status === 403) { await markUserBlocked(env, chatId, "sendVoice 403").catch(() => {}); return { ok: false, reason: "blocked" }; }
      // Rate limiting: Telegram tells us exactly how long to wait.
      if (response.status === 429) {
        const wait = Number(parsed?.parameters?.retry_after ?? 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 5000)));
        continue;
      }
      // 4xx other than 429 will not fix itself by retrying the same bytes.
      if (response.status >= 400 && response.status < 500) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "unknown error";
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  console.error("Voice send failed", lastError);
  return { ok: false, reason: lastError };
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
// Config comes from the APPS_SCRIPT_URL secret, or from /setdrive <url> (stored in the user store).
const DRIVE_CONFIG_KEY = "drive-config";
const ARCHIVE_CHAT_KEY = "archive-chat";
const SYNC_DRIVE_BATCH = 5;

async function driveConfig(env) {
  // An explicit admin /setdrive URL is an override; the repository secret is only the fallback.
  if (env.USERS) {
    try {
      const saved = (await storeCall(env, { op: "get", key: DRIVE_CONFIG_KEY })).value;
      if (saved?.url) return saved;
    } catch (error) {
      console.error("Drive config lookup failed", error instanceof Error ? error.message : "unknown error");
    }
  }
  return env.APPS_SCRIPT_URL ? { url: env.APPS_SCRIPT_URL } : null;
}

async function callAppsScript(config, payload) {
  const response = await fetch(config.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
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
async function pruneLocalVoices(env, deletedIds) {
  if (!env.USERS) return { removed: 0 };
  const result = await storeCall(env, { op: "voiceDeleteIds", ids: deletedIds.map(String) });
  return { removed: Number(result?.removed ?? 0) };
}
async function reconcileDrive(env) {
  const config = await driveConfig(env);
  if (!config) return { ok: false, skipped: true };
  try {
    const result = await callAppsScript(config, { action: "sync" });
    const active = Array.isArray(result.active_ids) ? result.active_ids : [];
    const deletedIds = Array.isArray(result.deleted_ids) ? result.deleted_ids : [];
    const pruned = await pruneLocalVoices(env, deletedIds);
    return { ok: true, activeIds: active, deletedIds, removed: pruned.removed };
  } catch (error) {
    console.error("Drive reconciliation failed", error instanceof Error ? error.message : "unknown error");
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}
async function deleteRemoteVoice(env, id) {
  return deleteRemoteVoices(env, { action: "delete", id });
}
async function deleteRemoteVoices(env, payload) {
  const config = await driveConfig(env);
  if (!config) return { ok: true, skipped: true };
  try { return await callAppsScript(config, { ...payload, by: { id: adminIds(env)[0] } }); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "unknown error" }; }
}
async function uploadVoiceToDrive(env, { id, record, fileId, duration, by, mimeType }) {
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
      mime_type: mimeType || "audio/ogg",
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

// New recordings are compressed by a GitHub Action (ffmpeg) before they reach Drive; the Action reports back to
// /voice-drive. Without the two secrets, or if GitHub refuses, the recording is uploaded directly as before.
const GITHUB_REPO = "abr429701-oss/coptic-dictionary-bot";

async function dispatchVoiceCompression(env, { id, record, fileId, duration, by, mimeType }) {
  if (!env.GITHUB_DISPATCH_TOKEN || !env.CALLBACK_SECRET) return false;
  try {
    if (!(await driveConfig(env))) return false;
    const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO || GITHUB_REPO}/dispatches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "coptic-dictionary-bot",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({
        event_type: "voice-recorded",
        client_payload: { id, word: record?.coptic ?? "", fileId, duration: duration ?? null, by: by ?? null, mimeType: mimeType || "audio/ogg" },
      }),
      signal: AbortSignal.timeout(10000),
    });
    return response.status === 204;
  } catch {
    return false;
  }
}

function sameSecret(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

async function archiveAndReport(env, chatId, job) {
  if (await dispatchVoiceCompression(env, job)) return;
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
    return "☁️ لم يتم ربط جوجل درايف بعد.\nأرسل: /setdrive رابط_السكريبت";
  }
  const sync = await reconcileDrive(env);
  const counts = await storeCall(env, { op: "voicepending", limit: 0 });
  const lines = [
    "☁️ <b>أرشيف جوجل درايف</b>",
    `✅ مرفوع: ${counts.uploaded}`,
    `⏳ في الانتظار: ${counts.pendingTotal}`,
    `🎙 إجمالي التسجيلات: ${counts.total}`,
    ...(sync.ok && sync.removed ? [`🧹 أزيلت من البوت بعد المصالحة: ${sync.removed}`] : []),
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
  const sync = await reconcileDrive(env);
  if (!sync.ok) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: `❌ تعذّرت مزامنة Drive/Sheet: ${sync.error ?? "unknown error"}` });
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
  const lines = [`☁️ تمت المصالحة، وأزيل من البوت: ${sync.removed ?? 0}.`, `☁️ تم رفع ${uploaded} تسجيل.`, `⏳ المتبقي: ${left}`];
  if (failure) lines.push(`❌ توقف الرفع: ${failure}`);
  else if (left) lines.push("أرسل /syncdrive مرة أخرى لمتابعة الرفع.");
  else lines.push("🎉 كل التسجيلات مرفوعة.");
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n") });
}

async function setDriveConfig(env, message, argument) {
  const input = argument.trim();
  if (input.toLowerCase() === "reset") {
    await storeCall(env, { op: "put", key: DRIVE_CONFIG_KEY, value: null });
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "تم حذف رابط /setdrive. سيستخدم البوت سرّ APPS_SCRIPT_URL إن كان مضبوطًا." });
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: await driveStatusText(env), parse_mode: "HTML", disable_web_page_preview: true });
    return;
  }
  const url = input.split(/\s+/u)[0];
  if (!/^https:\/\/script\.google\.com\/(?:macros\/s\/[\w-]+|a\/[^/\s]+\/macros\/s\/[\w-]+)\/exec$/u.test(url ?? "")) {
    await telegram(env, "sendMessage", {
      chat_id: message.chat.id,
      text: "أرسل: /setdrive ثم رابط الويب آب المنتهي بـ exec",
    });
    return;
  }
  await storeCall(env, { op: "put", key: DRIVE_CONFIG_KEY, value: { url } });
  await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "تم حفظ رابط درايف. جارٍ الاختبار…" });
  await telegram(env, "sendMessage", { chat_id: message.chat.id, text: await driveStatusText(env), parse_mode: "HTML", disable_web_page_preview: true });
}

// ---- Word cards (images drawn in GitHub Actions; see scripts/render_cards.mjs) ----
const CARDS_BASE_URL = "https://raw.githubusercontent.com/abr429701-oss/coptic-dictionary-bot/main/cards";

function cardHash(record) {
  return record?.id != null ? cardManifest[String(record.id)] ?? null : null;
}

function cardStorageKey(id, language = "ar") {
  return language === "ar" ? `card:${id}` : `card:${id}:${language}`;
}

// Only words that have a card pay for the extra lookup; it also carries the saved recording (one call).
function lookupMedia(env, record, language = "ar") {
  if (!cardHash(record)) return null;
  if (!env.USERS) return Promise.resolve({ voice: null, card: null });
  return storeCall(env, { op: "media", id: record.id, language }).catch((error) => {
    console.error("Media lookup failed", error instanceof Error ? error.message : "unknown error");
    return { voice: null, card: null };
  });
}

// Sends the entry text first, then the single supplied card image. The voice is sent by the caller.
async function sendCardEntry(env, chatId, record, text, media, replyMarkup = undefined, language = "ar") {
  // Word-card photos are disabled for now; dictionary results remain text + voice only.
  return false;
}

async function cardRecord(query, env) {
  const clean = String(query ?? "").trim();
  if (!clean) return null;
  const matches = await findMatches(clean, env);
  return records[matches[0]] ?? null;
}

async function setCardVisibility(env, chatId, query, visible) {
  const record = await cardRecord(query, env);
  if (record?.id == null || !cardHash(record)) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "لم أجد بطاقة لهذه الكلمة. أرسل الكلمة كما هي أو تأكد أن لها بطاقة." });
    return;
  }
  if (visible) {
    await storeCall(env, { op: "delete", key: cardDisabledKey(record.id) });
    await telegram(env, "sendMessage", { chat_id: chatId, text: `✅ ستظهر بطاقة «${record.coptic}» مرة أخرى في البحث التالي.` });
    await sendSearch(env, chatId, record.coptic, 0);
    return;
  }
  await storeCall(env, { op: "put", key: cardDisabledKey(record.id), value: true });
  await storeCall(env, { op: "delete", key: `card:${record.id}` });
  await telegram(env, "sendMessage", { chat_id: chatId, text: `🗑️ تم إخفاء بطاقة «${record.coptic}». ستعود فقط عند تسجيل Voice جديد أو استخدام /card_show.` });
}
function widenResultText(value, minimumWidth = 36) {
  const text = String(value ?? "");
  const currentWidth = Math.max(...text.split("\n").map((line) => [...line].length), 0);
  return currentWidth >= minimumWidth ? text : `${text}\n${"\u2007".repeat(minimumWidth - currentWidth)}`;
}
async function prepareSearch(env, chatId, query, page = 0, messageId = undefined, ctx = undefined) {
  const cleanQuery = String(query ?? "").replace(/[\r\n]+/gu, " ").trim().slice(0, 160);
  const normalizedQuery = normalize(cleanQuery);
  const deliver = (payload) => messageId === undefined
    ? telegram(env, "sendMessage", { chat_id: chatId, ...payload })
    : telegram(env, "editMessageText", { chat_id: chatId, message_id: messageId, ...payload });

  if (normalizedQuery) {
    const kind = await detectScriptKind(env, normalizedQuery);
    const isShortQuery = [...normalizedQuery.replace(/\s+/gu, "")].length <= SHORT_QUERY_MAX;
    if (messageId === undefined && !isShortQuery) {
      const chain = await exactChain(env, kind, normalizedQuery);
      if (chain.length) return () => sendOption(env, chatId, chain, chain[0].index, 0, undefined, chainCallback(cleanQuery), cleanQuery, true, ctx);
    }
    const words = await prefixWords(env, kind, normalizedQuery);
    if (words.length) {
      const view = renderWordSuggestions(cleanQuery, words, page);
      return () => deliver({ text: view.text, parse_mode: "HTML", reply_markup: view.reply_markup });
    }
  }
  const matches = await findMatches(cleanQuery, env);
  if (!matches.length) {
    trackMiss(cleanQuery);
    return () => deliver({ text: uiTextFor(cleanQuery).noResult });
  }
  if (matches.length > 1) {
    const view = renderSuggestions(cleanQuery, normalizedQuery, matches, page);
    return () => deliver({ text: view.text, parse_mode: "HTML", reply_markup: view.reply_markup });
  }
  const matchIndex = matches[0];
  return async () => {
    const options = meaningOptions(matchIndex, normalizedQuery);
    const selected = options[0] ?? { index: matchIndex, part: matchedPartIndex(records[matchIndex], normalizedQuery) };
    const record = records[selected.index];
    const cardLanguage = uiLanguage(normalizedQuery);
    const media = messageId === undefined ? lookupMedia(env, record, cardLanguage) : null;
    const voiceRecord = voiceRecordForSearch(record, normalizedQuery);
    const voice = prepareWordVoice(env, voiceRecord, media, { skipRecorded: scriptKind(normalizedQuery) === "el" });
    const more = moreMeaning(options, matchIndex, 1, undefined, true, uiLanguage(normalizedQuery));
    const text = widenResultText(`${formatRecord(record, selected.part, normalizedQuery)}${more.notice ?? ""}`).slice(0, MAX_MESSAGE_LENGTH);
    if (await sendCardEntry(env, chatId, record, text, media, more.reply_markup, cardLanguage)) {
      await sendPreparedVoice(env, chatId, voiceRecord, voice, selected.part, normalizedQuery, text, { textFallback: text });
      return undefined;
    }
    // One message: the voice carries the result as its caption, so the text and the audio can never
    // arrive separately. Long results (over the 1024-character caption cap) still fall back to a
    // separate text message, because Telegram cannot hold them in a caption.
    const audioEnabled = await featureEnabled(env, "audio");
    const autoVoice = audioEnabled ? await voiceAutoOn(env, chatId) : false;
    const captionMode = voiceCaptionMode(env);
    if (captionMode && messageId === undefined && autoVoice && text.length <= CAPTION_MAX) {
      const sent = await sendPreparedVoice(env, chatId, voiceRecord, voice, selected.part, normalizedQuery, text, { textFallback: text });
      if (sent.ok) {
        // Attach the "next meaning" button to the voice message itself.
        if (more.reply_markup) {
          await telegram(env, "editMessageReplyMarkup", {
            chat_id: chatId,
            message_id: sent.messageId ?? undefined,
            reply_markup: more.reply_markup,
          }).catch(() => null);
        }
        return { ok: true, result: { message_id: sent.messageId, caption: text } };
      }
    }
    const response = await deliver({ text, parse_mode: "HTML", ...(more.reply_markup ? { reply_markup: more.reply_markup } : {}) });
    if (messageId === undefined && autoVoice) await sendPreparedVoice(env, chatId, voiceRecord, voice, selected.part, normalizedQuery, "", { textFallback: null });
    return response;
  };
}

async function sendSearch(env, chatId, query, page = 0, messageId = undefined, ctx = undefined) {
  const sendPrepared = await prepareSearch(env, chatId, query, page, messageId, ctx);
  return sendPrepared();
}

async function sendRecord(env, chatId, index, partIndex = -1, searchKey = "") {
  if (searchKey) await detectScriptKind(env, searchKey);
  const options = searchKey && scriptKind(normalize(searchKey)) !== "cop"
    ? [{ key: String(index), index, part: -1 }]
    : meaningOptions(index, "", partIndex);
  await sendOption(env, chatId, options, index, 0, { index, part: partIndex }, undefined, searchKey);
}

// Step n of the next-meaning button: shows meaning number `step` of the word's fixed list.
async function sendMeaningStep(env, chatId, baseIndex, firstPart, step) {
  const options = meaningOptions(baseIndex, "", firstPart);
  if (!options[step]) return;
  await sendOption(env, chatId, options, baseIndex, step, undefined, undefined, "", false);
}
async function sendOption(env, chatId, options, baseIndex, step, fallback = undefined, callbackFor = undefined, searchKey = "", sendVoice = true, ctx = undefined) {
  if (searchKey) await detectScriptKind(env, searchKey);
  const selected = options[step] ?? fallback;
  const record = records[selected?.index];
  if (!record) return;
  lastLookup.set(String(chatId), { index: selected.index, coptic: String(record.coptic ?? "").slice(0, 60), meaning: String(record.meaning ?? "").slice(0, 60), at: new Date().toISOString() });
  const cardLanguage = uiLanguage(searchKey);
  const media = lookupMedia(env, record, cardLanguage);
  const voiceRecord = voiceRecordForSearch(record, searchKey);
  const isGreekSearch = scriptKind(normalize(searchKey)) === "el";
  const voice = prepareWordVoice(env, voiceRecord, media, { skipRecorded: isGreekSearch });
  const more = moreMeaning(options, baseIndex, step + 1, callbackFor ?? (searchKey ? chainCallback(searchKey) : undefined), true, uiLanguage(searchKey));
  const text = widenResultText(`${formatRecord(record, selected.part, searchKey)}${more.notice ?? ""}`).slice(0, MAX_MESSAGE_LENGTH);
  const wantVoice = sendVoice && await featureEnabled(env, "audio") && await voiceAutoOn(env, chatId);
  const captionMode = voiceCaptionMode(env);
  if (!(await sendCardEntry(env, chatId, record, text, media, more.reply_markup, cardLanguage))) {
    if (wantVoice && captionMode && text.length <= CAPTION_MAX) {
      const sent = await sendPreparedVoice(env, chatId, voiceRecord, voice, selected.part, searchKey, text, { textFallback: text });
      if (sent.ok) {
        if (more.reply_markup && sent.messageId) {
          await telegram(env, "editMessageReplyMarkup", { chat_id: chatId, message_id: sent.messageId, reply_markup: more.reply_markup }).catch(() => null);
        }
        return;
      }
    }
    await telegram(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...(more.reply_markup ? { reply_markup: more.reply_markup } : {}) });
  }
  if (wantVoice) await sendPreparedVoice(env, chatId, voiceRecord, voice, selected.part, searchKey, "", { textFallback: text });
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

  // One page of the user sync. Returns true while a job exists (so alarm() stops there).
  async syncStep() {
    const storage = this.state.storage;
    const env = this.env;
    const job = await storage.get("sync:job");
    if (!job) return false;
    try {
      const cursor = (await storage.get(USERS_SYNC_CURSOR)) ?? null;
      const pageSize = 50;
      const listPage = await storage.list({ prefix: "user:", ...(cursor ? { startAfter: cursor } : {}), limit: pageSize });
      const items = [...listPage].map(([storedKey, record]) => ({
        key: storedKey,
        id: storedKey.slice("user:".length),
        record,
      }));
      if (!items.length) { await this.finishSync(job); return true; }
      const rows = [];
      for (let c = 0; c < items.length; c += 10) {
        const chunk = items.slice(c, c + 10);
        const chunkRows = await Promise.all(chunk.map(async (item) => {
          let record = item.record ?? {};
          if (!job.fast && !record.tgName && !record.username) {
            const chat = await telegram(env, "getChat", { chat_id: item.id }).catch(() => null);
            if (chat?.ok && chat.result) {
              record = { ...record, tgName: displayNameOrEmpty(chat.result), username: chat.result.username ?? "" };
              await saveUser(env, item.id, record).catch(() => null);
            }
          }
          return userSheetRow(item.id, record);
        }));
        rows.push(...chunkRows);
      }
      const outcome = await pushUsers(env, rows);
      if (!outcome.ok) {
        job.attempts = (job.attempts ?? 0) + 1;
        job.lastError = outcome.error ?? "push failed";
        if (job.attempts >= 6) {
          await storage.delete("sync:job");
          await telegram(env, "sendMessage", {
            chat_id: job.adminChat,
            text: `❌ أُوقفت المزامنة بعد ${job.attempts} محاولات: ${job.lastError}\nتم حفظ ${job.total ?? 0} مستخدم قبل التوقف. أصلح السبب ثم أرسل /syncusers.`,
          }).catch(() => null);
          return true;
        }
        await storage.put("sync:job", job);
        const waitMs = Math.min(120000, 15000 * job.attempts);
        await storage.setAlarm(Date.now() + waitMs);
        if (job.attempts === 1) {
          await telegram(env, "sendMessage", {
            chat_id: job.adminChat,
            text: `⚠️ تعثّر رفع دفعة إلى الشيت (${job.lastError}). سأعيد المحاولة تلقائيًا بعد ${Math.round(waitMs / 1000)} ثانية من حيث توقفت.`,
          }).catch(() => null);
        }
        return true;
      }
      job.total = (job.total ?? 0) + rows.length;
      job.rounds = (job.rounds ?? 0) + 1;
      job.attempts = 0;
      job.lastError = "";
      job.lastAt = new Date().toISOString();
      // `cursor` is not exposed by every storage implementation, so the next page continues after the last key.
      const nextCursor = items.length === pageSize ? items[items.length - 1].key : null;
      if (nextCursor) {
        await storage.put(USERS_SYNC_CURSOR, nextCursor);
        await storage.put("sync:job", job);
        await storage.setAlarm(Date.now() + 25000); // sync, pause ~25s, resume
        if (job.rounds % 4 === 0) {
          await telegram(env, "sendMessage", {
            chat_id: job.adminChat,
            text: `⏳ مزامنة تلقائية: ${job.total} مستخدم حتى الآن (الجولة ${job.rounds})…`,
          }).catch(() => null);
        }
        return true;
      }
      await this.finishSync(job);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      job.attempts = (job.attempts ?? 0) + 1;
      job.lastError = message;
      console.error("syncStep failed", message);
      await storage.put("sync:job", job).catch(() => null);
      // Always reschedule: a thrown error used to leave the job without an alarm, so the sync stopped for good.
      await storage.setAlarm(Date.now() + Math.min(120000, 20000 * job.attempts)).catch(() => null);
      return true;
    }
  }

  async finishSync(job) {
    const storage = this.state.storage;
    await storage.delete(USERS_SYNC_CURSOR);
    await storage.delete("sync:job");
    await telegram(this.env, "sendMessage", {
      chat_id: job.adminChat,
      text: `✅ اكتملت المزامنة التلقائية: ${job.total ?? 0} مستخدم في ${job.rounds ?? 0} جولة. تحقّق من تبويب "users" في الشيت.`,
    }).catch(() => null);
  }

  async alarm() {
    const storage = this.state.storage;
    // Sync job: each batch runs in its own alarm invocation with fresh time limit.
    // The sync job continues one page at a time; every failure reschedules itself instead of dying.
    if (await this.syncStep()) return;
    const job = await storage.get("broadcast");
    if (!job) return;
    // Batch 4: broadcast pause/cancel control.
    const ctrl = (await storage.get("broadcast:control")) ?? { paused: false };
    if (ctrl.cancel) {
      await storage.delete("broadcast");
      await storage.delete("broadcast:control");
      await telegram(this.env, "sendMessage", { chat_id: job.adminChat, text: `🛑 تم إلغاء الإرسال الجماعي. تم إرسال ${job.sent} من ${job.total}.` });
      return;
    }
    if (ctrl.paused) { await storage.setAlarm(Date.now() + 15000); return; }
    const batch = job.queue.splice(0, BROADCAST_BATCH_SIZE);
    let delay = BROADCAST_BATCH_DELAY_MS;
    const perUserDelay = Number(await storage.get("bc:perUserDelay")) || BROADCAST_DEFAULT_PER_USER_DELAY_MS;
    for (let i = 0; i < batch.length; i += 1) {
      const id = batch[i];
      const recordFailure = (reason) => {
        job.failureReasons ??= {};
        const key = String(reason).replace(/\s+/gu, " ").slice(0, 180) || "Unknown Telegram error";
        if (Object.hasOwn(job.failureReasons, key) || Object.keys(job.failureReasons).length < 10) {
          job.failureReasons[key] = (job.failureReasons[key] ?? 0) + 1;
        } else {
          job.failureReasons["Other Telegram errors"] = (job.failureReasons["Other Telegram errors"] ?? 0) + 1;
        }
      };
      const retryTransient = (reason) => {
        const attempt = job.retryForId === id ? (job.retryCount ?? 0) + 1 : 1;
        if (attempt >= BROADCAST_MAX_TRANSIENT_RETRIES) {
          job.failed += 1;
          recordFailure(reason);
          job.retryForId = null;
          job.retryCount = 0;
          job.queue.unshift(...batch.slice(i + 1));
          return false;
        }
        job.retryForId = id;
        job.retryCount = attempt;
        job.lastError = String(reason).slice(0, 180);
        job.queue.unshift(...batch.slice(i));
        delay = Math.min(60000, 1000 * (2 ** attempt));
        return true;
      };
      let result;
      try {
        result = await telegram(this.env, "copyMessage", {
          chat_id: id,
          from_chat_id: job.fromChat,
          message_id: job.messageId,
        });
        // copyMessage handles almost every Telegram message type. Re-create a native poll
        // only when Telegram rejects the copy (for example, a quiz poll whose answer key
        // cannot be copied). The poll is fresh for each recipient; previous votes cannot
        // be transferred by the Bot API.
        if (!result?.ok && result?.error_code !== 429 && result?.error_code === 400 && job.poll) {
          result = await telegram(this.env, "sendPoll", { chat_id: id, ...job.poll });
        }
      } catch (error) {
        // Persist the successful prefix and retry transient network errors with backoff.
        const reason = error instanceof Error ? error.message : "Temporary network error";
        if (retryTransient(reason)) break;
        continue;
      }
      if (result?.ok) {
        job.sent += 1;
        if (job.retryForId === id) {
          job.retryForId = null;
          job.retryCount = 0;
        }
        await new Promise((r) => setTimeout(r, perUserDelay));
      } else if (result?.error_code === 429) {
        // Telegram asked us to slow down: put the rest back and wait.
        job.queue.unshift(...batch.slice(i));
        delay = ((result.parameters?.retry_after ?? 5) + 1) * 1000;
        break;
      } else if (Number(result?.error_code) >= 500) {
        const reason = String(result?.description ?? `Telegram error ${result.error_code}`);
        if (retryTransient(reason)) break;
        continue;
      } else {
        job.failed += 1;
        if (job.retryForId === id) {
          job.retryForId = null;
          job.retryCount = 0;
        }
        const reason = String(result?.description ?? `Telegram error ${result?.error_code ?? "unknown"}`).replace(/\s+/gu, " ").slice(0, 180);
        recordFailure(reason);
        // A 400 often means that this particular content cannot be copied. It does not
        // mean that the recipient blocked the bot, so never permanently exclude them for it.
        if (result?.error_code === 403) {
          const record = (await storage.get(`user:${id}`)) ?? {};
          await storage.put(`user:${id}`, { ...record, blocked: true });
          job.blocked = (job.blocked ?? 0) + 1;
        }
      }
    }
    if (job.queue.length) {
      await storage.put("broadcast", job);
      await storage.setAlarm(Date.now() + delay);
      return;
    }
    await storage.delete("broadcast");
    await storage.delete("broadcast:control");
    const failureLines = Object.entries(job.failureReasons ?? {}).slice(0, 3)
      .map(([reason, count]) => `• ${count}× ${reason}`);
    await telegram(this.env, "sendMessage", {
      chat_id: job.adminChat,
      text: [
        "✅ اكتمل الإرسال الجماعي.",
        `وصلت إلى: ${job.sent}`,
        `تعذّر الإرسال: ${job.failed}`,
        `استُبعدت بسبب منع البوت (403): ${job.blocked ?? 0}`,
        `الإجمالي: ${job.total}`,
        ...(failureLines.length ? ["أمثلة لأسباب الفشل:", ...failureLines] : []),
      ].join("\n").slice(0, 3500),
    });
  }

  async fetch(request) {
    const body = await request.json();
    const { op, key, value, userId, input, kb, exclude, fromChat, messageId, poll, id, fileId, drive, limit, profile, cursor, language, ids } = body;
    const storage = this.state.storage;
    if (op === "get") return Response.json({ value: (await storage.get(key)) ?? null });
    if (op === "put") {
      await storage.put(key, value);
      return Response.json({ ok: true });
    }
    if (op === "delete") {
      await storage.delete(key);
      return Response.json({ ok: true });
    }
    if (op === "register") {
      // Atomic "first contact" check so two quick messages never announce the same user twice.
      const existing = await storage.get(`user:${userId}`);
      const username = profile?.username ?? "";
      const tgName = profile?.tgName ?? "";
      if (!existing) {
        const firstSeen = new Date().toISOString();
        const created = { firstSeen, lastSeen: firstSeen, ...(username ? { username } : {}), ...(tgName ? { tgName } : {}) };
        await storage.put(`user:${userId}`, created);
        return Response.json({ created: true, user: created, total: (await storage.list({ prefix: "user:" })).size });
      }
      let user = existing.blocked ? { ...existing, blocked: false, blockedAt: undefined, blockedReason: undefined } : existing;
      let changed = user !== existing;
      if (profile && (username !== (existing.username ?? "") || tgName !== (existing.tgName ?? ""))) {
        user = { ...user, username, tgName };
        changed = true;
      }
      // Remember activity (hourly granularity) so the admin can list idle users without a write per message.
      const lastSeenAt = user.lastSeen ? Date.parse(user.lastSeen) : 0;
      if (!Number.isFinite(lastSeenAt) || Date.now() - lastSeenAt > 3600000) {
        user = { ...user, lastSeen: new Date().toISOString() };
        changed = true;
      }
      if (user !== existing) await storage.put(`user:${userId}`, user);
      return Response.json({ created: false, user, changed });
    }
    if (op === "bulk_import_users") {
      const list = Array.isArray(ids) ? ids.map(String).filter((id) => /^\d{5,}$/.test(id)) : [];
      const now = new Date().toISOString();
      // One list call instead of N sequential gets; then parallel puts.
      const existingList = await storage.list({ prefix: "user:" });
      const existingIds = new Set([...existingList.keys()].map((k) => k.slice("user:".length)));
      const fresh = list.filter((id) => !existingIds.has(id));
      const skipped = list.length - fresh.length;
      await Promise.all(fresh.map((id) => storage.put(`user:${id}`, { firstSeen: now, imported: true })));
      return Response.json({ imported: fresh.length, skipped, total: list.length });
    }
    if (op === "userpage") {
      const size = limit ?? 40;
      const page = await storage.list({ prefix: "user:", ...(cursor ? { startAfter: cursor } : {}), limit: size });
      const users = [...page].map(([storedKey, record]) => ({ key: storedKey, id: storedKey.slice("user:".length), record }));
      return Response.json({ users, next: users.length === size ? users.at(-1).key : null });
    }
    if (op === "usage") {
      // Request counter per UTC day (flushed in batches by the Worker so it stays cheap).
      const dayKey = `usage:${profile?.day ?? id}`;
      const day = String(profile?.day ?? id);
      const total = ((await storage.get(dayKey)) ?? 0) + Number(limit ?? 0);
      await storage.put(dayKey, total);
      if (total === Number(limit ?? 0)) {
        // First write of a new day: forget counters older than 40 days.
        const old = [...(await storage.list({ prefix: "usage:" })).keys()].sort().slice(0, -40);
        for (const oldKey of old) await storage.delete(oldKey);
      }
      const alertKey = `usage-alert:${day}`;
      const alerted = (await storage.get(alertKey)) ?? 0;
      const level = USAGE_ALERT_LEVELS.filter((threshold) => total >= threshold).at(-1) ?? 0;
      if (level > alerted) {
        await storage.put(alertKey, level);
        return Response.json({ total, alert: level });
      }
      return Response.json({ total });
    }
    if (op === "usageReport") {
      const all = await storage.list({ prefix: "usage:" });
      const days = [...all].map(([storedKey, count]) => ({ day: storedKey.slice("usage:".length), count }))
        .sort((a, b) => (a.day < b.day ? 1 : -1));
      return Response.json({ days: days.slice(0, Number(limit ?? 8)) });
    }
    if (op === "voiceClaim") {
      const user = (await storage.get(`user:${userId}`)) ?? {};
      const currentId = user.voiceRec?.id ?? records[Number(user.voiceRec?.index)]?.id;
      if (String(currentId) !== String(id)) return Response.json({ claimed: false, currentId: currentId ?? null });
      const { voiceRec, ...rest } = user;
      await storage.put(`user:${userId}`, { ...rest, voiceBusy: { id, at: new Date().toISOString() } });
      return Response.json({ claimed: true });
    }
    if (op === "adminStats") {
      const [users, voiced, pending] = await Promise.all([
        storage.list({ prefix: "user:" }),
        storage.list({ prefix: VOICE_PREFIX }),
        storage.list({ prefix: "voiceid:" }),
      ]);
      let pendingUploads = 0;
      let blocked = 0;
      for (const [, value] of pending) if (!value?.drive) pendingUploads += 1;
      for (const [, value] of users) if (value?.blocked === true) blocked += 1;
      return Response.json({ users: users.size, voices: voiced.size, pendingUploads, blocked });
    }
    if (op === "voiceIds") {
      const voiced = await storage.list({ prefix: VOICE_PREFIX });
      return Response.json({ ids: [...voiced.keys()].map((key) => Number(key.slice(VOICE_PREFIX.length))).filter(Number.isFinite) });
    }
    if (op === "voiceDeleteIds") {
      const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map(String));
      let removed = 0;
      for (const id of ids) if (await storage.delete(voiceKey(id))) removed += 1;
      return Response.json({ removed });
    }
    if (op === "voiceDeleteAll") {
      const voiced = await storage.list({ prefix: VOICE_PREFIX });
      let removed = 0;
      for (const [key] of voiced) { await storage.delete(key); removed += 1; }
      return Response.json({ removed });
    }
    if (op === "voicePrune") {
      const active = new Set((Array.isArray(body.activeIds) ? body.activeIds : []).map(String));
      const voiced = await storage.list({ prefix: VOICE_PREFIX });
      let removed = 0;
      for (const [key] of voiced) {
        if (!active.has(String(key.slice(VOICE_PREFIX.length)))) {
          await storage.delete(key);
          removed += 1;
        }
      }
      return Response.json({ removed });
    }
    if (op === "voiceFiles") {
      const wanted = Array.isArray(body.ids) ? body.ids.slice(0, 50) : [];
      const entries = await Promise.all(wanted.map(async (wordId) => [wordId, (await storage.get(voiceKey(wordId)))?.fileId ?? null]));
      return Response.json({ files: Object.fromEntries(entries.filter(([, fileId]) => fileId)) });
    }
    if (op === "media") {
      // One call returns both the saved recording and the cached card photo of a word.
      const [voice, card, disabled] = await Promise.all([
        storage.get(voiceKey(id)), storage.get(cardStorageKey(id, language)), storage.get(cardDisabledKey(id)),
      ]);
      return Response.json({ voice: voice ?? null, card: card ?? null, disabled: disabled === true });
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
        queue, total: queue.length, sent: 0, failed: 0, blocked: 0, fromChat, messageId, poll, adminChat: fromChat,
      });
      await storage.setAlarm(Date.now() + 100);
      return Response.json({ started: true, total: queue.length });
    }
    if (op === "sync_start") {
      await storage.put("sync:job", { adminChat: fromChat ?? chatId ?? 0, fast: input === "fast", total: 0, rounds: 0, startedAt: new Date().toISOString() });
      await storage.setAlarm(Date.now() + 5000);
      return Response.json({ ok: true });
    }
    if (op === "sync_cancel") {
      await storage.delete("sync:job");
      await storage.delete(USERS_SYNC_CURSOR);
      return Response.json({ ok: true });
    }
    const userKey = `user:${userId}`;
    if (op === "templates_get") return Response.json({ value: (await storage.get(TEMPLATES_KEY)) ?? {} });
    if (op === "template_save") {
      const all = (await storage.get(TEMPLATES_KEY)) ?? {};
      all[String(key).slice(0, 40)] = { chatId: fromChat, messageId, at: new Date().toISOString() };
      await storage.put(TEMPLATES_KEY, all);
      return Response.json({ ok: true, count: Object.keys(all).length });
    }
    if (op === "optout_stats") {
      const optOut = new Set(((await storage.get(OPTOUT_KEY)) ?? []).map(String));
      const users = await storage.list({ prefix: "user:" });
      let total = 0;
      for (const [storedKey, record] of users) {
        if (record?.blocked || optOut.has(storedKey.slice("user:".length))) continue;
        total += 1;
      }
      return Response.json({ total, optOut: optOut.size });
    }
    if (op === "resetuser") {
      const stored = (await storage.get(userKey)) ?? null;
      if (!stored) return Response.json({ ok: false });
      await storage.delete(userKey);
      return Response.json({ ok: true, hadName: Boolean(stored.name) });
    }
    if (op === "purge_inactive") {
      const days = Math.max(1, Number(limit ?? 30));
      const cutoff = Date.now() - days * 86400000;
      const users = await storage.list({ prefix: "user:" });
      let purged = 0;
      for (const [storedKey, record] of users) {
        if (record?.blocked) continue;
        const stamp = record?.registeredAt || record?.firstSeen || "";
        if (stamp && new Date(stamp).getTime() < cutoff) { await storage.delete(storedKey); purged += 1; }
      }
      return Response.json({ purged, days });
    }
    if (op === "listprefix") {
      const page = await storage.list({ prefix: String(key ?? ""), limit: Math.min(100, Number(limit) || 50) });
      return Response.json({ entries: [...page].map(([k, v]) => ({ key: k, value: v })) });
    }
    if (op === "purgeprefix") {
      const page = await storage.list({ prefix: String(key ?? "") });
      for (const k of page.keys()) await storage.delete(k);
      return Response.json({ purged: page.size });
    }
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
  if (name.length < 2 || name.length > 60) return false;
  // Letters and combining marks only (any language), spaces allowed; no digits, no symbols.
  return /^[\p{L}\p{M} ]+$/u.test(name);
}

function userReplyKeyboardMarkup() {
  return { remove_keyboard: true };
}

function userMainKeyboardMarkup() {
  return { keyboard: [["⌨️ الكيبورد القبطي", "📞 تواصل مع الإدارة"], ["🎲 كلمة عشوائية"]], resize_keyboard: true, is_persistent: true };
}

async function sendWelcome(env, chatId, name) {
  const caption = await getWelcomeCaption(env, name);
  try {
    const bytes = Uint8Array.from(atob(welcomeImageBase64), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    form.append("reply_markup", JSON.stringify(userMainKeyboardMarkup()));
    form.append("photo", new Blob([bytes], { type: "image/jpeg" }), "welcome.jpg");
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: "POST", body: form });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.ok) return;
    console.error("Telegram sendPhoto failed", result.description ?? response.status);
    if (response.status === 403 || result?.error_code === 403) await markUserBlocked(env, chatId, result.description ?? "sendPhoto 403");
  } catch (error) {
    console.error("Welcome photo failed", error instanceof Error ? error.message : "unknown error");
  }
  await telegram(env, "sendMessage", { chat_id: chatId, text: caption, parse_mode: "HTML", reply_markup: userMainKeyboardMarkup() });
}

// Organized commands menu (sent as a separate text message because photo captions are limited to 1024 chars).
function buildCommandsHelpText(env, userId) {
  const admin = isAdmin(env, userId);
  const lines = [
    "📖 <b>القاموس القبطي الناطق — الأوامر</b>",
    "",
    "🔹 <b>عامة</b>",
    "/start — بدء الاستخدام وإظهار القائمة",
    "/keyboard — لوحة مفاتيح قبطية",
    "/learn — تعلم اللغة القبطية",
    "/random — كلمة عشوائية من القاموس",
    "/contact — تواصل مع إدارة البوت (أو زر «📞 تواصل مع الإدارة»)",
    "💡 اكتب أي كلمة مباشرة للبحث: قبطي / عربي / إنجليزي / يوناني / فرنسي / ألماني.",
  ];
  if (admin) {
    lines.push("", "🔹 <b>للأدمن فقط</b>");
    lines.push("/admin — لوحة تحكم الأدمن");
    lines.push("/usage — تقرير استخدام البوت اليومي");
    lines.push("/analytics — تحليلات البحث وأكثر الكلمات بحثًا");
    lines.push("/auditlog — سجل تدقيق تعديلات القاموس");
    lines.push("/export — تصدير القاموس كملف JSON");
    lines.push("/backup — نسخة احتياطية من القاموس");
    lines.push("/broadcast — إرسال جماعي للمستخدمين");
    lines.push("/syncdrive — مزامنة الأصوات مع Drive");
    lines.push("/syncusers — مزامنة المستخدمين مع الشيت");
    lines.push("/record — تسجيل نطق كلمة جديدة");
    lines.push("/card_hide &lt;كلمة&gt; — إخفاء بطاقة كلمة");
    lines.push("/card_show &lt;كلمة&gt; — إظهار بطاقة كلمة");
    lines.push("/setdrive &lt;رابط&gt; — ضبط رابط Apps Script");
    lines.push("/setarchive &lt;here|id&gt; — ضبط مجموعة الأرشيف");
    lines.push("/voice_delete &lt;كلمة&gt; — حذف تسجيل صوتي");
    lines.push("/health — فحص صحة البوت | /uptime — مدة التشغيل");
    lines.push("/note — ملاحظة خاصة | /note حذف لمسحها");
    lines.push("/setwod &lt;كلمة&gt; — كلمة اليوم التلقائية (/setwodtest للتجربة)");
    lines.push("/autoreply كلمة = رد — ردود تلقائية (/autoreply للقائمة)");
    lines.push("/searchlimit &lt;عدد&gt; — حد البحث اليومي | /usagealert &lt;عدد&gt; — تنبيه استخدام");
    lines.push("/tplsave &lt;اسم&gt; — حفظ قالب بث | /tplsend &lt;اسم&gt; — إرساله");
    lines.push("/optout — إحصاء خيار الخروج من البث | /purge &lt;أيام&gt; — حذف الخاملين");
    lines.push("/resetuser &lt;id&gt; — تصفير مستخدم | /pin &lt;id&gt; / /pinhere / /unpin — تثبيت");
    lines.push("/reply &lt;id&gt; &lt;نص&gt; — الرد على رسالة /contact | /exportuserscsv — تصدير المستخدمين");
    lines.push("/alias اختصار = كلمة — اختصار بحث فوري | /motd النص — رسالة اليوم | /points &lt;id&gt; &lt;عدد&gt; — منح/خصم نقاط");
    lines.push("/rules — قواعد البوت (كأدمن: /rules نص أو /rules حذف) | /warn &lt;id&gt; — تحذير (3 = حظر 24س) | /tempban &lt;id&gt; &lt;ساعات&gt; — حظر مؤقت");
    lines.push("/wordinfo &lt;كلمة&gt; — كل حقول الكلمة | /searchcount &lt;كلمة&gt; — عدد مرات بحثها | /hiddencards — البطاقات المخفية | /unhideall — إظهار الكل");
    lines.push("— Batch 4 —");
    lines.push("/feature &lt;ميزة&gt; on|off — مفاتيح الميزات (audio/keyboard/contact/...)");
    lines.push("/blacklist add|remove &lt;كلمة&gt; — كلمات محظورة | /whitelist on|off/add|remove — القائمة البيضاء");
    lines.push("/msg &lt;id&gt; &lt;نص&gt; — رسالة مباشرة لمستخدم | /topusers — الأكثر نشاطًا");
    lines.push("/integrity — فحص سلامة القاموس | /nopronounce — كلمات بدون نطق | /noaudio — كلمات بدون صوت");
    lines.push("/findempty &lt;حقل&gt; — خلايا فاضية | /livesearch — بحث مباشر | /hourly — توزيع الساعات");
    lines.push("/adminaudit — سجل إجراءات الأدمن | /exportsearch — تصدير سجل البحث | /resetstats — تصفير الإحصاءات");
    lines.push("/setbanmsg &lt;نص&gt; — رسالة الحظر | /setmaintmsg &lt;نص&gt; — رسالة الصيانة");
    lines.push("/slowmode on|off|&lt;ثواني&gt; — الوضع البطيء | /clearcache — مسح الكاش");
    lines.push("/testbroadcast — إرسال تجريبي | /bcpause | /bcresume | /bccancel — التحكم في البث");
    lines.push("/importusers — استيراد قائمة معرّفات مستخدمين قديمة دفعة واحدة");
    lines.push("/importsheet <رابط> [تبويب] — استيراد المعرّفات من ورقة Google مباشرة");
    lines.push("/recoverusers — استرجاع مستخدمي فترة الصيانة من السجلات ورفعهم للشيت");
    lines.push("/bulkadd — إضافة عدة كلمات للقاموس دفعة واحدة (سطر لكل كلمة)");
    lines.push("/userfind <اسم> — البحث عن مستخدم بالاسم مع زر رد سريع (بدون معرف)");
    lines.push("/blockedusers — قائمة المحظورين مع زر فك الحظر | /configexport — نسخة احتياطية للإعدادات JSON");
    lines.push("/bcspeed <ثواني> — تأخير الإرسال الجماعي بين كل مستخدم (افتراضي 5 ثوانٍ)");
    lines.push("/syncall — مزامنة جميع المستخدمين للشيت (يكمل من حيث توقف) | /syncreset — تصفير المؤشر");
  }
  return lines.join("\n");
}

// Extra admins are kept in a sync cache (refreshed in the background) so the hot
// isAdmin() path stays synchronous. addExtraAdmin/removeExtraAdmin invalidate it.
let extraAdminsSync = [];
let extraAdminsSyncAt = 0;
async function refreshExtraAdmins(env) {
  if (!env.USERS) return;
  const now = Date.now();
  if (now - extraAdminsSyncAt < ADMIN_CACHE_TTL) return;
  extraAdminsSyncAt = now;
  try { extraAdminsSync = ((await storeCall(env, { op: "get", key: "admins:list" })).value ?? []).map(String); } catch { extraAdminsSync = []; }
}
function adminIds(env) {
  // The fixed owner identity plus any DO-stored extra admins.
  return [DEFAULT_ADMIN_IDS, ...extraAdminsSync];
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

async function notifyGroup(env, text) {
  const chatId = await archiveChatId(env);
  if (!chatId) return;
  try {
    await telegram(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
  } catch (error) {
    console.error("Group notify failed", error instanceof Error ? error.message : "unknown error");
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

async function renderVoiceWordSuggestions(query, env) {
  const clean = String(query ?? "").replace(/[\r\n]+/gu, " ").trim().slice(0, 160);
  const normalized = normalize(clean);
  const kind = await detectScriptKind(env, normalized);
  const candidates = [];
  if (ARABIC_LETTER.test(normalized)) {
    for (const index of await findMatches(clean, env)) candidates.push(index);
  } else {
    for (const item of await prefixWords(env, kind, normalized, 20)) candidates.push(...item.rows);
  }
  const seen = new Set();
  const keyboard = candidates.filter((index) => {
    const id = records[index]?.id;
    if (id == null || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 20).map((index) => [{
    text: String(records[index]?.coptic ?? "—").replaceAll("`", "").trim().slice(0, 48),
    callback_data: `vr|${records[index].id}`,
  }]);
  return {
    text: keyboard.length ? "اختر الكلمة التي تريد تسجيلها:" : "لم أجد كلمة بهذا البحث. جرّب بحثًا آخر:",
    reply_markup: keyboard.length ? { inline_keyboard: keyboard } : undefined,
  };
}

async function beginVoiceChoice(env, chatId, userId, user) {
  await saveUser(env, userId, { ...user, voicePick: true, voiceRec: undefined });
  await telegram(env, "sendMessage", { chat_id: chatId, text: "🔎 أرسل الكلمة التي تريد تسجيلها، وسأعرض لك اقتراحات القاموس." });
}

async function selectVoiceWord(env, chatId, userId, user, id) {
  const record = records[recordIndexById().get(Number(id))];
  if (!record) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "لم أجد هذه الكلمة، أعد البحث من فضلك." });
    return;
  }
  await saveUser(env, userId, { ...user, voicePick: false, voiceRec: { id: record.id, mode: "chosen" } });
  await telegram(env, "sendMessage", { chat_id: chatId, text: voicePrompt({ ...record, recorded: 0, total: 1 }), parse_mode: "HTML" });
}

async function nextVoicePrompt(env, chatId, userId, user) {
  const item = await storeCall(env, { op: "voiceNext" });
  if (!item) {
    await saveUser(env, userId, { ...user, voiceRec: undefined });
    await telegram(env, "sendMessage", { chat_id: chatId, text: voicePrompt(null), parse_mode: "HTML" });
    return;
  }
  await saveUser(env, userId, { ...user, voicePick: false, voiceRec: { id: item.id, mode: "sequential" } });
  await telegram(env, "sendMessage", { chat_id: chatId, text: voicePrompt(item), parse_mode: "HTML" });
}

async function beginVoiceRecording(env, chatId, userId, user) {
  const activeId = user?.voiceRec?.id ?? records[Number(user?.voiceRec?.index)]?.id;
  if (activeId != null) {
    const active = records[recordIndexById().get(activeId)];
    if (active) {
      await telegram(env, "sendMessage", { chat_id: chatId, text: voicePrompt({ ...active, recorded: 0, total: 1 }), parse_mode: "HTML" });
      return;
    }
  }
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
  const claim = await storeCall(env, { op: "voiceClaim", userId, id });
  if (!claim.claimed) {
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "⚠️ تم استلام تسجيل آخر لهذه الجلسة بالفعل؛ لم أربط هذا الصوت بكلمة ثانية." });
    return;
  }
  await storeCall(env, {
    op: "put",
    key: voiceKey(id),
    value: { fileId: message.voice.file_id, duration: message.voice.duration ?? null, savedAt: new Date().toISOString() },
  });
  // A fresh recording explicitly reactivates the word's card.
  await storeCall(env, { op: "delete", key: cardDisabledKey(id) });
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
  if (user.voiceRec?.mode === "chosen") {
    await saveUser(env, userId, { ...user, voiceRec: undefined, voicePick: true });
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "🔎 أرسل كلمة أخرى للبحث عنها وتسجيلها، أو أرسل /record_stop." });
  } else {
    await nextVoicePrompt(env, message.chat.id, userId, user);
  }
  await inBackground(ctx, archive);
  // لا نرسل التسجيل إلى مجموعة أرشيف؛ archiveAndReport يرفعه مباشرةً إلى
  // Apps Script ثم Google Drive وGoogle Sheets.
}

// Optional archive group: every new recording is also posted there, where a second bot
// (bot-to-bot mode) reads it and the scheduled "Archive recordings" workflow stores the file.
async function archiveChatId(env) {
  try {
    const saved = env.USERS ? (await storeCall(env, { op: "get", key: ARCHIVE_CHAT_KEY })).value : null;
    return saved?.chatId ?? null;
  } catch {
    return null;
  }
}

async function postToArchiveGroup(env, record, fileId, duration) {
  const chatId = await archiveChatId(env);
  if (!chatId || !fileId) return;
  try {
    const parts = splitMeaning(record.meaning ?? "");
    const meaning = parts.join("، ");
    const lines = [
      record.coptic ? `الكلمة: ${record.coptic}` : null,
      meaning ? `المعنى: ${meaning}` : null,
      record.kind ? `النوع: ${record.kind}` : null,
      record.origin ? `الأصل: ${record.origin}` : null,
    ].filter(Boolean);
    const caption = lines.join("\n").slice(0, 1024);
    await sendVoiceToArchive(env, chatId, {
      voice: fileId,
      ...(duration ? { duration } : {}),
      caption,
    });
  } catch (error) {
    console.error("Archive group post failed", error instanceof Error ? error.message : "unknown error");
  }
}

async function setArchiveChat(env, message, argument) {
  const input = argument.trim();
  const reply = (text) => telegram(env, "sendMessage", { chat_id: message.chat.id, text });
  if (input.toLowerCase() === "here") {
    if (!["group", "supergroup"].includes(message.chat.type)) {
      await reply("نفّذ /setarchive here داخل المجموعة نفسها.");
      return;
    }
    await storeCall(env, { op: "put", key: ARCHIVE_CHAT_KEY, value: { chatId: message.chat.id } });
    await reply(`✅ تم ربط هذه المجموعة (${message.chat.id}) لتحويل التسجيلات إلى @Abram444_bot.`);
    return;
  }
  if (input.toLowerCase() === "off") {
    await storeCall(env, { op: "put", key: ARCHIVE_CHAT_KEY, value: null });
    await reply("تم إيقاف إرسال التسجيلات لمجموعة الأرشيف.");
    return;
  }
  if (!input) {
    const current = await archiveChatId(env);
    await reply(current
      ? `مجموعة الأرشيف الحالية: ${current}\nلإيقافها: /setarchive off`
      : "لربط مجموعة الأرشيف أرسل: /setarchive رقم_المجموعة\n(المجموعة يجب أن يكون البوت عضوًا فيها)");
    return;
  }
  if (!/^-?\d{5,20}$/u.test(input)) {
    await reply("رقم المجموعة غير صحيح. أرسل: /setarchive -100xxxxxxxxxx");
    return;
  }
  const test = await telegram(env, "sendMessage", { chat_id: Number(input), text: "✅ تم ربط هذه المجموعة بأرشيف التسجيلات." }).catch(() => null);
  if (!test?.ok) {
    await reply("تعذّر الإرسال لهذه المجموعة. تأكد أن البوت عضو فيها وأن الرقم صحيح.");
    return;
  }
  await storeCall(env, { op: "put", key: ARCHIVE_CHAT_KEY, value: { chatId: Number(input) } });
  await reply("✅ تم الربط. كل تسجيل جديد سيُرسل أيضًا لهذه المجموعة.");
}

// Notify admins when someone joins or leaves a group the bot is in.
async function notifyGroupMembershipChange(env, message) {
  const members = await telegram(env, "getChatMemberCount", { chat_id: message.chat.id });
  if (message?.new_chat_members?.length) {
    const notices = [];
    for (const member of message.new_chat_members) {
      if (member?.is_bot) continue;
      notices.push(`👥 <b>انضم عضو جديد للمجموعة</b>\n👤 ${escapeHtml(displayNameOrEmpty(member) || "بدون اسم")}${member.username ? ` (@${escapeHtml(member.username)})` : ""}\n🆔 <code>${escapeHtml(String(member.id))}</code>${members?.result != null ? `\n👥 أعضاء المجموعة الآن: ${members.result}` : ""}`);
    }
    if (notices.length) await notifyAdmins(env, notices.join("\n\n"));
    return;
  }
  const left = message?.left_chat_member;
  if (left && !left.is_bot) {
    await notifyAdmins(env, `👥 <b>غادر عضو المجموعة</b>\n👤 ${escapeHtml(displayNameOrEmpty(left) || "بدون اسم")}\n🆔 <code>${escapeHtml(String(left.id))}</code>${members?.result != null ? `\n👥 أعضاء المجموعة الآن: ${members.result}` : ""}`);
    return;
  }
}

async function beginBroadcastFromTemplate(env, chatId, userId, user, name, message) {
  const templates = await broadcastTemplates(env);
  const existing = templates[name];
  if (existing?.messageId) {
    await telegram(env, "sendMessage", {
      chat_id: chatId,
      text: `🧷 القالب «${escapeHtml(name)}» محفوظ مسبقًا. أرسل الرسالة الجديدة التي تريد حفظها مكانه، أو اضغط للإرسال الآن:`,
      reply_markup: { inline_keyboard: [[{ text: "🚀 إرسال القالب الآن", callback_data: `tpl|go|${name}` }, { text: "❌ إلغاء", callback_data: "tpl|no" }]] },
    });
  }
  await saveUser(env, userId, { ...user, bc: "await" });
  await setAdminFlow(env, userId, { kind: "tpl_name", name, chatId });
  if (!existing?.messageId) await telegram(env, "sendMessage", { chat_id: chatId, text: "📢 أرسل الآن رسالة القالب (نص، صورة، فيديو، Voice، استبيان…)." });
}

async function beginOptOutStats(env, chatId) {
  const result = await storeCall(env, { op: "optout_stats" });
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: `📢 الإرسال الجماعي يستهدف حاليًا: <b>${Number(result?.total ?? 0).toLocaleString("en-US")}</b> مستخدم\n🔕 مستخدمون مُستثنون (خروج اختياري): <b>${Number(result?.optOut ?? 0).toLocaleString("en-US")}</b>\n\nالمستخدم يخرج بالأمر /stopbroadcast ويعود بـ /startbroadcast.`,
    parse_mode: "HTML",
  });
}

async function sendUptime(env, chatId) {
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: `⏱ مدة تشغيل هذه النسخة من البوت: <b>${formatUptime(Date.now() - BOT_STARTED_AT)}</b>\n📚 سجلات القاموس: ${records.length.toLocaleString("en-US")}\n🕒 وقت الفحص: ${new Date().toISOString()}`,
    parse_mode: "HTML",
  });
}

// The failed call then reports the new id: store it and retry once so the link keeps working.
async function sendVoiceToArchive(env, chatId, payload) {
  let result = await telegram(env, "sendVoice", { ...payload, chat_id: chatId });
  const migratedTo = result?.parameters?.migrate_to_chat_id;
  if (!result?.ok && migratedTo) {
    await storeCall(env, { op: "put", key: ARCHIVE_CHAT_KEY, value: { chatId: migratedTo } });
    result = await telegram(env, "sendVoice", { ...payload, chat_id: migratedTo });
  }
  return result;
}

async function forwardIncomingVoice(env, message) {
  const targetChatId = await archiveChatId(env);
  const source = message.voice ?? message.audio;
  if (!targetChatId) return { ok: false, reason: "not_configured" };
  if (!source || Number(message.chat.id) === Number(targetChatId)) return { ok: false, reason: "same_chat" };
  const duration = source.duration ?? null;
  const kind = message.voice ? "Voice" : "Audio";
  const caption = `@Abram444_bot\n${kind} من المستخدم ${message.from?.first_name ?? ""}`.trim();
  const result = await sendVoiceToArchive(env, targetChatId, {
    voice: source.file_id,
    ...(duration ? { duration } : {}),
    caption,
  });
  if (!result?.ok) {
    console.error("Forward voice to second bot failed", result?.description ?? "unknown error");
    return { ok: false, reason: result?.description ?? "telegram_error" };
  }
  return { ok: true };
}

// Admin: delete the saved recording of a word so it is read by the generated voice again.
async function askDeleteVoice(env, chatId, query) {
  const clean = String(query ?? "").trim();
  if (!clean) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "🗑️ لحذف تسجيلك لكلمة وإرجاعها للصوت الآلي أرسل:\n/voice_delete الكلمة" });
    return;
  }
  const record = await cardRecord(clean, env);
  if (record?.id == null) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "لم أجد هذه الكلمة. أرسلها كما هي في القاموس." });
    return;
  }
  const saved = env.USERS ? (await storeCall(env, { op: "get", key: voiceKey(record.id) })).value : null;
  if (!saved?.fileId) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: `لا يوجد تسجيل محفوظ لكلمة «${record.coptic}»، فهي تُقرأ بالصوت الآلي بالفعل.` });
    return;
  }
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: `🗑️ حذف تسجيل كلمة «${record.coptic}» من البوت وDrive وورقة upload؟\nستعود الكلمة للصوت الآلي.`,
    reply_markup: { inline_keyboard: [[
      { text: "✅ احذف", callback_data: `vd|${record.id}` },
      { text: "↩️ إلغاء", callback_data: "vd|x" },
    ]] },
  });
}

async function askDeleteManyVoices(env, chatId, userId, user, argument, all = false) {
  let ids = [];
  if (all) {
    const page = await storeCall(env, { op: "voiceIds" });
    ids = page.ids ?? [];
  } else {
    const selected = await Promise.all(String(argument ?? "").split(/[|،,\n]+/u).map((item) => cardRecord(item.trim(), env)));
    ids = selected.map((record) => record?.id).filter((id) => id != null);
  }
  ids = [...new Set(ids.map(Number))].slice(0, 100);
  if (!ids.length && !all) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "لم أجد كلمات مسجلة. افصل الكلمات بعلامة | أو فاصلة." });
    return;
  }
  await saveUser(env, userId, { ...user, voiceDeleteBatch: all ? undefined : ids, voiceDeleteAll: all });
  await telegram(env, "sendMessage", { chat_id: chatId, text: all ? `🗑️ سيتم تفريغ مجلد الأصوات وحذف كل صفوف upload (${ids.length} تسجيلًا) من البوت وDrive وSheet في عملية واحدة. هل أؤكد؟` : `🗑️ سيتم حذف ${ids.length} تسجيلات من البوت وDrive وورقة upload. هل أؤكد؟`, reply_markup: { inline_keyboard: [[{ text: "✅ تأكيد الحذف", callback_data: "vdb|yes" }, { text: "↩️ إلغاء", callback_data: "vdb|no" }]] } });
}
async function finishDeleteBatch(env, callback, confirm) {
  const chatId = callback.message?.chat?.id;
  if (!chatId || !isAdmin(env, callback.from?.id)) return;
  const userId = callback.from.id;
  const user = (await getUser(env, userId)) ?? {};
  const edit = (text) => telegram(env, "editMessageText", { chat_id: chatId, message_id: callback.message.message_id, text });
  if (confirm !== "yes") { await saveUser(env, userId, { ...user, voiceDeleteBatch: undefined, voiceDeleteAll: undefined }); await edit("تم إلغاء الحذف."); return; }
  const deleteAll = user.voiceDeleteAll === true;
  const ids = Array.isArray(user.voiceDeleteBatch) ? user.voiceDeleteBatch : [];
  const remote = deleteAll
    ? await deleteRemoteVoices(env, { action: "delete_all" })
    : await deleteRemoteVoices(env, { action: "delete_many", ids });
  if (!remote.ok) { await edit(`❌ تعذّر الحذف الجماعي من Drive/Sheet: ${remote.error ?? "unknown error"}`); return; }
  const local = await storeCall(env, { op: deleteAll ? "voiceDeleteAll" : "voiceDeleteIds", ids });
  await saveUser(env, userId, { ...user, voiceDeleteBatch: undefined, voiceDeleteAll: undefined });
  await edit(deleteAll
    ? `✅ تم تفريغ مجلد الأصوات وحذف ${local.removed ?? remote.deleted ?? 0} تسجيلًا من البوت وDrive وSheet. عاد الصوت الآلي.`
    : `✅ حُذف ${local.removed ?? remote.deleted ?? ids.length} تسجيل من كل الأنظمة، وعاد الصوت الآلي.`);
}
async function finishDeleteVoice(env, callback, choice) {
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  if (!chatId || !isAdmin(env, callback.from?.id)) return;
  const edit = (text) => telegram(env, "editMessageText", { chat_id: chatId, message_id: messageId, text });
  if (choice === "x") {
    await edit("تم الإلغاء، التسجيل كما هو.");
    return;
  }
  const record = records.find((item) => String(item.id) === choice);
  if (!record || !env.USERS) {
    await edit("تعذّر الحذف: لم أجد الكلمة.");
    return;
  }
  const remote = await deleteRemoteVoice(env, record.id);
  if (!remote.ok) { await edit(`❌ تعذّر حذف تسجيل «${record.coptic}» من Drive/Sheet: ${remote.error ?? "unknown error"}`); return; }
  await storeCall(env, { op: "delete", key: voiceKey(record.id) });
  await edit(`✅ حُذف تسجيل «${record.coptic}» من البوت وDrive وورقة upload. ستُقرأ الآن بالصوت الآلي.`);
}

async function stopVoiceRecording(env, chatId, userId, user) {
  await saveUser(env, userId, { ...user, voiceRec: undefined, voicePick: undefined });
  await telegram(env, "sendMessage", { chat_id: chatId, text: "⏸️ تم إيقاف جلسة التسجيل. أرسل /record لاستكمالها من أول كلمة غير مسجلة." });
}

// ---- User directory in the spreadsheet ("User" tab, written by the Apps Script) ----
const USERS_SYNC_CURSOR = "users-sync-cursor";
const USERS_SYNC_BATCH = 200;

function userSheetRow(id, record, from = {}) {
  const tgName = record?.tgName || displayNameOrEmpty(from);
  return {
    id: String(id),
    name: record?.name || tgName || "",
    username: record?.username || from?.username || "",
    joined_at: record?.firstSeen ?? "",
    registered_at: record?.registeredAt ?? "",
    blocked: record?.blocked === true,
    blocked_at: record?.blockedAt ?? "",
  };
}

function displayNameOrEmpty(person) {
  return [person?.first_name, person?.last_name].filter(Boolean).join(" ").trim();
}

const USER_PUSH_CHUNK = 120;
// Rows are written to the sheet in chunks and retried with exponential backoff: one huge POST used to
// abort silently in the middle of a sync, which is why many users never reached the sheet.
async function pushUsers(env, rows) {
  const config = await driveConfig(env);
  if (!config || !rows.length) return { ok: false, skipped: true };
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      for (let i = 0; i < rows.length; i += USER_PUSH_CHUNK) {
        await callAppsScript(config, { action: "users", users: rows.slice(i, i + USER_PUSH_CHUNK) });
      }
      return { ok: true };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "unknown error";
      console.error("User sheet sync failed", lastError);
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  return { ok: false, error: lastError };
}

async function markUserBlocked(env, chatId, reason = "Telegram 403") {
  if (!env.USERS || chatId == null || !/^\d+$/u.test(String(chatId)) || Number(chatId) <= 0) return;
  const userId = String(chatId);
  const current = await getUser(env, userId);
  if (current?.blocked === true) return;
  const blockedAt = new Date().toISOString();
  const updated = {
    ...(current ?? {}),
    blocked: true,
    blockedAt,
    blockedReason: String(reason).replace(/\s+/gu, " ").slice(0, 180),
  };
  await saveUser(env, userId, updated);
  await pushUsers(env, [userSheetRow(userId, updated)]);
  await notifyAdmins(env, `🚫 <b>مستخدم حظر البوت</b>\n🆔 <code>${escapeHtml(userId)}</code>\n🕒 ${escapeHtml(blockedAt)}\n📌 ${escapeHtml(updated.blockedReason)}`);
}

const USER_SYNC_MAX_PAGES = 6;
// Syncs page after page in a single run instead of stopping after one page, and only advances the cursor
// when the sheet actually accepted the rows. If more users remain, the alarm job continues automatically.
async function syncUsersBatch(env, chatId, options = {}) {
  const config = await driveConfig(env);
  if (!config) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "لم يتم ربط جوجل درايف بعد. استخدم /setdrive أولًا." });
    return { ok: false, error: "drive not linked" };
  }
  const maxPages = Math.max(1, Number(options.maxPages) || USER_SYNC_MAX_PAGES);
  let total = 0;
  let pages = 0;
  let done = false;
  let error = null;
  for (let page = 0; page < maxPages; page += 1) {
    const cursor = env.USERS ? ((await storeCall(env, { op: "get", key: USERS_SYNC_CURSOR })).value ?? null) : null;
    const result = await storeCall(env, { op: "userpage", cursor, limit: USERS_SYNC_BATCH });
    const list = result?.users ?? [];
    if (!list.length) { done = true; break; }
    // Limited parallelism (10 at a time) to avoid Telegram 429 rate-limit on getChat.
    const rows = [];
    for (let c = 0; c < list.length; c += 10) {
      const chunk = list.slice(c, c + 10);
      const chunkRows = await Promise.all(chunk.map(async (item) => {
        let record = item.record ?? {};
        if (!record.tgName && !record.username) {
          const chat = await telegram(env, "getChat", { chat_id: item.id }).catch(() => null);
          if (chat?.ok && chat.result) {
            record = { ...record, tgName: displayNameOrEmpty(chat.result), username: chat.result.username ?? "" };
            await saveUser(env, item.id, record).catch(() => null);
          }
        }
        return userSheetRow(item.id, record);
      }));
      rows.push(...chunkRows);
    }
    const outcome = await pushUsers(env, rows);
    if (!outcome.ok) { error = outcome.error ?? "تعذّر الدفع إلى الشيت"; break; }
    total += rows.length;
    pages += 1;
    await storeCall(env, { op: "put", key: USERS_SYNC_CURSOR, value: result.next ?? null }).catch(() => null);
    if (!result.next) { done = true; break; }
  }
  await storeCall(env, {
    op: "put",
    key: "user-sync:state",
    value: { lastRunAt: new Date().toISOString(), lastRunTotal: total, pages, lastError: error ?? "" },
  }).catch(() => null);
  if (error) {
    await telegram(env, "sendMessage", {
      chat_id: chatId,
      text: `⚠️ توقفت المزامنة بعد ${total} مستخدم: ${error}\nالمؤشر محفوظ، فأعد المحاولة بـ /syncusers — لن يُعاد إرسال من نجح.`,
    });
    return { ok: false, error, total };
  }
  if (done) {
    await storeCall(env, { op: "put", key: USERS_SYNC_CURSOR, value: null }).catch(() => null);
    await telegram(env, "sendMessage", { chat_id: chatId, text: `✅ اكتملت المزامنة: ${total} مستخدم في ${pages} دفعة. تحقّق من تبويب "users".` });
    return { ok: true, total, done: true };
  }
  // More users are still waiting: hand the rest to the alarm job so the admin does not press anything else.
  if (env.USERS) await storeCall(env, { op: "sync_start", fromChat: chatId, input: "fast" }).catch(() => null);
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: `⏳ تمت مزامنة ${total} مستخدم في ${pages} دفعة. الباقي يُكمل تلقائيًا كل 25 ثانية (/synccancel للإيقاف، /syncstatus للمتابعة).`,
  });
  return { ok: true, total, done: false };
}

// Fully registered users are remembered briefly in this isolate (registration never goes backwards),
// so their searches do not wait for a user-store round trip.
const registeredCache = new Map();
const REGISTERED_CACHE_MS = 60000;

async function registerOnFirstContact(env, message, userId, ctx) {
  if (isAdmin(env, userId) || (message.chat.type ?? "private") !== "private" || !env.USERS) return undefined;
  const from = message.from ?? {};
  const cached = registeredCache.get(userId);
  if (cached && Date.now() - cached.at < REGISTERED_CACHE_MS) return cached.user;
  let result;
  try {
    result = await storeCall(env, { op: "register", userId, profile: { username: from.username ?? "", tgName: displayNameOrEmpty(from) } });
  } catch (error) {
    console.error("Register failed", error instanceof Error ? error.message : "unknown error");
    return undefined;
  }
  if (result?.created || result?.changed) {
    await inBackground(ctx, pushUsers(env, [userSheetRow(userId, result.user, from)]));
  }
  if (!result?.created) {
    if (result?.user?.name && !result.user.awaitingName) {
      if (registeredCache.size > 5000) registeredCache.clear();
      registeredCache.set(userId, { at: Date.now(), user: result.user });
    }
    return result?.user;
  }
  const joinNotice = [
    "🆕 <b>انضم مستخدم جديد إلى البوت</b>",
    `👤 الاسم: ${escapeHtml(displayName(from))}`,
    `🔗 المعرّف: ${from.username ? `@${escapeHtml(from.username)}` : "—"}`,
    `🆔 الرقم: <code>${escapeHtml(userId)}</code>`,
    `👥 إجمالي المستخدمين: ${Number(result.total ?? 0).toLocaleString("en-US")}`,
  ].join("\n");
  // Auto-sync the newly registered user to the Google Sheet immediately.
  inBackground(ctx, pushUsers(env, [userSheetRow(userId, result.user)]).catch((e) => console.error("Auto-push user failed", e instanceof Error ? e.message : "unknown")));
  await notifyAdmins(env, joinNotice);
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
    text: "📢 أرسل الآن الرسالة التي تريد إرسالها للمستخدمين: نص، صورة، فيديو، Voice، ملف، استبيان، أو أي رسالة يدعم Telegram نسخها.\nلإلغاء العملية أرسل /cancel",
  });
}

function broadcastPollPayload(poll) {
  if (!poll || typeof poll.question !== "string" || !Array.isArray(poll.options)) return null;
  const options = poll.options
    .filter((option) => typeof option?.text === "string")
    .map((option) => ({
      text: option.text,
      ...(Array.isArray(option.text_entities) && option.text_entities.length ? { text_entities: option.text_entities } : {}),
    }));
  if (options.length < 2 || options.length > 12) return null;

  const type = poll.type === "quiz" ? "quiz" : "regular";
  const correctOptionIds = Array.isArray(poll.correct_option_ids) ? poll.correct_option_ids : null;
  // Telegram requires the answer key to recreate a quiz. If unavailable, retain the
  // ordinary copyMessage attempt but do not silently turn the quiz into a regular poll.
  if (type === "quiz" && !correctOptionIds?.length) return null;

  const payload = {
    question: poll.question,
    options,
    is_anonymous: Boolean(poll.is_anonymous),
    type,
    allows_multiple_answers: Boolean(poll.allows_multiple_answers),
    ...(poll.allows_revoting !== undefined ? { allows_revoting: Boolean(poll.allows_revoting) } : {}),
    ...(poll.shuffle_options !== undefined ? { shuffle_options: Boolean(poll.shuffle_options) } : {}),
    ...(poll.allow_adding_options !== undefined ? { allow_adding_options: Boolean(poll.allow_adding_options) } : {}),
    ...(poll.hide_results_until_closes !== undefined ? { hide_results_until_closes: Boolean(poll.hide_results_until_closes) } : {}),
    ...(poll.question_entities?.length ? { question_entities: poll.question_entities } : {}),
    ...(type === "quiz" ? { correct_option_ids: correctOptionIds } : {}),
    ...(poll.explanation ? { explanation: poll.explanation } : {}),
    ...(poll.explanation_entities?.length ? { explanation_entities: poll.explanation_entities } : {}),
    ...(poll.description ? { description: poll.description } : {}),
    ...(poll.description_entities?.length ? { description_entities: poll.description_entities } : {}),
    ...(poll.is_closed ? { is_closed: true } : {}),
  };

  if (!poll.is_closed && Number.isInteger(poll.open_period) && poll.open_period >= 5 && poll.open_period <= 2628000) {
    payload.open_period = poll.open_period;
  } else if (!poll.is_closed && Number.isInteger(poll.close_date)) {
    const secondsLeft = poll.close_date - Math.floor(Date.now() / 1000);
    if (secondsLeft >= 5 && secondsLeft <= 2628000) payload.open_period = secondsLeft;
    else if (secondsLeft < 5) payload.is_closed = true;
  }
  return payload;
}

async function captureBroadcast(env, message, userId, user) {
  const { count } = await storeCall(env, { op: "bccount", exclude: adminIds(env) });
  if (!count) {
    await saveUser(env, userId, { ...user, bc: undefined });
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "لا يوجد مستخدمون مسجّلون لإرسال الرسالة إليهم بعد." });
    return;
  }
  await saveUser(env, userId, {
    ...user,
    bc: { messageId: message.message_id, ...(message.poll ? { poll: broadcastPollPayload(message.poll) } : {}) },
  });
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
    exclude: [...adminIds(env), ...(await optOutList(env))],
    fromChat: chatId,
    messageId: user.bc.messageId,
    poll: user.bc.poll ?? null,
  });
  await saveUser(env, userId, { ...user, bc: undefined });
  await answer();
  if (started.busy) await edit("⏳ يوجد إرسال جماعي جارٍ بالفعل.");
  else if (!started.started) await edit("لا يوجد مستخدمون لإرسال الرسالة إليهم.");
  else await edit(`🚀 بدأ الإرسال إلى ${started.total.toLocaleString("en-US")} مستخدم. سأرسل لك تقريرًا عند الانتهاء.`);
}

// ---- Daily request counter (compare with the free plan's 100,000 requests/day) ----
const DAILY_REQUEST_LIMIT = 100000;
const USAGE_ALERT_LEVELS = [50000, 80000, 95000, 100000];
const USAGE_FLUSH_EVERY = 20;
const USAGE_FLUSH_MS = 60000;
const usageState = { day: "", pending: 0, flushedAt: 0 };

// ---- Pro feature: per-user rate limiting (sliding window, in-memory) ----
const RATE_LIMIT_WINDOW_MS = 10000;
const RATE_LIMIT_MAX = 30; // messages per window for regular users
const RATE_LIMIT_ADMIN_MULTIPLIER = 5;
const RATE_WARN_COOLDOWN_MS = 30000;
const rateBuckets = new Map(); // userId -> { windowStart, count }
const rateLastWarn = new Map(); // userId -> last warning timestamp
function checkRateLimit(userId, admin, customMax = null) {
  const now = Date.now();
  const base = Number(customMax) > 0 ? Number(customMax) : RATE_LIMIT_MAX;
  const max = admin ? base * RATE_LIMIT_ADMIN_MULTIPLIER : base;
  const key = String(userId);
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    bucket = { windowStart: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (rateBuckets.size > 20000) {
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    for (const [k, v] of rateBuckets) if (v.windowStart < cutoff) rateBuckets.delete(k);
  }
  const lastWarn = rateLastWarn.get(key) ?? 0;
  const shouldWarn = bucket.count > max && now - lastWarn > RATE_WARN_COOLDOWN_MS;
  if (shouldWarn) rateLastWarn.set(key, now);
  return { allowed: bucket.count <= max, count: bucket.count, max, shouldWarn };
}

// ---- Pro feature: usage analytics (searches/commands/inline + top searched words) ----
// Kept in memory and snapshotted to the Durable Object periodically so it survives cold starts.
const ANALYTICS_FLUSH_EVERY = 50;
const ANALYTICS_FLUSH_MS = 120000;
const analyticsState = { searches: 0, commands: 0, inline: 0, topWords: new Map(), lastFlush: Date.now(), pending: 0 };
function trackUsage(kind, word) {
  if (kind === "search") {
    analyticsState.searches += 1;
    if (word) {
      const key = normalize(String(word)).slice(0, 80);
      if (key) analyticsState.topWords.set(key, (analyticsState.topWords.get(key) ?? 0) + 1);
    }
  } else if (kind === "command") {
    analyticsState.commands += 1;
  } else if (kind === "inline") {
    analyticsState.inline += 1;
  }
  analyticsState.pending += 1;
}
async function flushAnalyticsSnapshot(env) {
  if (!env.USERS) return;
  const now = Date.now();
  if (analyticsState.pending < ANALYTICS_FLUSH_EVERY && now - analyticsState.lastFlush < ANALYTICS_FLUSH_MS) return;
  analyticsState.pending = 0;
  analyticsState.lastFlush = now;
  const top = [...analyticsState.topWords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100);
  try {
    const previous = (await storeCall(env, { op: "get", key: "analytics:snapshot" })).value ?? { searches: 0, commands: 0, inline: 0, topWords: [] };
    const mergedTop = new Map(previous.topWords ?? []);
    for (const [word, count] of top) mergedTop.set(word, (mergedTop.get(word) ?? 0) + count);
    const merged = {
      searches: (previous.searches ?? 0) + analyticsState.searches,
      commands: (previous.commands ?? 0) + analyticsState.commands,
      inline: (previous.inline ?? 0) + analyticsState.inline,
      topWords: [...mergedTop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100),
      updatedAt: new Date().toISOString(),
    };
    analyticsState.searches = 0; analyticsState.commands = 0; analyticsState.inline = 0; analyticsState.topWords.clear();
    await storeCall(env, { op: "put", key: "analytics:snapshot", value: merged });
  } catch (error) {
    console.error("Analytics snapshot failed", error instanceof Error ? error.message : "unknown error");
  }
}
async function readAnalyticsReport(env) {
  const persisted = env.USERS ? ((await storeCall(env, { op: "get", key: "analytics:snapshot" })).value ?? null) : null;
  const top = new Map(persisted?.topWords ?? []);
  for (const [word, count] of analyticsState.topWords) top.set(word, (top.get(word) ?? 0) + count);
  return {
    searches: (persisted?.searches ?? 0) + analyticsState.searches,
    commands: (persisted?.commands ?? 0) + analyticsState.commands,
    inline: (persisted?.inline ?? 0) + analyticsState.inline,
    topWords: [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
    updatedAt: persisted?.updatedAt ?? null,
  };
}

// ---- Pro feature: audit log for dictionary edits/appends (ring buffer + DO snapshot) ----
const AUDIT_MAX_MEMORY = 200;
const auditLog = [];
function logAudit(entry) {
  const record = { at: new Date().toISOString(), ...entry };
  auditLog.push(record);
  if (auditLog.length > AUDIT_MAX_MEMORY) auditLog.shift();
  console.log(JSON.stringify({ ev: "audit", ...entry }));
}
async function flushAuditLog(env) {
  if (!env.USERS || !auditLog.length) return;
  try {
    const previous = (await storeCall(env, { op: "get", key: "auditlog:recent" })).value ?? [];
    const merged = [...previous, ...auditLog].slice(-AUDIT_MAX_MEMORY);
    auditLog.length = 0;
    await storeCall(env, { op: "put", key: "auditlog:recent", value: merged });
  } catch (error) {
    console.error("Audit log flush failed", error instanceof Error ? error.message : "unknown error");
  }
}
async function readAuditLog(env) {
  const persisted = env.USERS ? ((await storeCall(env, { op: "get", key: "auditlog:recent" })).value ?? []) : [];
  return [...persisted, ...auditLog].slice(-30).reverse();
}

// ---- Pro feature: send a JSON/CSV file as a Telegram document (used by export & backup) ----
async function sendTextFile(env, chatId, filename, text, caption, mime = "application/json") {
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", String(caption ?? ""));
    form.append("parse_mode", "HTML");
    form.append("document", new Blob([text], { type: mime }), filename);
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) console.error("Telegram sendDocument failed", result.description ?? response.status);
    return result;
  } catch (error) {
    console.error("sendTextFile failed", error instanceof Error ? error.message : "unknown error");
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// ============================================================================
// Admin feature suite: cached DO state + helpers (bans, extra admins,
// maintenance mode, editable welcome, error log, search history, suggestions)
// ============================================================================
const ADMIN_CACHE_TTL = 60000;
const extraAdminsCache = { value: null, at: 0 };
const bansCache = { value: null, at: 0 };
const maintCache = { value: null, at: 0 };
const welcomeCache = { value: null, at: 0 };
async function cachedDoGet(env, key, cache, fallback = null) {
  const now = Date.now();
  if (cache.value !== null || now - cache.at < ADMIN_CACHE_TTL) {
    if (cache.value !== null) return cache.value;
  }
  let value = fallback;
  if (env.USERS) { try { value = (await storeCall(env, { op: "get", key })).value ?? fallback; } catch { value = fallback; } }
  cache.value = value; cache.at = now; return value;
}
function invalidateCache(cache) { cache.value = null; cache.at = 0; }

// ---- Extra admins (merged with the fixed DEFAULT_ADMIN_IDS) ----
async function extraAdminIds(env) {
  const list = await cachedDoGet(env, "admins:list", extraAdminsCache, []);
  return Array.isArray(list) ? list.map(String) : [];
}
async function addExtraAdmin(env, id) {
  const list = await extraAdminIds(env);
  const sid = String(id);
  if (!list.includes(sid)) list.push(sid);
  if (env.USERS) await storeCall(env, { op: "put", key: "admins:list", value: list });
  invalidateCache(extraAdminsCache); extraAdminsSyncAt = 0;
}
async function removeExtraAdmin(env, id) {
  const list = (await extraAdminIds(env)).filter((x) => x !== String(id));
  if (env.USERS) await storeCall(env, { op: "put", key: "admins:list", value: list });
  invalidateCache(extraAdminsCache); extraAdminsSyncAt = 0;
}

// ---- Bans ----
async function bannedSet(env) {
  const obj = await cachedDoGet(env, "bans:list", bansCache, {});
  return obj && typeof obj === "object" ? obj : {};
}
async function isBanned(env, userId) {
  const entry = (await bannedSet(env))[String(userId)];
  if (!entry) return false;
  // Temp bans expire on their own: first check after expiry lifts the ban.
  if (entry.until && new Date(entry.until).getTime() < Date.now()) { await unbanUser(env, userId); return false; }
  return true;
}
async function banUser(env, userId, reason = "") {
  const set = await bannedSet(env);
  set[String(userId)] = { at: new Date().toISOString(), reason: String(reason).slice(0, 120) };
  if (env.USERS) await storeCall(env, { op: "put", key: "bans:list", value: set });
  invalidateCache(bansCache);
  const user = (await getUser(env, userId)) ?? {};
  if (env.USERS && user) await saveUser(env, userId, { ...user, blocked: true, bannedAt: new Date().toISOString() });
}
async function unbanUser(env, userId) {
  const set = await bannedSet(env);
  delete set[String(userId)];
  if (env.USERS) await storeCall(env, { op: "put", key: "bans:list", value: set });
  invalidateCache(bansCache);
  const user = (await getUser(env, userId)) ?? {};
  if (env.USERS && user) { const { blocked, blockedReason, bannedAt, ...rest } = user; await saveUser(env, userId, rest); }
}

// ---- Maintenance mode ----
async function maintenanceOn(env) { return Boolean(await cachedDoGet(env, "maintenance:on", maintCache, false)); }
async function setMaintenance(env, on) {
  if (env.USERS) await storeCall(env, { op: "put", key: "maintenance:on", value: Boolean(on) });
  invalidateCache(maintCache);
}

// ---- Editable welcome caption ----
const DEFAULT_WELCOME_CAPTION = (name) => `مرحبًا بك ${escapeHtml(name)}، في القاموس القبطي الناطق، تفضل الان بكتابة أي كلمة للبحث عنها.`;
async function getWelcomeCaption(env, name) {
  const custom = await cachedDoGet(env, "welcome:caption", welcomeCache, null);
  if (typeof custom === "string" && custom.trim()) return custom.replaceAll("{name}", escapeHtml(name));
  return DEFAULT_WELCOME_CAPTION(name);
}
async function setWelcomeCaption(env, text) {
  if (env.USERS) await storeCall(env, { op: "put", key: "welcome:caption", value: String(text ?? "").slice(0, 900) });
  invalidateCache(welcomeCache);
}
async function resetWelcomeCaption(env) {
  if (env.USERS) await storeCall(env, { op: "delete", key: "welcome:caption" });
  invalidateCache(welcomeCache);
}


// ---- Unanswered searches: what users looked for and the dictionary does not have ----
const missLog = new Map();
const MISS_LOG_MAX = 400;
function trackMiss(query) {
  const key = String(query ?? "").replace(/\s+/gu, " ").trim().slice(0, 80);
  if (!key || key.length < 2) return;
  missLog.set(key, (missLog.get(key) ?? 0) + 1);
  if (missLog.size > MISS_LOG_MAX) { const first = missLog.keys().next().value; if (first) missLog.delete(first); }
}
async function flushMisses(env) {
  if (!env.USERS || !missLog.size) return;
  try {
    const previous = (await storeCall(env, { op: "get", key: "misses:snapshot" })).value ?? {};
    for (const [word, count] of missLog) previous[word] = (previous[word] ?? 0) + count;
    missLog.clear();
    const top = Object.entries(previous).sort((a, b) => b[1] - a[1]).slice(0, 300);
    await storeCall(env, { op: "put", key: "misses:snapshot", value: Object.fromEntries(top) });
  } catch (error) { console.error("Miss log flush failed", error instanceof Error ? error.message : "unknown error"); }
}
async function readMisses(env) {
  const persisted = env.USERS ? ((await storeCall(env, { op: "get", key: "misses:snapshot" })).value ?? {}) : {};
  const merged = new Map(Object.entries(persisted));
  for (const [word, count] of missLog) merged.set(word, (merged.get(word) ?? 0) + count);
  return [...merged.entries()].sort((a, b) => b[1] - a[1]);
}
async function clearMisses(env) {
  missLog.clear();
  if (env.USERS) await storeCall(env, { op: "put", key: "misses:snapshot", value: {} });
}
// Sizes of the in-isolate caches, used by /cacheinfo.
function cacheInfo() {
  const configCaches = [featureFlagsCache, blacklistCache, whitelistCache, whitelistModeCache, banMsgCache, maintMsgCache,
    slowModeCache, extraAdminsCache, bansCache, maintCache, welcomeCache, rateLimitCache, gamifyCache, apiKeyCache,
    wodCache, autoReplyCache, searchLimitCache, alertsCache, templatesCache, optOutCache, notesCache];
  return [
    ["كاش الإعدادات الممتلئ", configCaches.filter((cache) => cache.value !== null).length],
    ["آخر عمليات البحث (الذاكرة)", recentSearches.length],
    ["سجل الكلمات بلا نتائج", missLog.size],
    ["سجل الأخطاء", errorLog.length],
    ["سجل تدقيق القاموس", auditLog.length],
    ["سجل تاريخ البحث", userHistory.size],
    ["كاش المستخدمين المسجلين", registeredCache.size],
    ["أكثر الكلمات بحثًا (الذاكرة)", analyticsState.topWords.size],
    ["آخر بحث لكل مستخدم", lastUserSearchAt.size],
  ];
}

// ---- Error log (ring buffer + DO snapshot) ----
const errorLog = [];
const ERROR_LOG_MAX = 50;
function logError(env, error, context = {}) {
  const entry = { at: new Date().toISOString(), message: error instanceof Error ? error.message : String(error ?? "unknown"), stack: error instanceof Error ? String(error.stack ?? "").slice(0, 400) : "", ...context };
  errorLog.push(entry);
  if (errorLog.length > ERROR_LOG_MAX) errorLog.shift();
  console.error("captured error", JSON.stringify(entry).slice(0, 500));
}
async function flushErrorLog(env) {
  if (!env.USERS || !errorLog.length) return;
  try {
    const previous = (await storeCall(env, { op: "get", key: "errors:recent" })).value ?? [];
    const merged = [...previous, ...errorLog].slice(-ERROR_LOG_MAX);
    errorLog.length = 0;
    await storeCall(env, { op: "put", key: "errors:recent", value: merged });
  } catch {}
}
async function readErrorLog(env) {
  const persisted = env.USERS ? ((await storeCall(env, { op: "get", key: "errors:recent" })).value ?? []) : [];
  return [...persisted, ...errorLog].slice(-20).reverse();
}

// ---- Per-user search history (in-memory ring + DO snapshot) ----
const userHistory = new Map();
const USER_HISTORY_MAX = 30;
function trackSearchHistory(userId, query) {
  const key = String(userId);
  const arr = userHistory.get(key) ?? [];
  arr.push({ q: String(query).slice(0, 80), at: new Date().toISOString() });
  if (arr.length > USER_HISTORY_MAX) arr.shift();
  userHistory.set(key, arr);
  if (userHistory.size > 8000) { const first = userHistory.keys().next().value; if (first) userHistory.delete(first); }
}
async function flushUserHistory(env) {
  if (!env.USERS || !userHistory.size) return;
  try {
    const previous = (await storeCall(env, { op: "get", key: "history:snapshot" })).value ?? {};
    for (const [key, arr] of userHistory) previous[key] = [...(previous[key] ?? []), ...arr].slice(-USER_HISTORY_MAX);
    userHistory.clear();
    await storeCall(env, { op: "put", key: "history:snapshot", value: previous });
  } catch {}
}
async function getUserHistory(env, userId) {
  const key = String(userId);
  const persisted = env.USERS ? (((await storeCall(env, { op: "get", key: "history:snapshot" })).value ?? {})[key] ?? []) : [];
  return [...persisted, ...(userHistory.get(key) ?? [])].slice(-20).reverse();
}

// ---- Word suggestion box (public /suggest, admin approve/reject) ----
async function listSuggestions(env) {
  if (!env.USERS) return [];
  return (await storeCall(env, { op: "get", key: "suggestions:pending" })).value ?? [];
}
async function addSuggestion(env, userId, text) {
  if (!env.USERS) return null;
  const list = await listSuggestions(env);
  const entry = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, userId: String(userId), text: String(text).slice(0, 400), at: new Date().toISOString() };
  list.push(entry);
  await storeCall(env, { op: "put", key: "suggestions:pending", value: list.slice(-100) });
  return entry;
}
async function takeSuggestion(env, id) {
  if (!env.USERS) return null;
  const list = await listSuggestions(env);
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const [entry] = list.splice(idx, 1);
  await storeCall(env, { op: "put", key: "suggestions:pending", value: list });
  return entry;
}

// ---- Dictionary stats ----
function dictionaryStats(voiceIds = new Set()) {
  const byKind = new Map(); const byOrigin = new Map(); let missingVoice = 0; let withVoice = 0;
  for (const record of records) {
    if (record._deleted) continue;
    byKind.set(String(record.kind ?? "—"), (byKind.get(String(record.kind ?? "—")) ?? 0) + 1);
    byOrigin.set(String(record.origin ?? "—"), (byOrigin.get(String(record.origin ?? "—")) ?? 0) + 1);
    if (record.id != null && voiceIds.has(Number(record.id))) withVoice += 1; else missingVoice += 1;
  }
  const top = [...records].filter((r) => !r._deleted).sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0)).slice(0, 10);
  return { total: records.filter((r) => !r._deleted).length, byKind: [...byKind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8), byOrigin: [...byOrigin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8), withVoice, missingVoice, recent: top };
}

// ---- Duplicate detection (exact normalized coptic + exact normalized meaning) ----
function findDuplicates() {
  const byCoptic = new Map();
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record._deleted) continue;
    const key = normalize(record.coptic);
    if (!key) continue;
    (byCoptic.get(key) ?? byCoptic.set(key, []).get(key)).push({ index: i, coptic: record.coptic, meaning: String(record.meaning ?? "").slice(0, 40), row: i + 2 });
  }
  return [...byCoptic.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length).slice(0, 15);
}

// ---- Force resync: refetch dictionary.json from GitHub raw and repopulate records ----
const DICTIONARY_RAW_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/data/dictionary.json`;
async function resyncDictionary(env) {
  const response = await fetch(DICTIONARY_RAW_URL, { headers: { "user-agent": "coptic-dictionary-bot" } });
  if (!response.ok) throw new Error(`GitHub raw returned ${response.status}`);
  const fetched = await response.json();
  if (!Array.isArray(fetched) || !fetched.length) throw new Error("fetched dictionary is empty");
  records.length = 0;
  records.push(...fetched);
  SEARCH_INDEX_CACHE.clear();
  return { count: fetched.length };
}

// ============================================================================
// Batch 2 admin features
// ============================================================================
// Custom rate limit (admin-adjustable, DO-stored, cached in memory).
const rateLimitCache = { value: null, at: 0 };
async function customRateLimit(env) {
  const v = await cachedDoGet(env, "ratelimit:max", rateLimitCache, null);
  return Number(v) > 0 ? Number(v) : RATE_LIMIT_MAX;
}
// Gamification: points per search + day streak; in-memory buffer flushed to DO.
const gamifyCache = { value: null, at: 0 };
const gamifyScores = new Map(); // userId -> { points, name, lastDay, streak }
let gamifyFlushAt = 0;
async function gamifyOn(env) { return Boolean(await cachedDoGet(env, "gamify:on", gamifyCache, false)); }
function trackGamify(userId, name) {
  const key = String(userId);
  const today = utcDay();
  const entry = gamifyScores.get(key) ?? { points: 0, name: String(name ?? "").slice(0, 40), lastDay: "", streak: 0 };
  entry.points += 1;
  if (entry.lastDay !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    entry.streak = entry.lastDay === yesterday ? (entry.streak ?? 0) + 1 : 1;
    entry.lastDay = today;
  }
  gamifyScores.set(key, entry);
  if (gamifyScores.size > 5000) { const first = gamifyScores.keys().next().value; if (first) gamifyScores.delete(first); }
}
async function flushGamify(env) {
  if (!env.USERS || !gamifyScores.size) return;
  const now = Date.now();
  if (now - gamifyFlushAt < 60000) return;
  gamifyFlushAt = now;
  try {
    const previous = (await storeCall(env, { op: "get", key: "gamify:scores" })).value ?? {};
    for (const [key, e] of gamifyScores) {
      const prev = previous[key] ?? { points: 0, streak: 0, lastDay: "" };
      previous[key] = { points: (prev.points ?? 0) + e.points, streak: Math.max(prev.streak ?? 0, e.streak), lastDay: e.lastDay || prev.lastDay, name: e.name || prev.name };
    }
    gamifyScores.clear();
    await storeCall(env, { op: "put", key: "gamify:scores", value: previous });
  } catch {}
}
async function leaderboardTop(env, n = 10) {
  const persisted = env.USERS ? ((await storeCall(env, { op: "get", key: "gamify:scores" })).value ?? {}) : {};
  for (const [key, e] of gamifyScores) {
    const prev = persisted[key] ?? { points: 0, name: e.name };
    persisted[key] = { ...prev, points: (prev.points ?? 0) + e.points, name: e.name || prev.name };
  }
  return Object.entries(persisted).sort((a, b) => (b[1].points ?? 0) - (a[1].points ?? 0)).slice(0, n);
}
// API keys (DO-stored set) + in-memory per-key rate limit.
const apiKeyCache = { value: null, at: 0 };
const apiKeyHits = new Map();
async function validApiKey(env, key) {
  const keys = await cachedDoGet(env, "apikeys:list", apiKeyCache, []);
  return Array.isArray(keys) && keys.includes(String(key));
}
function apiKeyAllowed(key) {
  const now = Date.now(); const k = String(key);
  const bucket = apiKeyHits.get(k) ?? { at: now, count: 0 };
  if (now - bucket.at > 60000) { bucket.at = now; bucket.count = 0; }
  bucket.count += 1; apiKeyHits.set(k, bucket);
  return bucket.count <= 120;
}
// Referral links: count new users per campaign.
async function trackReflink(env, campaign) {
  if (!env.USERS || !campaign) return;
  const key = `reflinks:${String(campaign).slice(0, 30)}`;
  try {
    const current = (await storeCall(env, { op: "get", key })).value ?? 0;
    await storeCall(env, { op: "put", key, value: current + 1 });
  } catch {}
}
// Spam suspects (users who repeatedly hit the rate limit).
const spamSuspects = new Set();
function markSpamSuspect(userId) { spamSuspects.add(String(userId)); if (spamSuspects.size > 500) spamSuspects.clear(); }
// Anki export: Front=Coptic, Back=meaning+pronunciation+origin.
async function exportAnki(env, chatId) {
  const rows = [["#separator:Comma"], ["#html:true"], ["#columns:Front,Back"], ["Front", "Back"]];
  for (const record of records) {
    if (record._deleted) continue;
    const front = String(record.coptic ?? "").replaceAll('"', '""');
    const back = [record.meaning, record.pronunciation ? `(${record.pronunciation})` : "", record.origin].filter(Boolean).join(" — ").replaceAll('"', '""');
    if (front) rows.push([`"${front}"`, `"${back}"`]);
    if (rows.length > 20000) break;
  }
  const csv = rows.map((r) => r.join(",")).join("\n");
  const stamp = new Date().toISOString().slice(0, 10);
  await sendTextFile(env, chatId, `coptic-anki-${stamp}.csv`, csv, `🃏 تصدير Anki: ${rows.length - 4} بطاقة.`, "text/csv");
}

// Admin uploads a voice/audio file; the bot downloads it, base64-encodes it, and calls the
// existing Apps Script "upload" action (which requires audio_base64).
async function uploadAdminAudio(env, message, userId, admin) {
  const fileId = message.voice?.file_id ?? message.audio?.file_id;
  const word = String(admin?.adminFlow?.word ?? "");
  const info = await telegram(env, "getFile", { file_id: fileId });
  if (!info?.ok) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "❌ تعذّر الحصول على ملف الصوت من تيليجرام." }); return; }
  const fileResp = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${info.result.file_path}`);
  if (!fileResp.ok) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "❌ تعذّر تنزيل ملف الصوت." }); return; }
  const bytes = new Uint8Array(await fileResp.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  const base64 = btoa(binary);
  const config = await driveConfig(env);
  if (!config) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "❌ لم يتم ربط Google Sheets/Drive." }); return; }
  let result;
  try {
    result = await callAppsScript(config, {
      action: "upload", word, audio_base64: base64,
      mime: message.voice ? "audio/ogg" : (message.audio?.mime_type ?? "audio/mpeg"),
      duration: message.voice?.duration ?? message.audio?.duration ?? 0,
      by: { id: String(userId), name: String(admin?.name ?? ""), username: message.from?.username ?? "" },
    });
  } catch (error) { result = { ok: false, error: error instanceof Error ? error.message : "unknown" }; }
  if (result?.ok) {
    await clearAdminFlow(env, userId);
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ تم رفع الصوت لكلمة «${escapeHtml(word.slice(0, 40))}» إلى Drive وورقة upload.` });
  } else {
    const err = String(result?.error ?? "");
    if (err.includes("unknown action") || err.includes("audio_base64")) await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "❌ نسخة Apps Script قديمة — انشر Code.gs مرة أخرى." });
    else await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `❌ فشل الرفع: ${err}` });
  }
}

async function flushUsage(env, day, count) {
  try {
    const result = await storeCall(env, { op: "usage", profile: { day }, limit: count });
    if (result?.alert) {
      const percent = Math.round((result.total / DAILY_REQUEST_LIMIT) * 100);
      await notifyAdmins(env, `⚠️ <b>تنبيه الاستخدام</b>\nوصلت طلبات اليوم إلى ${Number(result.total).toLocaleString("en-US")} من ${DAILY_REQUEST_LIMIT.toLocaleString("en-US")} (${percent}%).\nعند الوصول للحد يتوقف البوت حتى تصفير العدّاد. أرسل /usage للتفاصيل.`);
    }
  } catch (error) {
    console.error("Usage count failed", error instanceof Error ? error.message : "unknown error");
  }
}

// Called for every request the Worker receives; sends one batched write per ~20 requests.
function countRequest(env, ctx) {
  if (!env.USERS) return;
  const day = utcDay();
  const now = Date.now();
  if (usageState.day && usageState.day !== day && usageState.pending) {
    const previous = { day: usageState.day, count: usageState.pending };
    usageState.pending = 0;
    inBackground(ctx, flushUsage(env, previous.day, previous.count));
  }
  usageState.day = day;
  usageState.pending += 1;
  if (usageState.pending >= USAGE_FLUSH_EVERY || now - usageState.flushedAt >= USAGE_FLUSH_MS) {
    const count = usageState.pending;
    usageState.pending = 0;
    usageState.flushedAt = now;
    inBackground(ctx, flushUsage(env, day, count));
  }
}

async function sendUsageReport(env, chatId) {
  if (!env.USERS) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "العدّاد يحتاج تخزين المستخدمين (Durable Object) وهو غير مفعّل." });
    return;
  }
  const report = await storeCall(env, { op: "usageReport", limit: 8 });
  const today = utcDay();
  const rows = report.days.map((item) => ({ ...item }));
  const todayRow = rows.find((item) => item.day === today);
  const pending = usageState.day === today ? usageState.pending : 0;
  if (todayRow) todayRow.count += pending;
  else rows.unshift({ day: today, count: pending });
  const used = rows.find((item) => item.day === today).count;
  const remaining = Math.max(0, DAILY_REQUEST_LIMIT - used);
  const nextReset = new Date(`${today}T00:00:00Z`);
  nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  const resetAt = new Intl.DateTimeFormat("ar-EG", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" }).format(nextReset);
  const fmt = (value) => Number(value).toLocaleString("en-US");
  const lines = [
    `📊 <b>طلبات البوت اليوم</b> (UTC ${today})`,
    `المستخدَم: <b>${fmt(used)}</b> من ${fmt(DAILY_REQUEST_LIMIT)} (${((used / DAILY_REQUEST_LIMIT) * 100).toFixed(1)}%)`,
    `المتبقي: <b>${fmt(remaining)}</b>`,
    `يتصفّر العدّاد الساعة ${resetAt} بتوقيت القاهرة`,
    "",
    "<b>آخر الأيام:</b>",
    ...rows.slice(0, 7).map((item) => `${item.day}: ${fmt(item.count)}`),
    "",
    "العدّاد تقديري وقد ينقص بضع عشرات من الطلبات. سأنبّهك تلقائيًا عند 50% و80% و95%.",
  ];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n"), parse_mode: "HTML" });
}

// ---- Pro feature: usage analytics report (searches/commands/inline + top searched words) ----
async function sendAnalyticsReport(env, chatId) {
  const report = await readAnalyticsReport(env);
  const fmt = (value) => Number(value).toLocaleString("en-US");
  const topLines = report.topWords.length
    ? report.topWords.map(([word, count], i) => `${i + 1}. ${escapeHtml(word.slice(0, 50))} — ${fmt(count)}`).join("\n")
    : "لا توجد عمليات بحث مسجلة بعد.";
  const lines = [
    "📈 <b>تحليلات الاستخدام</b>",
    `عمليات البحث: <b>${fmt(report.searches)}</b>`,
    `الأوامر: <b>${fmt(report.commands)}</b>`,
    `Inline: <b>${fmt(report.inline)}</b>`,
    "",
    "<b>أكثر الكلمات بحثًا:</b>",
    topLines,
  ];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n"), parse_mode: "HTML" });
}

// ---- Pro feature: dictionary audit log report ----
async function sendAuditLogReport(env, chatId) {
  const entries = await readAuditLog(env);
  if (!entries.length) { await telegram(env, "sendMessage", { chat_id: chatId, text: "📋 سجل التدقيق فارغ؛ لم تتم أي تعديلات على القاموس بعد." }); return; }
  const lines = ["📋 <b>سجل تدقيق تعديلات القاموس</b> (آخر 30):", ""];
  for (const entry of entries) {
    const action = entry.action === "dictionary_append" ? "➕ إضافة صف" : "✏️ تعديل عمود";
    const detail = entry.action === "dictionary_append"
      ? `صف ${entry.row}: ${escapeHtml(String(entry.coptic ?? "").slice(0, 40))}`
      : `صف ${entry.row} [${escapeHtml(String(entry.coptic ?? "").slice(0, 30))}] — ${escapeHtml(String(entry.column ?? ""))}: «${escapeHtml(String(entry.old ?? "").slice(0, 25))}» → «${escapeHtml(String(entry.new ?? "").slice(0, 25))}»`;
    lines.push(`• ${entry.at?.slice(0, 19) ?? ""} ${action} (${entry.userId ?? "?"})\n  ${detail}`);
  }
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3500), parse_mode: "HTML" });
}

// ---- Pro feature: export dictionary.json / users CSV as files ----
async function exportDictionary(env, chatId) {
  const snapshot = JSON.stringify(records, null, 1);
  const stamp = new Date().toISOString().slice(0, 10);
  await sendTextFile(env, chatId, `dictionary-${stamp}.json`, snapshot, `📦 تصدير القاموس: ${records.length.toLocaleString("en-US")} سجل.`);
}
async function exportUsersCsv(env, chatId) {
  if (!env.USERS) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ تخزين المستخدمين غير مفعّل." }); return; }
  const rows = [["user_id", "name", "username", "first_seen", "registered_at", "blocked"]];
  let cursor = null;
  for (;;) {
    const page = await storeCall(env, { op: "userpage", limit: 200, ...(cursor ? { cursor } : {}) });
    for (const { id, record } of page.users ?? []) {
      rows.push([id, record?.name ?? "", record?.username ?? "", record?.firstSeen ?? "", record?.registeredAt ?? "", record?.blocked ? "yes" : "no"]);
    }
    cursor = page.next;
    if (!cursor || rows.length > 5000) break;
  }
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const stamp = new Date().toISOString().slice(0, 10);
  await sendTextFile(env, chatId, `users-${stamp}.csv`, csv, `👥 تصدير المستخدمين: ${rows.length - 1} مستخدم.`, "text/csv");
}

// ---- Pro feature: backup snapshot of the dictionary (sent as file to admin) ----
async function sendBackup(env, chatId) {
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const payload = { backedUpAt: new Date().toISOString(), recordsCount: records.length, records };
  await sendTextFile(env, chatId, `backup-dictionary-${stamp}.json`, JSON.stringify(payload), `💾 نسخة احتياطية من القاموس (${records.length.toLocaleString("en-US")} سجل).`);
}

// ---- Admin feature: users list / user info ----
async function sendUsersList(env, chatId, query) {
  if (!env.USERS) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ تخزين المستخدمين غير مفعّل." }); return; }
  const q = normalize(query);
  const page = await storeCall(env, { op: "userpage", limit: 60 });
  const bans = await bannedSet(env);
  const lines = [`👥 <b>المستخدمون</b> (آخر ${page.users.length} من إجمالي أكبر):`, ""];
  for (const { id, record } of page.users ?? []) {
    if (q && !normalize(`${record?.name ?? ""} ${record?.username ?? ""} ${id}`).includes(q)) continue;
    const bannedTag = bans[id] || record?.blocked ? " 🚫" : "";
    lines.push(`• <code>${escapeHtml(id)}</code> — ${escapeHtml(String(record?.name ?? record?.tgName ?? "بدون اسم").slice(0, 30))}${record?.username ? ` (@${escapeHtml(record.username)})` : ""}${bannedTag}`);
  }
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3500), parse_mode: "HTML" });
}
async function sendUserInfo(env, chatId, id) {
  if (!/^\d+$/u.test(id)) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ الاستخدام: /userinfo <user_id>" }); return; }
  const user = await getUser(env, id);
  const history = await getUserHistory(env, id);
  const bans = await bannedSet(env);
  const lines = [
    `👤 <b>معلومات المستخدم</b> <code>${escapeHtml(id)}</code>`,
    `الاسم: ${escapeHtml(String(user?.name ?? "—"))}`,
    `Username: ${user?.username ? "@" + escapeHtml(user.username) : "—"}`,
    `انضم: ${escapeHtml(String(user?.firstSeen ?? user?.registeredAt ?? "—"))}`,
    `محظور: ${bans[id] || user?.blocked ? "🚫 نعم" : "لا"}`,
    `آخر عمليات البحث (${history.length}):`,
    ...history.slice(0, 10).map((h) => `• ${h.at?.slice(11, 16) ?? ""} ${escapeHtml(String(h.q ?? "").slice(0, 50))}`),
  ];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n"), parse_mode: "HTML" });
}

// ---- Admin feature: dictionary stats ----
async function sendDictStats(env, chatId) {
  const voiceIds = env.USERS ? new Set((await storeCall(env, { op: "voiceIds" })).ids ?? []) : new Set();
  const stats = dictionaryStats(voiceIds);
  const fmt = (n) => Number(n).toLocaleString("en-US");
  const lines = [
    "📚 <b>إحصائيات القاموس</b>",
    `إجمالي الكلمات: <b>${fmt(stats.total)}</b>`,
    `لها صوت: <b>${fmt(stats.withVoice)}</b>`,
    `ناقصة صوت: <b>${fmt(stats.missingVoice)}</b>`,
    "",
    "<b>التوزيع حسب النوع (kind):</b>",
    ...stats.byKind.map(([k, v]) => `• ${escapeHtml(k)}: ${fmt(v)}`),
    "",
    "<b>آخر 10 كلمات مضافة (حسب المعرّف):</b>",
    ...stats.recent.map((r) => `• ${escapeHtml(String(r.coptic ?? "—").slice(0, 30))} — ${escapeHtml(String(r.meaning ?? "").slice(0, 30))}`),
  ];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3500), parse_mode: "HTML" });
}

// ---- Admin feature: error log report ----
async function sendErrorLogReport(env, chatId) {
  const entries = await readErrorLog(env);
  if (!entries.length) { await telegram(env, "sendMessage", { chat_id: chatId, text: "✅ سجل الأخطاء فارغ." }); return; }
  const lines = ["⚠️ <b>آخر الأخطاء الملتقطة:</b>", ""];
  for (const e of entries) lines.push(`• ${e.at?.slice(0, 19) ?? ""} [${escapeHtml(String(e.where ?? "?"))}] ${escapeHtml(String(e.message ?? "").slice(0, 120))}`);
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3500), parse_mode: "HTML" });
}

// ---- Admin feature: duplicate words report ----
async function sendDuplicatesReport(env, chatId) {
  const groups = findDuplicates();
  if (!groups.length) { await telegram(env, "sendMessage", { chat_id: chatId, text: "✅ لم أجد كلمات مكررة (بناءً على الكلمة القبطية بعد التطبيع)." }); return; }
  const lines = [`🔁 <b>كلمات مكررة محتملة</b> (${groups.length} مجموعة):`, ""];
  for (const group of groups.slice(0, 10)) {
    lines.push(`<b>مجموعة ${group.length} كلمات:</b>`);
    for (const item of group) lines.push(`• صف ${item.row}: ${escapeHtml(String(item.coptic).slice(0, 30))} — ${escapeHtml(item.meaning)}`);
    lines.push("");
  }
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3500), parse_mode: "HTML" });
}

// ---- Batch 4 admin reports: integrity, top users, hourly, missing pronounce/audio, find empty, live searches, admin audit ----
async function sendIntegrityReport(env, chatId) {
  let missingCoptic = 0, missingMeaning = 0, missingPron = 0, missingId = 0, emptyFields = new Map();
  const fields = ["coptic", "greek", "pronunciation", "english", "phonetic", "arabic_pronunciation", "kind", "gender", "meaning"];
  for (const rec of records) {
    if (rec._deleted) continue;
    if (!String(rec.coptic ?? "").trim()) missingCoptic += 1;
    if (!String(rec.meaning ?? "").trim()) missingMeaning += 1;
    if (!String(rec.pronunciation ?? "").trim()) missingPron += 1;
    if (!String(rec.id ?? "").trim()) missingId += 1;
    for (const f of fields) if (!String(rec[f] ?? "").trim()) emptyFields.set(f, (emptyFields.get(f) ?? 0) + 1);
  }
  const lines = [
    "🔍 <b>تقرير سلامة القاموس</b>", "",
    `📚 إجمالي السجلات: <b>${records.length.toLocaleString("en-US")}</b>`,
    `❌ كلمة قبطية ناقصة: <b>${missingCoptic}</b>`,
    `❌ معنى ناقص: <b>${missingMeaning}</b>`,
    `🔇 بدون نطق: <b>${missingPron}</b>`,
    `🆔 بدون معرّف صوت: <b>${missingId}</b>`, "",
    "<b>الحقول الفاضية:</b>",
    ...[...emptyFields.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `• ${f}: ${n}`),
  ];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3500), parse_mode: "HTML" });
}
async function sendTopUsersReport(env, chatId) {
  if (!env.USERS) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ غير مفعّل (لا يوجد تخزين مستخدمين)." }); return; }
  const all = await storeCall(env, { op: "userpage", limit: 500 });
  const users = (all.users ?? []).map(({ id, record }) => ({ id, searches: Number(record?.searches ?? record?.searchCount ?? 0), name: record?.name ?? record?.tgName ?? "—", username: record?.username ?? "" })).filter((u) => u.searches > 0).sort((a, b) => b.searches - a.searches).slice(0, 20);
  if (!users.length) { await telegram(env, "sendMessage", { chat_id: chatId, text: "📭 لا توجد بيانات بحث بعد." }); return; }
  const lines = ["🏆 <b>أكثر المستخدمين نشاطًا</b>", "", ...users.map((u, i) => `${i + 1}. <code>${escapeHtml(u.id)}</code> — ${escapeHtml(String(u.name).slice(0, 25))}${u.username ? ` (@${escapeHtml(u.username)})` : ""}: <b>${u.searches}</b> بحث`)];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3500), parse_mode: "HTML" });
}
async function sendHourlyReport(env, chatId) {
  const hours = new Map();
  for (const s of recentSearches) { const h = new Date(s.at).getHours(); hours.set(h, (hours.get(h) ?? 0) + 1); }
  if (!hours.size) { await telegram(env, "sendMessage", { chat_id: chatId, text: "📭 لا توجد عمليات بحث مسجلة في الجلسة الحالية." }); return; }
  const max = Math.max(...hours.values());
  const lines = ["🕐 <b>توزيع البحث حسب الساعة</b> (الجلسة الحالية)", ""];
  for (let h = 0; h < 24; h += 1) {
    const n = hours.get(h) ?? 0;
    if (n === 0 && ![0, 6, 12, 18].includes(h)) continue;
    const bar = "█".repeat(Math.round((n / max) * 12));
    lines.push(`${String(h).padStart(2, "0")}:00 ${bar} ${n}`);
  }
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3500), parse_mode: "HTML" });
}
async function sendMissingPronounceReport(env, chatId, limit = 30) {
  const missing = records.filter((r) => !r._deleted && !String(r.pronunciation ?? "").trim()).slice(0, limit);
  const total = records.filter((r) => !r._deleted && !String(r.pronunciation ?? "").trim()).length;
  if (!total) { await telegram(env, "sendMessage", { chat_id: chatId, text: "✅ كل الكلمات لها نطق." }); return; }
  const lines = [`🔇 <b>كلمات بدون نطق</b>: ${total} (عرض أول ${missing.length})`, "", ...missing.map((r, i) => `${i + 1}. صف ${records.indexOf(r) + 2}: <b>${escapeHtml(String(r.coptic ?? "—").slice(0, 30))}</b> — ${escapeHtml(String(r.meaning ?? "").slice(0, 50))}`)];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3500), parse_mode: "HTML" });
}
async function sendMissingAudioReport(env, chatId, limit = 30) {
  const manifest = await loadAudioManifest(env).catch(() => ({}));
  const have = new Set(Object.keys(manifest ?? {}));
  const missing = records.filter((r) => !r._deleted && String(r.pronunciation ?? "").trim() && !have.has(String(r.id ?? ""))).slice(0, limit);
  const total = records.filter((r) => !r._deleted && String(r.pronunciation ?? "").trim() && !have.has(String(r.id ?? ""))).length;
  if (!total) { await telegram(env, "sendMessage", { chat_id: chatId, text: "✅ كل الكلمات ذات النطق لها صوت." }); return; }
  const lines = [`🔊 <b>كلمات لها نطق لكن بدون صوت</b>: ${total} (عرض أول ${missing.length})`, "", ...missing.map((r, i) => `${i + 1}. <b>${escapeHtml(String(r.coptic ?? "—").slice(0, 30))}</b> — ${escapeHtml(String(r.meaning ?? "").slice(0, 50))}`)];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3500), parse_mode: "HTML" });
}
async function sendFindEmptyReport(env, chatId, fieldArg, limit = 30) {
  const fieldMap = { a: "coptic", b: "greek", c: "pronunciation", d: "english", e: "phonetic", f: "arabic_pronunciation", g: "kind", h: "gender", i: "meaning" };
  const field = fieldMap[String(fieldArg ?? "").toLowerCase()] || (DICTIONARY_LOCAL_FIELDS.includes(fieldArg) ? fieldArg : null);
  if (!field) { await telegram(env, "sendMessage", { chat_id: chatId, text: `✏️ الاستخدام: /findempty <حقل A-I أو اسم الحقل>\nالحقول: ${Object.entries(fieldMap).map(([k, v]) => `${k}=${v}`).join(", ")}` }); return; }
  const missing = records.filter((r) => !r._deleted && !String(r[field] ?? "").trim()).slice(0, limit);
  const total = records.filter((r) => !r._deleted && !String(r[field] ?? "").trim()).length;
  if (!total) { await telegram(env, "sendMessage", { chat_id: chatId, text: `✅ لا توجد خلايا فاضية في الحقل «${field}».` }); return; }
  const lines = [`📭 <b>سجلات فاضية في الحقل «${field}»</b>: ${total} (عرض أول ${missing.length})`, "", ...missing.map((r, i) => `${i + 1}. صف ${records.indexOf(r) + 2}: <b>${escapeHtml(String(r.coptic ?? "—").slice(0, 30))}</b>`)];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3500), parse_mode: "HTML" });
}
async function sendLiveSearchesReport(env, chatId) {
  if (!recentSearches.length) { await telegram(env, "sendMessage", { chat_id: chatId, text: "📭 لا توجد عمليات بحث في الجلسة الحالية." }); return; }
  const lines = ["🔴 <b>آخر عمليات البحث المباشرة</b>", "", ...recentSearches.slice(-20).reverse().map((s) => `• [${new Date(s.at).toLocaleTimeString("en-GB")}] <code>${escapeHtml(s.userId)}</code> ${escapeHtml(s.name ? `(${s.name})` : "")}: ${escapeHtml(s.query)}`)];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3500), parse_mode: "HTML" });
}
async function sendAdminAuditReport(env, chatId) {
  const list = await readAdminAudit(env);
  if (!list.length) { await telegram(env, "sendMessage", { chat_id: chatId, text: "📭 لا توجد إجراءات إدارية مسجلة بعد." }); return; }
  const lines = ["📋 <b>سجل إجراءات الأدمن</b> (آخر 30)", "", ...list.slice(0, 30).map((e) => `• ${escapeHtml(e.at?.slice(0, 19) ?? "")} <code>${escapeHtml(e.admin)}</code>: <b>${escapeHtml(e.action)}</b>${e.detail ? ` — ${escapeHtml(e.detail)}` : ""}`)];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3500), parse_mode: "HTML" });
}
async function exportSearchHistoryCsv(env, chatId) {
  const rows = [["timestamp", "user_id", "user_name", "query"]];
  for (const s of recentSearches) rows.push([new Date(s.at).toISOString(), s.userId, s.name, s.query]);
  const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  await sendTextFile(env, chatId, "search_history.csv", csv, "📥 تم تصدير سجل البحث (الجلسة الحالية).", "text/csv");
}
async function resetAnalyticsData(env, chatId) {
  if (env.USERS) await storeCall(env, { op: "put", key: "analytics:snapshot", value: { searches: 0, commands: 0, inline: 0, topWords: [], updatedAt: new Date().toISOString() } });
  analyticsState.searches = 0; analyticsState.commands = 0; analyticsState.inline = 0; analyticsState.topWords.clear();
  recentSearches.length = 0;
  await telegram(env, "sendMessage", { chat_id: chatId, text: "✅ تم تصفير التحليلات وسجل البحث المباشر." });
}
async function importUserIds(env, chatId, rawText) {
  if (!env.USERS) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ تخزين المستخدمين غير مفعّل." }); return; }
  const ids = [...new Set((rawText.match(/\d{5,}/g) ?? []).map(String))].slice(0, 5000);
  if (!ids.length) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ لم أجد أي معرّفات صالحة (أرقام من 5 أرقام فأكثر)." }); return; }
  await telegram(env, "sendMessage", { chat_id: chatId, text: `⏳ جارٍ استيراد ${ids.length} مستخدم…` });
  const result = await storeCall(env, { op: "bulk_import_users", ids }).catch((e) => ({ error: String(e) }));
  await logAdminAction(env, chatId, "importusers", `${ids.length} ids`);
  if (result?.error) { await telegram(env, "sendMessage", { chat_id: chatId, text: `❌ فشل الاستيراد: ${result.error}` }); return; }
  await telegram(env, "sendMessage", { chat_id: chatId, text: `✅ تم الاستيراد: ${result?.imported ?? ids.length} مستخدم جديد${result?.skipped ? ` (تم تخطي ${result.skipped} مسجلين مسبقًا)` : ""}.\nالآن يمكنك استخدام /broadcast وسيصل لجميعهم.` });
}
async function importFromSheet(env, chatId, arg) {
  if (!env.USERS) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ تخزين المستخدمين غير مفعّل." }); return; }
  const parts = arg.split(/\s+/u);
  const url = parts[0];
  const sheetName = parts.slice(1).join(" ") || "bot";
  const sheetIdMatch = url.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (!sheetIdMatch) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ رابط الورقة غير صالح. استخدم رابط docs.google.com/spreadsheets/d/..." }); return; }
  const sheetId = sheetIdMatch[1];
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  await telegram(env, "sendMessage", { chat_id: chatId, text: `⏳ جارٍ جلب الورقة «${escapeHtml(sheetName)}»…` });
  try {
    const resp = await fetch(csvUrl, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const csvText = await resp.text();
    const ids = [...new Set((csvText.match(/^"?(\d{5,})"?/gm) ?? []).map((m) => m.replace(/"/g, "").trim()))].slice(0, 5000);
    if (!ids.length) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ لم أجد أي معرّفات في العمود الأول. تأكد من اسم التبويب." }); return; }
    await telegram(env, "sendMessage", { chat_id: chatId, text: `⏳ تم العثور على ${ids.length} معرّف. جارٍ التسجيل…` });
    const result = await storeCall(env, { op: "bulk_import_users", ids }).catch((e) => ({ error: String(e) }));
    await logAdminAction(env, chatId, "importsheet", `${ids.length} ids from ${sheetId}/${sheetName}`);
    if (result?.error) { await telegram(env, "sendMessage", { chat_id: chatId, text: `❌ فشل الاستيراد: ${result.error}` }); return; }
    await telegram(env, "sendMessage", { chat_id: chatId, text: `✅ تم الاستيراد من الورقة: ${result?.imported ?? ids.length} مستخدم جديد${result?.skipped ? ` (تم تخطي ${result.skipped} مسجلين مسبقًا)` : ""}.\nالآن يمكنك استخدام /broadcast وسيصل لجميعهم.` });
  } catch (error) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: `❌ فشل جلب الورقة: ${error instanceof Error ? error.message : "unknown"}.\nتأكد أن الورقة عامة (أي شخص لديه الرابط يمكنه الاطلاع).` });
  }
}

// Recovers users who contacted the bot during a maintenance window: every text search was logged
// (history/gamify/recent) before the maintenance early-return, but their ids were never registered.
// Users who only sent /start and nothing else left no trace and cannot be recovered automatically.
async function recoverMissingUsers(env, chatId, ctx) {
  if (!env.USERS) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ تخزين المستخدمين غير مفعّل." }); return; }
  await telegram(env, "sendMessage", { chat_id: chatId, text: "⏳ جارٍ فحص السجلات لاسترجاع مستخدمي فترة الصيانة…" });
  const candidateIds = new Set();
  const namesById = new Map();
  const addId = (id, name) => {
    const s = String(id ?? "");
    if (/^\d{5,}$/.test(s)) {
      candidateIds.add(s);
      if (name && !namesById.has(s)) namesById.set(s, String(name).slice(0, 60));
    }
  };
  // 1) Persisted per-user search history (every text search was flushed here before the early-return).
  try {
    const history = ((await storeCall(env, { op: "get", key: "history:snapshot" })).value ?? {});
    for (const id of Object.keys(history)) addId(id);
  } catch { /* non-critical */ }
  // 2) Persisted gamify scores (logged for every text search while gamify was on; carries the display name).
  try {
    const gamify = ((await storeCall(env, { op: "get", key: "gamify:scores" })).value ?? {});
    for (const [id, entry] of Object.entries(gamify)) addId(id, entry?.name);
  } catch { /* non-critical */ }
  // 3) In-memory buffers of the current isolate (recent searches, live history, gamify, slow-mode).
  for (const s of recentSearches) addId(s.userId, s.name);
  for (const id of userHistory.keys()) addId(id);
  for (const [id, entry] of gamifyScores) addId(id, entry?.name);
  for (const id of lastUserSearchAt.keys()) addId(id);
  const ids = [...candidateIds].slice(0, 5000);
  if (!ids.length) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "📭 لم أجد أي معرفات مستخدمين في السجلات.\n\n📌 من أرسلوا /start فقط دون أي بحث نصي أثناء الصيانة لا يترك أثرًا في السجلات ولا يمكن استرجاعهم آليًا. من الآن فصاعدًا يتم تسجيل كل مستخدم فور دخوله حتى أثناء الصيانة." });
    return;
  }
  const result = await storeCall(env, { op: "bulk_import_users", ids }).catch((e) => ({ error: String(e) }));
  if (result?.error) { await telegram(env, "sendMessage", { chat_id: chatId, text: `❌ فشل التسجيل في السيستم: ${result.error}` }); return; }
  // Push every recovered id to the sheet in the background (upsert by id, so already-present rows are harmless).
  const now = new Date().toISOString();
  const rows = ids.map((id) => userSheetRow(id, { firstSeen: now, tgName: namesById.get(id) || "" }));
  if (ctx) inBackground(ctx, pushUsers(env, rows).catch((e) => console.error("Recover pushUsers failed", e instanceof Error ? e.message : "unknown")));
  await logAdminAction(env, chatId, "recoverusers", `${ids.length} candidates, imported ${result?.imported ?? 0}`);
  const lines = [
    "♻️ <b>تمت استرجاع مستخدمي فترة الصيانة</b>",
    "",
    `🔍 معرفات وُجدت في السجلات: <b>${ids.length.toLocaleString("en-US")}</b>`,
    `✅ سُجلوا حديثًا في السيستم: <b>${Number(result?.imported ?? 0).toLocaleString("en-US")}</b>`,
    `⏭️ كانوا مسجلين مسبقًا: <b>${Number(result?.skipped ?? 0).toLocaleString("en-US")}</b>`,
    ctx ? "📤 جارٍ رفعهم جميعًا إلى الشيت (تبويب users) في الخلفية." : "📤 تم تجهيزهم للرفع إلى الشيت.",
    "",
    "📌 ملاحظة مهمة: من أرسلوا /start فقط دون أي بحث نصي أثناء الصيانة لا يترك أثرًا في السجلات، فلا يمكن استرجاعهم آليًا. من الآن فصاعدًا يتم تسجيل كل مستخدم فور دخوله حتى أثناء الصيانة، فلن تتكرر المشكلة.",
  ];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n"), parse_mode: "HTML" });
}

// Bulk dictionary add: admin pastes many lines at once (coptic|ipa|meaning|en|fr|de|greek|origin|kind).
async function bulkAddDictionaryWords(env, chatId, rawText) {
  const config = await driveConfig(env);
  if (!config) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ لم يتم ربط Google Sheets؛ استخدم /setdrive أولًا." }); return; }
  const lines = rawText.split(/\r?\n/u).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  const skipped = [];
  for (let i = 0; i < lines.length; i += 1) {
    const parts = lines[i].split(/\s*\|\s*/u).map((p) => (p === "—" || p === "-" ? "" : p.trim()));
    const [coptic = "", ipa = "", meaning = "", english = "", french = "", german = "", greek = "", origin = "", kind = ""] = parts;
    if (!coptic || !meaning) { skipped.push(i + 1); continue; }
    rows.push([coptic, ipa, meaning, english, french, german, greek, "", "", origin, kind]);
  }
  if (!rows.length) { await telegram(env, "sendMessage", { chat_id: chatId, text: `❌ لم أجد أي صف صالح. كل صف يحتاج على الأقل: قبطي | المعنى.${skipped.length ? ` أسطر تالفة: ${skipped.slice(0, 15).join(", ")}` : ""}` }); return; }
  let added = 0;
  let lastError = "";
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    try {
      const result = await callAppsScript(config, { action: "dictionary_append_batch", rows: chunk, by: { id: "813894692" } });
      if (!result.ok) { lastError = String(result.error ?? "unknown"); break; }
      added += chunk.length;
      for (const r of chunk) {
        const record = { id: nextTempId() };
        for (let f = 0; f < DICTIONARY_LOCAL_FIELDS.length; f += 1) {
          const field = DICTIONARY_LOCAL_FIELDS[f];
          if (field) record[field] = r[f] ?? "";
        }
        records.push(record);
      }
    } catch (error) { lastError = error instanceof Error ? error.message : "تعذّر الاتصال بالشيت"; break; }
  }
  await logAdminAction(env, chatId, "bulkadd", `${added} words`);
  await telegram(env, "sendMessage", { chat_id: chatId, text: added
    ? `✅ تمت إضافة ${added} كلمة إلى القاموس والورقة، وأصبحت قابلة للبحث فورًا.${skipped.length ? `\n⚠️ تم تخطي ${skipped.length} سطر (ناقص قبطي أو معنى): ${skipped.slice(0, 15).join(", ")}${skipped.length > 15 ? "…" : ""}` : ""}${lastError ? `\n❌ توقف عند: ${lastError}` : ""}`
    : `❌ فشلت الإضافة: ${lastError || "خطأ غير معروف"}` });
}

// Find users by name/username (no id needed) and offer one-tap reply buttons.
async function findUsers(env, chatId, query) {
  if (!env.USERS) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ تخزين المستخدمين غير مفعّل." }); return; }
  const q = normalize(query);
  const matches = [];
  let cursor = null;
  for (let page = 0; page < 40; page += 1) {
    const result = await storeCall(env, { op: "userpage", cursor, limit: 200 });
    const list = result?.users ?? [];
    for (const item of list) {
      const rec = item.record ?? {};
      const hay = normalize([rec.name, rec.tgName, rec.username].filter(Boolean).join(" "));
      if (hay.includes(q)) matches.push({ id: item.id, name: rec.name || rec.tgName || "—", username: rec.username ?? "", blocked: rec.blocked === true });
    }
    if (!result?.next) break;
    cursor = result.next;
  }
  if (!matches.length) { await telegram(env, "sendMessage", { chat_id: chatId, text: `🔍 لا توجد نتائج لـ «${escapeHtml(query)}».` }); return; }
  const lines = [`🔍 نتائج البحث عن «${escapeHtml(query)}» (${matches.length}):`, ""];
  matches.slice(0, 20).forEach((m, i) => { lines.push(`${i + 1}. ${escapeHtml(String(m.name).slice(0, 30))}${m.username ? ` (@${escapeHtml(m.username)})` : ""} — <code>${escapeHtml(m.id)}</code>${m.blocked ? " 🚫" : ""}`); });
  const buttons = matches.slice(0, 10).map((m) => [{ text: `↩️ رد: ${String(m.name).slice(0, 18)}`, callback_data: `replyto|${m.id}` }]);
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3500), parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

// List blocked users with one-tap unban buttons.
async function listBlockedUsers(env, chatId) {
  if (!env.USERS) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ تخزين المستخدمين غير مفعّل." }); return; }
  const blocked = [];
  let cursor = null;
  for (let page = 0; page < 40; page += 1) {
    const result = await storeCall(env, { op: "userpage", cursor, limit: 200 });
    for (const item of result?.users ?? []) { if (item.record?.blocked === true) blocked.push({ id: item.id, name: item.record.name || item.record.tgName || "—" }); }
    if (!result?.next) break;
    cursor = result.next;
  }
  if (!blocked.length) { await telegram(env, "sendMessage", { chat_id: chatId, text: "✅ لا يوجد مستخدمون محظورون حاليًا." }); return; }
  const lines = [`🚫 المستخدمون المحظورون (${blocked.length}):`, "", ...blocked.slice(0, 30).map((b, i) => `${i + 1}. ${escapeHtml(String(b.name).slice(0, 30))} — <code>${escapeHtml(b.id)}</code>`)];
  const buttons = blocked.slice(0, 10).map((b) => [{ text: `✅ فك حظر: ${String(b.name).slice(0, 16)}`, callback_data: `unban|${b.id}` }]);
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3500), parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

// Export all bot configuration as a JSON backup file.
async function exportConfigBackup(env, chatId) {
  const [flags, bl, wl, wlMode, banMsg, maintMsg, slow, maint, gamify, autoreplies, tpls, searchLimit] = await Promise.all([
    featureFlags(env), blacklistedWords(env), whitelistUsers(env), whitelistModeOn(env), customBanMessage(env),
    customMaintenanceMessage(env), slowModeConfig(env), maintenanceOn(env), gamifyOn(env),
    featureEnabled(env, "autoreply") ? autoReplies(env) : Promise.resolve([]), broadcastTemplates(env), dailySearchLimit(env),
  ]).catch(() => [{}, [], [], false, "", "", { on: false, seconds: 5 }, false, false, [], {}, 0]);
  const cfg = { exportedAt: new Date().toISOString(), featureFlags: flags, blacklist: bl, whitelist: wl, whitelistMode: wlMode, banMsg, maintMsg, slowMode: slow, maintenanceOn: maint, gamifyOn: gamify, autoreplies, templates: tpls, dailySearchLimit: searchLimit, extraAdmins: extraAdminsSync };
  await sendTextFile(env, chatId, "bot-config-backup.json", JSON.stringify(cfg, null, 2), "💾 تم تصدير نسخة احتياطية من إعدادات البوت (JSON).", "application/json");
}

async function featureFlagsText(env) {
  const flags = await featureFlags(env);
  const lines = ["🎚 <b>مفاتيح الميزات</b>", ""];
  for (const [flag, def] of Object.entries(FEATURE_DEFAULTS)) {
    const on = flags[flag] !== false;
    lines.push(`${on ? "🟢" : "🔴"} ${flag}: ${on ? "مفعّلة" : "موقوفة"}`);
  }
  lines.push("", "✏️ الاستخدام: /feature <اسم> on|off");
  return lines.join("\n");
}

// ---- Admin feature: suggestion box review ----
async function sendSuggestionsList(env, chatId) {
  const list = await listSuggestions(env);
  if (!list.length) { await telegram(env, "sendMessage", { chat_id: chatId, text: "📭 لا توجد اقتراحات معلّقة." }); return; }
  const rows = list.slice(0, 15).map((s) => [{ text: `✅ موافقة: ${String(s.text).slice(0, 30)}`, callback_data: `ad|sugapp|${s.id}` }, { text: "❌ رفض", callback_data: `ad|sugrej|${s.id}` }]);
  const lines = ["💡 <b>اقتراحات المستخدمين المعلّقة:</b>", ""];
  for (const s of list.slice(0, 15)) lines.push(`• ${escapeHtml(String(s.text).slice(0, 80))} (من ${escapeHtml(s.userId)})`);
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3000), parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}
async function sendUserHistoryReport(env, chatId, id) {
  if (!/^\d+$/u.test(id)) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ الاستخدام: /userhistory <user_id>" }); return; }
  const history = await getUserHistory(env, id);
  const lines = [`🕘 <b>آخر عمليات بحث المستخدم</b> <code>${escapeHtml(id)}</code> (${history.length}):`, "", ...history.map((h) => `• ${h.at?.slice(0, 19) ?? ""} — ${escapeHtml(String(h.q ?? "").slice(0, 60))}`)];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n").slice(0, 3500), parse_mode: "HTML" });
}

// ---- Admin feature: delete a word (local candidates -> confirm -> sheet delete + soft local delete) ----
async function beginDeleteWord(env, chatId, userId, word) {
  const result = localDictionaryCandidates(word, 6);
  if (!result.ok || !result.candidates.length) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ لم أجد هذه الكلمة محليًا." }); return; }
  if (result.candidates.length === 1 || result.exactCount === 1) {
    const c = result.candidates[0];
    await setAdminFlow(env, userId, { kind: "delete_pending", row: c.row, coptic: c.values?.[0] ?? word });
    await telegram(env, "sendMessage", {
      chat_id: chatId,
      text: `🗑 تأكيد حذف الصف <b>${c.row}</b>؟\nالكلمة: <b>${escapeHtml(String(c.values?.[0] ?? "").slice(0, 60))}</b>\nالمعنى: ${escapeHtml(String(c.values?.[2] ?? "").slice(0, 80))}\nسيُحذف من Google Sheet ويُخفى محليًا (يُحفظ في سجل التدقيق).`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "✅ نعم، احذف الصف", callback_data: `ad|delconfirm|${c.row}` }, { text: "❌ إلغاء", callback_data: "ad|delcancel" }]] },
    });
    return;
  }
  const rows = result.candidates.map((c) => [{ text: `${String(c.values?.[0] ?? "—").slice(0, 30)} — صف ${c.row}`, callback_data: `ad|delpick|${c.row}` }]);
  await telegram(env, "sendMessage", { chat_id: chatId, text: "اختر الكلمة المراد حذفها:", reply_markup: { inline_keyboard: rows } });
}
async function confirmDeleteWord(env, callback, row) {
  const chatId = callback.message?.chat?.id;
  const userId = callback.from.id;
  const index = Number(row) - 2;
  const record = records[index];
  if (!record || record._deleted) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ الصف غير موجود أو تم حذفه." }); return; }
  const config = await driveConfig(env);
  if (!config) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ لم يتم ربط Google Sheets." }); return; }
  let result;
  try { result = await callAppsScript(config, { action: "dictionary_delete", row: Number(row), expected_coptic: String(record.coptic ?? ""), by: { id: "813894692" } }); }
  catch (error) { result = { ok: false, error: error instanceof Error ? error.message : "تعذّر الاتصال بالشيت" }; }
  if (!result.ok) {
    const err = String(result.error ?? "");
    if (err.includes("unknown action") || err.includes("audio_base64")) {
      await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ نسخة Apps Script المنشورة قديمة. انشر Code.gs مرة أخرى (New deployment) لدعم حذف الصفوف." });
    } else {
      await telegram(env, "sendMessage", { chat_id: chatId, text: `❌ لم يتم الحذف: ${err}` });
    }
    return;
  }
  // Soft-delete locally (preserves indices for voice lookups); skipped in search candidates.
  record._deleted = true;
  logAudit({ action: "dictionary_delete", userId: String(userId), row: Number(row), deletedRecord: { ...record } });
  await clearAdminFlow(env, userId);
  await telegram(env, "sendMessage", { chat_id: chatId, text: `🗑 تم حذف صف ${row} (${escapeHtml(String(record.coptic ?? "").slice(0, 60))}) من الشيت وأُخفي محليًا.` });
}

async function sendBroadcastStatus(env, chatId) {
  const status = env.USERS ? await storeCall(env, { op: "bcstatus" }) : { running: false };
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: status.running
      ? `📢 <b>الإرسال الجماعي يعمل</b>\n✅ تم الإرسال: ${status.sent}\n📦 الإجمالي: ${status.total}\n❌ فشل: ${status.failed}`
      : "📢 لا يوجد إرسال جماعي يعمل حاليًا.",
    parse_mode: "HTML",
  });
}

// ---- Inline mode: type @bot_username <word> in any chat ----
const INLINE_LIMIT = 20;
const INLINE_CACHE_SECONDS = 300;

function inlineArticle(index, normalizedQuery, fileId, generatedAudioUrl = "") {
  const record = records[index];
  const part = matchedPartIndex(record, normalizedQuery);
  const parts = splitMeaning(record.meaning);
  const meaning = part >= 0 && parts[part] ? parts[part] : parts.join("، ");
  const word = String(record.coptic ?? "").trim() || String(record.english ?? "").trim() || "—";
  const id = part >= 0 ? `${index}.${part}` : String(index);
  const text = formatRecord(record, part, normalizedQuery).slice(0, MAX_MESSAGE_LENGTH);
  if (fileId && text.length <= 1000) {
    // A recorded word is sent as the voice itself without a caption.
    return {
      type: "voice",
      id,
      voice_file_id: fileId,
      title: `🔊 ${word}${meaning ? ` — ${meaning}` : ""}`.slice(0, 100),
      parse_mode: "HTML",
    };
  }
  if (generatedAudioUrl && text.length <= 1000) {
    // No recording: Telegram fetches the same Polly Miguel OGG published on GitHub.
    return {
      type: "audio",
      id,
      audio_url: generatedAudioUrl,
      title: `🔊 ${word}${meaning ? ` — ${meaning}` : ""}`.slice(0, 100),
      parse_mode: "HTML",
    };
  }
  const description = [meaning, String(record.kind ?? "").trim()].filter(Boolean).join(" — ");
  return {
    type: "article",
    id,
    title: word,
    description: description.slice(0, 120),
    input_message_content: { message_text: text, parse_mode: "HTML" },
  };
}

async function recordedVoices(env, indexes) {
  if (!env.USERS) return {};
  const ids = indexes.map((index) => records[index].id).filter((id) => id != null);
  if (!ids.length) return {};
  try {
    return (await storeCall(env, { op: "voiceFiles", ids })).files ?? {};
  } catch (error) {
    console.error("Inline voice lookup failed", error instanceof Error ? error.message : "unknown error");
    return {};
  }
}

async function answerInline(env, inlineQuery) {
  const raw = String(inlineQuery.query ?? "").replace(/[\r\n]+/gu, " ").trim().slice(0, 160);
  const normalizedQuery = normalize(raw);
  const answer = (results, cacheTime) => telegram(env, "answerInlineQuery", {
    inline_query_id: inlineQuery.id,
    results,
    cache_time: cacheTime,
    is_personal: false,
  });
  // Empty query: no list at all, so the bot's placeholder text (set in BotFather) is what the user sees.
  if (!normalizedQuery) {
    await answer([], 3600);
    return;
  }
  await detectScriptKind(env, normalizedQuery);
  const short = Array.from(normalizedQuery).length <= SHORT_QUERY_MAX;
  let indexes = short ? await findPrefixMatches(env, normalizedQuery) : await findMatches(raw, env);
  if (!indexes.length && short) indexes = await findMatches(raw, env);
  indexes = indexes.slice(0, INLINE_LIMIT);
  const voices = await recordedVoices(env, indexes);
  const results = indexes.map((index) => inlineArticle(index, normalizedQuery, voices[records[index].id], audioUrl(env, records[index].id)));
  const response = await answer(results, INLINE_CACHE_SECONDS);
  if (response && response.ok === false && results.some((item) => item.type === "voice" || item.type === "audio")) {
    // A stored recording was rejected by Telegram: answer again with text only.
    await answer(indexes.map((index) => inlineArticle(index, normalizedQuery, null)), INLINE_CACHE_SECONDS);
  }
}

async function serveSpeech(request, ctx, env, index) {
  const record = records[index];
  if (!record?.id) return new Response("Not found", { status: 404 });
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
  const cached = cache ? await cache.match(cacheKey) : undefined;
  if (cached) return cached;
  const audio = await fetchPrebuiltSpeech(env, record);
  if (!audio) return new Response("Speech unavailable", { status: 502 });
  const response = new Response(request.method === "HEAD" ? null : audio, {
    headers: { "content-type": "audio/ogg", "content-length": String(audio.byteLength), "cache-control": "public, max-age=2592000" },
  });
  if (cache && request.method === "GET") await inBackground(ctx, cache.put(cacheKey, response.clone()));
  return response;
}

async function sendBotInfo(env, chatId) {
  const [me, hook] = await Promise.all([
    telegram(env, "getMe", {}),
    telegram(env, "getWebhookInfo", {}),
  ]);
  const info = hook?.result ?? {};
  const allowed = info.allowed_updates ?? [];
  const lines = [
    `🤖 <b>@${escapeHtml(me?.result?.username ?? "?")}</b>`,
    `البحث من المحادثات (inline): ${me?.result?.supports_inline_queries ? "مفعّل ✅" : "غير مفعّل ❌ — من @BotFather أرسل /setinline"}`,
    `الـ webhook يستقبل inline: ${allowed.includes("inline_query") ? "نعم ✅" : "لا ❌"}`,
    `طلبات معلّقة: ${info.pending_update_count ?? 0}`,
    `آخر خطأ في الـ webhook: ${info.last_error_message ? escapeHtml(info.last_error_message) : "لا يوجد"}`,
    "الصوت: Amazon Polly — Miguel [US Spanish] — IPA ✅",
    "",
    "نص البلاس هولدر (التلميح داخل خانة الكتابة) يُضبط من @BotFather ← /setinline ولا يمكن قراءته أو تغييره من الكود.",
  ];
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n"), parse_mode: "HTML" });
}

const DICTIONARY_LOCAL_FIELDS = ["coptic", "pronunciation", "meaning", "english", "translation_fr", "translation_de", "greek", null, null, "origin", "kind"];
const DICTIONARY_LOCAL_HEADERS = ["coptic", "ipa", "meaning", "english", "french", "german", "greek", "unused_h", "unused_i", "origin", "kind"];
// Bounded Levenshtein distance for fuzzy matching; returns Infinity when beyond `max`.
function levenshtein(a, b, max) {
  if (a === b) return 0;
  if (!a.length) return b.length <= max ? b.length : Infinity;
  if (!b.length) return a.length <= max ? a.length : Infinity;
  // Early exit when length difference alone exceeds the budget.
  if (Math.abs(a.length - b.length) > max) return Infinity;
  let prev = [];
  let curr = [];
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return Infinity;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] <= max ? prev[b.length] : Infinity;
}

// Local, in-memory candidate search (instant). Returns up to ~8 candidates ranked:
// exact match first, then partial (contains/contained), then fuzzy (bounded Levenshtein).
// Each candidate: { row, matched_column, headers, values, score, matchType }.
function localDictionaryCandidates(word, limit = 8) {
  const wanted = normalize(word);
  if (!wanted) return { ok: false, error: "word is required", candidates: [] };
  const exact = [];
  const partial = [];
  const fuzzy = [];
  const fuzzyMax = wanted.length <= 4 ? 1 : wanted.length <= 8 ? 2 : 3;
  const seenRows = new Set();
  const pushCandidate = (bucket, index, column, values, matchType, score) => {
    const row = index + 2;
    if (seenRows.has(row)) return;
    seenRows.add(row);
    bucket.push({ row, matched_column: column, headers: DICTIONARY_LOCAL_HEADERS, values, matchType, score });
  };
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record._deleted) continue;
    const values = DICTIONARY_LOCAL_FIELDS.map((field) => (field ? String(record?.[field] ?? "") : ""));
    for (let column = 0; column < values.length; column += 1) {
      const cell = normalize(values[column]);
      if (!cell) continue;
      if (cell === wanted) { pushCandidate(exact, index, column, values, "exact", 0); break; }
      if (cell.includes(wanted) || wanted.includes(cell)) {
        const score = Math.abs(cell.length - wanted.length);
        pushCandidate(partial, index, column, values, "partial", score);
      } else {
        const dist = levenshtein(cell, wanted, fuzzyMax);
        if (dist !== Infinity) pushCandidate(fuzzy, index, column, values, "fuzzy", dist);
      }
    }
    if (exact.length >= limit) break;
  }
  partial.sort((a, b) => a.score - b.score);
  fuzzy.sort((a, b) => a.score - b.score);
  const candidates = [...exact, ...partial, ...fuzzy].slice(0, limit);
  return { ok: candidates.length > 0, candidates, exactCount: exact.length };
}

// Backward-compatible single-result lookup: returns the best candidate as the old shape.
function localDictionaryLookup(word) {
  const result = localDictionaryCandidates(word, 1);
  const best = result.candidates?.[0];
  if (!best) return { ok: false, error: result.error ?? "word not found" };
  return { ok: true, sheet: "dictionary", ...best };
}

// Local-first: search the in-memory records instantly. Only hit the Apps Script sheet
// when nothing is found locally (fallback). Returns { ok, source, candidates, ...best }.
async function dictionaryGetFromSheet(env, word) {
  const local = localDictionaryCandidates(word, 8);
  if (local.ok) return { ok: true, source: "local", candidates: local.candidates, exactCount: local.exactCount, ...local.candidates[0] };
  const config = await driveConfig(env);
  if (!config) return { ok: false, source: "local", candidates: [], error: "word not found" };
  try {
    const result = await callAppsScript(config, { action: "dictionary_get", word, by: { id: "813894692" } });
    if (result.ok) return { ok: true, source: "sheet", candidates: [result], exactCount: 1, ...result };
    return { ok: false, source: "sheet", candidates: [], error: result.error ?? "word not found" };
  } catch (error) {
    return { ok: false, source: "sheet", candidates: [], error: error instanceof Error ? error.message : "تعذّر الاتصال بالشيت" };
  }
}
function dictionaryFieldName(headers, index) {
  return String(headers?.[index] || `العمود ${String.fromCharCode(65 + index)}`).trim();
}
function dictionaryEditMarkup(row, headers) {
  const buttons = (headers ?? []).map((header, index) => ({ text: `✏️ ${String.fromCharCode(65 + index)}: ${String(header || "بدون عنوان").slice(0, 22)}`, callback_data: `ad|dictfield|${row}|${index}` }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push([{ text: "⬅️ قسم تعديل القاموس", callback_data: "ad|page|dictionary" }]);
  return { inline_keyboard: rows };
}
// Opens the edit UI for a specific dictionary row (used after picking a suggestion).
async function openDictionaryEditByRow(env, chatId, userId, row, matchedColumn = null) {
  const index = Number(row) - 2;
  const record = records[index];
  if (!record) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ لم أجد هذا الصف محليًا؛ ابحث عن الكلمة مرة أخرى." }); return; }
  const values = DICTIONARY_LOCAL_FIELDS.map((field) => (field ? String(record?.[field] ?? "") : ""));
  const headers = DICTIONARY_LOCAL_HEADERS;
  await setAdminFlow(env, userId, { kind: "dict_value", row: Number(row), expectedCoptic: values[0] ?? "", values, headers, col: null });
  const matched = Number.isInteger(matchedColumn) ? `\n🔎 تطابقت مع: <b>${escapeHtml(dictionaryFieldName(headers, matchedColumn))}</b>` : "";
  const lines = [`📄 <b>الورقة: dictionary</b>\n🔢 <b>رقم الصف: ${row}</b>${matched}`, "اختر أي عمود لتعديله. التعديل يُحفظ فورًا في نفس الصف:", ""];
  for (let i = 0; i < headers.length; i += 1) lines.push(`<b>${String.fromCharCode(65 + i)} — ${escapeHtml(dictionaryFieldName(headers, i))}:</b> ${escapeHtml(values[i] ?? "")}`);
  await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n"), parse_mode: "HTML", reply_markup: dictionaryEditMarkup(Number(row), headers) });
}

// Inline keyboard shown when several candidates match the admin's search word.
function dictionaryCandidatesMarkup(candidates, word) {
  const rows = [];
  for (const candidate of candidates) {
    const coptic = String(candidate.values?.[0] ?? "—").replaceAll("`", "").trim().slice(0, 32);
    const meaning = String(candidate.values?.[2] ?? "").replace(/\s+/gu, " ").trim().slice(0, 28);
    rows.push([{ text: `${coptic}${meaning ? ` — ${meaning}` : ""}`, callback_data: `ad|dictpick|${candidate.row}|${candidate.matched_column ?? -1}` }]);
  }
  rows.push([{ text: "➕ إضافة كلمة جديدة", callback_data: "ad|dictnew" }]);
  rows.push([{ text: "⬅️ قسم تعديل القاموس", callback_data: "ad|page|dictionary" }]);
  return { inline_keyboard: rows };
}

async function beginDictionaryEdit(env, chatId, userId, word) {
  const result = await dictionaryGetFromSheet(env, word);
  if (!result.ok) {
    await telegram(env, "sendMessage", {
      chat_id: chatId,
      text: `❌ ${result.error || "لم أجد الكلمة في ورقة dictionary."}\nيمكنك إضافتها ككلمة جديدة بالزر أدناه.`,
      reply_markup: { inline_keyboard: [[{ text: "➕ إضافة كلمة جديدة", callback_data: "ad|dictnew" }], [{ text: "⬅️ قسم تعديل القاموس", callback_data: "ad|page|dictionary" }]] },
    });
    return;
  }
  const candidates = result.candidates ?? [];
  // Single exact match (or a single sheet result): open the edit UI directly — instant, no round trip.
  if (candidates.length === 1 || result.exactCount === 1) {
    const best = candidates[0];
    const headers = best.headers ?? [];
    await setAdminFlow(env, userId, { kind: "dict_value", row: best.row, expectedCoptic: best.values?.[0] ?? word, values: best.values ?? [], headers, col: null });
    const matched = Number.isInteger(best.matched_column) ? `\n🔎 تطابقت مع: <b>${escapeHtml(dictionaryFieldName(headers, best.matched_column))}</b>` : "";
    const lines = [`📄 <b>الورقة: dictionary</b>\n🔢 <b>رقم الصف: ${best.row}</b>${matched}`, "اختر أي عمود لتعديله. التعديل يُحفظ فورًا في نفس الصف:", ""];
    for (let i = 0; i < headers.length; i += 1) lines.push(`<b>${String.fromCharCode(65 + i)} — ${escapeHtml(dictionaryFieldName(headers, i))}:</b> ${escapeHtml(best.values?.[i] ?? "")}`);
    await telegram(env, "sendMessage", { chat_id: chatId, text: lines.join("\n"), parse_mode: "HTML", reply_markup: dictionaryEditMarkup(best.row, headers) });
    return;
  }
  // Several candidates: let the admin pick the right row (with an "add new" escape hatch).
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: `🔎 وجدت <b>${candidates.length}</b> مرشحًا محتملاً لكلمة «${escapeHtml(String(word).slice(0, 60))}».\nاختر الصف المطلوب لتعديله، أو أضف كلمة جديدة:`,
    parse_mode: "HTML",
    reply_markup: dictionaryCandidatesMarkup(candidates, word),
  });
}
async function chooseDictionaryField(env, callback) {
  const userId = callback.from.id;
  const user = await getUser(env, userId);
  const flow = user?.adminFlow;
  const row = Number(callback.data.split("|")[2]);
  const col = Number(callback.data.split("|")[3]);
  const isNew = flow?.kind === "dict_new";
  if (!flow || (flow.kind !== "dict_value" && !isNew) || (isNew ? flow.row !== 0 : flow.row !== row) || !Number.isInteger(col) || col < 0 || col >= flow.headers.length) {
    await telegram(env, "sendMessage", { chat_id: callback.message.chat.id, text: "انتهت جلسة التعديل. ابدأ من /admin ثم تعديل القاموس مرة أخرى." });
    return;
  }
  await setAdminFlow(env, userId, { ...flow, col });
  await telegram(env, "sendMessage", { chat_id: callback.message.chat.id, text: `✏️ أرسل القيمة الجديدة للحقل «${dictionaryFieldName(flow.headers, col)}».\nأرسل - لمسح محتوى الخلية.` });
}
async function updateDictionaryField(env, message, userId, flow, text) {
  const values = [...(flow.values ?? [])];
  while (values.length < flow.headers.length) values.push("");
  values[flow.col] = text === "-" ? "" : text;
  const config = await driveConfig(env);
  if (!config) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "❌ لم يتم ربط Google Sheets." }); return; }
  let result;
  try { result = await callAppsScript(config, { action: "dictionary_update", row: flow.row, expected_coptic: flow.expectedCoptic, values, by: { id: "813894692" } }); }
  catch (error) { result = { ok: false, error: error instanceof Error ? error.message : "تعذّر الاتصال بالشيت" }; }
  if (!result.ok) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `❌ لم يتم الحفظ: ${result.error || "خطأ غير معروف"}\nجلسة نفس الكلمة ما زالت مفتوحة.` }); return; }
  const index = records.findIndex((record) => normalize(record.coptic) === normalize(flow.expectedCoptic));
  const localField = DICTIONARY_LOCAL_FIELDS[flow.col];
  const oldValue = index >= 0 && localField ? String(records[index]?.[localField] ?? "") : "";
  if (index >= 0 && localField) records[index][localField] = values[flow.col];
  logAudit({ action: "dictionary_update", userId: String(userId), row: flow.row, coptic: flow.expectedCoptic, column: dictionaryFieldName(flow.headers, flow.col), old: oldValue, new: values[flow.col] });
  await setAdminFlow(env, userId, { ...flow, values: result.values ?? values, col: null });
  await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ تم تعديل «${dictionaryFieldName(flow.headers, flow.col)}» في صف dictionary رقم ${flow.row} فورًا.\nجلسة نفس الكلمة ما زالت مفتوحة؛ اضغط زر عمود آخر من رسالة الصف لتكمل التعديل.` });
}

// ---- New-word (append) flow: 11 empty columns, written locally, then appended to the sheet ----
function dictionaryNewMarkup(headers) {
  const buttons = (headers ?? []).map((header, index) => ({ text: `✏️ ${String.fromCharCode(65 + index)}: ${String(header || "بدون عنوان").slice(0, 22)}`, callback_data: `ad|dictfield|0|${index}` }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push([{ text: "💾 حفظ وإضافة الصف", callback_data: "ad|dictsave" }, { text: "❌ إلغاء", callback_data: "ad|dictcancel" }]);
  return { inline_keyboard: rows };
}
function dictionaryNewText(values, headers) {
  const lines = ["➕ <b>إضافة كلمة جديدة إلى القاموس</b>", "اضغط أي عمود لكتابة قيمته، ثم «حفظ وإضافة الصف» في النهاية:", ""];
  for (let i = 0; i < headers.length; i += 1) lines.push(`<b>${String.fromCharCode(65 + i)} — ${escapeHtml(dictionaryFieldName(headers, i))}:</b> ${escapeHtml(values?.[i] ?? "")}`);
  return lines.join("\n");
}
async function beginDictionaryNew(env, chatId, userId) {
  const headers = DICTIONARY_LOCAL_HEADERS;
  const values = new Array(headers.length).fill("");
  await setAdminFlow(env, userId, { kind: "dict_new", row: 0, values, headers, col: null });
  await telegram(env, "sendMessage", { chat_id: chatId, text: dictionaryNewText(values, headers), parse_mode: "HTML", reply_markup: dictionaryNewMarkup(headers) });
}
// Writes one column of the in-progress new row locally (no sheet call until final save).
async function updateDictionaryNewField(env, message, userId, flow, text) {
  const values = [...(flow.values ?? [])];
  while (values.length < flow.headers.length) values.push("");
  values[flow.col] = text === "-" ? "" : text;
  await setAdminFlow(env, userId, { ...flow, values, col: null });
  await telegram(env, "sendMessage", {
    chat_id: message.chat.id,
    text: `✅ تم تعيين «${dictionaryFieldName(flow.headers, flow.col)}» محليًا.\n${dictionaryNewText(values, flow.headers)}`,
    parse_mode: "HTML",
    reply_markup: dictionaryNewMarkup(flow.headers),
  });
}
// Local id for freshly appended rows: a large number that never collides with existing permanent ids.
let tempIdCounter = 1000000;
function nextTempId() { tempIdCounter += 1; return tempIdCounter; }
async function saveDictionaryNew(env, callback) {
  const userId = callback.from.id;
  const chatId = callback.message?.chat?.id;
  const user = await getUser(env, userId);
  const flow = user?.adminFlow;
  if (!flow || flow.kind !== "dict_new") { await telegram(env, "sendMessage", { chat_id: chatId, text: "انتهت جلسة الإضافة. ابدأ من /admin ثم «إضافة كلمة جديدة»." }); return; }
  const values = [...(flow.values ?? [])];
  while (values.length < flow.headers.length) values.push("");
  if (!String(values[0] ?? "").trim()) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ العمود A (الكلمة القبطية) مطلوب قبل الحفظ. اضغط عمود A وأدخل الكلمة." }); return; }
  if (!String(values[2] ?? "").trim()) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ العمود C (المعنى) مطلوب قبل الحفظ. اضغط عمود C وأدخل المعنى." }); return; }
  const config = await driveConfig(env);
  if (!config) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ لم يتم ربط Google Sheets؛ لا يمكن إضافة الصف." }); return; }
  let result;
  try { result = await callAppsScript(config, { action: "dictionary_append", values, by: { id: "813894692" } }); }
  catch (error) { result = { ok: false, error: error instanceof Error ? error.message : "تعذّر الاتصال بالشيت" }; }
  if (!result.ok) {
    const err = String(result.error ?? "");
    // Old deployed Apps Script falls through to upload_() and reports "audio_base64 is missing";
    // the fixed Code.gs reports "unknown action". Both mean: redeploy is required.
    if (err.includes("audio_base64") || err.includes("unknown action")) {
      await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ لم تتم الإضافة: نسخة Apps Script المنشورة قديمة. يرجى فتح Google Apps Script ونشر (Deploy) ملف Code.gs مرة أخرى (New deployment) لإضافة دعم إضافة الكلمات." });
    } else {
      await telegram(env, "sendMessage", { chat_id: chatId, text: `❌ لم تتم الإضافة: ${err || "خطأ غير معروف"}` });
    }
    return;
  }
  // Add the new record to the in-memory array so it is immediately searchable.
  const record = { id: nextTempId() };
  for (let i = 0; i < DICTIONARY_LOCAL_FIELDS.length; i += 1) {
    const field = DICTIONARY_LOCAL_FIELDS[i];
    if (field) record[field] = result.values?.[i] ?? values[i] ?? "";
  }
  records.push(record);
  logAudit({ action: "dictionary_append", userId: String(userId), row: result.row, coptic: values[0], values });
  await clearAdminFlow(env, userId);
  await telegram(env, "sendMessage", { chat_id: chatId, text: `✅ تمت إضافة الصف رقم <b>${result.row}</b> إلى ورقة dictionary.\nالكلمة: <b>${escapeHtml(String(values[0]).slice(0, 80))}</b>\nأصبحت قابلة للبحث فورًا.`, parse_mode: "HTML" });
}
function adminMenuMarkup(page = "home") {
  const back = [{ text: "⬅️ الرئيسية", callback_data: "ad|page|home" }];
  if (page === "home") return { inline_keyboard: [
    [{ text: "📊 الإحصاءات", callback_data: "ad|page|stats" }, { text: "🎙 الأصوات", callback_data: "ad|page|voices" }],
    [{ text: "☁️ Drive وSheets", callback_data: "ad|page|drive" }, { text: "👥 المستخدمون", callback_data: "ad|page|users" }],
    [{ text: "📖 تعديل القاموس", callback_data: "ad|page|dictionary" }, { text: "⚙️ أدوات النظام", callback_data: "ad|page|tools" }],
    [{ text: "🔧 أدوات متقدمة", callback_data: "ad|page|advanced" }, { text: "🎚 مفاتيح الميزات", callback_data: "ad|features" }],
    [{ text: "⬆️ مزامنة الأصوات", callback_data: "ad|syncvoices" }, { text: "👥 مزامنة المستخدمين", callback_data: "ad|syncusers" }],
    [{ text: "📢 حالة الإرسال", callback_data: "ad|bcstatus" }, { text: "🧹 مسح جلسة", callback_data: "ad|clearflow" }],
  ] };
  if (page === "advanced") return { inline_keyboard: [
    [{ text: "🔍 سلامة القاموس", callback_data: "ad|integrity" }, { text: "🏆 الأكثر نشاطًا", callback_data: "ad|topusers" }],
    [{ text: "🕐 توزيع الساعات", callback_data: "ad|hourly" }, { text: "🔴 بحث مباشر", callback_data: "ad|livesearch" }],
    [{ text: "🔇 بدون نطق", callback_data: "ad|nopronounce" }, { text: "🔊 بدون صوت", callback_data: "ad|noaudio" }],
    [{ text: "📭 خلايا فاضية", callback_data: "ad|findempty" }, { text: "📋 سجل إجراءات الأدمن", callback_data: "ad|adminaudit" }],
    [{ text: "🧪 إرسال تجريبي", callback_data: "ad|testbroadcast" }, { text: "🧹 مسح الكاش", callback_data: "ad|clearcache" }],
    [{ text: "⏸️ إيقاف البث", callback_data: "ad|bcpause" }, { text: "▶️ استئناف البث", callback_data: "ad|bcresume" }],
    [{ text: "📥 تصدير سجل البحث", callback_data: "ad|exportsearch" }, { text: "🔄 تصفير الإحصاءات", callback_data: "ad|resetstats" }],
    back,
  ] };
  if (page === "stats") return { inline_keyboard: [
    [{ text: "🔄 تحديث الإحصاءات", callback_data: "ad|page|stats" }], back,
  ] };
  if (page === "voices") return { inline_keyboard: [
    [{ text: "🎙 تسجيل التالي", callback_data: "ad|record" }, { text: "🎯 اختيار كلمة", callback_data: "ad|recordchoose" }],
    [{ text: "⏹ إيقاف التسجيل", callback_data: "ad|recordstop" }, { text: "⬆️ مزامنة الأصوات", callback_data: "ad|syncvoices" }],
    [{ text: "🗑 حذف تسجيل واحد", callback_data: "ad|deleteone" }, { text: "🗑 حذف مجموعة", callback_data: "ad|deletemany" }],
    [{ text: "⚠️ حذف كل التسجيلات", callback_data: "ad|deleteall" }], back,
  ] };
  if (page === "drive") return { inline_keyboard: [
    [{ text: "📡 فحص Drive الآن", callback_data: "ad|drive" }, { text: "⬆️ مزامنة الأصوات", callback_data: "ad|syncvoices" }],
    [{ text: "🔗 تغيير رابط Apps Script", callback_data: "ad|setdrive" }, { text: "🧹 إعادة ضبط الرابط", callback_data: "ad|resetdrive" }],
    [{ text: "📦 إعداد مجموعة الأرشيف", callback_data: "ad|setarchive" }], back,
  ] };
  if (page === "users") return { inline_keyboard: [
    [{ text: "👥 مزامنة المستخدمين", callback_data: "ad|syncusers" }, { text: "📢 إرسال جماعي", callback_data: "ad|broadcast" }],
    [{ text: "📢 حالة الإرسال", callback_data: "ad|bcstatus" }, { text: "📈 تقرير الاستخدام", callback_data: "ad|usage" }],
    [{ text: "🔄 تحديث المستخدمين", callback_data: "ad|page|users" }], back,
  ] };
  if (page === "dictionary") return { inline_keyboard: [
    [{ text: "✏️ تعديل كلمة / صف كامل", callback_data: "ad|dictedit" }],
    [{ text: "➕ إضافة كلمة جديدة", callback_data: "ad|dictnew" }, { text: "🗑 حذف كلمة", callback_data: "ad|deleteword" }],
    [{ text: "📊 إحصائيات القاموس", callback_data: "ad|dictstats" }, { text: "🔁 كلمات مكررة", callback_data: "ad|duplicates" }],
    [{ text: "📋 سجل تدقيق التعديلات", callback_data: "ad|auditlog" }],
    [{ text: "🔄 فتح قسم آخر", callback_data: "ad|page|home" }],
  ] };
  return { inline_keyboard: [
    [{ text: "🤖 معلومات البوت", callback_data: "ad|botinfo" }, { text: "📈 تقرير الاستخدام", callback_data: "ad|usage" }],
    [{ text: "📊 تحليلات البحث", callback_data: "ad|analytics" }, { text: "📋 سجل التدقيق", callback_data: "ad|auditlog" }],
    [{ text: "👥 المستخدمون", callback_data: "ad|users" }, { text: "💡 اقتراحات الكلمات", callback_data: "ad|suggestions" }],
    [{ text: "⚠️ سجل الأخطاء", callback_data: "ad|errors" }, { text: "🔧 وضع الصيانة", callback_data: "ad|maintoggle" }],
    [{ text: "♻️ استرجاع مستخدمي الصيانة", callback_data: "ad|recover" }],
    [{ text: "📥 إضافة دفعة كلمات", callback_data: "ad|bulkadd" }, { text: "🚫 المحظورون", callback_data: "ad|blocked" }],
    [{ text: "📦 تصدير القاموس JSON", callback_data: "ad|exportdict" }, { text: "👥 تصدير المستخدمين CSV", callback_data: "ad|exportusers" }],
    [{ text: "💾 نسخة احتياطية", callback_data: "ad|backup" }, { text: "🔄 تحديث الأوامر", callback_data: "ad|commands" }],
    [{ text: "🖼 إخفاء بطاقة كلمة", callback_data: "ad|cardhide" }, { text: "🖼 إظهار بطاقة كلمة", callback_data: "ad|cardshow" }],
    [{ text: "📢 حالة الإرسال", callback_data: "ad|bcstatus" }, { text: "🧹 مسح الجلسة", callback_data: "ad|clearflow" }],
    [{ text: "☀️ كلمة اليوم", callback_data: "ad|wod" }, { text: "🤖 ردود تلقائية", callback_data: "ad|autoreply" }],
    [{ text: "⏳ حد بحث يومي", callback_data: "ad|searchlimit" }, { text: "🚨 تنبيه استخدام", callback_data: "ad|usagealert" }],
    [{ text: "🧷 قوالب الإرسال", callback_data: "ad|tplsave" }, { text: "🔕 خيار الخروج من البث", callback_data: "ad|optout" }],
    [{ text: "🧹 حذف الخاملين", callback_data: "ad|purge" }, { text: "🔄 تصفير مستخدم", callback_data: "ad|resetuser" }],
    [{ text: "📌 أدوات التثبيت", callback_data: "ad|pinmenu" }, { text: "❤️ فحص الصحة", callback_data: "ad|health" }],
    [{ text: "📝 ملاحظاتي", callback_data: "ad|mynotes" }, { text: "⏱ مدة التشغيل", callback_data: "ad|uptime" }], back,
  ] };
}
async function adminDashboardText(env, page = "home") {
  const stats = env.USERS ? await storeCall(env, { op: "adminStats" }) : { users: 0, voices: 0, pendingUploads: 0 };
  const config = await driveConfig(env);
  const drive = config ? "✅ مرتبط" : "❌ غير مرتبط";
  const common = [
    `📚 كلمات القاموس: <b>${records.length.toLocaleString("en-US")}</b>`,
    `👥 المستخدمون المسجلون: <b>${Number(stats.users ?? 0).toLocaleString("en-US")}</b>`,
    `🚫 حالات الحظر المكتشفة: <b>${Number(stats.blocked ?? 0).toLocaleString("en-US")}</b>`,
    `🎙 التسجيلات المحفوظة: <b>${Number(stats.voices ?? 0).toLocaleString("en-US")}</b>`,
    `⏳ تنتظر الرفع: <b>${Number(stats.pendingUploads ?? 0).toLocaleString("en-US")}</b>`,
    `☁️ Drive / Sheets: <b>${drive}</b>`,
  ];
  const titles = { home: "🛠 لوحة تحكم الأدمن", stats: "📊 إحصاءات القاموس والبوت", voices: "🎙 إدارة الأصوات", drive: "☁️ إدارة Google Drive وSheets", users: "👥 إدارة المستخدمين", dictionary: "📖 تعديل القاموس", tools: "⚙️ أدوات النظام" };
  const extras = {
    home: ["اختر القسم المطلوب؛ جميع وظائف الأدمن موجودة هنا."],
    stats: ["✅ البيانات تُقرأ مباشرة من التخزين الحالي."],
    voices: ["التسجيل الجديد يبقى مرتبطًا بمعرّف الكلمة، ثم يُرفع ويُزامن مع Drive وupload."],
    drive: [config ? "الرابط مضبوط ويمكن فحص المصالحة أو تغييره." : "لم يتم ضبط رابط Apps Script بعد."],
    users: ["المستخدمون الجدد والقدامى يمرون من نفس مسار المزامنة."],
    dictionary: ["تحكم كامل في خلايا صف الكلمة، مع تحقق من رقم الصف والكلمة قبل الحفظ."],
    tools: ["أدوات صيانة وتشخيص وإدارة البطاقات والأرشيف."],
  };
  return [`<b>${titles[page] ?? titles.home}</b>`, "", ...common, "", ...(extras[page] ?? extras.home)].join("\n");
}
async function sendAdminDashboard(env, chatId, messageId = undefined, page = "home") {
  const payload = { chat_id: chatId, text: await adminDashboardText(env, page), parse_mode: "HTML", reply_markup: adminMenuMarkup(page) };
  if (messageId != null) {
    const edited = await telegram(env, "editMessageText", { ...payload, message_id: messageId });
    if (edited?.ok || String(edited?.description ?? "").includes("not modified")) return;
  }
  await telegram(env, "sendMessage", payload);
}
async function setAdminFlow(env, userId, flow) {
  const user = (await getUser(env, userId)) ?? {};
  await saveUser(env, userId, { ...user, adminFlow: flow });
}
async function clearAdminFlow(env, userId) {
  const user = (await getUser(env, userId)) ?? {};
  const { adminFlow, ...rest } = user;
  await saveUser(env, userId, rest);
}
async function handleAdminFlow(env, message, userId, user, text) {
  const flow = user?.adminFlow;
  if (!flow || !text || text.startsWith("/")) return false;
  if (flow.kind === "dict_find") { await clearAdminFlow(env, userId); await beginDictionaryEdit(env, message.chat.id, userId, text); return true; }
  if (flow.kind === "delete_find") { await clearAdminFlow(env, userId); await beginDeleteWord(env, message.chat.id, userId, text); return true; }
  if (flow.kind === "tpl_name") {
    // The user pressed a template name; the actual content arrives via the broadcast flow.
    await clearAdminFlow(env, userId);
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ أرسل الآن محتوى القالب ليُحفظ تحت هذا الاسم." });
    return true;
  }
  if (flow.kind === "dict_value" && Number.isInteger(flow.col) && flow.col >= 0) { await updateDictionaryField(env, message, userId, flow, text); return true; }
  if (flow.kind === "dict_new" && Number.isInteger(flow.col) && flow.col >= 0) { await updateDictionaryNewField(env, message, userId, flow, text); return true; }
  // A dictionary edit/add flow is active but no column was chosen yet: remind instead of clearing.
  if (flow.kind === "dict_value" || flow.kind === "dict_new" || flow.kind === "delete_pending") {
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ اضغط أولاً على زر الإجراء المطلوب من الرسالة (عمود / تأكيد حذف)، ثم أرسل القيمة." });
    return true;
  }
  await clearAdminFlow(env, userId);
  if (flow === "setdrive") await setDriveConfig(env, message, text);
  else if (flow === "setarchive") await setArchiveChat(env, message, text);
  else if (flow === "deleteone") await askDeleteVoice(env, message.chat.id, text);
  else if (flow === "deletemany") await askDeleteManyVoices(env, message.chat.id, userId, user, text);
  else if (flow === "cardhide") await setCardVisibility(env, message.chat.id, text, false);
  else if (flow === "cardshow") await setCardVisibility(env, message.chat.id, text, true);
  else if (flow === "findempty_wait" || flow.kind === "findempty_wait") { await clearAdminFlow(env, userId); await sendFindEmptyReport(env, message.chat.id, text); return true; }
  else if (flow === "importusers" || flow.kind === "importusers") { await clearAdminFlow(env, userId); await importUserIds(env, message.chat.id, text); return true; }
  else if (flow === "replyto" || flow.kind === "replyto") { await clearAdminFlow(env, userId); await sendReplyToUser(env, message.chat.id, flow.target ?? flow, text); return true; }
  else if (flow === "bulk_add" || flow.kind === "bulk_add") { await clearAdminFlow(env, userId); await bulkAddDictionaryWords(env, message.chat.id, text); return true; }
  return true;
}
async function handleAdminDashboardCallback(env, callback, ctx) {
  if (!isAdmin(env, callback.from?.id)) return;
  const chatId = callback.message?.chat?.id;
  if (!chatId) return;
  await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });
  const parts = String(callback.data ?? "").split("|");
  const action = parts[1];
  const page = parts[2] ?? "home";
  if (action === "page") { await sendAdminDashboard(env, chatId, callback.message.message_id, page); return; }
  if (action === "refresh") { await sendAdminDashboard(env, chatId, callback.message.message_id, "home"); return; }
  if (action === "drive") { await telegram(env, "sendMessage", { chat_id: chatId, text: await driveStatusText(env), parse_mode: "HTML", disable_web_page_preview: true }); return; }
  if (action === "syncvoices") { await telegram(env, "sendMessage", { chat_id: chatId, text: "⏳ بدأت مزامنة الأصوات مع Drive وupload…" }); await inBackground(ctx, syncPendingVoices(env, chatId, recorderInfo(callback.from, await getUser(env, callback.from.id), callback.from.id))); return; }
  if (action === "syncusers") { await telegram(env, "sendMessage", { chat_id: chatId, text: "⏳ بدأت مزامنة المستخدمين القدامى والجدد…" }); await inBackground(ctx, syncUsersBatch(env, chatId)); return; }
  if (action === "record") { await beginVoiceRecording(env, chatId, callback.from.id, await getUser(env, callback.from.id) ?? {}); return; }
  if (action === "recordchoose") { await beginVoiceChoice(env, chatId, callback.from.id, await getUser(env, callback.from.id) ?? {}); return; }
  if (action === "recordstop") { await stopVoiceRecording(env, chatId, callback.from.id, await getUser(env, callback.from.id) ?? {}); return; }
  if (action === "deleteall") { await askDeleteManyVoices(env, chatId, callback.from.id, await getUser(env, callback.from.id) ?? {}, "", true); return; }
  if (action === "dictedit") { await setAdminFlow(env, callback.from.id, { kind: "dict_find" }); await telegram(env, "sendMessage", { chat_id: chatId, text: "📖 أرسل الكلمة القبطية كما تظهر في القاموس للبحث عن صفها." }); return; }
  if (action === "dictfield") { await chooseDictionaryField(env, callback); return; }
  if (action === "dictpick") {
    const row = Number(parts[2]);
    const col = Number(parts[3] ?? -1);
    await openDictionaryEditByRow(env, chatId, callback.from.id, row, col >= 0 ? col : null);
    return;
  }
  if (action === "dictnew") { await beginDictionaryNew(env, chatId, callback.from.id); return; }
  if (action === "dictsave") { await saveDictionaryNew(env, callback); return; }
  if (action === "dictcancel") { await clearAdminFlow(env, callback.from.id); await telegram(env, "sendMessage", { chat_id: chatId, text: "✅ تم إلغاء إضافة الكلمة الجديدة." }); return; }
  if (action === "analytics") { await sendAnalyticsReport(env, chatId); return; }
  if (action === "auditlog") { await sendAuditLogReport(env, chatId); return; }
  if (action === "exportdict") { await exportDictionary(env, chatId); return; }
  if (action === "exportusers") { await exportUsersCsv(env, chatId); return; }
  if (action === "backup") { await sendBackup(env, chatId); return; }
  if (action === "delpick") {
    const row = Number(parts[2]);
    const record = records[row - 2];
    if (!record) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ الصف غير موجود." }); return; }
    await setAdminFlow(env, callback.from.id, { kind: "delete_pending", row });
    await telegram(env, "sendMessage", { chat_id: chatId, text: `🗑 تأكيد حذف الصف <b>${row}</b>؟\nالكلمة: <b>${escapeHtml(String(record.coptic ?? "").slice(0, 60))}</b>\nالمعنى: ${escapeHtml(String(record.meaning ?? "").slice(0, 80))}`, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "✅ نعم، احذف الصف", callback_data: `ad|delconfirm|${row}` }, { text: "❌ إلغاء", callback_data: "ad|delcancel" }]] } });
    return;
  }
  if (action === "delconfirm") { await confirmDeleteWord(env, callback, Number(parts[2])); return; }
  if (action === "delcancel") { await clearAdminFlow(env, callback.from.id); await telegram(env, "sendMessage", { chat_id: chatId, text: "✅ تم إلغاء الحذف." }); return; }
  if (action === "sugapp" || action === "sugrej") {
    const entry = await takeSuggestion(env, parts[2]);
    if (!entry) { await telegram(env, "sendMessage", { chat_id: chatId, text: "⚠️ الاقتراح لم يعد موجودًا (تمت معالجته مسبقًا)." }); return; }
    if (action === "sugrej") { await telegram(env, "sendMessage", { chat_id: chatId, text: `❌ تم رفض الاقتراح: ${escapeHtml(String(entry.text).slice(0, 80))}` }); return; }
    // Approve: parse "coptic — meaning" and append to the sheet.
    const split = String(entry.text).split(/\s*[—\-]\s*/u, 2);
    const values = new Array(11).fill("");
    values[0] = (split[0] ?? entry.text).trim().slice(0, 80);
    values[2] = (split[1] ?? entry.text).trim().slice(0, 200);
    const config = await driveConfig(env);
    if (!config) { await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ لم يتم ربط Google Sheets." }); return; }
    let result;
    try { result = await callAppsScript(config, { action: "dictionary_append", values, by: { id: "813894692" } }); }
    catch (error) { result = { ok: false, error: error instanceof Error ? error.message : "تعذّر الاتصال" }; }
    if (!result.ok) {
      const err = String(result.error ?? "");
      if (err.includes("unknown action") || err.includes("audio_base64")) await telegram(env, "sendMessage", { chat_id: chatId, text: "❌ نسخة Apps Script قديمة — انشر Code.gs مرة أخرى لإضافة الاقتراح." });
      else await telegram(env, "sendMessage", { chat_id: chatId, text: `❌ فشلت الإضافة: ${err}` });
      return;
    }
    const rec = { id: nextTempId() };
    for (let i = 0; i < DICTIONARY_LOCAL_FIELDS.length; i += 1) { const f = DICTIONARY_LOCAL_FIELDS[i]; if (f) rec[f] = result.values?.[i] ?? values[i] ?? ""; }
    records.push(rec);
    logAudit({ action: "dictionary_append", source: "suggestion", userId: entry.userId, row: result.row, values });
    await telegram(env, "sendMessage", { chat_id: chatId, text: `✅ تمت إضافة الاقتراح كصف رقم <b>${result.row}</b>.` });
    return;
  }
  if (action === "deleteword") { await setAdminFlow(env, callback.from.id, { kind: "delete_find" }); await telegram(env, "sendMessage", { chat_id: chatId, text: "🗑 أرسل الكلمة المراد حذفها من القاموس." }); return; }
  if (action === "duplicates") { await sendDuplicatesReport(env, chatId); return; }
  if (action === "dictstats") { await sendDictStats(env, chatId); return; }
  if (action === "users") { await sendUsersList(env, chatId, ""); return; }
  if (action === "errors") { await sendErrorLogReport(env, chatId); return; }
  if (action === "suggestions") { await sendSuggestionsList(env, chatId); return; }
  if (action === "maintoggle") { const on = !(await maintenanceOn(env)); await setMaintenance(env, on); await telegram(env, "sendMessage", { chat_id: chatId, text: on ? "🔧 تم تفعيل وضع الصيانة." : "✅ تم إيقاف وضع الصيانة." }); return; }
  if (action === "recover") { await recoverMissingUsers(env, chatId, ctx); return; }
  if (action === "bulkadd") { await setAdminFlow(env, callback.from.id, { kind: "bulk_add" }); await telegram(env, "sendMessage", { chat_id: chatId, text: "📥 أرسل الآن الكلمات، كل كلمة في سطر، مفصولة بـ | بهذا الترتيب:\nقبطي | النطق | المعنى | English | Français | Deutsch | اليوناني | الأصل | النوع\n\nالحقلان المطلوبان: القبطي والمعنى. اكتب — لحقل تريد تركه فاضيًا." }); return; }
  if (action === "blocked") { await listBlockedUsers(env, chatId); return; }
  const prompts = { deleteone: ["🗑 أرسل كلمة واحدة لحذف تسجيلها:", "deleteone"], deletemany: ["🗑 أرسل الكلمات مفصولة بعلامة | أو فاصلة:", "deletemany"], setdrive: ["🔗 أرسل رابط Apps Script المنتهي بـ /exec:", "setdrive"], setarchive: ["📦 أرسل رقم المجموعة، أو off لإيقاف الأرشيف:", "setarchive"], cardhide: ["🖼 أرسل الكلمة لإخفاء بطاقتها:", "cardhide"], cardshow: ["🖼 أرسل الكلمة لإظهار بطاقتها:", "cardshow"] };
  if (prompts[action]) { await setAdminFlow(env, callback.from.id, prompts[action][1]); await telegram(env, "sendMessage", { chat_id: chatId, text: prompts[action][0] }); return; }
  if (action === "resetdrive") { await setDriveConfig(env, { chat: { id: chatId } }, "reset"); return; }
  if (action === "broadcast") { await beginBroadcast(env, chatId, callback.from.id, await getUser(env, callback.from.id) ?? {}); return; }
  if (action === "bcstatus") { await sendBroadcastStatus(env, chatId); return; }
  if (action === "commands") { commandMenuReady.delete("admin"); await ensureCommandMenu(env, callback.from.id); await telegram(env, "sendMessage", { chat_id: chatId, text: "✅ تم تحديث قائمة أوامر الأدمن في Telegram." }); return; }
  if (action === "clearflow") { await clearAdminFlow(env, callback.from.id); await telegram(env, "sendMessage", { chat_id: chatId, text: "✅ تم مسح أي جلسة إدخال معلّقة." }); return; }
  if (action === "usage") { await sendUsageReport(env, chatId); return; }
  if (action === "botinfo") { await sendBotInfo(env, chatId); return; }
  // ---- Batch 3 dashboard actions ----
  if (action === "wod") {
    const config = await wordOfTheDayConfig(env);
    await telegram(env, "sendMessage", { chat_id: chatId, text: config?.word ? `☀️ كلمة اليوم: «${escapeHtml(config.word)}» → ${config.chatId} (آخر إرسال: ${config.lastSent ?? "لم يُرسل بعد"})\nلتغييرها أرسل: /setwod <كلمة>\nللإرسال الآن فورًا: /setwodtest` : "☀️ كلمة اليوم غير مضبوطة.\nأرسل: /setwod <كلمة> — وستُرسل إلى هذه المحادثة يوميًا.", parse_mode: "HTML" });
    return;
  }
  if (action === "autoreply") {
    const list = await autoReplies(env);
    await telegram(env, "sendMessage", { chat_id: chatId, text: list.length ? `🤖 الردود التلقائية (${list.length}):\n${list.map((r) => `• «${escapeHtml(r.trigger)}» → ${escapeHtml(r.reply.slice(0, 60))}`).join("\n")}\n\nإضافة: /autoreply تفعيل = الرد\nحذف: /autoreply حذف تفعيل` : "🤖 لا توجد ردود تلقائية.\nإضافة: /autoreply كلمة_التفويض = الرد", parse_mode: "HTML" });
    return;
  }
  if (action === "searchlimit") { const v = await dailySearchLimit(env); await telegram(env, "sendMessage", { chat_id: chatId, text: `⏳ الحد اليومي للبحث: <b>${v || "بلا حد"}</b>\nتغيير: /searchlimit <عدد> (0 = بلا حد)`, parse_mode: "HTML" }); return; }
  if (action === "usagealert") { const v = (await alertsConfig(env))?.threshold; await telegram(env, "sendMessage", { chat_id: chatId, text: `🚨 تنبيه الاستخدام: <b>${Number(v ?? 0) || "معطّل"}</b>\nتغيير: /usagealert <عدد> (0 = إيقاف)`, parse_mode: "HTML" }); return; }
  if (action === "tplsave") { await telegram(env, "sendMessage", { chat_id: chatId, text: "🧷 لحفظ قالب إرسال: أرسل /tplsave <اسم> ثم أرسل رسالة القالب.\nللإرسال لاحقًا: /tplsend <اسم>" }); return; }
  if (action === "optout") { await beginOptOutStats(env, chatId); return; }
  if (action === "purge") { await telegram(env, "sendMessage", { chat_id: chatId, text: "🧹 لحذف المستخدمين الخاملين: /purge <عدد الأيام> — مثال /purge 30" }); return; }
  if (action === "purgeconfirm") {
    const days = Number(page);
    const result = await storeCall(env, { op: "purge_inactive", limit: days });
    await telegram(env, "sendMessage", { chat_id: chatId, text: `🧹 تم حذف ${Number(result?.purged ?? 0).toLocaleString("en-US")} مستخدم خامل (أقدم من ${days} يومًا).` });
    return;
  }
  if (action === "purgecancel") { await telegram(env, "sendMessage", { chat_id: chatId, text: "✅ تم إلغاء حذف الخاملين." }); return; }
  if (action === "resetuser") { await telegram(env, "sendMessage", { chat_id: chatId, text: "🔄 لتنظير مستخدم: /resetuser <user_id>" }); return; }
  if (action === "pinmenu") { await telegram(env, "sendMessage", { chat_id: chatId, text: "📌 أدوات التثبيت (اجعل البوت مشرفًا أولًا):\n/pin <message_id> أو رد على رسالة بـ /pinhere\n/unpin — فك كل الرسائل المثبتة" }); return; }
  if (action === "health") { await sendHealthCheck(env, chatId); return; }
  if (action === "uptime") { await sendUptime(env, chatId); return; }
  if (action === "mynotes") {
    const all = await adminNotes(env);
    const mine = all[String(callback.from.id)];
    await telegram(env, "sendMessage", { chat_id: chatId, text: mine ? `📝 ملاحظتك:\n${escapeHtml(mine.note)}\n(${mine.at})` : "📝 لا توجد ملاحظة. احفظ واحدة: /note نص الملاحظة", parse_mode: "HTML" });
    return;
  }
  if (action === "exportuserscsv") { await exportUsersCsv(env, chatId); return; }
  // ---- Batch 4 dashboard callbacks ----
  if (action === "integrity") { await sendIntegrityReport(env, chatId); return; }
  if (action === "topusers") { await sendTopUsersReport(env, chatId); return; }
  if (action === "hourly") { await sendHourlyReport(env, chatId); return; }
  if (action === "nopronounce") { await sendMissingPronounceReport(env, chatId); return; }
  if (action === "noaudio") { await sendMissingAudioReport(env, chatId); return; }
  if (action === "livesearch") { await sendLiveSearchesReport(env, chatId); return; }
  if (action === "adminaudit") { await sendAdminAuditReport(env, chatId); return; }
  if (action === "clearcache") { invalidateAllCaches(); await logAdminAction(env, callback.from.id, "clearcache"); await telegram(env, "sendMessage", { chat_id: chatId, text: "✅ تم مسح كل الكاش." }); return; }
  if (action === "features") { await telegram(env, "sendMessage", { chat_id: chatId, text: await featureFlagsText(env), parse_mode: "HTML" }); return; }
  if (action === "featoggle") {
    const flag = parts[2]; if (!Object.prototype.hasOwnProperty.call(FEATURE_DEFAULTS, flag)) return;
    const flags = await featureFlags(env); const on = flags[flag] === false;
    await setFeatureFlag(env, flag, on); await logAdminAction(env, callback.from.id, "feature", `${flag}=${on}`);
    await telegram(env, "sendMessage", { chat_id: chatId, text: `✅ ميزة «${flag}» ${on ? "مفعّلة" : "موقوفة"}.` }); return;
  }
  if (action === "testbroadcast") { const admins = adminIds(env); for (const id of admins) await telegram(env, "sendMessage", { chat_id: id, text: "🧪 رسالة تجريبية من الإرسال الجماعي." }).catch(() => null); await telegram(env, "sendMessage", { chat_id: chatId, text: `✅ تم الإرسال التجريبي إلى ${admins.length} أدمن.` }); return; }
  if (action === "bcpause") { await setBroadcastControl(env, { paused: true }); await telegram(env, "sendMessage", { chat_id: chatId, text: "⏸️ تم إيقاف البث مؤقتًا." }); return; }
  if (action === "bcresume") { await setBroadcastControl(env, { paused: false }); await telegram(env, "sendMessage", { chat_id: chatId, text: "▶️ تم استئناف البث." }); return; }
  if (action === "resetstats") { await resetAnalyticsData(env, chatId); await logAdminAction(env, callback.from.id, "resetstats"); return; }
  if (action === "exportsearch") { await exportSearchHistoryCsv(env, chatId); return; }
  if (action === "findempty") { await setAdminFlow(env, callback.from.id, { kind: "findempty_wait" }); await telegram(env, "sendMessage", { chat_id: chatId, text: "✏️ أرسل اسم الحقل (A-I أو coptic/meaning/pronunciation/...) للعثور على الخلايا الفاضية فيه." }); return; }
}
async function handleUpdate(update, env, ctx) {
  if (update.inline_query) {
    trackUsage("inline");
    inBackground(ctx, flushAnalyticsSnapshot(env));
    await answerInline(env, update.inline_query);
    return;
  }
  if (update.callback_query) {
    const callback = update.callback_query;
    if (String(callback.data ?? "").startsWith("tpl|")) {
      await handleTemplateCallback(env, callback);
      return;
    }
    if (String(callback.data ?? "").startsWith("bc|")) {
      await handleBroadcastCallback(env, callback);
      return;
    }
    if (String(callback.data ?? "").startsWith("a2|")) {
      await adminExtras2.handleCallback({ env, callback });
      return;
    }
    if (String(callback.data ?? "").startsWith("ad|")) {
      await handleAdminDashboardCallback(env, callback, ctx);
      return;
    }
    const replyToMatch = /^replyto\|(\d+)$/u.exec(callback.data ?? "");
    if (replyToMatch) {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });
      if (isAdmin(env, callback.from?.id)) {
        const target = replyToMatch[1];
        const admin = (await getUser(env, callback.from.id)) ?? {};
        await saveUser(env, callback.from.id, { ...admin, adminFlow: { kind: "replyto", target } });
        await telegram(env, "sendMessage", { chat_id: callback.message?.chat?.id, text: `✏️ اكتب نص الرد الآن وسيُرسل مباشرة إلى المستخدم <code>${escapeHtml(target)}</code>.\n/cancel للإلغاء.`, parse_mode: "HTML" });
      }
      return;
    }
    const unbanMatch = /^unban\|(\d+)$/u.exec(callback.data ?? "");
    if (unbanMatch) {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });
      if (isAdmin(env, callback.from?.id)) {
        const id = unbanMatch[1];
        const user = (await getUser(env, id)) ?? {};
        const updated = { ...user, blocked: false, blockedAt: undefined, blockedReason: undefined };
        await saveUser(env, id, updated);
        await pushUsers(env, [userSheetRow(id, updated)]);
        await telegram(env, "sendMessage", { chat_id: callback.message?.chat?.id, text: `✅ تم فك حظر المستخدم <code>${escapeHtml(id)}</code>.`, parse_mode: "HTML" });
      }
      return;
    }
    const quizMatch = /^qz\|(\d)$/u.exec(callback.data ?? "");
    if (quizMatch) {
      await handleQuizAnswer(env, callback);
      return;
    }
    if (callback.data === "noop") {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });
      return;
    }
    // Acknowledge the tap in the background so the answer is not delayed by a round trip.
    await inBackground(ctx, telegram(env, "answerCallbackQuery", { callback_query_id: callback.id }));
    const kbAction = /^kb\|(.+)$/su.exec(callback.data ?? "");
    if (kbAction) {
      await handleKeyboardCallback(env, callback, kbAction[1], ctx);
      return;
    }
    const chatForPick = callback.message?.chat?.id;
    const voiceDelete = /^vd\|(\d+|x)$/u.exec(callback.data ?? "");
    if (voiceDelete) {
      await finishDeleteVoice(env, callback, voiceDelete[1]);
      return;
    }
    const voiceDeleteBatch = /^vdb\|(yes|no)$/u.exec(callback.data ?? "");
    if (voiceDeleteBatch) {
      await finishDeleteBatch(env, callback, voiceDeleteBatch[1]);
      return;
    }
    const voicePick = /^vr\|(\d+)$/u.exec(callback.data ?? "");
    if (voicePick) {
      if (chatForPick && isAdmin(env, callback.from?.id)) {
        const admin = await getUser(env, callback.from.id);
        await selectVoiceWord(env, chatForPick, callback.from.id, admin ?? {}, Number(voicePick[1]));
      }
      return;
    }
    const chainPick = /^x\|(\d{1,3})\|(.+)$/su.exec(callback.data ?? "");
    if (chainPick) {
      const chainQuery = chainPick[2];
      const normalizedChainQuery = normalize(chainQuery);
      const kind = await detectScriptKind(env, normalizedChainQuery);
      const chain = await exactChain(env, kind, normalizedChainQuery);
      const step = Number(chainPick[1]);
      if (chatForPick && chain[step]) {
        const sendVoice = ARABIC_LETTER.test(normalizedChainQuery);
        await inBackground(ctx, sendOption(env, chatForPick, chain, chain[0].index, step, undefined, chainCallback(chainQuery), chainQuery, sendVoice));
      }
      return;
    }
    const wordPick = /^w\|(.+)$/su.exec(callback.data ?? "");
    if (wordPick) {
      if (chatForPick) {
        let key = wordPick[1];
        const kind = await detectScriptKind(env, key);
        let chain = await exactChain(env, kind, key);
        if (!chain.length) {
          // The button text was cut to fit Telegram's limit: take the first word that starts with it.
          const [first] = await prefixWords(env, kind, key, 1);
          if (first) {
            key = first.key;
            chain = await exactChain(env, kind, key);
          }
        }
        if (chain.length) {
          await inBackground(ctx, sendOption(env, chatForPick, chain, chain[0].index, 0, undefined, chainCallback(key), key));
        }
      }
      return;
    }
    const nextMeaning = /^n\|(\d{1,6})\|(\d{1,3})\|(\d{1,3})$/u.exec(callback.data ?? "");
    if (nextMeaning) {
      if (callback.message?.chat?.id) {
        await inBackground(ctx, sendMeaningStep(env, callback.message.chat.id, Number(nextMeaning[1]), Number(nextMeaning[2]), Number(nextMeaning[3])));
      }
      return;
    }
    // Buttons already sitting in old chats (m|...) still work: show that meaning, then follow the fixed list.
    const meaningPick = /^m\|(\d{1,6})\|(\d{1,6})\|(\d{1,3})$/u.exec(callback.data ?? "");
    if (meaningPick) {
      if (callback.message?.chat?.id) {
        await inBackground(ctx, sendRecord(env, callback.message.chat.id, Number(meaningPick[2]), Number(meaningPick[3]), callback.message.date));
      }
      return;
    }
    const pick = /^s\|(\d{1,6})(?:\|(\d{1,3}))?(?:\|(.+))?$/su.exec(callback.data ?? "");
    if (pick) {
      if (callback.message?.chat?.id) {
        await inBackground(ctx, sendRecord(env, callback.message.chat.id, Number(pick[1]), pick[2] === undefined ? -1 : Number(pick[2]), pick[3] ?? ""));
      }
      return;
    }
    const match = /^p\|(\d{1,6})\|(.+)$/su.exec(callback.data ?? "");
    if (!match || !callback.message?.chat?.id || !callback.message?.message_id) return;
    await inBackground(ctx, sendSearch(env, callback.message.chat.id, match[2], Number(match[1]), callback.message.message_id));
    return;
  }

  const message = update.message;
  if (!message?.chat?.id) return;
  let text = String(message.text ?? "").trim();
  if (text === "📞 تواصل مع الإدارة") text = "/contact";
  else if (text === "🎲 كلمة عشوائية") text = "/random";
  const userId = message.from?.id ?? message.chat.id;
  const isPrivate = (message.chat.type ?? "private") === "private";
  // Pro feature: per-user rate limit (sliding window). Admins get a higher limit.
  const rateMax = await customRateLimit(env);
  const rate = checkRateLimit(userId, isAdmin(env, userId), rateMax);
  if (!rate.allowed) {
    markSpamSuspect(userId);
    if (rate.shouldWarn) {
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `⏳ أرسلت طلبات كثيرة جدًا (${rate.count} من ${rate.max} خلال ${RATE_LIMIT_WINDOW_MS / 1000} ثوانٍ). ابتهد قليلًا ثم عاود المحاولة.` });
    }
    return;
  }
  if (text) trackUsage(text.startsWith("/") ? "command" : "search", text.startsWith("/") ? undefined : text);
  inBackground(ctx, flushAnalyticsSnapshot(env));
  inBackground(ctx, flushAuditLog(env));
  inBackground(ctx, refreshExtraAdmins(env));
  inBackground(ctx, flushErrorLog(env));
  inBackground(ctx, flushUserHistory(env));
  if (text && !text.startsWith("/")) trackSearchHistory(userId, text);
  if (text && !text.startsWith("/")) pushRecentSearch(userId, displayName(message.from), text);
  if (text && !text.startsWith("/") && await gamifyOn(env)) { trackGamify(userId, displayName(message.from)); inBackground(ctx, flushGamify(env)); }
  // Register the user BEFORE any banned/whitelist/maintenance early-return, so their id is
  // always recorded in the user store and pushed to the sheet — even during maintenance.
  const registerPromise = registerOnFirstContact(env, message, userId, ctx);
  // Admin feature: banned users get no response; maintenance mode blocks non-admins.
  // Batch 4: whitelist mode, custom ban/maintenance messages, slow mode.
  const [banned, maint, wlMode, wlList, banMsg, maintMsg, slowCfg] = await Promise.all([
    isBanned(env, userId), maintenanceOn(env), whitelistModeOn(env), whitelistUsers(env),
    customBanMessage(env), customMaintenanceMessage(env), slowModeConfig(env),
  ]);
  if (banned) {
    await registerPromise.catch(() => null);
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: banMsg || "🚫 تم حظرك من استخدام البوت. إذا كنت تعتقد أن ذلك خطأ، تواصل مع المشرف." });
    return;
  }
  const adminNow = isAdmin(env, userId);
  if (!adminNow && wlMode && !wlList.includes(String(userId))) {
    await registerPromise.catch(() => null);
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "🔒 البوت في وضع القائمة البيضاء حاليًا. فقط المستخدمون المصرح لهم يمكنهم الاستخدام." });
    return;
  }
  if (!adminNow && maint) {
    const regUser = await registerPromise.catch(() => undefined);
    // During maintenance, allow /start, commands and the name-registration flow; only block
    // actual dictionary lookups (plain text search or voice) so users are still fully registered.
    const awaitingName = regUser?.awaitingName === true || regUser?.awaitingContact === true;
    const isSearchAttempt = (text && !text.startsWith("/") && !awaitingName) || Boolean(message.voice || message.audio);
    if (isSearchAttempt) {
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: maintMsg || "🔧 البوت حاليًا تحت الصيانة نظراً للاضافة الكبيرة القادمة، وسيتم تنبيهك عند الاتاحة الكاملة، شكرًا لتفهمك." });
      return;
    }
    // commands (/start, /contact, ...) and the registration name-entry proceed normally.
  }
  // Batch 4 slow mode: global cooldown between searches for non-admins.
  if (!adminNow && slowCfg.on && text && !text.startsWith("/") && message.chat.type === "private") {
    const last = lastUserSearchAt.get(String(userId)) ?? 0;
    const wait = slowCfg.seconds * 1000 - (Date.now() - last);
    if (wait > 0) { await registerPromise.catch(() => null); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `⏳ الوضع البطيء مفعّل. انتظر ${Math.ceil(wait / 1000)} ثانية قبل البحث التالي.` }); return; }
    lastUserSearchAt.set(String(userId), Date.now());
  }
  // Batch 3: notify admins of group joins/leaves, then let the daily features tick.
  if (["group", "supergroup"].includes(message.chat.type) && (message.new_chat_members || message.left_chat_member)) {
    await notifyGroupMembershipChange(env, message);
    return;
  }
  inBackground(ctx, maybeAlertUsage(env));
  // Scheduled admin messages are delivered on the first activity after their due time (no cron needed).
  inBackground(ctx, adminExtras.processSchedules(env));
  // Auto jobs: scheduled maintenance, daily digest, auto backup, sync watcher (one check per minute).
  inBackground(ctx, adminExtras2.tick(env));
  inBackground(ctx, autoWordOfTheDay(env, message.chat.id, ctx));
  // Batch 5: MOTD (رسالة اليوم) once per day on /start for regular users.
  if (!isAdmin(env, userId) && (text === "/start" || text.startsWith("/start "))) inBackground(ctx, maybeSendMotd(env, message.chat.id, userId));
  // Batch 5: search aliases — an alias redirects straight to its target search.
  if (!isAdmin(env, userId) && text && !text.startsWith("/")) {
    const replies = await (featureEnabled(env, "autoreply") ? autoReplies(env) : Promise.resolve([]));
    const normalizedText = normalize(text);
    const hit = replies.find((r) => { const t = normalize(r.trigger); return t && (normalizedText === t || normalizedText.startsWith(`${t} `)); });
    if (hit) { await registerPromise.catch(() => null); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: String(hit.reply).slice(0, 3000) }); return; }
    const aliasTarget = (await aliasList(env))[normalizedText];
    if (aliasTarget) { await registerPromise.catch(() => null); await sendSearch(env, message.chat.id, aliasTarget, 0, undefined, ctx); return; }
    const limit = await dailySearchLimit(env);
    if (limit) {
      const used = bumpSearchCount(userId);
      if (used > limit) { await registerPromise.catch(() => null); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `⏳ وصلت إلى الحد اليومي للبحث (${limit} بحثًا). حاول غدًا أو تواصل مع المشرف عبر /contact.` }); return; }
    }
  }
  if (text === "/" || text === "/start" || text.startsWith("/start ") || text === "/admin") inBackground(ctx, ensureCommandMenu(env, userId));
  const cachedRegistration = registeredCache.get(userId);
  const cacheIsFresh = cachedRegistration && Date.now() - cachedRegistration.at < REGISTERED_CACHE_MS;
  const canPrepareSearch = isPrivate && !isAdmin(env, userId) && env.USERS && text && !text.startsWith("/") &&
    !message.voice && !message.audio && text !== "⌨️ الكيبورد القبطي" && text !== "/keyboard" && text !== "/k" && !cacheIsFresh;
  // Search-index work can overlap the DO registration round trip, but its returned plan has no Telegram side effects.
  const searchPlanPromise = canPrepareSearch
    ? prepareSearch(env, message.chat.id, text, 0, undefined, ctx).catch((error) => {
      console.error("Parallel search preparation failed", error instanceof Error ? error.message : "unknown error");
      return null;
    })
    : null;
  const known = await registerPromise;
  if (text === "⌨️ الكيبورد القبطي" || text === "/keyboard" || text === "/kbd" || text === "/k") {
    if (!await featureEnabled(env, "keyboard")) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "⌨️ لوحة المفاتيح القبطية معطلة حاليًا من قبل الأدمن." }); return; }
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: keyboardComposerText(""), reply_markup: copticKeyboardMarkup() });
    return;
  }
  if (isAdmin(env, userId) && ["group", "supergroup"].includes(message.chat.type)
      && /^\/setarchive(?:@[^\s]+)?\s+here$/u.test(text)) {
    await setArchiveChat(env, message, "here");
    return;
  }
  if (isAdmin(env, userId) && isPrivate) {
    const admin = await getUser(env, userId);
    // Extra admin pack (src/admin-extra.js). Unknown commands fall through to the handlers below.
    if (await adminExtras.handle({ env, chatId: message.chat.id, userId, text, raw: text })) return;
    if (await adminExtras2.handle({ env, chatId: message.chat.id, userId, text, raw: text })) return;
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
    if (text === "/admin" || text === "/dashboard") {
      await sendAdminDashboard(env, message.chat.id);
      return;
    }
    if (text === "/botinfo") {
      await sendBotInfo(env, message.chat.id);
      return;
    }
    if (text === "/usage") {
      await sendUsageReport(env, message.chat.id);
      return;
    }
    if (text === "/analytics") {
      await sendAnalyticsReport(env, message.chat.id);
      return;
    }
    if (text === "/auditlog") {
      await sendAuditLogReport(env, message.chat.id);
      return;
    }
    if (text === "/export" || text.startsWith("/export ")) {
      const arg = text.slice("/export".length).trim();
      if (arg === "users") await exportUsersCsv(env, message.chat.id);
      else await exportDictionary(env, message.chat.id);
      return;
    }
    if (text === "/backup") {
      await sendBackup(env, message.chat.id);
      return;
    }
    if (text === "/users" || text.startsWith("/users ")) {
      await sendUsersList(env, message.chat.id, text.slice("/users".length).trim());
      return;
    }
    if (text === "/ban" || text.startsWith("/ban ")) {
      const arg = text.slice("/ban".length).trim();
      const id = arg.split(/\s+/u)[0];
      if (!/^\d+$/u.test(id)) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "❌ الاستخدام: /ban <user_id> [سبب]" }); return; }
      await banUser(env, id, arg.slice(id.length).trim());
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `🚫 تم حظر المستخدم <code>${escapeHtml(id)}</code>.` });
      return;
    }
    if (text === "/unban" || text.startsWith("/unban ")) {
      const id = text.slice("/unban".length).trim();
      if (!/^\d+$/u.test(id)) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "❌ الاستخدام: /unban <user_id>" }); return; }
      await unbanUser(env, id);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ تم رفع الحظر عن المستخدم <code>${escapeHtml(id)}</code>.` });
      return;
    }
    if (text === "/userinfo" || text.startsWith("/userinfo ")) {
      await sendUserInfo(env, message.chat.id, text.slice("/userinfo".length).trim());
      return;
    }
    if (text === "/deleteword" || text.startsWith("/deleteword ")) {
      const word = text.slice("/deleteword".length).trim();
      if (word) { await beginDeleteWord(env, message.chat.id, userId, word); return; }
      await setAdminFlow(env, userId, { kind: "delete_find" });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "🗑 أرسل الكلمة المراد حذفها من القاموس." });
      return;
    }
    if (text === "/dictstats") { await sendDictStats(env, message.chat.id); return; }
    if (text === "/maintenance" || text.startsWith("/maintenance ")) {
      const arg = text.slice("/maintenance".length).trim().toLowerCase();
      if (arg === "on") { await setMaintenance(env, true); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "🔧 تم تفعيل وضع الصيانة. المستخدمون العاديون سيرون رسالة الصيانة." }); }
      else if (arg === "off") { await setMaintenance(env, false); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم إيقاف وضع الصيانة. البوت يعمل طبيعيًا." }); }
      else await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `الوضع الحالي: ${(await maintenanceOn(env)) ? "🔧 مفعّل" : "✅ متوقف"}\nالاستخدام: /maintenance on  أو  /maintenance off` });
      return;
    }
    if (text === "/editwelcome" || text.startsWith("/editwelcome ")) {
      const custom = text.slice("/editwelcome".length).trim();
      if (!custom) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /editwelcome النص الجديد. استخدم {name} ليظهر اسم المستخدم. /resetwelcome للنص الأصلي." }); return; }
      await setWelcomeCaption(env, custom);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ تم تحديث نص الترحيب:\n${escapeHtml(custom)}` });
      return;
    }
    if (text === "/resetwelcome") { await resetWelcomeCaption(env); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تمت إعادة نص الترحيب إلى الأصلي." }); return; }
    if (text === "/admins" || text.startsWith("/admins ")) {
      const parts = text.split(/\s+/u);
      const sub = parts[1] ?? "list";
      if (sub === "add" && /^\d+$/u.test(parts[2] ?? "")) { await addExtraAdmin(env, parts[2]); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ أُضيف الأدمن <code>${escapeHtml(parts[2])}</code>.` }); }
      else if (sub === "remove" && /^\d+$/u.test(parts[2] ?? "")) { if (parts[2] === DEFAULT_ADMIN_IDS) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "❌ لا يمكن إزالة الأدمن الرئيسي الثابت." }); } else { await removeExtraAdmin(env, parts[2]); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ أُزيل الأدمن <code>${escapeHtml(parts[2])}</code>.` }); } }
      else await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `👥 الأدمن الحاليون: ${adminIds(env).map((id) => `<code>${escapeHtml(id)}</code>`).join(", ")}\nالاستخدام: /admins add &lt;id&gt;  |  /admins remove &lt;id&gt;`, parse_mode: "HTML" });
      return;
    }
    if (text === "/errors") { await sendErrorLogReport(env, message.chat.id); return; }
    if (text === "/duplicates") { await sendDuplicatesReport(env, message.chat.id); return; }
    if (text === "/preview" || text.startsWith("/preview ")) {
      const word = text.slice("/preview".length).trim();
      if (!word) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "👁 الاستخدام: /preview <كلمة> — تعرض الكلمة كما يراها المستخدم العادي." }); return; }
      await sendSearch(env, message.chat.id, word, 0, undefined, ctx);
      return;
    }
    if (text === "/resync") {
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "🔄 إعادة تحميل القاموس من GitHub raw…" });
      try { const r = await resyncDictionary(env); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ تمت إعادة التحميل: ${r.count.toLocaleString("en-US")} سجل. تم مسح كاش فهرس البحث.` }); }
      catch (error) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `❌ فشل التحميل: ${error instanceof Error ? error.message : "unknown"}` }); }
      return;
    }
    if (text === "/suggestions") { await sendSuggestionsList(env, message.chat.id); return; }
    if (text === "/userhistory" || text.startsWith("/userhistory ")) {
      await sendUserHistoryReport(env, message.chat.id, text.slice("/userhistory".length).trim());
      return;
    }
    // ---- Batch 2 admin commands ----
    if (text === "/setbotname" || text.startsWith("/setbotname ")) {
      const name = text.slice("/setbotname".length).trim();
      if (!name) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /setbotname الاسم الجديد" }); return; }
      const r = await telegram(env, "setMyName", { name: name.slice(0, 64) });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: r.ok ? "✅ تم تغيير اسم البوت." : `❌ ${r.description ?? "فشل"}` });
      return;
    }
    if (text === "/setbotabout" || text.startsWith("/setbotabout ")) {
      const about = text.slice("/setbotabout".length).trim();
      if (!about) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /setbotabout النص القصير" }); return; }
      const r = await telegram(env, "setMyShortDescription", { short_description: about.slice(0, 120) });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: r.ok ? "✅ تم تغيير النص القصير (About)." : `❌ ${r.description ?? "فشل"}` });
      return;
    }
    if (text === "/setbotdescription" || text.startsWith("/setbotdescription ")) {
      const desc = text.slice("/setbotdescription".length).trim();
      if (!desc) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /setbotdescription الوصف الكامل" }); return; }
      const r = await telegram(env, "setMyDescription", { description: desc.slice(0, 255) });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: r.ok ? "✅ تم تغيير الوصف (Description)." : `❌ ${r.description ?? "فشل"}` });
      return;
    }
    if (text === "/setcommands") { commandMenuReady.delete("admin"); await ensureCommandMenu(env, userId); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم تحديث قائمة الأوامر." }); return; }
    if (text === "/bulkedit" || text.startsWith("/bulkedit ")) {
      const args = text.slice("/bulkedit".length).trim();
      const match = /^([A-Ka-k])\s+(.+)$/u.exec(args);
      if (!match) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /bulkedit <عمود A-K> <قيمة> — يملأ الخلايا الفاضية في ذلك العمود (حتى 50 صف)." }); return; }
      const colIndex = match[1].toUpperCase().charCodeAt(0) - 65;
      const field = DICTIONARY_LOCAL_FIELDS[colIndex];
      const value = match[2];
      const targets = [];
      for (let i = 0; i < records.length && targets.length < 50; i += 1) {
        const rec = records[i];
        if (rec._deleted) continue;
        if (field && !String(rec[field] ?? "").trim()) targets.push({ index: i, row: i + 2, coptic: rec.coptic });
      }
      if (!targets.length) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ لا توجد خلايا فاضية في هذا العمود." }); return; }
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `⏳ سيُملأ ${targets.length} صفًا في العمود ${match[1].toUpperCase()} بقيمة «${escapeHtml(value.slice(0, 40))}»…` });
      inBackground(ctx, (async () => {
        const config = await driveConfig(env);
        if (!config) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "❌ لم يتم ربط Sheets." }); return; }
        let ok = 0, fail = 0;
        for (const t of targets) {
          const values = DICTIONARY_LOCAL_FIELDS.map((f) => (f ? String(records[t.index]?.[f] ?? "") : ""));
          values[colIndex] = value;
          try {
            const r = await callAppsScript(config, { action: "dictionary_update", row: t.row, expected_coptic: t.coptic, values, by: { id: "813894692" } });
            if (r.ok) { if (field) records[t.index][field] = value; ok += 1; } else fail += 1;
          } catch { fail += 1; }
        }
        logAudit({ action: "bulkedit", userId: String(userId), column: field, value, updated: ok, failed: fail });
        await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ التعديل الجماعي: نجح ${ok}، فشل ${fail}.` });
      })());
      return;
    }
    if (text === "/gamify" || text.startsWith("/gamify ")) {
      const arg = text.slice("/gamify".length).trim().toLowerCase();
      if (arg === "on") { if (env.USERS) await storeCall(env, { op: "put", key: "gamify:on", value: true }); invalidateCache(gamifyCache); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم تفعيل النقاط ولوحة المتصدرين." }); }
      else if (arg === "off") { if (env.USERS) await storeCall(env, { op: "put", key: "gamify:on", value: false }); invalidateCache(gamifyCache); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم إيقاف النقاط." }); }
      else await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `الوضع: ${(await gamifyOn(env)) ? "مفعّل" : "متوقف"}\n/gamify on | off` });
      return;
    }
    if (text === "/apikey" || text.startsWith("/apikey ")) {
      const parts = text.split(/\s+/u);
      const sub = parts[1] ?? "list";
      const keys = env.USERS ? ((await storeCall(env, { op: "get", key: "apikeys:list" })).value ?? []) : [];
      if (sub === "generate") {
        const key = `cdb_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
        keys.push(key);
        if (env.USERS) await storeCall(env, { op: "put", key: "apikeys:list", value: keys });
        invalidateCache(apiKeyCache);
        await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `🔑 المفتاح الجديد:\n<code>${escapeHtml(key)}</code>\nالاستخدام: /api/dictionary?key=...&q=كلمة`, parse_mode: "HTML" });
      } else if (sub === "revoke" && parts[2]) {
        const filtered = keys.filter((k) => k !== parts[2]);
        if (env.USERS) await storeCall(env, { op: "put", key: "apikeys:list", value: filtered });
        invalidateCache(apiKeyCache);
        await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم إلغاء المفتاح." });
      } else {
        await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `🔑 المفاتيح (${keys.length}):\n${keys.map((k) => `<code>${escapeHtml(k)}</code>`).join("\n") || "لا توجد. أنشئ بـ /apikey generate"}\n/apikey generate | revoke <key>`, parse_mode: "HTML" });
      }
      return;
    }
    if (text === "/ratelimit" || text.startsWith("/ratelimit ")) {
      const arg = Number(text.slice("/ratelimit".length).trim());
      if (!Number.isFinite(arg) || arg < 5) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✏️ الاستخدام: /ratelimit <عدد>\nالحد الحالي: ${await customRateLimit(env)} طلب / ${RATE_LIMIT_WINDOW_MS / 1000} ثوانٍ (الأدمن ×${RATE_LIMIT_ADMIN_MULTIPLIER}).` }); return; }
      if (env.USERS) await storeCall(env, { op: "put", key: "ratelimit:max", value: Math.round(arg) });
      invalidateCache(rateLimitCache);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ تم ضبط الحد على ${Math.round(arg)} طلب / ${RATE_LIMIT_WINDOW_MS / 1000} ثوانٍ.` });
      return;
    }
    if (text === "/reflinks") {
      if (!env.USERS) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "❌ غير مفعّل." }); return; }
      const all = await storeCall(env, { op: "userpage", limit: 200 });
      const counts = new Map();
      for (const { record } of all.users ?? []) {
        if (record?.reflink) counts.set(record.reflink, (counts.get(record.reflink) ?? 0) + 1);
      }
      const lines = ["🔗 <b>روابط الدعوة</b>", "", ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `• ${escapeHtml(c)}: ${n} مستخدم`)];
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: lines.length > 3 ? lines.join("\n") : "لا توجد إحالات مسجلة. استخدم https://t.me/<البوت>?start=campaign", parse_mode: "HTML" });
      return;
    }
    if (text === "/uploadaudio" || text.startsWith("/uploadaudio ")) {
      const word = text.slice("/uploadaudio".length).trim();
      if (!word) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /uploadaudio <كلمة> ثم أرسل ملف الصوت/Voice." }); return; }
      await setAdminFlow(env, userId, { kind: "uploadaudio", word });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `🎙 أرسل الآن ملف الصوت (Voice أو audio) للكلمة «${escapeHtml(word.slice(0, 40))}».` });
      return;
    }
    if (text === "/exportanki") { await exportAnki(env, message.chat.id); return; }
    if (text === "/setmenubutton" || text.startsWith("/setmenubutton ")) {
      const arg = text.slice("/setmenubutton".length).trim();
      if (!arg) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /setmenubutton default  أو  /setmenubutton https://example.com" }); return; }
      const menuButton = arg === "default" ? { type: "default" } : { type: "web_app", text: "فتح", web_app: { url: arg } };
      const r = await telegram(env, "setChatMenuButton", { menu_button: menuButton });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: r.ok ? "✅ تم ضبط زر القائمة." : `❌ ${r.description ?? "فشل"}` });
      return;
    }
    if (text === "/spamlist") {
      const list = [...spamSuspects].slice(0, 30);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: list.length ? `⚠️ <b>مشتبه بهم بالسبام</b> (${list.length}):\n${list.map((id) => `• <code>${escapeHtml(id)}</code> — /ban ${id}`).join("\n")}` : "✅ لا يوجد مشتبه بهم.", parse_mode: "HTML" });
      return;
    }
    if (text === "/syncusers") {
      await inBackground(ctx, syncUsersBatch(env, message.chat.id));
      return;
    }
    if (text === "/syncreset") {
      if (env.USERS) await storeCall(env, { op: "put", key: USERS_SYNC_CURSOR, value: null });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم تصفير مؤشر المزامنة. المزامنة التالية ستبدأ من أول مستخدم." });
      return;
    }
    if (text === "/syncall") {
      const dc = await driveConfig(env);
      if (!dc) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "❌ لم يتم ربط Apps Script بعد. تأكد من وجود سر APPS_SCRIPT_URL في GitHub وأعد النشر بـ setup_webhook=true." }); return; }
      const fast = text.includes("fast");
      if (env.USERS) await storeCall(env, { op: "sync_start", fromChat: message.chat.id, input: fast ? "fast" : "" });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: fast
        ? "⏳ بدأت المزامنة التلقائية السريعة (بدون جلب الأسماء). كل 50 مستخدم ثم انتظار 25 ثانية ثم المتابعة تلقائيًا."
        : "⏳ بدأت المزامنة التلقائية (فكرتك: مزامنة ثم انتظار ثم عودة). كل 50 مستخدم ثم 25 ثانية. أضف fast لتسريع: /syncall fast" });
      return;
    }
    if (text === "/synccancel") {
      if (env.USERS) await storeCall(env, { op: "sync_cancel" });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "🛑 تم إيقاف المزامنة التلقائية." });
      return;
    }
    if (text === "/setwod" || text.startsWith("/setwod ")) {
      const word = text.slice("/setwod".length).trim();
      if (!word) {
        const config = await wordOfTheDayConfig(env);
        await telegram(env, "sendMessage", { chat_id: message.chat.id, text: config?.word ? `☀️ كلمة اليوم مضبوطة على «${escapeHtml(config.word)}» وتُرسل إلى ${config.chatId} يوميًا (آخر إرسال: ${config.lastSent ?? "لم يُرسل بعد"}).\nالاستخدام: /setwod <كلمة>` : "✏️ الاستخدام: /setwod <كلمة> — لتلقي كلمة اليوم تلقائيًا هنا كل يوم. نفّذها داخل المجموعة لإرسالها هناك.", parse_mode: "HTML" });
        return;
      }
      await setWordOfTheDay(env, { word: word.slice(0, 80), chatId: message.chat.id, lastSent: null });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ تم ضبط كلمة اليوم على «${escapeHtml(word.slice(0, 80))}» وستُرسل إلى هذه المحادثة تلقائيًا كل يوم.\nلإلغائها: /setwod off`, parse_mode: "HTML" });
      return;
    }
    if (text === "/autoreply" || text.startsWith("/autoreply ")) {
      const arg = text.slice("/autoreply".length).trim();
      if (!arg) {
        const list = await autoReplies(env);
        await telegram(env, "sendMessage", { chat_id: message.chat.id, text: list.length ? `🤖 الردود التلقائية الحالية (${list.length}):\n${list.map((r) => `• «${escapeHtml(r.trigger)}» → ${escapeHtml(r.reply.slice(0, 60))}`).join("\n")}\n\nلإضافة: /autoreply كلمة_التفويض = الرد\nللحذف: /autoreply حذف كلمة_التفويض` : "لا توجد ردود تلقائية.\nلإضافة: /autoreply كلمة_التفويض = الرد", parse_mode: "HTML" });
        return;
      }
      const removeMatch = /^حذف\s+(.+)$/u.exec(arg);
      if (removeMatch) {
        const trigger = normalize(removeMatch[1]);
        await setAutoReplies(env, (await autoReplies(env)).filter((r) => normalize(r.trigger) !== trigger));
        await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم حذف الرد التلقائي." });
        return;
      }
      const sep = arg.includes("=") ? "=" : arg.includes("|") ? "|" : null;
      const [trigger, ...rest] = sep ? arg.split(sep) : [];
      if (!sep || !trigger.trim() || !rest.join("=").trim()) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /autoreply كلمة_التفويض = الرد" }); return; }
      const list = (await autoReplies(env)).filter((r) => normalize(r.trigger) !== normalize(trigger));
      list.push({ trigger: trigger.trim().slice(0, 60), reply: rest.join("=").trim().slice(0, 400) });
      await setAutoReplies(env, list);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ تم حفظ الرد التلقائي لـ «${escapeHtml(trigger.trim())}».`, parse_mode: "HTML" });
      return;
    }
    if (text === "/searchlimit" || text.startsWith("/searchlimit ")) {
      const arg = text.slice("/searchlimit".length).trim();
      if (!/^\d+$/u.test(arg)) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `الحد اليومي الحالي للبحث: <b>${await dailySearchLimit(env) || "بلا حد"}</b>\nالاستخدام: /searchlimit <عدد> (0 = بلا حد)`, parse_mode: "HTML" }); return; }
      await setDailySearchLimit(env, Number(arg));
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: Number(arg) ? `✅ تم ضبط الحد اليومي لعمليات البحث إلى ${Number(arg).toLocaleString("en-US")} بحث لكل مستخدم (الأدمن استثناء).` : "✅ تم إلغاء الحد اليومي." });
      return;
    }
    if (text === "/usagealert" || text.startsWith("/usagealert ")) {
      const arg = text.slice("/usagealert".length).trim();
      if (!/^\d+$/u.test(arg)) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `تنبيه الاستخدام الحالي: <b>${Number((await alertsConfig(env))?.threshold ?? 0) || "معطّل"}</b>\nالاستخدام: /usagealert <عدد> (0 = إيقاف)`, parse_mode: "HTML" }); return; }
      await setAlertsConfig(env, { threshold: Number(arg) });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: Number(arg) ? `🚨 سيصلك تنبيه عندما تتجاوز طلبات اليوم ${Number(arg).toLocaleString("en-US")}.` : "✅ تم إيقاف تنبيهات الاستخدام." });
      return;
    }
    if (text === "/tplsave" || text.startsWith("/tplsave ")) {
      const name = text.slice("/tplsave".length).trim() || "افتراضي";
      await beginBroadcastFromTemplate(env, message.chat.id, userId, admin ?? {}, name, message);
      return;
    }
    if (text === "/tplsend" || text.startsWith("/tplsend ")) {
      const name = text.slice("/tplsend".length).trim() || "افتراضي";
      const templates = await broadcastTemplates(env);
      const tpl = templates[name];
      if (!tpl?.messageId) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `❌ لا يوجد قالب باسم «${escapeHtml(name)}». احفظ واحدًا بـ /tplsave ${name}.`, parse_mode: "HTML" }); return; }
      await telegram(env, "sendMessage", {
        chat_id: message.chat.id,
        text: `🧷 إرسال القالب «${escapeHtml(name)}» (المحفوظ) إلى المستخدمين؟`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "🚀 إرسال الآن", callback_data: `tpl|go|${name}` }, { text: "❌ إلغاء", callback_data: "tpl|no" }]] },
      });
      return;
    }
    if (text === "/setwodtest") {
      const config = await wordOfTheDayConfig(env);
      if (!config?.word) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "☀️ كلمة اليوم غير مضبوطة. اضبطها أولًا بـ /setwod <كلمة>." }); return; }
      await sendWordOfTheDay(env, message.chat.id, { ...config, lastSent: null });
      return;
    }
    if (text === "/optout" || text === "/optoutstats") { await beginOptOutStats(env, message.chat.id); return; }
    if (text === "/purge" || text.startsWith("/purge ")) {
      const days = Number(text.slice("/purge".length).trim()) || 30;
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `🗑 تأكيد: حذف كل المستخدمين المسجلين قبل أكثر من ${days} يومًا (غير المحظورين)؟`, reply_markup: { inline_keyboard: [[{ text: `✅ نعم، احذف الخاملين (${days} يوم)`, callback_data: `ad|purgeconfirm|${days}` }, { text: "❌ إلغاء", callback_data: "ad|purgecancel" }]] } });
      return;
    }
    if (text === "/resetuser" || text.startsWith("/resetuser ")) {
      const id = text.slice("/resetuser".length).trim();
      if (!/^\d+$/u.test(id)) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /resetuser <user_id> — يحذف بيانات المستخدم ليعيد التسجيل من الصفر." }); return; }
      const result = await storeCall(env, { op: "resetuser", userId: id });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: result?.ok ? `✅ تم تصفير بيانات المستخدم <code>${escapeHtml(id)}</code>${result.hadName ? " (كان مسجلاً باسم)" : ""}؛ سيعيد التسجيل في أول رسالة.` : "❌ المستخدم غير موجود في التخزين.", parse_mode: "HTML" });
      return;
    }
    if (text === "/pinhere" || text.startsWith("/pin ")) {
      const target = text === "/pinhere" ? message.reply_to_message : null;
      const idToPin = target?.message_id ?? Number(text.slice("/pin ".length).trim());
      if (!idToPin) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /pin <message_id>، أو رد على رسالة بـ /pinhere. أضف البوت مشرفًا في المجموعة بصلاحية التثبيت." }); return; }
      const result = await telegram(env, "pinChatMessage", { chat_id: message.chat.id, message_id: idToPin, disable_notification: false });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: result?.ok ? "📌 تم تثبيت الرسالة." : `❌ تعذّر التثبيت: ${result?.description ?? "خطأ غير معروف"}` });
      return;
    }
    if (text === "/unpin") {
      const result = await telegram(env, "unpinAllChatMessages", { chat_id: message.chat.id });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: result?.ok ? "📌 تم فك كل الرسائل المثبتة." : `❌ تعذّر: ${result?.description ?? "خطأ"}` });
      return;
    }
    if (text === "/health" || text === "/healthcheck") { await sendHealthCheck(env, message.chat.id); return; }
    if (text === "/uptime") { await sendUptime(env, message.chat.id); return; }
    if (text === "/note" || text.startsWith("/note ")) {
      const note = text.slice("/note".length).trim();
      if (!note) {
        const all = await adminNotes(env);
        const mine = all[String(userId)];
        await telegram(env, "sendMessage", { chat_id: message.chat.id, text: mine ? `📝 ملاحظتك المحفوظة:\n${escapeHtml(mine.note)}\n(${mine.at})\nللحذف: /note حذف` : "لا توجد ملاحظة محفوظة.\n✏️ الاستخدام: /note نص الملاحظة", parse_mode: "HTML" });
        return;
      }
      if (/^حذف$/u.test(note)) { await setAdminNote(env, userId, null); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم حذف ملاحظتك." }); return; }
      await setAdminNote(env, userId, note);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم حفظ ملاحظتك. اعرضها بـ /note" });
      return;
    }
    if (text === "/rules" || text.startsWith("/rules ")) {
      const body = text.slice("/rules".length).trim();
      if (!body) {
        const current = await rulesText(env);
        if (!current) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "📜 لا توجد قواعد مضبوطة بعد.\nكأدمن: /rules نص القواعد — وحينها يستطيع أي عضو عرضها بـ /rules" }); return; }
      }
      if (!isAdmin(env, userId)) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `📜 <b>قواعد البوت والمجموعات</b>\n\n${escapeHtml((await rulesText(env)) || "لم تُضبط القواعد بعد.")}`, parse_mode: "HTML" }); return; }
      if (/^حذف$/u.test(body)) { await setRulesText(env, ""); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ حُذفت نص القواعد." }); return; }
      await setRulesText(env, body);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ حُفظت القواعد. أي عضو يراها بـ /rules:\n${escapeHtml(body)}`, parse_mode: "HTML" });
      return;
    }
    if (text === "/warn" || text.startsWith("/warn ")) {
      const parts = text.split(/\s+/u);
      const target = parts[1] ?? "";
      const reason = text.slice("/warn".length + target.length + 1).trim();
      if (!/^\d+$/u.test(target)) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /warn <user_id> [سبب] — عند التحذير الثالث يُحظر المستخدم تلقائيًا." }); return; }
      const count = await addWarn(env, target, reason);
      await logAdminAction(env, userId, "warn", `${target} #${count}`);
      if (count >= WARN_AUTOban) {
        await tempBanUser(env, target, 24, "ثلاثة تحذيرات");
        await resetWarns(env, target);
        await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `🚫 وصل المستخدم <code>${escapeHtml(target)}</code> إلى ${WARN_AUTOban} تحذيرات، فحُظر تلقائيًا 24 ساعة وتصفيرت تحذيراته.`, parse_mode: "HTML" });
        return;
      }
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `⚠️ تحذير ${count}/${WARN_AUTOban} للمستخدم <code>${escapeHtml(target)}</code>${reason ? ` — ${escapeHtml(reason.slice(0, 100))}` : ""}.`, parse_mode: "HTML" });
      return;
    }
    if (text === "/warns" || text.startsWith("/warns ")) {
      const target = text.slice("/warns".length).trim();
      if (!/^\d+$/u.test(target)) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /warns <user_id> — عرض تحذيرات مستخدم. التصفير: /resetwarns <id>" }); return; }
      const warns = await userWarns(env, target);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: warns.length ? `⚠️ تحذيرات المستخدم <code>${escapeHtml(target)}</code> (${warns.length}):\n${warns.map((w, i) => `${i + 1}. ${escapeHtml(w.reason || "بدون سبب")} — ${w.at.slice(0, 10)}`).join("\n")}` : `✅ المستخدم <code>${escapeHtml(target)}</code> بلا تحذيرات.`, parse_mode: "HTML" });
      return;
    }
    if (text === "/resetwarns" || text.startsWith("/resetwarns ")) {
      const target = text.slice("/resetwarns".length).trim();
      if (!/^\d+$/u.test(target)) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /resetwarns <user_id>" }); return; }
      await resetWarns(env, target);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ تم تصفير تحذيرات المستخدم <code>${escapeHtml(target)}</code>.`, parse_mode: "HTML" });
      return;
    }
    if (text === "/tempban" || text.startsWith("/tempban ")) {
      const parts = text.split(/\s+/u);
      const target = parts[1] ?? "";
      const hours = Number(parts[2] ?? NaN);
      if (!/^\d+$/u.test(target) || !Number.isFinite(hours) || hours <= 0) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /tempban <user_id> <ساعات> [سبب] — يُرفع الحظر تلقائيًا بعد انتهاء المدة." }); return; }
      const reason = parts.slice(3).join(" ");
      await tempBanUser(env, target, hours, reason);
      await logAdminAction(env, userId, "tempban", `${target} ${hours}h`);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `⏳ حُظر المستخدم <code>${escapeHtml(target)}</code> مؤقتًا لمدة ${hours} ساعة (ينتهي تلقائيًا).`, parse_mode: "HTML" });
      return;
    }
    if (text === "/wordinfo" || text.startsWith("/wordinfo ")) {
      const word = text.slice("/wordinfo".length).trim();
      if (!word) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /wordinfo <كلمة> — كل الحقول الخام للكلمة ورقم صفها وحالة الصوت." }); return; }
      await sendWordInfo(env, message.chat.id, word);
      return;
    }
    if (text === "/searchcount" || text.startsWith("/searchcount ")) {
      const word = text.slice("/searchcount".length).trim();
      if (!word) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /searchcount <كلمة> — كم مرة بحثها المستخدمون." }); return; }
      const count = await wordSearchCount(env, word);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `🔎 كلمة «${escapeHtml(word.slice(0, 60))}» بحثت <b>${Number(count).toLocaleString("en-US")}</b> مرة.`, parse_mode: "HTML" });
      return;
    }
    if (text === "/hiddencards") { await sendHiddenCards(env, message.chat.id); return; }
    if (text === "/unhideall") {
      const result = await storeCall(env, { op: "purgeprefix", key: "card-disabled:" });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ أُعيد إظهار ${Number(result?.purged ?? 0).toLocaleString("en-US")} بطاقة مخفية.` });
      return;
    }
    // ---- Batch 5 admin commands: aliases, MOTD, manual points ----
    if (text === "/alias" || text.startsWith("/alias ")) {
      const arg = text.slice("/alias".length).trim();
      if (!arg) {
        const all = await aliasList(env);
        const rows = Object.entries(all).slice(0, 30).map(([trigger, target]) => `• «${escapeHtml(trigger)}» → بحث: ${escapeHtml(target)}`);
        await telegram(env, "sendMessage", { chat_id: message.chat.id, text: rows.length ? `🔀 <b>اختصارات البحث</b> (${Object.keys(all).length}):\n${rows.join("\n")}\n\nإضافة: /alias اختصار = كلمة القاموس\nحذف: /alias حذف اختصار` : "🔀 لا توجد اختصارات بحث.\nإضافة: /alias اختصار = كلمة القاموس\nحين يكتب المستخدم الاختصار يبحث له البوت عن الكلمة المقصودة فورًا.", parse_mode: "HTML" });
        return;
      }
      const removeMatch = /^حذف\s+(.+)$/u.exec(arg);
      if (removeMatch) { await setAlias(env, removeMatch[1].trim(), null); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ حُذف الاختصار." }); return; }
      const sep = arg.includes("=") ? "=" : arg.includes("|") ? "|" : null;
      const [trigger, ...rest] = sep ? arg.split(sep) : [];
      const target = rest.join("=").trim();
      if (!sep || !trigger.trim() || !target) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /alias اختصار = كلمة القاموس" }); return; }
      await setAlias(env, trigger.trim(), target);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ حين يكتب أي مستخدم «${escapeHtml(trigger.trim())}» سينفّذ البحث عن «${escapeHtml(target)}» فورًا.`, parse_mode: "HTML" });
      return;
    }
    if (text === "/motd" || text.startsWith("/motd ")) {
      const body = text.slice("/motd".length).trim();
      if (!body) { const current = await motdText(env); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: current ? `📢 رسالة اليوم الحالية:\n${escapeHtml(current)}\n\nتغيير: /motd النص\nحذف: /motd حذف` : "📢 لا توجد رسالة يوم مضبوطة.\n✏️ الاستخدام: /motd النص — تُرسل مرة واحدة يوميًا لكل مستخدم عند /start.", parse_mode: "HTML" }); return; }
      if (/^حذف$/u.test(body)) { await setMotd(env, ""); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ حُذفت رسالة اليوم." }); return; }
      await setMotd(env, body);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ حُفظت رسالة اليوم وستصل لكل مستخدم مرة واحدة عند /start:\n${escapeHtml(body)}`, parse_mode: "HTML" });
      return;
    }
    if (text === "/points" || text.startsWith("/points ")) {
      const parts = text.split(/\s+/u);
      const target = parts[1] ?? "";
      const amount = Number(parts[2] ?? NaN);
      if (!/^\d+$/u.test(target) || !Number.isFinite(amount) || amount === 0) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /points <user_id> <عدد> — عدد موجب لمنح نقاط وسالب لخصمها." }); return; }
      const newScore = await awardPoints(env, target, amount);
      if (newScore == null) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "❌ التخزين غير مفعّل." }); return; }
      await logAdminAction(env, userId, "points", `${target} ${amount > 0 ? "+" : ""}${amount}`);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `🏆 رصيد المستخدم <code>${escapeHtml(target)}</code> أصبح <b>${Number(newScore).toLocaleString("en-US")}</b> نقطة.`, parse_mode: "HTML" });
      return;
    }
    if (text === "/reply" || text.startsWith("/reply ")) { await handleAdminReply(env, message, text); return; }
    if (text === "/card_hide" || text.startsWith("/card_hide ")) {
      await setCardVisibility(env, message.chat.id, text.slice("/card_hide".length), false);
      return;
    }
    if (text === "/card_show" || text.startsWith("/card_show ")) {
      await setCardVisibility(env, message.chat.id, text.slice("/card_show".length), true);
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
    if (text === "/record_choose" || text === "/record_select") {
      await beginVoiceChoice(env, message.chat.id, userId, admin ?? {});
      return;
    }
    if (text === "/setarchive" || text.startsWith("/setarchive ")) {
      await setArchiveChat(env, message, text.slice("/setarchive".length));
      return;
    }
    if (text === "/voice_delete_all") {
      await askDeleteManyVoices(env, message.chat.id, userId, admin ?? {}, "", true);
      return;
    }
    if (text === "/voice_delete_many" || text.startsWith("/voice_delete_many ")) {
      await askDeleteManyVoices(env, message.chat.id, userId, admin ?? {}, text.slice("/voice_delete_many".length));
      return;
    }
    if (text === "/voice_delete" || text.startsWith("/voice_delete ")) {
      await askDeleteVoice(env, message.chat.id, text.slice("/voice_delete".length));
      return;
    }
    if (text === "/record_stop") {
      await stopVoiceRecording(env, message.chat.id, userId, admin ?? {});
      return;
    }
    if (await handleAdminFlow(env, message, userId, admin, text)) return;
    if (admin?.adminFlow?.kind === "uploadaudio" && (message.voice || message.audio)) {
      await uploadAdminAudio(env, message, userId, admin);
      return;
    }
    if (admin?.voiceRec && (message.voice || message.audio)) {
      await captureVoiceRecording(env, message, userId, admin, ctx);
      return;
    }
    if (admin?.voicePick && text && !text.startsWith("/")) {
      const view = await renderVoiceWordSuggestions(text, env);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: view.text, ...(view.reply_markup ? { reply_markup: view.reply_markup } : {}) });
      return;
    }
    if (admin?.bc === "await" && !text.startsWith("/")) {
      // tpl_name flow: capture the message as a broadcast template content, then confirm.
      if (admin?.adminFlow?.kind === "tpl_name") {
        const name = String(admin.adminFlow.name ?? "افتراضي");
        await storeCall(env, { op: "template_save", key: name, fromChat: message.chat.id, messageId: message.message_id });
        await clearAdminFlow(env, userId);
        await saveUser(env, userId, { ...(admin ?? {}), bc: undefined });
        await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `🧷 تم حفظ القالب «${escapeHtml(name)}». أرسله للمستخدمين في أي وقت بـ /tplsend ${name}.`, parse_mode: "HTML" });
        return;
      }
      await captureBroadcast(env, message, userId, admin);
      return;
    }
    // ---- Batch 4 admin commands ----
    if (text === "/feature" || text.startsWith("/feature ")) {
      const arg = text.slice("/feature".length).trim();
      if (!arg) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: await featureFlagsText(env), parse_mode: "HTML" }); return; }
      const parts = arg.split(/\s+/u); const flag = parts[0]; const on = parts[1] ?? "on";
      if (!Object.prototype.hasOwnProperty.call(FEATURE_DEFAULTS, flag)) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `❌ ميزة غير معروفة. المتاحة: ${Object.keys(FEATURE_DEFAULTS).join(", ")}` }); return; }
      await setFeatureFlag(env, flag, on !== "off"); await logAdminAction(env, userId, "feature", `${flag}=${on}`);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ ميزة «${flag}» ${on !== "off" ? "مفعّلة" : "موقوفة"}.` }); return;
    }
    if (text === "/blacklist" || text.startsWith("/blacklist ")) {
      const arg = text.slice("/blacklist".length).trim();
      if (!arg) { const list = await blacklistedWords(env); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: list.length ? `🚫 <b>الكلمات المحظورة</b> (${list.length}):\n${list.map((w) => `• ${escapeHtml(w)}`).join("\n")}` : "✅ لا توجد كلمات محظورة.\n/blacklist add <كلمة>", parse_mode: "HTML" }); return; }
      const parts = arg.split(/\s+/u); const sub = parts[0]; const word = parts.slice(1).join(" ");
      if (sub === "add" && word) { await addBlacklist(env, word); await logAdminAction(env, userId, "blacklist_add", word); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ أُضيفت «${escapeHtml(word.slice(0, 40))}» إلى القائمة السوداء.` }); }
      else if (sub === "remove" && word) { await removeBlacklist(env, word); await logAdminAction(env, userId, "blacklist_remove", word); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ أُزيلت «${escapeHtml(word.slice(0, 40))}».` }); }
      else await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ /blacklist add <كلمة> | remove <كلمة> | list" });
      return;
    }
    if (text === "/whitelist" || text.startsWith("/whitelist ")) {
      const arg = text.slice("/whitelist".length).trim();
      if (!arg) { const mode = await whitelistModeOn(env); const list = await whitelistUsers(env); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `الوضع: ${mode ? "🟢 مفعّل (فعلًا القائمة البيضاء فقط)" : "🔴 متوقف"}\nالمستخدمون (${list.length}): ${list.map((id) => `<code>${escapeHtml(id)}</code>`).join(", ") || "لا يوجد"}\n/whitelist on|off | add <id> | remove <id>`, parse_mode: "HTML" }); return; }
      const parts = arg.split(/\s+/u); const sub = parts[0];
      if (sub === "on") { await setWhitelistMode(env, true); await logAdminAction(env, userId, "whitelist_on"); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم تفعيل وضع القائمة البيضاء. فقط المستخدمون المدرجون والأدمن يمكنهم استخدام البوت." }); }
      else if (sub === "off") { await setWhitelistMode(env, false); await logAdminAction(env, userId, "whitelist_off"); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم إيقاف وضع القائمة البيضاء." }); }
      else if (sub === "add" && /^\d+$/u.test(parts[1] ?? "")) { await addWhitelistUser(env, parts[1]); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ أُضيف <code>${escapeHtml(parts[1])}</code>.` }); }
      else if (sub === "remove" && /^\d+$/u.test(parts[1] ?? "")) { await removeWhitelistUser(env, parts[1]); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ أُزيل <code>${escapeHtml(parts[1])}</code>.` }); }
      else await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ /whitelist on|off | add <id> | remove <id>" });
      return;
    }
    if (text === "/clearcache") { invalidateAllCaches(); await logAdminAction(env, userId, "clearcache"); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم مسح كل الكاش (مستخدمون، أوامر، ميزات، قوالب، إلخ)." }); return; }
    if (text === "/msg" || text.startsWith("/msg ")) {
      const arg = text.slice("/msg".length).trim();
      const match = /^(\d+)\s+([\s\S]+)$/u.exec(arg);
      if (!match) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /msg <user_id> <نص الرسالة>" }); return; }
      const r = await telegram(env, "sendMessage", { chat_id: match[1], text: match[2].slice(0, 3500) });
      await logAdminAction(env, userId, "msg", match[1]);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: r?.ok ? "✅ تم إرسال الرسالة." : `❌ فشل: ${r?.description ?? "unknown"}` }); return;
    }
    if (text === "/topusers") { await sendTopUsersReport(env, message.chat.id); return; }
    if (text === "/hourly") { await sendHourlyReport(env, message.chat.id); return; }
    if (text === "/integrity") { await sendIntegrityReport(env, message.chat.id); return; }
    if (text === "/nopronounce" || text.startsWith("/nopronounce")) { await sendMissingPronounceReport(env, message.chat.id, Number(text.split(/\s+/u)[1]) || 30); return; }
    if (text === "/noaudio" || text.startsWith("/noaudio")) { await sendMissingAudioReport(env, message.chat.id, Number(text.split(/\s+/u)[1]) || 30); return; }
    if (text === "/findempty" || text.startsWith("/findempty ")) { await sendFindEmptyReport(env, message.chat.id, text.slice("/findempty".length).trim()); return; }
    if (text === "/livesearch") { await sendLiveSearchesReport(env, message.chat.id); return; }
    if (text === "/exportsearch") { await exportSearchHistoryCsv(env, message.chat.id); return; }
    if (text === "/resetstats") { await resetAnalyticsData(env, message.chat.id); await logAdminAction(env, userId, "resetstats"); return; }
    if (text === "/adminaudit") { await sendAdminAuditReport(env, message.chat.id); return; }
    if (text === "/setbanmsg" || text.startsWith("/setbanmsg ")) {
      const arg = text.slice("/setbanmsg".length).trim();
      if (!arg) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `الرسالة الحالية: ${escapeHtml(await customBanMessage(env)) || "(الافتراضية)"}\n✏️ /setbanmsg <نص الرسالة> | /setbanmsg reset` }); return; }
      if (arg === "reset") { await setBanMessage(env, ""); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تمت إعادة رسالة الحظر إلى الافتراضية." }); }
      else { await setBanMessage(env, arg); await logAdminAction(env, userId, "setbanmsg"); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم حفظ رسالة الحظر الجديدة." }); }
      return;
    }
    if (text === "/setmaintmsg" || text.startsWith("/setmaintmsg ")) {
      const arg = text.slice("/setmaintmsg".length).trim();
      if (!arg) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `الرسالة الحالية: ${escapeHtml(await customMaintenanceMessage(env)) || "(الافتراضية)"}\n✏️ /setmaintmsg <نص> | /setmaintmsg reset` }); return; }
      if (arg === "reset") { await setMaintenanceMessage(env, ""); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تمت إعادة رسالة الصيانة إلى الافتراضية." }); }
      else { await setMaintenanceMessage(env, arg); await logAdminAction(env, userId, "setmaintmsg"); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم حفظ رسالة الصيانة الجديدة." }); }
      return;
    }
    if (text === "/slowmode" || text.startsWith("/slowmode ")) {
      const arg = text.slice("/slowmode".length).trim().toLowerCase();
      const cfg = await slowModeConfig(env);
      if (!arg) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `الوضع: ${cfg.on ? `🟢 مفعّل (${cfg.seconds} ثانية بين كل بحث)` : "🔴 متوقف"}\n/slowmode on | off | <ثواني>` }); return; }
      if (arg === "on") { await setSlowModeConfig(env, { on: true, seconds: cfg.seconds }); await logAdminAction(env, userId, "slowmode_on"); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ تم تفعيل الوضع البطيء: ${cfg.seconds} ثانية بين كل بحث (للغير أدمن).` }); }
      else if (arg === "off") { await setSlowModeConfig(env, { on: false, seconds: cfg.seconds }); await logAdminAction(env, userId, "slowmode_off"); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم إيقاف الوضع البطيء." }); }
      else if (/^\d+$/u.test(arg)) { const s = Math.max(1, Math.min(60, Number(arg))); await setSlowModeConfig(env, { on: cfg.on, seconds: s }); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ تم ضبط مدة الوضع البطيء على ${s} ثانية.` }); }
      else await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ /slowmode on | off | <ثواني 1-60>" });
      return;
    }
    if (text === "/testbroadcast") {
      const admins = adminIds(env);
      for (const id of admins) await telegram(env, "sendMessage", { chat_id: id, text: "🧪 <b>رسالة تجريبية من الإرسال الجماعي</b>\nإذا رأيت هذه الرسالة، فإن الإرسال الجماعي يعمل بشكل صحيح.", parse_mode: "HTML" }).catch(() => null);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ تم إرسال رسالة تجريبية إلى ${admins.length} أدمن.` }); return;
    }
    if (text === "/bcpause") { await setBroadcastControl(env, { paused: true }); await logAdminAction(env, userId, "bcpause"); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "⏸️ تم إيقاف الإرسال الجماعي مؤقتًا (سيتوقف عند المستلم التالي)." }); return; }
    if (text === "/bcresume") { await setBroadcastControl(env, { paused: false }); await logAdminAction(env, userId, "bcresume"); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "▶️ تم استئناف الإرسال الجماعي." }); return; }
    if (text === "/bccancel") {
      if (env.USERS) await storeCall(env, { op: "put", key: BROADCAST_CTRL_KEY, value: { paused: true, cancel: true } });
      await logAdminAction(env, userId, "bccancel");
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "🛑 تم طلب إلغاء الإرسال الجماعي. سيتوقف قريبًا." }); return;
    }
    if (text === "/importusers" || text.startsWith("/importusers")) {
      if (!env.USERS) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "❌ تخزين المستخدمين غير مفعّل." }); return; }
      const arg = text.slice("/importusers".length).trim();
      if (arg) { await importUserIds(env, message.chat.id, arg); return; }
      await setAdminFlow(env, userId, { kind: "importusers" });
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "📥 أرسل الآن قائمة معرّفات المستخدمين (رقم في كل سطر أو مفصولة بفواصل/مسافات).\nستُسجّل دفعة واحدة في قاعدة بيانات البوت للإرسال الجماعي." });
      return;
    }
    if (text === "/importsheet" || text.startsWith("/importsheet ")) {
      if (!env.USERS) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "❌ تخزين المستخدمين غير مفعّل." }); return; }
      const arg = text.slice("/importsheet".length).trim();
      if (!arg) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /importsheet <رابط_الورقة> [اسم_التبويب]\nمثال: /importsheet https://docs.google.com/spreadsheets/d/XXXX/edit bot\nيستورد المعرّفات من العمود الأول." }); return; }
      await importFromSheet(env, message.chat.id, arg);
      return;
    }
    if (text === "/recoverusers" || text === "/recover") { await recoverMissingUsers(env, message.chat.id, ctx); return; }
    if (text === "/bulkadd") { await setAdminFlow(env, userId, { kind: "bulk_add" }); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "📥 أرسل الآن الكلمات، كل كلمة في سطر، مفصولة بـ | بهذا الترتيب:\nقبطي | النطق | المعنى | English | Français | Deutsch | اليوناني | الأصل | النوع\n\nمثال:\nⲁⲛⲁⲩ | [anaʊ] | ماء | water | eau | Wasser | — | قبطي | اسم\n\nالحقلان المطلوبان: القبطي والمعنى. اكتب — لحقل تريد تركه فاضيًا." }); return; }
    if (text === "/bcspeed" || text.startsWith("/bcspeed ")) {
      const secs = Number(text.split(/\s+/u)[1]);
      if (!Number.isFinite(secs) || secs < 1 || secs > 60) { const cur = env.USERS ? (((await storeCall(env, { op: "get", key: "bc:perUserDelay" })).value ?? 5000) / 1000) : 5; await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `⏱ التأخير الحالي بين كل مستخدم في الإرسال الجماعي: ${cur} ثانية.\n✏️ الاستخدام: /bcspeed <عدد_الثواني> (من 1 إلى 60).` }); return; }
      await storeCall(env, { op: "put", key: "bc:perUserDelay", value: Math.round(secs * 1000) });
      await logAdminAction(env, userId, "bcspeed", `${secs}s`);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: `✅ تم ضبط التأخير بين كل مستخدم في الإرسال الجماعي على ${secs} ثانية. سينفذ في الإرسال القادم.` });
      return;
    }
    if (text === "/userfind" || text.startsWith("/userfind ")) { const q = text.slice("/userfind".length).trim(); if (!q) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✏️ الاستخدام: /userfind <اسم أو معرف المستخدم> — ستظهر أزرار رد سريع بدون كتابة المعرف." }); return; } await findUsers(env, message.chat.id, q); return; }
    if (text === "/blockedusers") { await listBlockedUsers(env, message.chat.id); return; }
    if (text === "/configexport") { await exportConfigBackup(env, message.chat.id); return; }
  }
  if (text === "/start" || text.startsWith("/start ")) {
    if (!env.USERS) {
      // No user store bound: registration is unavailable, so fall back to the plain help text.
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "اكتب الكلمة مباشرة للبحث." });
      return;
    }
    const user = known ?? await getUser(env, userId);
    // Referral link tracking: /start <campaign> remembers the source for new users.
    const startParam = text.startsWith("/start ") ? text.slice(7).trim() : "";
    if (startParam && !user?.registeredAt) {
      inBackground(ctx, trackReflink(env, startParam));
      if (env.USERS) await saveUser(env, userId, { ...user, reflink: startParam });
    }
    if (user?.name) {
      await sendWelcome(env, message.chat.id, user.name);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: buildCommandsHelpText(env, userId), parse_mode: "HTML", disable_web_page_preview: true });
      return;
    }
    await saveUser(env, userId, { ...user, awaitingName: true });
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: FIRST_TIME_TEXT });
    return;
  }
  if (text === "/learn" || text.startsWith("/learn ")) {
    await telegram(env, "sendMessage", {
      chat_id: message.chat.id,
      text: "هذا هو بوت تعلم اللغة القبطية من الصفر: https://t.me/Coptic2_bot",
    });
    return;
  }
  if (text === "/random" || text.startsWith("/random ")) {
    const index = Math.floor(Math.random() * records.length);
    await sendRecord(env, message.chat.id, index, -1, "");
    return;
  }
  if (text === "/contact" || text.startsWith("/contact ")) { if (!await featureEnabled(env, "contact")) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "📭 خاصية التواصل مع الأدمن معطلة حاليًا." }); return; } await handleContactAdmin(env, message, userId, text); return; }
  if (text === "/stopbroadcast") {
    await setOptOut(env, userId, true);
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "🔕 تم تسجيل خروجك من الرسائل الجماعية. يمكنك العودة في أي وقت بأمر /startbroadcast." });
    return;
  }
  if (text === "/startbroadcast") {
    await setOptOut(env, userId, false);
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "🔔 تم إعادة تسجيلك لاستقبال الرسائل الجماعية." });
    return;
  }
  if (text === "/cancel") {
    const user = known ?? await getUser(env, userId);
    if (user?.awaitingContact) { await saveUser(env, userId, { ...user, awaitingContact: undefined }); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم إلغاء رسالة التواصل مع الإدارة." }); return; }
  }
  // ---- Batch 5 user features: quiz, favorites, my stats, recent, voice preference ----
  if (text === "/quiz") { await beginQuiz(env, message.chat.id); return; }
  if (text === "/fav" || text === "/⭐") {
    const last = lastLookup.get(String(message.chat.id));
    if (!last?.coptic) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "⭐ ابحث عن كلمة أولًا ثم اضغط /fav لحفظها في مفضلتك." }); return; }
    const added = await addFavorite(env, userId, { word: last.coptic, meaning: last.meaning });
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: added ? `⭐ تمت إضافة «${escapeHtml(last.coptic)}» إلى مفضلتك. اعرضها بـ /myfav` : "⭐ هذه الكلمة في مفضلتك بالفعل.", parse_mode: "HTML" });
    return;
  }
  if (text === "/myfav" || text.startsWith("/myfav ")) {
    const arg = text.slice("/myfav".length).trim();
    if (arg) { const removed = await removeFavorite(env, userId, arg); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: removed ? `🗑 حُذفت «${escapeHtml(arg.slice(0, 60))}» من المفضلة.` : "هذه الكلمة ليست في مفضلتك." }); return; }
    const favs = await userFavorites(env, userId);
    if (!favs.length) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "مفضلتك فارغة. ابحث عن كلمة ثم أرسل /fav لحفظها." }); return; }
    const lines = ["⭐ <b>كلماتك المفضلة</b>", "", ...favs.map((f) => `• <b>${escapeHtml(f.word)}</b> — ${escapeHtml(f.meaning ?? "")}\n  حذف: /myfav ${escapeHtml(f.word)}`)];
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: lines.join("\n").slice(0, 3800), parse_mode: "HTML" });
    return;
  }
  if (text === "/mystats") { await sendMyStats(env, message.chat.id, userId, displayName(message.from)); return; }
  if (text === "/recent") {
    const history = await getUserHistory(env, userId);
    if (!history.length) { await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "لا توجد عمليات بحث محفوظة بعد." }); return; }
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: ["🕘 <b>آخر عمليات بحثك</b>", "", ...history.slice(0, 15).map((h) => `• ${escapeHtml(h.q)}`)].join("\n"), parse_mode: "HTML" });
    return;
  }
  if (text === "/voiceoff") { await saveUser(env, userId, { ...(known ?? await getUser(env, userId)) ?? {}, voiceOff: true }); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "🔇 لن يُرسل النطق تلقائيًا مع نتائج البحث بعد الآن. للتشغيل: /voiceon" }); return; }
  if (text === "/voiceon") { const user = (known ?? await getUser(env, userId)) ?? {}; await saveUser(env, userId, { ...user, voiceOff: undefined }); await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "🔊 سيعود إرسال النطق تلقائيًا مع نتائج البحث." }); return; }
  if (text === "/suggest" || text.startsWith("/suggest ")) {
    const suggestion = text.slice("/suggest".length).trim();
    if (!suggestion) {
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "💡 أرسل اقتراحك بهذا الشكل: /suggest الكلمة القبطية — المعنى (بالعربية أو الإنجليزية). سيُراجعها الأدمن ويضيفها للقاموس." });
      return;
    }
    const entry = await addSuggestion(env, userId, suggestion);
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: entry ? "✅ تم استلام اقتراحك وسيُراجعه الأدمن قريبًا. شكرًا لمساهمتك!" : "⚠️ تعذّر حفظ الاقتراح حاليًا، جرّب لاحقًا." });
    return;
  }
  if (text === "/leaderboard") {
    const top = await leaderboardTop(env, 10);
    const lines = ["🏆 <b>لوحة المتصدرين</b>", ""];
    if (!top.length) lines.push("لا توجد نقاط مسجلة بعد. اكتب أي كلمة للبحث واكسب نقاطًا!");
    top.forEach(([id, e], i) => { lines.push(`${i + 1}. ${escapeHtml(String(e?.name ?? id).slice(0, 30))} — ${Number(e?.points ?? 0).toLocaleString("en-US")} نقطة${e?.streak > 1 ? ` (سلسلة ${e.streak} أيام)` : ""}`); });
    await telegram(env, "sendMessage", { chat_id: message.chat.id, text: lines.join("\n").slice(0, 2000), parse_mode: "HTML" });
    return;
  }
  if (message.voice || message.audio) {
    const forwarded = await forwardIncomingVoice(env, message);
    const text = forwarded.ok
      ? "✅ تم إرسال الـVoice إلى مجموعة البوت الثاني."
      : forwarded.reason === "not_configured"
        ? "⚠️ لم تُربط مجموعة البوت الثاني بعد. أرسل /setarchive here داخل المجموعة أولًا."
        : `❌ تعذّر إرسال الـVoice إلى المجموعة: ${forwarded.reason}`;
    await telegram(env, "sendMessage", {
      chat_id: message.chat.id,
      text,
    });
    return;
  }
  if (text.startsWith("/")) {
    await telegram(env, "sendMessage", {
      chat_id: message.chat.id,
      text: "اكتب الكلمة مباشرة للبحث أو استخدم /start للبدء.",
    });
    return;
  }
  if (text) {
    // Fresh read (not the registeredCache snapshot) so awaitingContact / awaitingName are never stale.
    const user = await getUser(env, userId);
    if (user?.awaitingContact) {
      await saveUser(env, userId, { ...user, awaitingContact: undefined });
      await deliverContactMessage(env, message, userId, text);
      return;
    }
    if (user?.awaitingName) {
      if (!isValidFullName(text)) {
        await telegram(env, "sendMessage", { chat_id: message.chat.id, text: NAME_RETRY_TEXT });
        return;
      }
      const name = text.replace(/\s+/gu, " ").trim();
      const completed = { ...user, name, awaitingName: undefined, registeredAt: new Date().toISOString() };
      await saveUser(env, userId, completed);
      await inBackground(ctx, pushUsers(env, [userSheetRow(userId, completed, message.from)]));
      await sendWelcome(env, message.chat.id, name);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: buildCommandsHelpText(env, userId), parse_mode: "HTML", disable_web_page_preview: true });
      if (!isAdmin(env, userId)) {
        await notifyAdmins(env, `✅ أكمل التسجيل: <b>${escapeHtml(name)}</b> (🆔 <code>${escapeHtml(userId)}</code>)`);
      }
      return;
    }
    // Batch 4: word blacklist (moderation) — blocked queries return no results.
    if (!isAdmin(env, userId) && await isBlacklistedWord(env, text)) {
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "⚠️ لا تتوفر نتائج لهذا البحث حاليًا." });
      return;
    }
    const preparedSearch = searchPlanPromise ? await searchPlanPromise : null;
    if (preparedSearch) await preparedSearch();
    else await sendSearch(env, message.chat.id, text, 0, undefined, ctx);
  }
}

// ---------------------------------------------------------------------------
// Extra admin pack wiring: shares the worker's storage, Telegram and dictionary
// helpers so both files stay small and there is one source of truth.
// ---------------------------------------------------------------------------
let activeEnv = null;
const adminExtras = createAdminExtras({
  telegram,
  escapeHtml,
  storeCall,
  getUser,
  saveUser,
  bannedSet,
  readAnalyticsReport,
  readErrorLog,
  sendTextFile,
  logAdminAction,
  adminIds,
  driveConfig,
  callAppsScript,
  records,
  formatUptime,
  readMisses,
  flushMisses,
  clearMisses,
  cacheInfo,
  botVersion: BOT_VERSION,
  adminStatsOp: () => (activeEnv ? storeCall(activeEnv, { op: "adminStats" }).catch(() => ({})) : Promise.resolve({})),
});

const adminExtras2 = createAdminExtras2({
  telegram,
  escapeHtml,
  storeCall,
  getUser,
  bannedSet,
  readAnalyticsReport,
  readErrorLog,
  readMisses,
  flushMisses,
  sendTextFile,
  logAdminAction,
  adminIds,
  driveConfig,
  callAppsScript,
  records,
  formatUptime,
  getUserHistory,
  maintenanceOn,
  setMaintenance,
  customMaintenanceMessage,
  recentSearches,
  botVersion: BOT_VERSION,
});

export default {
  async fetch(request, env, ctx) {
    countRequest(env, ctx);
    activeEnv = env;
    const url = new URL(request.url);
    const speech = /^\/tts\/(\d{1,6})\.(?:mp3|ogg)$/u.exec(url.pathname);
    if (speech && (request.method === "GET" || request.method === "HEAD") && records[Number(speech[1])]) {
      return serveSpeech(request, ctx, env, Number(speech[1]));
    }
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Coptic dictionary bot is ready.", { status: 200 });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        status: "ready",
        bot: "coptic-dictionary-bot",
        records: records.length,
        time: new Date().toISOString(),
        usersStore: Boolean(env.USERS),
        driveConfigured: Boolean(await driveConfig(env).catch(() => null)),
      });
    }
    // Public read-only API for external consumers (admin-issued keys, 120 req/min per key).
    if (request.method === "GET" && url.pathname === "/api/dictionary") {
      const key = url.searchParams.get("key") ?? "";
      const q = url.searchParams.get("q") ?? "";
      const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
      if (!key || !(await validApiKey(env, key))) {
        return new Response(JSON.stringify({ ok: false, error: "invalid or missing api key" }), { status: 403, headers: jsonHeaders });
      }
      if (!apiKeyAllowed(key)) {
        return new Response(JSON.stringify({ ok: false, error: "rate limit exceeded (120/min per key)" }), { status: 429, headers: jsonHeaders });
      }
      const candidates = (localDictionaryCandidates(q, 10).candidates ?? []).map((c) => ({ row: c.row, values: c.values }));
      return new Response(JSON.stringify({ ok: true, query: q, count: candidates.length, results: candidates }), { status: 200, headers: jsonHeaders });
    }

    if (request.method === "POST" && url.pathname === "/voice-drive") {
      // The compress-voice Action reports the Drive link of a compressed recording.
      if (!env.CALLBACK_SECRET || !sameSecret(request.headers.get("x-callback-secret") ?? "", env.CALLBACK_SECRET)) {
        return new Response("Forbidden", { status: 403 });
      }
      const body = await request.json().catch(() => null);
      const id = Number(body?.id);
      const fileId = String(body?.fileId ?? "");
      if (!Number.isInteger(id) || !fileId || !body?.drive) return new Response("Bad request", { status: 400 });
      const result = await storeCall(env, {
        op: "voicedrive",
        id,
        fileId,
        drive: { url: body.drive.url ?? null, fileId: body.drive.fileId ?? null, at: new Date().toISOString() },
      });
      return Response.json(result ?? { ok: true });
    }

    if (request.method === "POST" && url.pathname === "/__setup") {
      if (!env.TELEGRAM_BOT_TOKEN || !env.WEBHOOK_SECRET ||
          request.headers.get("x-setup-secret") !== env.WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      const result = await telegram(env, "setWebhook", {
        url: `${url.origin}/webhook`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query", "inline_query"],
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
      const t0 = Date.now();
      const update = await request.json();
      await handleUpdate(update, env, ctx);
      // Pro feature: structured request logging (duration + update type).
      const durMs = Date.now() - t0;
      const kind = update.inline_query ? "inline" : update.callback_query ? "callback" : update.message ? "message" : "other";
      console.log(JSON.stringify({ ev: "webhook", kind, update_id: update.update_id ?? null, dur_ms: durMs }));
      return new Response("ok", { status: 200 });
    } catch (error) {
      logError(env, error, { where: "webhook" });
      console.error("Webhook update failed", error instanceof Error ? error.message : "unknown error");
      // Return 200 so Telegram does not retry a malformed update indefinitely.
      return new Response("ok", { status: 200 });
    }
  },
};
