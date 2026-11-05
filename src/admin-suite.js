// ============================================================================
// admin-suite.js — حزمة الأدمن الاحترافية (لوحة واحدة + تقارير من بيانات حقيقية)
//
// تتبع نفس عقد الحزم السابقة تمامًا: createAdminSuite(api) ترجع { handle, commands }.
// كل الأرقام محسوبة من مصادر حقيقية فقط:
//   - records (القاموس المرفق) + audioManifest عبر quickAudioIds()
//   - سجل المستخدمين في Durable Object (firstSeen/lastSeen/reflink/blocked)
//   - حلقة البحث الأخيرة recentSearches وaudit الأدمن
// لا تخترع أرقامًا: أي حقل غير موجود يظهر "—" ولا يُقدَّر.
// ============================================================================

export function createAdminSuite(api) {
  const { telegram, escapeHtml, storeCall, records, logAdminAction, adminIds, botVersion, recentSearches } = api;
  const esc = (value) => escapeHtml(String(value ?? ""));
  const fmt = (value) => Number(value ?? 0).toLocaleString("en-US");
  const replyTo = (env, chatId) => (text, extra = {}) => telegram(env, "sendMessage", {
    chat_id: chatId, text: String(text).slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, ...extra,
  });
  const storeGet = async (env, key, fallback = null) => {
    if (!env.USERS) return fallback;
    try { return (await storeCall(env, { op: "get", key })).value ?? fallback; } catch { return fallback; }
  };
  const storePut = async (env, key, value) => {
    if (!env.USERS) return false;
    try { await storeCall(env, { op: "put", key, value }); return true; } catch { return false; }
  };
  async function allUsers(env, max = 8000) {
    const out = [];
    let cursor = null;
    for (;;) {
      const page = await storeCall(env, { op: "userpage", limit: 200, ...(cursor ? { cursor } : {}) });
      const users = page?.users ?? [];
      if (!users.length) break;
      out.push(...users);
      cursor = page.next;
      if (!cursor || out.length >= max) break;
    }
    return out;
  }
  const bare = (value) => String(value ?? "").replace(/[\u0300-\u036f\u064b-\u065f\u0670\u06d6-\u06ed]/gu, "").replace(/`/gu, "").replace(/\s*\([^)]*\)/gu, "").replace(/\s+/gu, " ").trim();

  // مصدر الصوت الحقيقي: نفس الـ manifest المرفق الذي يقرؤه البوت فعليًا (نفس الحزمة).
  let audioIds = null;
  async function audioIdSet() {
    if (audioIds) return audioIds;
    try {
      const mod = await import("../data/audio-manifest.json", { with: { type: "json" } });
      audioIds = new Set(Object.keys(mod.default ?? mod));
    } catch { audioIds = new Set(); }
    return audioIds;
  }

  // -------------------------------------------------------------- لوحة الأوامر
  const PANEL_TEXT = `🛠 <b>لوحة الأدمن الاحترافية</b>\nالإصدار: <code>${esc(botVersion)}</code>\nالقاموس: ${fmt(records.length)} مدخل\n\nاختر قسمًا من الأزرار:`;
  const panelKeyboard = () => ({
    inline_keyboard: [
      [{ text: "📊 التقارير", callback_data: "aps|reports" }, { text: "👥 المستخدمون", callback_data: "aps|users" }],
      [{ text: "📚 القاموس", callback_data: "aps|dict" }, { text: "⚙️ النظام", callback_data: "aps|system" }],
      [{ text: "🔄 تحديث", callback_data: "aps|home" }],
    ],
  });
  async function runPanelCommand(env, chatId, section, title, fn) {
    const keyboard = section ? { inline_keyboard: [[{ text: "⬅️ رجوع", callback_data: `aps|${section}` }], [{ text: "🏠 اللوحة", callback_data: "aps|home" }]] } : panelKeyboard();
    await replyTo(env, chatId)(`⏳ يُحسب ${esc(title)}…`, { reply_markup: undefined });
    try {
      const text = await fn();
      await replyTo(env, chatId)(text, { reply_markup: keyboard });
    } catch (error) {
      await replyTo(env, chatId)(`❌ فشل ${esc(title)}: ${esc(error instanceof Error ? error.message : "خطأ")}`, { reply_markup: keyboard });
    }
  }
  const SECTIONS = {
    reports: { title: "📊 التقارير", buttons: [["⏰ النشاط بالساعة", "hourly"], ["🫵 قمع التفاعل", "funnel"], ["📆 أفواج التسجيل", "cohorts"], ["🔗 مصادر الروابط", "reflinks"]] },
    users: { title: "👥 المستخدمون", buttons: [["👑 الأدمن الحاليون", "admins"], ["📦 مقارنة لقطتين", "snapshot"]] },
    dict: { title: "📚 القاموس", buttons: [["👯 الكلمات المكررة", "dups"], ["🔇 بلا صوت منشور", "noaudio"], ["🕳 معانٍ فارغة", "emptymeaning"]] },
    system: { title: "⚙️ النظام", buttons: [["🧭 هوية البوت والويبهوك", "whereami"], ["👑 الأدمن الحاليون", "admins"], ["📦 مقارنة لقطتين", "snapshot"]] },
  };
  function sectionKeyboard(sectionKey) {
    const section = SECTIONS[sectionKey];
    const rows = section.buttons.map(([label, cmd]) => [{ text: label, callback_data: `apx|${cmd}` }]);
    rows.push([{ text: "🏠 اللوحة", callback_data: "aps|home" }]);
    return { inline_keyboard: rows };
  }
  function sectionText(sectionKey) {
    const section = SECTIONS[sectionKey];
    return `${section.title}\n\nاختر تقريرًا:`;
  }
  async function handlePanelCallback({ env, callback }) {
    const data = String(callback.data ?? "");
    const chatId = callback.message?.chat?.id;
    const messageId = callback.message?.message_id;
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id }).catch(() => null);
    if (!chatId) return;
    if (data === "aps|home" && messageId) {
      await telegram(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: PANEL_TEXT, parse_mode: "HTML", reply_markup: panelKeyboard() }).catch(() => null);
      return;
    }
    const section = /^aps\|(\w+)$/u.exec(data);
    if (section && SECTIONS[section[1]] && messageId) {
      await telegram(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: sectionText(section[1]), parse_mode: "HTML", reply_markup: sectionKeyboard(section[1]) }).catch(() => null);
      return;
    }
    const action = /^apx\|(\w+)$/u.exec(data);
    if (action) {
      const entry = COMMANDS[action[1]];
      if (!entry) return;
      const text = await entry.run({ env, chatId });
      const backKeyboard = { inline_keyboard: [[{ text: "⬅️ رجوع", callback_data: "aps|home" }]] };
      if (messageId) await telegram(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: String(text).slice(0, 4000), parse_mode: "HTML", reply_markup: backKeyboard }).catch(async () => { await replyTo(env, chatId)(text, { reply_markup: backKeyboard }); });
    }
  }

  // ----------------------------------------------------------------- التقارير
  async function runHourly(env, chatId) {
    const now = Date.now();
    const buckets = new Array(24).fill(0);
    let total = 0;
    for (const entry of recentSearches ?? []) {
      const hour = Number.isFinite(entry?.at) ? new Date(entry.at).getUTCHours() : null;
      if (hour == null || now - entry.at > 86400000 * 7) continue;
      buckets[hour] += 1;
      total += 1;
    }
    if (!total) return "⏰ لا توجد عمليات بحث حديثة كافية لبناء مبيان الساعات (آخر 7 أيام).";
    const peak = Math.max(...buckets);
    const rows = buckets.map((n, hour) => `${String(hour).padStart(2, "0")}:00 ${"█".repeat(Math.round((n / Math.max(peak, 1)) * 12)).padEnd(12, "　")} ${fmt(n)}`);
    return `⏰ النشاط بالساعة (UTC — آخر 7 أيام، ${fmt(total)} بحثًا):\n<code>${rows.join("\n")}</code>`;
  }
  async function runFunnel(env, chatId) {
    const users = await allUsers(env);
    const now = Date.now();
    const active = (days) => users.filter((u) => {
      const t = Date.parse(u.record?.lastSeen ?? "");
      return Number.isFinite(t) && now - t <= days * 86400000;
    }).length;
    const total = users.length;
    const d7 = active(7), d1 = active(1), d30 = active(30);
    const pct = (n) => (total ? `${Math.round(n / total * 100)}%` : "—");
    return `🫵 قمع التفاعل (من سجلات المستخدمين الفعلية):\n👥 مسجلون: <b>${fmt(total)}</b>\n🟢 نشِط آخر 24 ساعة: <b>${fmt(d1)}</b> (${pct(d1)})\n🟡 نشِط آخر 7 أيام: <b>${fmt(d7)}</b> (${pct(d7)})\n🟠 نشِط آخر 30 يومًا: <b>${fmt(d30)}</b> (${pct(d30)})\n⚫️ خامل أكثر من 30 يومًا: <b>${fmt(total - d30)}</b>`;
  }
  async function runCohorts(env, chatId) {
    const users = await allUsers(env);
    const byDay = new Map();
    for (const u of users) {
      const t = Date.parse(u.record?.firstSeen ?? u.record?.registeredAt ?? "");
      if (!Number.isFinite(t)) continue;
      const day = new Date(t).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    const unknown = users.length - [...byDay.values()].reduce((s, n) => s + n, 0);
    const rows = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14).map(([day, n]) => `${day}: ${fmt(n)}`);
    return `📆 أفواج التسجيل (أحدث 14 يومًا):\n${rows.length ? rows.map((r) => `• ${esc(r)}`).join("\n") : "لا توجد تواريخ تسجيل مسجلة."}${unknown ? `\n(بدون تاريخ معروف: ${fmt(unknown)})` : ""}`;
  }
  async function runReflinks(env, chatId) {
    const users = await allUsers(env);
    const counts = new Map();
    let none = 0;
    for (const u of users) {
      const source = String(u.record?.reflink ?? "").trim();
      if (!source) { none += 1; continue; }
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([source, n]) => `${esc(source)}: ${fmt(n)}`);
    return `🔗 المستخدمون حسب مصدر الرابط (من حقل reflink الفعلي):\n${rows.length ? rows.map((r) => `• ${r}`).join("\n") : "لا يوجد مستخدمون بروابط حمل."}\n• بدون رابط: ${fmt(none)}`;
  }
  async function runDups(env, chatId) {
    const counts = new Map();
    for (const r of records) {
      const head = bare(r.coptic);
      if (!head) continue;
      counts.set(head, (counts.get(head) ?? 0) + 1);
    }
    const dups = [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
    const top = dups.slice(0, 12).map(([head, n]) => `• ${esc(head)} — ${fmt(n)} صفوف`);
    return `👯 الكلمات المكررة في القاموس (نفس الكتابة بلا زخرفة):\nالإجمالي: <b>${fmt(dups.length)}</b> كلمة مكررة من ${fmt(records.length)} صف\n${top.length ? top.join("\n") : "لا يوجد تكرار على الإطلاق."}`;
  }
  async function runNoAudio(env, chatId) {
    const audio = await audioIdSet();
    const seen = new Set();
    const missing = [];
    let withAudio = 0;
    for (const r of records) {
      const head = bare(r.coptic);
      if (!head || seen.has(head)) continue;
      seen.add(head);
      if (r.id != null && audio.has(String(r.id))) withAudio += 1;
      else if (missing.length < 12) missing.push(head);
    }
    const total = seen.size;
    const percent = total ? Math.round(withAudio / total * 100) : 0;
    return `🔇 كلمات بلا ملف صوت منشور (من الـ manifest المرفق):\n🔊 تغطية صوتية: <b>${fmt(withAudio)}</b> / ${fmt(total)} كلمة فريدة (<b>${percent}%</b>)\n\nأول أمثلة ناقصة:\n${missing.length ? missing.map((m) => `• ${esc(m)}`).join("\n") : "لا شيء — التغطية كاملة."}`;
  }
  async function runEmptyMeaning(env, chatId) {
    const rows = records.filter((r) => !String(r.meaning ?? "").trim());
    const sample = rows.slice(0, 10).map((r) => `• صف ${esc(String(r.id ?? "?"))}: ${esc(bare(r.coptic) || "(بلا كلمة)")}`);
    return `🕳 صفوف بمعنى فارغ: <b>${fmt(rows.length)}</b> من ${fmt(records.length)}\n${sample.length ? sample.join("\n") : "كل الصفوف لها معنى."}`;
  }
  async function runAdmins(env, chatId, userId) {
    const ids = adminIds(env);
    const names = [];
    for (const id of ids) {
      const user = await getUserSafe(env, id);
      names.push(`👑 <code>${esc(id)}</code>${user?.name ? ` — ${esc(user.name)}` : ""}${user?.username ? ` (@${esc(user.username)})` : ""}`);
    }
    await logAdminAction(env, userId, "ap-admins", "view");
    return `👑 الأدمن الحاليون (${fmt(ids.length)}):\n${names.join("\n")}`;
  }
  async function getUserSafe(env, id) {
    if (!env.USERS) return null;
    try { return (await storeCall(env, { op: "get", key: `user:${id}` })).value ?? null; } catch { return null; }
  }
  async function runWhereami(env, chatId) {
    const webhook = await telegram(env, "getWebhookInfo", {}).catch(() => null);
    const info = webhook?.result ?? {};
    const pending = Number(info.pending_update_count ?? 0);
    return `🧭 هوية البوت والويبهوك:\n الإصدار: <code>${esc(botVersion)}</code>\n🔗 الويبهوك: ${info.url ? `<code>${esc(info.url)}</code>` : "غير مضبوط"}\n📬 تحديثات معلّقة: <b>${fmt(pending)}</b>${pending > 100 ? " ⚠️ تراكم" : ""}\n📦 آخر خطأ تيليجرام: ${info.last_error_message ? `<code>${esc(info.last_error_message)}</code>` : "لا يوجد ✅"}\n📚 السجلات: ${fmt(records.length)}`;
  }
  async function runSnapshot(env, chatId, userId, diff) {
    const users = await allUsers(env);
    const now = Date.now();
    const active = users.filter((u) => { const t = Date.parse(u.record?.lastSeen ?? ""); return Number.isFinite(t) && now - t <= 86400000 * 7; }).length;
    const current = { at: new Date().toISOString(), records: records.length, users: users.length, active7: active };
    if (!diff) {
      await storePut(env, "suite:snapshot:prev", await storeGet(env, "suite:snapshot:last") ?? null);
      await storePut(env, "suite:snapshot:last", current);
      await logAdminAction(env, userId, "ap-snapshot", "save");
      return `📦 حُفظت لقطة الحالة:\n📚 سجلات: ${fmt(current.records)}\n👥 مستخدمون: ${fmt(current.users)}\n🟢 نشطون/7 أيام: ${fmt(current.active7)}\n\nقارنها لاحقًا: /snapshot diff`;
    }
    const last = await storeGet(env, "suite:snapshot:last");
    const prev = await storeGet(env, "suite:snapshot:prev") ?? last;
    if (!last) return "لا توجد لقطة محفوظة بعد. أرسل /snapshot أولًا لحفظ لقطة، ثم /snapshot diff بعد فترة للمقارنة.";
    const delta = (key) => Number(last[key] ?? 0) - Number(prev?.[key] ?? last[key] ?? 0);
    const arrow = (n) => (n > 0 ? `⬆️ +${fmt(n)}` : n < 0 ? `⬇️ ${fmt(n)}` : "➖ ثابت");
    return `📦 مقارنة اللقطات (الأحدث: ${esc(last.at.slice(0, 16))}):\n📚 السجلات: ${fmt(last.records)} ${arrow(delta("records"))}\n👥 المستخدمون: ${fmt(last.users)} ${arrow(delta("users"))}\n🟢 النشطون/7 أيام: ${fmt(last.active7)} ${arrow(delta("active7"))}`;
  }

  const COMMANDS = {
    apanel: { description: "لوحة الأدمن الاحترافية", run: async ({ env, chatId }) => { await replyTo(env, chatId)(PANEL_TEXT, { reply_markup: panelKeyboard() }); return true; } },
    hourly: { description: "النشاط بالساعة", run: ({ env, chatId }) => runHourly(env, chatId) },
    funnel: { description: "قمع التفاعل", run: ({ env, chatId }) => runFunnel(env, chatId) },
    cohorts: { description: "أفواج التسجيل", run: ({ env, chatId }) => runCohorts(env, chatId) },
    reflinks: { description: "مصادر الروابط", run: ({ env, chatId }) => runReflinks(env, chatId) },
    dups: { description: "الكلمات المكررة", run: ({ env, chatId }) => runDups(env, chatId) },
    noaudio: { description: "كلمات بلا صوت", run: ({ env, chatId }) => runNoAudio(env, chatId) },
    emptymeaning: { description: "صفوف بمعنى فارغ", run: ({ env, chatId }) => runEmptyMeaning(env, chatId) },
    admins: { description: "الأدمن الحاليون", run: ({ env, chatId, userId }) => runAdmins(env, chatId, userId) },
    whereami: { description: "هوية البوت والويبهوك", run: ({ env, chatId }) => runWhereami(env, chatId) },
    snapshot: { description: "لقطة حالة ومقارنتها (/snapshot أو /snapshot diff)", run: ({ env, chatId, userId, args }) => runSnapshot(env, chatId, userId, /^diff$/u.test(String(args ?? "").trim())) },
  };
  const commandList = Object.entries(COMMANDS).map(([command, entry]) => ({ command, description: entry.description }));

  async function handle({ env, chatId, userId, text, raw }) {
    const source = String(raw ?? text ?? "").trim();
    if (!source.startsWith("/")) return false;
    const match = /^\/([a-zA-Z_]+)(?:@[^\s]+)?(?:\s+([\s\S]*))?$/u.exec(source);
    if (!match) return false;
    const name = match[1].toLowerCase();
    const entry = COMMANDS[name];
    if (!entry) return false;
    try {
      const result = await entry.run({ env, chatId, userId, args: (match[2] ?? "").trim(), text: source });
      if (result !== true && result != null) await replyTo(env, chatId)(result);
    } catch (error) {
      await replyTo(env, chatId)(`❌ تعذّر تنفيذ /${esc(name)}: ${esc(error instanceof Error ? error.message : "خطأ غير معروف")}`);
    }
    return true;
  }
  return { handle, handlePanelCallback, commands: COMMANDS, commandList };
}
