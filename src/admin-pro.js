// ============================================================================
// admin-pro.js — الحزمة الاحترافية لميزات الأدمن (v1.0.0)
//
// ثماني حزم: لوحة تحكم تفاعلية، صلاحيات متدرجة، إعلانات مستهدفة بشرائح،
// نظام تذاكر دعم، تنبيهات ذكية في الوقت الفعلي، ملخص أسبوعي تلقائي،
// سجل أمان منفصل، ومحرر سلاسل الواجهة.
// بادئة الـ callbacks: "ap|"
// ============================================================================
const AP = {
  roles: "pro:roles",
  tickets: "pro:tickets",
  ticketSeq: "pro:ticket:seq",
  campaigns: "pro:campaigns",
  campaignState: "pro:campaign:state",
  alerts: "pro:alerts:last",
  alertErrCount: "pro:alerts:errcount",
  weekly: "pro:weekly:last",
  security: "pro:security:audit",
  uistrings: "pro:uistrings",
  gamify: "pro:gamify:scores",
  antispamFlags: "pro:antispam:flags",
  antispamAutoban: "pro:antispam:autoban",
  events: "pro:events",
  eventSeq: "pro:event:seq",
  voiceRebuild: "pro:voice:rebuild",
  referrals: "pro:referrals",
  reports: "pro:reports",
  reportSeq: "pro:report:seq",
  rollout: "pro:rollout",
  teamnotes: "pro:teamnotes",
  teamnoteSeq: "pro:teamnote:seq",
  maintAdv: "pro:maint:advanced",
  supportFlow: "pro:support:flow",
};
const HR = "━━━━━━━━━━━━";
const ROLE_LEVELS = { viewer: 1, mod: 2, admin: 3, owner: 4 };
const ROLE_NAMES = { viewer: "مشاهد", mod: "مشرف", admin: "أدمن", owner: "مالك" };
const DEFAULT_STRINGS = {
  welcome_text: "مرحبًا بك في القاموس القبطي البحيري! اكتب أي كلمة للبحث.",
  ban_message: "تم حظرك من استخدام البوت. تواصل مع المشرف إذا كنت تعتقد أن هذا خطأ.",
  maintenance_note: "البوت تحت الصيانة حاليًا، عُد لاحقًا.",
  support_thanks: "تم استلام تذكرتك بنجاح، سيرد عليك فريق الدعم في أقرب وقت.",
  broadcast_done: "اكتمل الإرسال الجماعي بنجاح.",
};
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;
const ALERT_COOLDOWN = 30 * 60 * 1000;
const CAMPAIGN_BATCH = 25;

export function createAdminPro(api) {
  const {
    telegram, escapeHtml, storeCall, getUser, saveUser, bannedSet, readAnalyticsReport,
    readErrorLog, sendTextFile, logAdminAction, adminIds, driveConfig, callAppsScript,
    records, formatUptime, readMisses, flushMisses, cacheInfo, botVersion,
    adminStatsOp, getUserHistory, maintenanceOn, setMaintenance, recentSearches,
  } = api;

  const esc = (value) => escapeHtml(String(value ?? ""));
  const fmt = (value) => Number(value ?? 0).toLocaleString("en-US");
  const iso = () => new Date().toISOString();
  const day = () => iso().slice(0, 10);
  const say = (env, chatId) => (text, extra = {}) => telegram(env, "sendMessage", {
    chat_id: chatId, text: String(text).slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, ...extra,
  });
  const isAdminUser = (env, userId) => adminIds(env).map(String).includes(String(userId));
  const sget = async (env, key, fallback = null) => {
    if (!env.USERS) return fallback;
    try { return (await storeCall(env, { op: "get", key })).value ?? fallback; } catch { return fallback; }
  };
  const sput = async (env, key, value) => {
    if (!env.USERS) return false;
    try { await storeCall(env, { op: "put", key, value }); return true; } catch { return false; }
  };
  const sdel = async (env, key) => {
    if (!env.USERS) return;
    try { await storeCall(env, { op: "delete", key }); } catch { /* ignore */ }
  };
  async function allUsers(env, max = 8000) {
    const out = [];
    let cursor = null;
    for (;;) {
      const page = await storeCall(env, { op: "userpage", limit: 200, ...(cursor ? { cursor } : {}) }).catch(() => null);
      const list = page?.users ?? [];
      if (!list.length) break;
      out.push(...list);
      cursor = page.next;
      if (!cursor || out.length >= max) break;
    }
    return out;
  }
  let lastTickAt = 0;
  // عدّاد السبام في الذاكرة (لكل عملية معزولة) — يُصفّى كل دقيقة
  const spamCounters = new Map();
  const SPAM_THRESHOLD = 30;

  // ==========================================================================
  // 1) نظام الصلاحيات المتدرجة
  // ==========================================================================
  async function getRoles(env) {
    const v = await sget(env, AP.roles, {});
    return (v && typeof v === "object") ? v : {};
  }
  async function userRole(env, userId) {
    if (isAdminUser(env, userId)) return "owner";
    const roles = await getRoles(env);
    return roles[String(userId)] || null;
  }
  async function hasRole(env, userId, minLevel) {
    const role = await userRole(env, userId);
    if (!role) return false;
    return (ROLE_LEVELS[role] || 0) >= minLevel;
  }
  async function requireRole(env, userId, chatId, minLevel) {
    if (await hasRole(env, userId, minLevel)) return true;
    const role = await userRole(env, userId);
    const needed = Object.keys(ROLE_LEVELS).find((k) => ROLE_LEVELS[k] === minLevel) || "admin";
    await say(env, chatId)(`⛔ <b>غير مصرح</b>\nصلاحيتك الحالية: <b>${esc(role ? ROLE_NAMES[role] : "—")}</b>\nهذا الإجراء يتطلب صلاحية <b>${esc(ROLE_NAMES[needed] || needed)}</b> فأعلى.`);
    return false;
  }

  // ==========================================================================
  // 2) سجل الأمان (Security Audit)
  // ==========================================================================
  async function logSecurity(env, userId, action, detail) {
    const log = (await sget(env, AP.security, [])) || [];
    if (!Array.isArray(log)) log.length = 0;
    log.unshift({
      t: Date.now(),
      userId: String(userId),
      action: String(action).slice(0, 60),
      detail: String(detail ?? "").slice(0, 300),
    });
    await sput(env, AP.security, log.slice(0, 300));
    if (logAdminAction) await logAdminAction(env, userId, `pro:${action}`, String(detail ?? "").slice(0, 200)).catch(() => null);
  }

  // ==========================================================================
  // 3) سلاسل الواجهة (UI Strings)
  // ==========================================================================
  async function getStrings(env) {
    const stored = await sget(env, AP.uistrings, {});
    return { ...DEFAULT_STRINGS, ...((stored && typeof stored === "object") ? stored : {}) };
  }

  // ==========================================================================
  // 4) نظام تذاكر الدعم
  // ==========================================================================
  async function nextTicketId(env) {
    const seq = Number(await sget(env, AP.ticketSeq, 0)) + 1;
    await sput(env, AP.ticketSeq, seq);
    return "TKT-" + String(seq).padStart(4, "0");
  }
  async function getTickets(env) {
    const t = await sget(env, AP.tickets, []);
    return Array.isArray(t) ? t : [];
  }
  async function notifyAdmins(env, text) {
    const ids = adminIds(env);
    for (const id of ids) {
      await telegram(env, "sendMessage", { chat_id: id, text: String(text).slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }).catch(() => null);
    }
  }

  // ==========================================================================
  // 5) لوحة التحكم التفاعلية (/proadmin)
  // ==========================================================================
  function mainMenuKeyboard() {
    return {
      inline_keyboard: [
        [{ text: "📊 إحصائيات", callback_data: "ap|menu|stats" }, { text: "👥 مستخدمون", callback_data: "ap|menu|users" }],
        [{ text: "📣 إعلانات", callback_data: "ap|menu|ads" }, { text: "⚙️ نظام", callback_data: "ap|menu|system" }],
        [{ text: "📚 محتوى", callback_data: "ap|menu|content" }, { text: "🎙️ أصوات", callback_data: "ap|menu|voice" }],
        [{ text: "🔒 أمان", callback_data: "ap|menu|security" }, { text: "🛡️ صلاحيات", callback_data: "ap|menu|roles" }],
        [{ text: "❌ إغلاق", callback_data: "ap|menu|close" }],
      ],
    };
  }
  function backKeyboard() {
    return { inline_keyboard: [[{ text: "🔙 رجوع للقائمة الرئيسية", callback_data: "ap|menu|main" }]] };
  }
  async function renderMenu(env, chatId, messageId, section) {
    const edit = (text, reply_markup) => telegram(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: String(text).slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, reply_markup }).catch(() => null);
    if (section === "main" || !section) {
      return edit(`🎛️ <b>لوحة التحكم الاحترافية</b>\n${HR}\nاختر قسمًا من القائمة أدناه:`, mainMenuKeyboard());
    }
    if (section === "stats") {
      let stats = {};
      if (adminStatsOp) stats = await adminStatsOp().catch(() => ({})) || {};
      const total = Number(stats.total ?? stats.users ?? 0);
      const lines = [
        "📊 <b>قسم الإحصائيات</b>", HR,
        `إجمالي المستخدمين: <b>${fmt(total)}</b>`,
        `إصدار البوت: <code>${esc(botVersion ?? "—")}</code>`,
        `آخر عمليات بحث بالذاكرة: <b>${fmt(Array.isArray(recentSearches) ? recentSearches.length : 0)}</b>`,
        "",
        "أوامر سريعة: /searchstats ، /adminscore ، /weekly",
      ];
      return edit(lines.join("\n"), backKeyboard());
    }
    if (section === "users") {
      return edit(`👥 <b>قسم المستخدمين</b>\n${HR}\nأوامر إدارة المستخدمين:\n• /users — قائمة المستخدمين\n• /trace &lt;id&gt; — تتبّع مستخدم\n• /usertimeline &lt;id&gt; — خط زمني\n• /tickets — تذاكر الدعم المفتوحة`, backKeyboard());
    }
    if (section === "ads") {
      const camps = await sget(env, AP.campaigns, []);
      const active = await sget(env, AP.campaignState, null);
      const lines = [
        "📣 <b>قسم الإعلانات المستهدفة</b>", HR,
        `حملات سابقة: <b>${fmt(Array.isArray(camps) ? camps.length : 0)}</b>`,
        active && active.status === "sending" ? `حملة قيد الإرسال الآن: تم إرسال <b>${fmt(active.sent ?? 0)}</b> / ${fmt(active.total ?? 0)}` : "لا توجد حملة قيد الإرسال.",
        "",
        "أنشئ إعلانًا مستهدفًا: /targeted",
      ];
      return edit(lines.join("\n"), backKeyboard());
    }
    if (section === "system") {
      const maint = maintenanceOn ? Boolean(await maintenanceOn(env).catch(() => false)) : false;
      const info = cacheInfo ? (cacheInfo() || {}) : {};
      const lines = [
        "⚙️ <b>قسم النظام</b>", HR,
        `الصيانة: <b>${maint ? "مفعّلة ⚠️" : "معطّلة"}</b>`,
        `وقط التشغيل: <code>${esc(formatUptime ? formatUptime() : "—")}</code>`,
        "",
        "أوامر سريعة: /selfcheck ، /statuspage ، /syncwatch ، /alerts",
      ];
      return edit(lines.join("\n"), backKeyboard());
    }
    if (section === "content") {
      const total = Object.keys(records || {}).length;
      const lines = [
        "📚 <b>قسم المحتوى</b>", HR,
        `إجمالي الكلمات في القاموس: <b>${fmt(total)}</b>`,
        "",
        "أوامر سريعة: /wordaudit &lt;كلمة&gt; ، /gapfill &lt;حقل&gt; ، /exportmisses",
      ];
      return edit(lines.join("\n"), backKeyboard());
    }
    if (section === "voice") {
      return edit(`🎙️ <b>قسم التسجيلات الصوتية</b>\n${HR}\nأوامر سريعة:\n• /voicecoverage — تغطية الأصوات\n• /records — إدارة التسجيلات`, backKeyboard());
    }
    if (section === "security") {
      const log = await sget(env, AP.security, []);
      const lines = [
        "🔒 <b>قسم الأمان</b>", HR,
        `إجراءات مسجلة في تدقيق الأمان: <b>${fmt(Array.isArray(log) ? log.length : 0)}</b>`,
        "",
        "أوامر سريعة: /securitylog — آخر الإجراءات\n/exportsecurity — تصدير السجل\n/roles — إدارة الصلاحيات",
      ];
      return edit(lines.join("\n"), backKeyboard());
    }
    if (section === "roles") {
      const roles = await getRoles(env);
      const entries = Object.entries(roles);
      const lines = [
        "🛡️ <b>قسم الصلاحيات</b>", HR,
        `أدمنز ثابتون (مالكون): <b>${fmt(adminIds(env).length)}</b>`,
        `صلاحيات مخصصة: <b>${fmt(entries.length)}</b>`,
        "",
        "الأدوار: مالك › أدمن › مشرف › مشاهد",
        "أوامر: /setrole &lt;id&gt; &lt;owner|admin|mod|viewer&gt; ، /roles ، /myrole",
      ];
      return edit(lines.join("\n"), backKeyboard());
    }
    return edit("قسم غير معروف.", backKeyboard());
  }

  // ==========================================================================
  // أوامر الصلاحيات
  // ==========================================================================
  async function cmdSetRole(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.owner)) return;
    const parts = args.split(/\s+/u).filter(Boolean);
    if (parts.length < 2) {
      await say(env, chatId)(`ℹ️ الاستخدام: <code>/setrole &lt;id&gt; &lt;owner|admin|mod|viewer&gt;</code>`);
      return;
    }
    const targetId = String(parts[0]).replace(/[^0-9-]/gu, "");
    const role = String(parts[1]).toLowerCase();
    if (!ROLE_LEVELS[role]) {
      await say(env, chatId)(`❌ دور غير صالح. الدور المتاح: owner / admin / mod / viewer`);
      return;
    }
    if (!targetId) { await say(env, chatId)("❌ معرف مستخدم غير صالح."); return; }
    if (isAdminUser(env, targetId)) {
      await say(env, chatId)("⚠️ هذا المستخدم أدمن ثابت (مالك) ولا يمكن تغيير صلاحيته.");
      return;
    }
    const roles = await getRoles(env);
    roles[targetId] = role;
    await sput(env, AP.roles, roles);
    await logSecurity(env, userId, "setrole", `user=${targetId} role=${role}`);
    await say(env, chatId)(`✅ تم تعيين صلاحية <b>${esc(ROLE_NAMES[role])}</b> للمستخدم <code>${esc(targetId)}</code>.`);
  }
  async function cmdRoles(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.mod)) return;
    const roles = await getRoles(env);
    const entries = Object.entries(roles);
    const lines = ["🛡️ <b>قائمة الصلاحيات</b>", HR, `<b>مالكون (أدمنز ثابتون):</b> ${adminIds(env).map((id) => `<code>${esc(id)}</code>`).join("، ")}`];
    if (!entries.length) {
      lines.push("", "لا توجد صلاحيات مخصصة أخرى.");
    } else {
      lines.push("");
      for (const [id, role] of entries.slice(0, 50)) {
        lines.push(`• <code>${esc(id)}</code> → <b>${esc(ROLE_NAMES[role] || role)}</b>`);
      }
      if (entries.length > 50) lines.push(`… و ${fmt(entries.length - 50)} آخرين`);
    }
    await say(env, chatId)(lines.join("\n"));
  }
  async function cmdMyRole(env, chatId, userId) {
    const role = await userRole(env, userId);
    await say(env, chatId)(`👤 صلاحيتك الحالية: <b>${esc(role ? ROLE_NAMES[role] : "لا توجد صلاحية")}</b> <code>(${esc(role || "none")})</code>`);
  }

  // ==========================================================================
  // الإعلانات المستهدفة بشرائح (/targeted)
  // ==========================================================================
  function parseTargetedArgs(args) {
    const tokens = args.split(/\s+/u);
    const criteria = {};
    let msgStart = 0;
    for (let i = 0; i < tokens.length; i += 1) {
      const t = tokens[i];
      const m = /^([a-z_]+)=(.+)$/iu.exec(t);
      if (!m) { msgStart = i; break; }
      criteria[m[1].toLowerCase()] = m[2];
      msgStart = i + 1;
    }
    const message = tokens.slice(msgStart).join(" ").trim();
    return { criteria, message };
  }
  function matchCriteria(record, criteria, now) {
    const r = record || {};
    if (criteria.lang) {
      const lang = String(r.lang ?? "").toLowerCase();
      const want = String(criteria.lang).toLowerCase();
      if (want === "ar" && lang && lang !== "ar") return false;
      if (want === "en" && lang && lang !== "en") return false;
      if (want === "coptic" && lang && !lang.includes("cop")) return false;
    }
    if (criteria.activity) {
      const last = r.lastSeen ? Date.parse(r.lastSeen) : 0;
      const active = Number.isFinite(last) && now - last < 7 * 24 * 60 * 60 * 1000;
      if (criteria.activity === "active" && !active) return false;
      if (criteria.activity === "idle" && active) return false;
    }
    if (criteria.joined_before) {
      const first = r.firstSeen ? Date.parse(r.firstSeen) : NaN;
      const before = Date.parse(criteria.joined_before);
      if (Number.isFinite(first) && Number.isFinite(before) && first >= before) return false;
    }
    if (criteria.joined_after) {
      const first = r.firstSeen ? Date.parse(r.firstSeen) : NaN;
      const after = Date.parse(criteria.joined_after);
      if (Number.isFinite(first) && Number.isFinite(after) && first <= after) return false;
    }
    return true;
  }
  async function cmdTargeted(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.admin)) return;
    if (!args.trim()) {
      await say(env, chatId)([
        "📣 <b>الإعلانات المستهدفة</b>", HR,
        "الاستخدام:",
        "<code>/targeted [lang=ar|en|coptic] [activity=active|idle] [joined_before=YYYY-MM-DD] [joined_after=YYYY-MM-DD] [banned=yes|no] نص الإعلان</code>",
        "",
        "مثال:",
        "<code>/targeted lang=ar activity=active مرحبًا بك!</code>",
      ].join("\n"));
      return;
    }
    const { criteria, message } = parseTargetedArgs(args);
    if (!message) { await say(env, chatId)("❌ لم تُقدَّم نص الإعلان."); return; }
    const now = Date.now();
    const users = await allUsers(env);
    const banned = bannedSet ? await bannedSet(env).catch(() => new Set()) : new Set();
    const targets = [];
    for (const u of users) {
      const id = String(u.id);
      const isBanned = banned.has(id) || banned.has(Number(id));
      if (criteria.banned === "yes" && !isBanned) continue;
      if (criteria.banned !== "yes" && isBanned) continue;
      if (adminIds(env).map(String).includes(id)) continue;
      if (matchCriteria(u.record, criteria, now)) targets.push(id);
    }
    if (!targets.length) { await say(env, chatId)("⚠️ لا يوجد مستخدمون مطابقون للمعايير. عدّل المعايير وأعد المحاولة."); return; }
    const token = Math.random().toString(36).slice(2, 10);
    const state = { token, chatId, message, targets, sent: 0, failed: 0, blocked: 0, total: targets.length, status: "preview", createdAt: now };
    await sput(env, AP.campaignState, state);
    const critText = Object.entries(criteria).map(([k, v]) => `${esc(k)}=<code>${esc(v)}</code>`).join("، ") || "بدون معايير (الكل)";
    await say(env, chatId)([
      "📣 <b>معاينة الإعلان المستهدف</b>", HR,
      `المعايير: ${critText}`,
      `المستخدمون المستهدفون: <b>${fmt(targets.length)}</b>`,
      "",
      "<b>نص الإعلان:</b>",
      esc(message),
    ].join("\n"), {
      reply_markup: { inline_keyboard: [[
        { text: `✅ إرسال إلى ${fmt(targets.length)} مستخدم`, callback_data: `ap|camp|confirm|${token}` },
        { text: "❌ إلغاء", callback_data: `ap|camp|cancel|${token}` },
      ]] },
    });
  }
  async function campaignTick(env) {
    const state = await sget(env, AP.campaignState, null);
    if (!state || state.status !== "sending" || !Array.isArray(state.targets)) return;
    const batch = state.targets.splice(0, CAMPAIGN_BATCH);
    for (const id of batch) {
      try {
        const res = await telegram(env, "sendMessage", { chat_id: id, text: String(state.message).slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true });
        if (res?.ok) state.sent += 1;
        else { state.failed += 1; }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/blocked|deactivated|chat not found|403/i.test(msg)) state.blocked += 1; else state.failed += 1;
      }
    }
    if (!state.targets.length) {
      state.status = "done";
      state.finishedAt = Date.now();
      const camps = await sget(env, AP.campaigns, []);
      const list = Array.isArray(camps) ? camps : [];
      list.unshift({ sent: state.sent, failed: state.failed, blocked: state.blocked, total: state.total, createdAt: state.createdAt, finishedAt: state.finishedAt, preview: String(state.message).slice(0, 80) });
      await sput(env, AP.campaigns, list.slice(0, 50));
      await logSecurity(env, state.chatId || "system", "targeted_send", `sent=${state.sent} failed=${state.failed} blocked=${state.blocked} total=${state.total}`);
      await telegram(env, "sendMessage", { chat_id: state.chatId, text: `✅ اكتملت الحملة المستهدفة.\nتم الإرسال: <b>${fmt(state.sent)}</b>\nفشل: <b>${fmt(state.failed)}</b>\nمحظور/غير متاح: <b>${fmt(state.blocked)}</b>`, parse_mode: "HTML" }).catch(() => null);
      await sdel(env, AP.campaignState);
    } else {
      await sput(env, AP.campaignState, state);
    }
  }

  // ==========================================================================
  // تذاكر الدعم (/support, /tickets, /ticket, /ticketclose)
  // ==========================================================================
  // ----- أدوات حالة محادثة الدعم (supportFlow) -----
  async function getSupportFlow(env) {
    const v = await sget(env, AP.supportFlow, {});
    return (v && typeof v === "object") ? v : {};
  }
  async function setSupportFlow(env, userId, ticketId) {
    const flow = await getSupportFlow(env);
    flow[String(userId)] = { ticketId: String(ticketId), activeSince: Date.now() };
    await sput(env, AP.supportFlow, flow);
  }
  async function clearSupportFlow(env, userId) {
    const flow = await getSupportFlow(env);
    delete flow[String(userId)];
    await sput(env, AP.supportFlow, flow);
  }
  function findOpenTicket(tickets, userId) {
    const id = String(userId);
    return tickets.find((t) => String(t.userId) === id && t.status === "open") || null;
  }
  function lastThreadMessages(t, n) {
    const all = [{ by: "user", text: t.text, at: t.createdAt }, ...(Array.isArray(t.replies) ? t.replies : [])];
    return all.slice(-n);
  }
  async function appendUserMessage(env, chatId, userId, text, fromName) {
    const tickets = await getTickets(env);
    const existing = findOpenTicket(tickets, userId);
    if (existing) {
      existing.replies = existing.replies || [];
      existing.replies.push({ by: "user", text: String(text).slice(0, 2000), at: Date.now() });
      await sput(env, AP.tickets, tickets);
      await setSupportFlow(env, userId, existing.id);
      await say(env, chatId)(`✅ أُلحقت رسالتك بتذكرتك المفتوحة <b>${esc(existing.id)}</b>.`);
      await notifyAdmins(env, `💬 <b>رسالة جديدة في تذكرة</b> ${esc(existing.id)}\n${HR}\nالمستخدم: <code>${esc(userId)}</code> ${esc(fromName ? `(${fromName})` : "")}\nالنص: ${esc(String(text).slice(0, 300))}`);
      return existing.id;
    }
    const ticketId = await nextTicketId(env);
    tickets.push({ id: ticketId, userId: String(userId), name: String(fromName ?? "").slice(0, 60), chatId: String(chatId), text: String(text).slice(0, 2000), status: "open", createdAt: Date.now(), replies: [] });
    await sput(env, AP.tickets, tickets.slice(-200));
    await setSupportFlow(env, userId, ticketId);
    await say(env, chatId)(`✅ ${esc(DEFAULT_STRINGS.support_thanks)}\nرقم تذكرتك: <b>${esc(ticketId)}</b>\nيمكنك متابعة المحادثة بإرسال رسائل نصية مباشرة. لإنهاء وضع الدعم: /exitsupport`);
    await notifyAdmins(env, `🎫 <b>تذكرة دعم جديدة</b>\n${HR}\nالرقم: <b>${esc(ticketId)}</b>\nالمستخدم: <code>${esc(userId)}</code> ${esc(fromName ? `(${fromName})` : "")}\nالنص: ${esc(String(text).slice(0, 300))}`);
    return ticketId;
  }
  async function cmdSupport(env, chatId, userId, args, fromName) {
    if (!args.trim()) {
      const tickets = await getTickets(env);
      const existing = findOpenTicket(tickets, userId);
      if (existing) {
        await setSupportFlow(env, userId, existing.id);
        await say(env, chatId)(`ℹ️ لديك تذكرة مفتوحة بالفعل: <b>${esc(existing.id)}</b>. أرسل رسالتك النصية الآن وستُلحق بها. لإنهاء الدعم: /exitsupport`);
      } else {
        await say(env, chatId)("ℹ️ اكتب مشكلتك بعد الأمر: <code>/support نص المشكلة</code>");
      }
      return;
    }
    await appendUserMessage(env, chatId, userId, args, fromName);
  }
  async function cmdTickets(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.mod)) return;
    const tickets = await getTickets(env);
    const open = tickets.filter((t) => t.status === "open");
    if (!open.length) { await say(env, chatId)("📭 لا توجد تذاكر مفتوحة حاليًا."); return; }
    const lines = ["🎫 <b>قائمة التذاكر المفتوحة</b>", HR];
    for (const t of open.slice(-20)) {
      lines.push(`• <b>${esc(t.id)}</b> — <code>${esc(t.userId)}</code> ${esc(t.name ? `(${t.name})` : "")}`);
      const thread = lastThreadMessages(t, 3);
      thread.forEach((m) => {
        const who = m.by === "user" ? "👤" : "🛡️";
        lines.push(`  ${who} ${esc(String(m.text).slice(0, 100))}`);
      });
    }
    lines.push("", "للرد: <code>/ticket TKT-XXXX الرد</code>\nللإغلاق: <code>/ticketclose TKT-XXXX</code>");
    await say(env, chatId)(lines.join("\n"));
  }
  async function cmdTicketReply(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.mod)) return;
    const m = /^(TKT-\d+)\s+([\s\S]+)$/iu.exec(args.trim());
    if (!m) { await say(env, chatId)("ℹ️ الاستخدام: <code>/ticket TKT-XXXX نص الرد</code>"); return; }
    const tickets = await getTickets(env);
    const t = tickets.find((x) => x.id === m[1]);
    if (!t) { await say(env, chatId)(`❌ تذكرة ${esc(m[1])} غير موجودة.`); return; }
    t.replies = t.replies || [];
    t.replies.push({ by: String(userId), text: String(m[2]).slice(0, 2000), at: Date.now() });
    await sput(env, AP.tickets, tickets);
    // إعادة تفعيل وضع الدعم للمستخدم حتى يتمكن من المتابعة (لا يُغيَّر الحالة — تظل مفتوحة)
    await setSupportFlow(env, t.userId, t.id);
    await telegram(env, "sendMessage", { chat_id: t.chatId, text: `📩 <b>رد على تذكرتك ${esc(t.id)}</b>\n${HR}\n${esc(String(m[2]))}\n\nيمكنك الرد بإرسال رسالة نصية مباشرة. لإنهاء الدعم: /exitsupport`, parse_mode: "HTML", disable_web_page_preview: true }).catch(() => null);
    await logSecurity(env, userId, "ticket_reply", `ticket=${t.id}`);
    await say(env, chatId)(`✅ تم إرسال الرد على <b>${esc(t.id)}</b>، إشعار المستخدم، وإعادة تفعيل محادثة الدعم.`);
  }
  async function cmdTicketClose(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.mod)) return;
    const id = args.trim().split(/\s+/u)[0];
    if (!id) { await say(env, chatId)("ℹ️ الاستخدام: <code>/ticketclose TKT-XXXX</code>"); return; }
    const tickets = await getTickets(env);
    const t = tickets.find((x) => x.id === id);
    if (!t) { await say(env, chatId)(`❌ تذكرة ${esc(id)} غير موجودة.`); return; }
    t.status = "closed";
    t.closedAt = Date.now();
    t.closedBy = String(userId);
    await sput(env, AP.tickets, tickets);
    // إنهاء وضع الدعم للمستخدم المرتبط بالتذكرة
    await clearSupportFlow(env, t.userId);
    await telegram(env, "sendMessage", { chat_id: t.chatId, text: `✅ تم إغلاق تذكرتك <b>${esc(t.id)}</b>. يمكنك الآن متابعة استخدام البوت طبيعيًا. إذا كانت المشكلة مستمرة، افتح تذكرة جديدة عبر /support.`, parse_mode: "HTML" }).catch(() => null);
    await logSecurity(env, userId, "ticket_close", `ticket=${t.id}`);
    await say(env, chatId)(`✅ تم إغلاق التذكرة <b>${esc(t.id)}</b>، إنهاء وضع الدعم للمستخدم، وإشعاره.`);
  }
  async function cmdExitSupport(env, chatId, userId) {
    await clearSupportFlow(env, userId);
    await say(env, chatId)("✅ تم إنهاء وضع الدعم. يمكنك الآن متابعة استخدام البوت طبيعيًا (البحث في القاموس).");
  }
  async function cmdMyTickets(env, chatId, userId) {
    const tickets = await getTickets(env);
    const mine = tickets.filter((t) => String(t.userId) === String(userId));
    if (!mine.length) { await say(env, chatId)("📭 ليس لديك تذاكر دعم. افتح واحدة عبر /support."); return; }
    const lines = ["🎫 <b>تذاكر الدعم الخاصة بك</b>", HR];
    mine.slice(-10).reverse().forEach((t) => {
      const state = t.status === "open" ? "🟢 مفتوحة" : "⚪ مغلقة";
      const last = lastThreadMessages(t, 1)[0];
      lines.push(`• <b>${esc(t.id)}</b> — ${state}\n  آخر رسالة: ${esc(String(last?.text ?? t.text).slice(0, 100))}`);
    });
    lines.push("", "لإنهاء وضع الدعم الحالي: /exitsupport");
    await say(env, chatId)(lines.join("\n"));
  }

  // ==========================================================================
  // التنبيهات الذكية (/alerts) + tick
  // ==========================================================================
  async function getAlertState(env) {
    const v = await sget(env, AP.alerts, {});
    return (v && typeof v === "object") ? v : {};
  }
  async function sendAlert(env, type, text) {
    const state = await getAlertState(env);
    const last = Number(state[type] || 0);
    if (Date.now() - last < ALERT_COOLDOWN) return;
    state[type] = Date.now();
    await sput(env, AP.alerts, state);
    await notifyAdmins(env, `🚨 <b>تنبيه تلقائي</b>\n${HR}\n${text}`);
  }
  async function alertsTick(env) {
    // 1) ارتفاع الأخطاء
    if (readErrorLog) {
      try {
        const log = await readErrorLog(env, 50);
        const lines = Array.isArray(log) ? log : (typeof log === "string" ? log.split("\n") : []);
        const count = lines.length;
        const lastCount = Number(await sget(env, AP.alertErrCount, 0));
        await sput(env, AP.alertErrCount, count);
        if (lastCount > 0 && count - lastCount > 5) {
          await sendAlert(env, "errors", `ارتفاع في عدد الأخطاء: +${fmt(count - lastCount)} خطأ جديد منذ آخر فحص (إجمالي ${fmt(count)}). تحقق بـ /exporterrors.`);
        }
      } catch { /* ignore */ }
    }
    // 2) فشل المزامنة
    try {
      const syncState = await sget(env, "user-sync:state", null);
      if (syncState && syncState.lastError && Date.now() - Number(syncState.lastErrorAt || syncState.at || 0) < 3600000) {
        await sendAlert(env, "sync", `فشل في مزامنة المستخدمين: ${esc(String(syncState.lastError).slice(0, 150))}. تحقق بـ /syncwatch.`);
      }
    } catch { /* ignore */ }
  }
  async function cmdAlerts(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.viewer)) return;
    const state = await getAlertState(env);
    const errCount = await sget(env, AP.alertErrCount, 0);
    const lines = ["🚨 <b>حالة التنبيهات الذكية</b>", HR];
    const types = ["errors", "sync", "quota"];
    for (const t of types) {
      const last = Number(state[t] || 0);
      lines.push(`• ${esc(t)}: ${last ? `آخر تنبيه منذ ${fmt(Math.round((Date.now() - last) / 60000))} دقيقة` : "لم يُرسل بعد"}`);
    }
    lines.push("", `أخطاء مسجلة (آخر 50): <b>${fmt(errCount)}</b>`);
    lines.push(`فترة التبريد بين التنبيهات: 30 دقيقة لكل نوع.`);
    await say(env, chatId)(lines.join("\n"));
  }

  // ==========================================================================
  // الملخص الأسبوعي (/weekly) + tick
  // ==========================================================================
  async function buildWeeklyReport(env) {
    const users = await allUsers(env);
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    let dau = 0, mau = 0, newThisWeek = 0;
    const searches = {};
    for (const u of users) {
      const r = u.record || {};
      const last = r.lastSeen ? Date.parse(r.lastSeen) : 0;
      const first = r.firstSeen ? Date.parse(r.firstSeen) : 0;
      if (Number.isFinite(last) && now - last < dayMs) dau += 1;
      if (Number.isFinite(last) && now - last < 30 * dayMs) mau += 1;
      if (Number.isFinite(first) && now - first < 7 * dayMs) newThisWeek += 1;
    }
    const retention = mau ? Math.round((dau / mau) * 100) : 0;
    let topWords = [];
    if (readAnalyticsReport) {
      try {
        const rep = await readAnalyticsReport(env);
        if (rep && Array.isArray(rep.topWords)) topWords = rep.topWords.slice(0, 5);
        else if (rep && Array.isArray(rep.words)) topWords = rep.words.slice(0, 5);
      } catch { /* ignore */ }
    }
    if (!topWords.length && Array.isArray(recentSearches)) {
      const counts = {};
      for (const s of recentSearches) counts[s.query] = (counts[s.query] || 0) + 1;
      topWords = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([q, c]) => ({ word: q, count: c }));
    }
    const voiceTotal = Object.keys(records || {}).length;
    const lines = [
      "📅 <b>الملخص الأسبوعي للبوت</b>", HR,
      `المستخدمون النشطون يوميًا (DAU): <b>${fmt(dau)}</b>`,
      `المستخدمون النشطون شهريًا (MAU): <b>${fmt(mau)}</b>`,
      `معدل الاحتفاظ (DAU/MAU): <b>${retention}%</b>`,
      `مستخدمون جدد هذا الأسبوع: <b>+${fmt(newThisWeek)}</b>`,
      `إجمالي المستخدمين: <b>${fmt(users.length)}</b>`,
      `إجمالي كلمات القاموس: <b>${fmt(voiceTotal)}</b>`,
    ];
    if (topWords.length) {
      lines.push("", "<b>أكثر الكلمات بحثًا:</b>");
      for (const w of topWords) lines.push(`• ${esc(w.word ?? w.name ?? w)} (${fmt(w.count ?? w.c ?? 1)})`);
    }
    return lines.join("\n");
  }
  async function cmdWeekly(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.admin)) return;
    const report = await buildWeeklyReport(env);
    await say(env, chatId)(report);
    await sput(env, AP.weekly, Date.now());
  }
  async function weeklyTick(env) {
    const last = Number(await sget(env, AP.weekly, 0));
    if (Date.now() - last < WEEKLY_MS) return;
    await sput(env, AP.weekly, Date.now());
    const report = await buildWeeklyReport(env);
    await notifyAdmins(env, report);
  }

  // ==========================================================================
  // سجل الأمان (/securitylog, /exportsecurity)
  // ==========================================================================
  async function cmdSecurityLog(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.admin)) return;
    const log = await sget(env, AP.security, []);
    const list = Array.isArray(log) ? log : [];
    if (!list.length) { await say(env, chatId)("📭 سجل الأمان فارغ حاليًا."); return; }
    const lines = ["🔒 <b>سجل تدقيق الأمان (آخر 15)</b>", HR];
    for (const e of list.slice(0, 15)) {
      lines.push(`• [${new Date(Number(e.t)).toLocaleString("en-GB")}] <code>${esc(e.userId)}</code> <b>${esc(e.action)}</b>${e.detail ? ` — ${esc(e.detail)}` : ""}`);
    }
    lines.push("", `الإجمالي: ${fmt(list.length)} إجراء. للتصدير الكامل: /exportsecurity`);
    await say(env, chatId)(lines.join("\n"));
  }
  async function cmdExportSecurity(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.admin)) return;
    const log = await sget(env, AP.security, []);
    const list = Array.isArray(log) ? log : [];
    const rows = [["timestamp", "user_id", "action", "detail"]];
    for (const e of list) rows.push([new Date(Number(e.t)).toISOString(), e.userId, e.action, e.detail]);
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    if (sendTextFile) {
      await sendTextFile(env, chatId, "security-audit.csv", csv).catch(() => say(env, chatId)("❌ تعذّر إرسال الملف."));
    } else {
      await say(env, chatId)(`<pre>${esc(csv.slice(0, 3500))}</pre>`);
    }
    await logSecurity(env, userId, "export_security", "");
  }

  // ==========================================================================
  // محرر سلاسل الواجهة (/strings, /setstring, /resetstring)
  // ==========================================================================
  async function cmdStrings(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.viewer)) return;
    const strings = await getStrings(env);
    const lines = ["✏️ <b>سلاسل الواجهة القابلة للتعديل</b>", HR];
    for (const [k, v] of Object.entries(strings)) {
      lines.push(`• <code>${esc(k)}</code>:\n  ${esc(String(v).slice(0, 120))}`);
    }
    lines.push("", "لتعديل: <code>/setstring &lt;key&gt; &lt;نص&gt;</code>\nلإعادة الضبط: <code>/resetstring &lt;key&gt;</code>");
    await say(env, chatId)(lines.join("\n"));
  }
  async function cmdSetString(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.admin)) return;
    const m = /^([a-z_][a-z0-9_]*)\s+([\s\S]+)$/iu.exec(args.trim());
    if (!m) { await say(env, chatId)("ℹ️ الاستخدام: <code>/setstring &lt;key&gt; &lt;نص&gt;</code>"); return; }
    if (!DEFAULT_STRINGS[m[1]]) { await say(env, chatId)(`❌ مفتاح غير معروف. المفاتيح المتاحة: ${Object.keys(DEFAULT_STRINGS).map((k) => `<code>${esc(k)}</code>`).join("، ")}`); return; }
    const stored = await sget(env, AP.uistrings, {});
    const map = (stored && typeof stored === "object") ? stored : {};
    map[m[1]] = m[2];
    await sput(env, AP.uistrings, map);
    await logSecurity(env, userId, "setstring", `key=${m[1]}`);
    await say(env, chatId)(`✅ تم تحديث <code>${esc(m[1])}</code>.`);
  }
  async function cmdResetString(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.admin)) return;
    const key = args.trim().split(/\s+/u)[0];
    if (!DEFAULT_STRINGS[key]) { await say(env, chatId)(`❌ مفتاح غير معروف.`); return; }
    const stored = await sget(env, AP.uistrings, {});
    const map = (stored && typeof stored === "object") ? stored : {};
    delete map[key];
    await sput(env, AP.uistrings, map);
    await logSecurity(env, userId, "resetstring", `key=${key}`);
    await say(env, chatId)(`✅ تمت إعادة <code>${esc(key)}</code> للقيمة الافتراضية.`);
  }

  // ==========================================================================
  // /proadmin + /prohelp
  // ==========================================================================
  async function cmdProAdmin(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.viewer)) return;
    await say(env, chatId)("🎛️ <b>لوحة التحكم الاحترافية</b>\nاختر قسمًا:", { reply_markup: mainMenuKeyboard() });
  }
  async function cmdProHelp(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.viewer)) return;
    const lines = [
      "📖 <b>أوامر الحزمة الاحترافية</b>", HR,
      "<b>اللوحة والمساعدة:</b>",
      "• /proadmin — لوحة تحكم تفاعلية",
      "• /prohelp — هذه القائمة",
      "",
      "<b>الصلاحيات:</b>",
      "• /setrole &lt;id&gt; &lt;owner|admin|mod|viewer&gt;",
      "• /roles — عرض كل الصلاحيات",
      "• /myrole — صلاحيتي الحالية",
      "",
      "<b>الإعلانات المستهدفة:</b>",
      "• /targeted [معايير] نص الإعلان",
      "",
      "<b>تذاكر الدعم:</b>",
      "• /support &lt;نص&gt; — فتح تذكرة (للجميع)",
      "• /tickets — التذاكر المفتوحة",
      "• /ticket &lt;رقم&gt; &lt;رد&gt;",
      "• /ticketclose &lt;رقم&gt;",
      "",
      "<b>المراقبة والتقارير:</b>",
      "• /alerts — حالة التنبيهات الذكية",
      "• /weekly — ملخص أسبوعي فوري",
      "",
      "<b>الأمان والواجهة:</b>",
      "• /securitylog — سجل تدقيق الأمان",
      "• /exportsecurity — تصدير السجل",
      "• /strings — سلاسل الواجهة",
      "• /setstring &lt;key&gt; &lt;نص&gt;",
      "• /resetstring &lt;key&gt;",
    ];
    await say(env, chatId)(lines.join("\n"));
  }

  // ==========================================================================
  // 9) نظام النقاط والمكافآت (Gamification)
  // ==========================================================================
  const LEVELS = [
    { min: 0, name: "مبتدئ" },
    { min: 50, name: "متعلم" },
    { min: 200, name: "متقدم" },
    { min: 500, name: "خبير" },
    { min: 1000, name: "أسطورة" },
  ];
  function levelForScore(score) {
    let lvl = LEVELS[0];
    for (const l of LEVELS) if (score >= l.min) lvl = l;
    return lvl.name;
  }
  async function getScores(env) {
    const v = await sget(env, AP.gamify, {});
    return (v && typeof v === "object") ? v : {};
  }
  async function addPoints(env, userId, amount, reason) {
    if (!env.USERS) return null;
    const scores = await getScores(env);
    const id = String(userId);
    const cur = scores[id] || { score: 0, level: LEVELS[0].name, badges: [] };
    cur.score = Number(cur.score || 0) + Number(amount || 0);
    cur.level = levelForScore(cur.score);
    const newBadges = [];
    if (cur.score >= 50 && !cur.badges.includes("first50")) { cur.badges.push("first50"); newBadges.push("أول 50 نقطة"); }
    if (cur.score >= 200 && !cur.badges.includes("adv200")) { cur.badges.push("adv200"); newBadges.push("متقدم (200)"); }
    if (cur.score >= 1000 && !cur.badges.includes("legend")) { cur.badges.push("legend"); newBadges.push("أسطورة"); }
    scores[id] = cur;
    await sput(env, AP.gamify, scores);
    return { score: cur.score, level: cur.level, newBadges };
  }
  async function cmdAddPoints(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.mod)) return;
    const parts = args.split(/\s+/u).filter(Boolean);
    if (parts.length < 2) { await say(env, chatId)("ℹ️ الاستخدام: <code>/addpoints &lt;id&gt; &lt;نقاط&gt;</code>"); return; }
    const targetId = String(parts[0]).replace(/[^0-9-]/gu, "");
    const amount = Number(parts[1]);
    if (!targetId || !Number.isFinite(amount)) { await say(env, chatId)("❌ معرف أو عدد نقاط غير صالح."); return; }
    const res = await addPoints(env, targetId, amount, `admin:${userId}`);
    await logSecurity(env, userId, "addpoints", `user=${targetId} amount=${amount}`);
    await say(env, chatId)(`✅ أُضيفت <b>${fmt(amount)}</b> نقطة للمستخدم <code>${esc(targetId)}</code>.\nالرصيد الآن: <b>${fmt(res?.score ?? 0)}</b> (${esc(res?.level ?? "")})`);
  }
  async function cmdSetPoints(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.admin)) return;
    const parts = args.split(/\s+/u).filter(Boolean);
    if (parts.length < 2) { await say(env, chatId)("ℹ️ الاستخدام: <code>/setpoints &lt;id&gt; &lt;نقاط&gt;</code>"); return; }
    const targetId = String(parts[0]).replace(/[^0-9-]/gu, "");
    const amount = Number(parts[1]);
    if (!targetId || !Number.isFinite(amount) || amount < 0) { await say(env, chatId)("❌ قيمة غير صالحة."); return; }
    const scores = await getScores(env);
    scores[targetId] = { score: amount, level: levelForScore(amount), badges: (scores[targetId]?.badges) || [] };
    await sput(env, AP.gamify, scores);
    await logSecurity(env, userId, "setpoints", `user=${targetId} amount=${amount}`);
    await say(env, chatId)(`✅ ضبط رصيد <code>${esc(targetId)}</code> على <b>${fmt(amount)}</b> نقطة (${esc(levelForScore(amount))}).`);
  }
  async function cmdLeaderboard(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.viewer)) return;
    const scores = await getScores(env);
    const entries = Object.entries(scores).map(([id, v]) => ({ id, score: Number(v?.score || 0), level: v?.level || "" })).sort((a, b) => b.score - a.score).slice(0, 10);
    if (!entries.length) { await say(env, chatId)("📭 لا توجد نقاط مسجلة بعد."); return; }
    const lines = ["🏆 <b>لوحة المتصدرين (أعلى 10)</b>", HR];
    entries.forEach((e, i) => lines.push(`${i + 1}. <code>${esc(e.id)}</code> — <b>${fmt(e.score)}</b> نقطة (${esc(e.level)})`));
    await say(env, chatId)(lines.join("\n"));
  }
  async function cmdBadges(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.viewer)) return;
    const targetId = String(args.trim().split(/\s+/u)[0] || userId).replace(/[^0-9-]/gu, "");
    const scores = await getScores(env);
    const cur = scores[targetId];
    if (!cur) { await say(env, chatId)(`📭 المستخدم <code>${esc(targetId)}</code> ليس لديه نقاط بعد.`); return; }
    const badgeNames = { first50: "أول 50 نقطة", adv200: "متقدم (200)", legend: "أسطورة" };
    const lines = [`🎖️ <b>شارات المستخدم</b> <code>${esc(targetId)}</code>`, HR, `النقاط: <b>${fmt(cur.score)}</b> — المستوى: <b>${esc(cur.level)}</b>`, ""];
    if (!cur.badges?.length) lines.push("لا توجد شارات بعد.");
    else cur.badges.forEach((b) => lines.push(`• ${esc(badgeNames[b] || b)}`));
    await say(env, chatId)(lines.join("\n"));
  }

  // ==========================================================================
  // 10) كشف السبام والحماية التلقائية (Anti-Spam)
  // ==========================================================================
  function bumpSpamCounter(env, userId) {
    const id = String(userId);
    const now = Date.now();
    const rec = spamCounters.get(id) || { count: 0, windowStart: now };
    if (now - rec.windowStart > 60000) { rec.count = 0; rec.windowStart = now; }
    rec.count += 1;
    spamCounters.set(id, rec);
    return rec.count;
  }
  async function getSpamFlags(env) {
    const v = await sget(env, AP.antispamFlags, {});
    return (v && typeof v === "object") ? v : {};
  }
  async function antispamTick(env) {
    const now = Date.now();
    const flags = await getSpamFlags(env);
    let changed = false;
    for (const [id, rec] of spamCounters.entries()) {
      if (now - rec.windowStart > 60000) { spamCounters.delete(id); continue; }
      if (rec.count > SPAM_THRESHOLD && !flags[id]) {
        flags[id] = { flaggedAt: now, peak: rec.count, status: "warned" };
        changed = true;
        const autoban = Boolean(await sget(env, AP.antispamAutoban, false));
        if (autoban && bannedSet) {
          try { await bannedSet(env).add?.(id); } catch { /* ignore */ }
          flags[id].status = "banned";
          await logSecurity(env, "system", "antispam_autoban", `user=${id} peak=${rec.count}`);
        }
        await sendAlert(env, "spam", `مستخدم <code>${esc(id)}</code> تجاوز عتبة السبام (${fmt(rec.count)} طلب/دقيقة).${autoban ? " تم حظره تلقائيًا." : ""}`);
      }
    }
    if (changed) await sput(env, AP.antispamFlags, flags);
  }
  async function cmdAntispam(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.admin)) return;
    const arg = args.trim().toLowerCase();
    if (arg === "on") { await sput(env, AP.antispamAutoban, true); await logSecurity(env, userId, "antispam_on", ""); await say(env, chatId)("✅ تم تفعيل الحظر التلقائي للسبام."); return; }
    if (arg === "off") { await sput(env, AP.antispamAutoban, false); await logSecurity(env, userId, "antispam_off", ""); await say(env, chatId)("✅ تم إيقاف الحظر التلقائي (سيبقى التحذير فقط)."); return; }
    const autoban = Boolean(await sget(env, AP.antispamAutoban, false));
    const flags = await getSpamFlags(env);
    const active = Object.keys(flags).length;
    const liveCount = spamCounters.size;
    await say(env, chatId)([
      "🛡️ <b>حالة الحماية من السبام</b>", HR,
      `الحظر التلقائي: <b>${autoban ? "مفعّل ⚠️" : "معطّل"}</b> (غيّره: /antispam on|off)`,
      `العتبة: <b>${SPAM_THRESHOLD}</b> طلب/دقيقة`,
      `مستخدمون مُعلمون: <b>${fmt(active)}</b>`,
      `جلسات نشطة بالذاكرة: <b>${fmt(liveCount)}</b>`,
      "",
      "المُعلمون: /spamlist — مسح: /spamclear &lt;id&gt;",
    ].join("\n"));
  }
  async function cmdSpamList(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.mod)) return;
    const flags = await getSpamFlags(env);
    const entries = Object.entries(flags);
    if (!entries.length) { await say(env, chatId)("📭 لا يوجد مستخدمون مُعلمون بالسبام."); return; }
    const lines = ["🚫 <b>المستخدمون المُعلمون بالسبام</b>", HR];
    entries.slice(0, 20).forEach(([id, f]) => lines.push(`• <code>${esc(id)}</code> — ذروة <b>${fmt(f.peak)}</b> — ${esc(f.status || "warned")} — ${new Date(Number(f.flaggedAt)).toLocaleString("en-GB")}`));
    await say(env, chatId)(lines.join("\n"));
  }
  async function cmdSpamClear(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.mod)) return;
    const targetId = String(args.trim().split(/\s+/u)[0]).replace(/[^0-9-]/gu, "");
    if (!targetId) { await say(env, chatId)("ℹ️ الاستخدام: <code>/spamclear &lt;id&gt;</code>"); return; }
    const flags = await getSpamFlags(env);
    delete flags[targetId];
    spamCounters.delete(targetId);
    await sput(env, AP.antispamFlags, flags);
    await logSecurity(env, userId, "spamclear", `user=${targetId}`);
    await say(env, chatId)(`✅ تم مسح علامة السبام للمستخدم <code>${esc(targetId)}</code>.`);
  }

  // ==========================================================================
  // 11) سجل بحث مستخدم محدد
  // ==========================================================================
  async function cmdSearchHistory(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.mod)) return;
    const targetId = String(args.trim().split(/\s+/u)[0]).replace(/[^0-9-]/gu, "");
    if (!targetId) { await say(env, chatId)("ℹ️ الاستخدام: <code>/searchhistory &lt;id&gt;</code>"); return; }
    let history = [];
    if (getUserHistory) {
      try {
        const h = await getUserHistory(env, targetId);
        if (Array.isArray(h)) history = h;
        else if (h && Array.isArray(h.history)) history = h.history;
      } catch { /* ignore */ }
    }
    if (!history.length) {
      const raw = await sget(env, `history:${targetId}`, null);
      if (Array.isArray(raw)) history = raw;
    }
    if (!history.length) { await say(env, chatId)(`📭 لا يوجد سجل بحث للمستخدم <code>${esc(targetId)}</code>.`); return; }
    const lines = [`🔍 <b>آخر 20 عملية بحث — </b><code>${esc(targetId)}</code>`, HR, "<code>الوقت            الكلمة</code>"];
    history.slice(-20).reverse().forEach((h) => {
      const t = h.at || h.time || h.timestamp || "";
      const q = h.query || h.word || h.name || JSON.stringify(h).slice(0, 60);
      lines.push(`<code>${esc(String(t).slice(0, 19).padEnd(19, " "))}</code> ${esc(String(q).slice(0, 40))}`);
    });
    await say(env, chatId)(lines.join("\n"));
  }

  // ==========================================================================
  // 12) إدارة الأحداث/المناسبات المجدولة
  // ==========================================================================
  async function getEvents(env) {
    const v = await sget(env, AP.events, []);
    return Array.isArray(v) ? v : [];
  }
  async function cmdAddEvent(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.admin)) return;
    const m = /^(\d{4}-\d{2}-\d{2})\s+([^|]+?)\s*\|\s*([\s\S]+)$/u.exec(args.trim());
    if (!m) { await say(env, chatId)("ℹ️ الاستخدام: <code>/addevent YYYY-MM-DD العنوان | الرسالة</code>"); return; }
    const seq = Number(await sget(env, AP.eventSeq, 0)) + 1;
    await sput(env, AP.eventSeq, seq);
    const events = await getEvents(env);
    events.push({ id: `EVT-${seq}`, title: m[2].trim(), date_iso: m[1], message: m[3].trim(), sent: false, createdAt: Date.now() });
    await sput(env, AP.events, events.slice(-100));
    await logSecurity(env, userId, "addevent", `id=EVT-${seq} date=${m[1]}`);
    await say(env, chatId)(`✅ تمت إضافة الحدث <b>EVT-${seq}</b> (${esc(m[1])}): ${esc(m[2].trim())}`);
  }
  async function cmdEvents(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.viewer)) return;
    const events = await getEvents(env);
    if (!events.length) { await say(env, chatId)("📭 لا توجد أحداث مجدولة."); return; }
    const lines = ["📅 <b>الأحداث المجدولة</b>", HR];
    events.slice(-20).forEach((e) => lines.push(`• <b>${esc(e.id)}</b> [${esc(e.date_iso)}] ${e.sent ? "✅ أُرسل" : "⏳ بانتظار"} — ${esc(e.title)}`));
    lines.push("", "لحذف: <code>/delevent EVT-X</code>");
    await say(env, chatId)(lines.join("\n"));
  }
  async function cmdDelEvent(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.admin)) return;
    const id = args.trim().split(/\s+/u)[0];
    if (!id) { await say(env, chatId)("ℹ️ الاستخدام: <code>/delevent EVT-X</code>"); return; }
    const events = await getEvents(env);
    const filtered = events.filter((e) => e.id !== id);
    if (filtered.length === events.length) { await say(env, chatId)(`❌ حدث ${esc(id)} غير موجود.`); return; }
    await sput(env, AP.events, filtered);
    await logSecurity(env, userId, "delevent", `id=${id}`);
    await say(env, chatId)(`✅ تم حذف الحدث <b>${esc(id)}</b>.`);
  }
  async function eventsTick(env) {
    const events = await getEvents(env);
    const today = day();
    let changed = false;
    for (const e of events) {
      if (e.sent || e.sending) continue;
      if (e.date_iso > today) continue;
      e.sending = true;
      e.targets = e.targets || null;
      if (!e.targets) {
        const users = await allUsers(env);
        e.targets = users.map((u) => String(u.id)).filter((id) => !adminIds(env).map(String).includes(id));
        e.total = e.targets.length;
        e.sentCount = 0;
      }
      const batch = e.targets.splice(0, CAMPAIGN_BATCH);
      for (const id of batch) {
        await telegram(env, "sendMessage", { chat_id: id, text: `📅 <b>${esc(e.title)}</b>\n${HR}\n${esc(e.message)}`, parse_mode: "HTML", disable_web_page_preview: true }).catch(() => null);
        e.sentCount += 1;
      }
      if (!e.targets.length) { e.sent = true; e.sending = false; e.sentAt = Date.now(); delete e.targets; }
      changed = true;
    }
    if (changed) await sput(env, AP.events, events);
  }

  // ==========================================================================
  // 13) إدارة دفعية للأصوات
  // ==========================================================================
  async function cmdVoiceGaps(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.admin)) return;
    const ids = Object.keys(records || {});
    let missing = 0;
    const samples = [];
    for (const id of ids.slice(0, 3000)) {
      const rec = records[id];
      const hasVoice = rec && (rec.voiceKey || rec.neuralKey || rec.humanKey || rec.voice || rec.audio);
      if (!hasVoice) {
        missing += 1;
        if (samples.length < 10) samples.push(rec?.coptic || rec?.word || id);
      }
    }
    const coverage = ids.length ? Math.round(((ids.length - missing) / ids.length) * 100) : 0;
    const lines = [
      "🎙️ <b>الكلمات بلا تسجيل صوتي</b>", HR,
      `إجمالي الكلمات: <b>${fmt(ids.length)}</b>`,
      `بدون صوت (عينة فحص): <b>${fmt(missing)}</b>`,
      `نسبة التغطية التقديرية: <b>${coverage}%</b>`,
    ];
    if (samples.length) lines.push("", "عينات: " + samples.map((s) => `<code>${esc(String(s).slice(0, 20))}</code>`).join("، "));
    lines.push("", "لإعادة بناء صوت: /rebuildvoice &lt;wordId|all&gt;");
    await say(env, chatId)(lines.join("\n"));
  }
  async function cmdRebuildVoice(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.admin)) return;
    const target = args.trim();
    if (!target) { await say(env, chatId)("ℹ️ الاستخدام: <code>/rebuildvoice &lt;wordId|all&gt;</code>"); return; }
    const queue = await sget(env, AP.voiceRebuild, []);
    const list = Array.isArray(queue) ? queue : [];
    list.push({ target, requestedBy: String(userId), at: Date.now(), status: "pending" });
    await sput(env, AP.voiceRebuild, list.slice(-200));
    await logSecurity(env, userId, "rebuildvoice", `target=${target}`);
    await say(env, chatId)(`✅ سُجّل طلب إعادة بناء الصوت لـ <code>${esc(target)}</code> في قائمة المعالجة (${fmt(list.length)} طلب).`);
  }

  // ==========================================================================
  // 14) نظام الدعوات/الإحالات (Referral)
  // ==========================================================================
  async function getReferrals(env) {
    const v = await sget(env, AP.referrals, {});
    return (v && typeof v === "object") ? v : {};
  }
  async function registerReferral(env, referrerId, inviteeId) {
    if (!env.USERS) return false;
    const refs = await getReferrals(env);
    const r = String(referrerId);
    const list = refs[r] || [];
    if (list.includes(String(inviteeId))) return false;
    list.push(String(inviteeId));
    refs[r] = list;
    await sput(env, AP.referrals, refs);
    await addPoints(env, referrerId, 10, "referral");
    return true;
  }
  async function botUsername(env) {
    const me = await telegram(env, "getMe", {}).catch(() => null);
    return me?.result?.username || "";
  }
  async function cmdMyRef(env, chatId, userId) {
    const username = await botUsername(env);
    const link = username ? `https://t.me/${username}?start=ref_${userId}` : `https://t.me/<bot>?start=ref_${userId}`;
    const refs = await getReferrals(env);
    const count = (refs[String(userId)] || []).length;
    await say(env, chatId)([
      "🔗 <b>رابط الدعوة الخاص بك</b>", HR,
      `<code>${esc(link)}</code>`,
      "",
      `الأصدقاء المدعوون: <b>${fmt(count)}</b>`,
      "كل دعوة ناجحة تكسبك 10 نقاط!",
    ].join("\n"));
  }
  async function cmdTopRef(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.viewer)) return;
    const refs = await getReferrals(env);
    const entries = Object.entries(refs).map(([id, list]) => ({ id, count: Array.isArray(list) ? list.length : 0 })).sort((a, b) => b.count - a.count).slice(0, 10);
    if (!entries.length) { await say(env, chatId)("📭 لا توجد إحالات مسجلة بعد."); return; }
    const lines = ["🏆 <b>أفضل الدعاة (أعلى 10)</b>", HR];
    entries.forEach((e, i) => lines.push(`${i + 1}. <code>${esc(e.id)}</code> — <b>${fmt(e.count)}</b> دعوة`));
    await say(env, chatId)(lines.join("\n"));
  }
  async function cmdRefInfo(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.mod)) return;
    const targetId = String(args.trim().split(/\s+/u)[0] || userId).replace(/[^0-9-]/gu, "");
    const refs = await getReferrals(env);
    const list = refs[targetId] || [];
    const lines = [`🔗 <b>إحالات المستخدم</b> <code>${esc(targetId)}</code>`, HR, `العدد: <b>${fmt(list.length)}</b>`];
    if (list.length) { lines.push(""); list.slice(0, 20).forEach((id) => lines.push(`• <code>${esc(id)}</code>`)); }
    await say(env, chatId)(lines.join("\n"));
  }

  // ==========================================================================
  // 15) نظام إبلاغ المستخدمين (User Reporting)
  // ==========================================================================
  async function getReports(env) {
    const v = await sget(env, AP.reports, []);
    return Array.isArray(v) ? v : [];
  }
  async function cmdReport(env, chatId, userId, args) {
    const parts = args.trim().split(/\s+/u);
    if (parts.length < 2) { await say(env, chatId)("ℹ️ الاستخدام: <code>/report &lt;id أو @username&gt; السبب</code>"); return; }
    const target = parts[0].replace(/^@/u, "");
    const reason = parts.slice(1).join(" ").slice(0, 500);
    const seq = Number(await sget(env, AP.reportSeq, 0)) + 1;
    await sput(env, AP.reportSeq, seq);
    const reports = await getReports(env);
    reports.push({ id: `RPT-${seq}`, reporter: String(userId), target, reason, at: Date.now(), status: "open" });
    await sput(env, AP.reports, reports.slice(-200));
    await say(env, chatId)(`✅ تم استلام بلاغك <b>RPT-${seq}</b>، سيراجعه فريق الإدارة.`);
    await notifyAdmins(env, `🚨 <b>بلاغ مستخدم جديد</b>\n${HR}\nالرقم: <b>RPT-${seq}</b>\nالمُبلغ: <code>${esc(userId)}</code>\nالمُبلغ عنه: <code>${esc(target)}</code>\nالسبب: ${esc(reason)}`);
  }
  async function cmdReports(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.mod)) return;
    const reports = await getReports(env);
    const open = reports.filter((r) => r.status === "open");
    if (!open.length) { await say(env, chatId)("📭 لا توجد بلاغات مفتوحة."); return; }
    const lines = ["🚨 <b>البلاغات المفتوحة</b>", HR];
    open.slice(-20).forEach((r) => lines.push(`• <b>${esc(r.id)}</b> — المُبلغ <code>${esc(r.reporter)}</code> عن <code>${esc(r.target)}</code>\n  ${esc(r.reason)}`));
    lines.push("", "للإغلاق: <code>/reportclose RPT-X الإجراء المتخذ</code>");
    await say(env, chatId)(lines.join("\n"));
  }
  async function cmdReportClose(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.mod)) return;
    const m = /^(RPT-\d+)\s*([\s\S]*)$/u.exec(args.trim());
    if (!m) { await say(env, chatId)("ℹ️ الاستخدام: <code>/reportclose RPT-X الإجراء المتخذ</code>"); return; }
    const reports = await getReports(env);
    const r = reports.find((x) => x.id === m[1]);
    if (!r) { await say(env, chatId)(`❌ بلاغ ${esc(m[1])} غير موجود.`); return; }
    r.status = "closed";
    r.action = String(m[2] || "").slice(0, 200);
    r.closedBy = String(userId);
    r.closedAt = Date.now();
    await sput(env, AP.reports, reports);
    await logSecurity(env, userId, "reportclose", `id=${r.id} action=${r.action}`);
    await say(env, chatId)(`✅ تم إغلاق البلاغ <b>${esc(r.id)}</b>.`);
  }

  // ==========================================================================
  // 16) اختبار A/B وتدريج الميزات (Feature Rollout)
  // ==========================================================================
  async function getRollout(env) {
    const v = await sget(env, AP.rollout, {});
    return (v && typeof v === "object") ? v : {};
  }
  async function isFeatureEnabled(env, featureName, userId) {
    const rollout = await getRollout(env);
    const cfg = rollout[String(featureName)];
    if (!cfg) return false;
    const id = String(userId);
    if (Array.isArray(cfg.denyUsers) && cfg.denyUsers.includes(id)) return false;
    if (Array.isArray(cfg.allowUsers) && cfg.allowUsers.includes(id)) return true;
    const percent = Number(cfg.percent || 0);
    if (percent >= 100) return true;
    if (percent <= 0) return false;
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
    return (Math.abs(hash) % 100) < percent;
  }
  async function cmdRollout(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.owner)) return;
    const m = /^([a-z_][a-z0-9_]*)\s+(\d{1,3})%?$/iu.exec(args.trim());
    if (!m) { await say(env, chatId)("ℹ️ الاستخدام: <code>/rollout &lt;feature&gt; &lt;0-100&gt;%</code>"); return; }
    const percent = Math.max(0, Math.min(100, Number(m[2])));
    const rollout = await getRollout(env);
    const cur = rollout[m[1]] || { percent: 0, allowUsers: [], denyUsers: [] };
    cur.percent = percent;
    rollout[m[1]] = cur;
    await sput(env, AP.rollout, rollout);
    await logSecurity(env, userId, "rollout", `feature=${m[1]} percent=${percent}`);
    await say(env, chatId)(`✅ ميزة <code>${esc(m[1])}</code> مفعّلة لـ <b>${percent}%</b> من المستخدمين.`);
  }
  async function cmdRolloutAllow(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.owner)) return;
    const parts = args.trim().split(/\s+/u);
    if (parts.length < 2) { await say(env, chatId)("ℹ️ الاستخدام: <code>/rolloutallow &lt;feature&gt; &lt;id&gt;</code>"); return; }
    const rollout = await getRollout(env);
    const cur = rollout[parts[0]] || { percent: 0, allowUsers: [], denyUsers: [] };
    cur.allowUsers = cur.allowUsers || [];
    if (!cur.allowUsers.includes(parts[1])) cur.allowUsers.push(parts[1]);
    cur.denyUsers = (cur.denyUsers || []).filter((x) => x !== parts[1]);
    rollout[parts[0]] = cur;
    await sput(env, AP.rollout, rollout);
    await logSecurity(env, userId, "rolloutallow", `feature=${parts[0]} user=${parts[1]}`);
    await say(env, chatId)(`✅ سماح للمستخدم <code>${esc(parts[1])}</code> بميزة <code>${esc(parts[0])}</code>.`);
  }
  async function cmdRolloutDeny(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.owner)) return;
    const parts = args.trim().split(/\s+/u);
    if (parts.length < 2) { await say(env, chatId)("ℹ️ الاستخدام: <code>/rolloutdeny &lt;feature&gt; &lt;id&gt;</code>"); return; }
    const rollout = await getRollout(env);
    const cur = rollout[parts[0]] || { percent: 0, allowUsers: [], denyUsers: [] };
    cur.denyUsers = cur.denyUsers || [];
    if (!cur.denyUsers.includes(parts[1])) cur.denyUsers.push(parts[1]);
    cur.allowUsers = (cur.allowUsers || []).filter((x) => x !== parts[1]);
    rollout[parts[0]] = cur;
    await sput(env, AP.rollout, rollout);
    await logSecurity(env, userId, "rolloutdeny", `feature=${parts[0]} user=${parts[1]}`);
    await say(env, chatId)(`✅ منع المستخدم <code>${esc(parts[1])}</code> من ميزة <code>${esc(parts[0])}</code>.`);
  }
  async function cmdRollouts(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.admin)) return;
    const rollout = await getRollout(env);
    const entries = Object.entries(rollout);
    if (!entries.length) { await say(env, chatId)("📭 لا توجد ميزات مدروجة حاليًا."); return; }
    const lines = ["🧪 <b>تدريج الميزات (A/B)</b>", HR];
    entries.forEach(([name, cfg]) => lines.push(`• <code>${esc(name)}</code>: <b>${fmt(cfg.percent)}%</b> — سماح: ${fmt((cfg.allowUsers || []).length)}، منع: ${fmt((cfg.denyUsers || []).length)}`));
    await say(env, chatId)(lines.join("\n"));
  }

  // ==========================================================================
  // 17) ملاحظات تعاون فريق الأدمن (Team Notes)
  // ==========================================================================
  async function getTeamNotes(env) {
    const v = await sget(env, AP.teamnotes, []);
    return Array.isArray(v) ? v : [];
  }
  async function cmdTeamNote(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.mod)) return;
    if (!args.trim()) { await say(env, chatId)("ℹ️ اكتب نص الملاحظة: <code>/teamnote النص</code>"); return; }
    const seq = Number(await sget(env, AP.teamnoteSeq, 0)) + 1;
    await sput(env, AP.teamnoteSeq, seq);
    const notes = await getTeamNotes(env);
    notes.push({ id: `NOTE-${seq}`, text: String(args).slice(0, 500), assignee: "", status: "open", by: String(userId), at: Date.now() });
    await sput(env, AP.teamnotes, notes.slice(-200));
    await say(env, chatId)(`✅ أُضيفت الملاحظة <b>NOTE-${seq}</b>.`);
  }
  async function cmdTeamNotes(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.mod)) return;
    const filter = args.trim().toLowerCase();
    const notes = await getTeamNotes(env);
    let list = notes.slice(-30);
    if (filter === "open" || filter === "doing" || filter === "done") list = list.filter((n) => n.status === filter);
    if (!list.length) { await say(env, chatId)("📭 لا توجد ملاحظات."); return; }
    const statusName = { open: "مفتوحة", doing: "قيد التنفيذ", done: "مكتملة" };
    const lines = ["📝 <b>ملاحظات الفريق</b>", HR];
    list.forEach((n) => lines.push(`• <b>${esc(n.id)}</b> [${esc(statusName[n.status] || n.status)}] ${n.assignee ? `→ <code>${esc(n.assignee)}</code>` : ""}\n  ${esc(n.text)}`));
    lines.push("", "تعيين: /teamassign NOTE-X &lt;id&gt; — إنجاز: /teamdone NOTE-X");
    await say(env, chatId)(lines.join("\n"));
  }
  async function cmdTeamAssign(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.mod)) return;
    const parts = args.trim().split(/\s+/u);
    if (parts.length < 2) { await say(env, chatId)("ℹ️ الاستخدام: <code>/teamassign NOTE-X &lt;userId&gt;</code>"); return; }
    const notes = await getTeamNotes(env);
    const n = notes.find((x) => x.id === parts[0]);
    if (!n) { await say(env, chatId)(`❌ ملاحظة ${esc(parts[0])} غير موجودة.`); return; }
    n.assignee = parts[1];
    n.status = "doing";
    await sput(env, AP.teamnotes, notes);
    await say(env, chatId)(`✅ عُيّنت <b>${esc(n.id)}</b> إلى <code>${esc(parts[1])}</code> (قيد التنفيذ).`);
  }
  async function cmdTeamDone(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.mod)) return;
    const id = args.trim().split(/\s+/u)[0];
    const notes = await getTeamNotes(env);
    const n = notes.find((x) => x.id === id);
    if (!n) { await say(env, chatId)(`❌ ملاحظة ${esc(id)} غير موجودة.`); return; }
    n.status = "done";
    n.doneBy = String(userId);
    n.doneAt = Date.now();
    await sput(env, AP.teamnotes, notes);
    await say(env, chatId)(`✅ أُكملت الملاحظة <b>${esc(id)}</b>.`);
  }

  // ==========================================================================
  // 18) وضع الصيانة المتقدم (Advanced Maintenance)
  // ==========================================================================
  async function getMaintAdv(env) {
    const v = await sget(env, AP.maintAdv, null);
    return (v && typeof v === "object") ? v : null;
  }
  async function cmdMaintAdv(env, chatId, userId, args) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.owner)) return;
    const m = /^(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?)\s+(\d+)\s+([\s\S]+)$/u.exec(args.trim());
    if (!m) { await say(env, chatId)("ℹ️ الاستخدام: <code>/maintadv YYYY-MM-DD[THH:MM] المدة_بالدقائق الرسالة</code>"); return; }
    const startAt = Date.parse(m[1].replace(" ", "T"));
    const durationMin = Number(m[2]);
    if (!Number.isFinite(startAt) || !Number.isFinite(durationMin) || durationMin <= 0) { await say(env, chatId)("❌ تاريخ أو مدة غير صالحة."); return; }
    const cfg = { scheduledAt: startAt, autoResumeAt: startAt + durationMin * 60000, message: String(m[3]).slice(0, 500), durationMin, active: false, createdBy: String(userId) };
    await sput(env, AP.maintAdv, cfg);
    await logSecurity(env, userId, "maintadv_schedule", `start=${new Date(startAt).toISOString()} duration=${durationMin}min`);
    await say(env, chatId)(`✅ تمت جدولة الصيانة المتقدمة.\nالبداية: <b>${new Date(startAt).toLocaleString("en-GB")}</b>\nالمدة: <b>${fmt(durationMin)}</b> دقيقة\nالرسالة: ${esc(cfg.message)}`);
  }
  async function cmdMaintAdvStatus(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.admin)) return;
    const cfg = await getMaintAdv(env);
    if (!cfg) { await say(env, chatId)("📭 لا توجد صيانة مجدولة. جدولها بـ /maintadv."); return; }
    const now = Date.now();
    const lines = ["🌙 <b>حالة الصيانة المتقدمة</b>", HR];
    if (cfg.active) {
      const remain = Math.max(0, Math.round((cfg.autoResumeAt - now) / 60000));
      lines.push(`الحالة: <b>مفعّلة الآن ⚠️</b> — متبقٍ <b>${fmt(remain)}</b> دقيقة`);
    } else if (cfg.scheduledAt > now) {
      const until = Math.round((cfg.scheduledAt - now) / 60000);
      lines.push(`الحالة: <b>مجدولة</b> — تبدأ خلال <b>${fmt(until)}</b> دقيقة`);
    } else {
      lines.push("الحالة: <b>منتهية</b>");
    }
    lines.push(`البداية: ${new Date(Number(cfg.scheduledAt)).toLocaleString("en-GB")}`, `المدة: ${fmt(cfg.durationMin)} دقيقة`, `الرسالة: ${esc(cfg.message)}`, "", "للإلغاء: /maintadvcancel");
    await say(env, chatId)(lines.join("\n"));
  }
  async function cmdMaintAdvCancel(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.owner)) return;
    const cfg = await getMaintAdv(env);
    if (!cfg) { await say(env, chatId)("📭 لا توجد صيانة مجدولة للإلغاء."); return; }
    if (cfg.active && setMaintenance) { try { await setMaintenance(env, false); } catch { /* ignore */ } }
    await sdel(env, AP.maintAdv);
    await logSecurity(env, userId, "maintadv_cancel", "");
    await say(env, chatId)("✅ تم إلغاء الصيانة المتقدمة.");
  }
  async function maintAdvTick(env) {
    const cfg = await getMaintAdv(env);
    if (!cfg) return;
    const now = Date.now();
    if (!cfg.active && now >= cfg.scheduledAt) {
      cfg.active = true;
      cfg.activatedAt = now;
      if (setMaintenance) { try { await setMaintenance(env, true); } catch { /* ignore */ } }
      await sput(env, AP.maintAdv, cfg);
      await notifyAdmins(env, `🌙 بدأت الصيانة المجدولة الآن. المدة: ${fmt(cfg.durationMin)} دقيقة. الرسالة: ${esc(cfg.message)}`);
      return;
    }
    if (cfg.active && now >= cfg.autoResumeAt) {
      if (setMaintenance) { try { await setMaintenance(env, false); } catch { /* ignore */ } }
      await sdel(env, AP.maintAdv);
      await notifyAdmins(env, "✅ انتهت الصيانة المجدولة وتمت استعادة البوت بالكامل.");
    }
  }

  // ==========================================================================
  // COMMANDS
  // ==========================================================================
  const COMMANDS = {
    proadmin: { desc: "لوحة تحكم احترافية تفاعلية", run: (c) => cmdProAdmin(c.env, c.chatId, c.userId) },
    prohelp: { desc: "أوامر الحزمة الاحترافية", run: (c) => cmdProHelp(c.env, c.chatId, c.userId) },
    setrole: { desc: "تعيين صلاحية مستخدم", run: (c) => cmdSetRole(c.env, c.chatId, c.userId, c.args) },
    roles: { desc: "عرض كل الصلاحيات", run: (c) => cmdRoles(c.env, c.chatId, c.userId) },
    myrole: { desc: "صلاحيتي الحالية", run: (c) => cmdMyRole(c.env, c.chatId, c.userId) },
    targeted: { desc: "إعلان مستهدف بشرائح", run: (c) => cmdTargeted(c.env, c.chatId, c.userId, c.args) },
    support: { desc: "فتح تذكرة دعم", run: (c) => cmdSupport(c.env, c.chatId, c.userId, c.args, c.rawName) },
    tickets: { desc: "قائمة تذاكر الدعم", run: (c) => cmdTickets(c.env, c.chatId, c.userId) },
    ticket: { desc: "الرد على تذكرة", run: (c) => cmdTicketReply(c.env, c.chatId, c.userId, c.args) },
    ticketclose: { desc: "إغلاق تذكرة", run: (c) => cmdTicketClose(c.env, c.chatId, c.userId, c.args) },
    alerts: { desc: "حالة التنبيهات الذكية", run: (c) => cmdAlerts(c.env, c.chatId, c.userId) },
    weekly: { desc: "ملخص أسبوعي فوري", run: (c) => cmdWeekly(c.env, c.chatId, c.userId) },
    securitylog: { desc: "سجل تدقيق الأمان", run: (c) => cmdSecurityLog(c.env, c.chatId, c.userId) },
    exportsecurity: { desc: "تصدير سجل الأمان", run: (c) => cmdExportSecurity(c.env, c.chatId, c.userId) },
    strings: { desc: "سلاسل الواجهة القابلة للتعديل", run: (c) => cmdStrings(c.env, c.chatId, c.userId) },
    setstring: { desc: "تعديل سلسلة واجهة", run: (c) => cmdSetString(c.env, c.chatId, c.userId, c.args) },
    resetstring: { desc: "إعادة سلسلة للافتراضي", run: (c) => cmdResetString(c.env, c.chatId, c.userId, c.args) },
    addpoints: { desc: "إضافة نقاط لمستخدم", run: (c) => cmdAddPoints(c.env, c.chatId, c.userId, c.args) },
    setpoints: { desc: "ضبط نقاط مستخدم", run: (c) => cmdSetPoints(c.env, c.chatId, c.userId, c.args) },
    leaderboard: { desc: "لوحة متصدرين النقاط", run: (c) => cmdLeaderboard(c.env, c.chatId, c.userId) },
    badges: { desc: "شارات مستخدم", run: (c) => cmdBadges(c.env, c.chatId, c.userId, c.args) },
    antispam: { desc: "حالة وإعدادات مضاد السبام", run: (c) => cmdAntispam(c.env, c.chatId, c.userId, c.args) },
    spamlist: { desc: "المستخدمون المُعلمون بالسبام", run: (c) => cmdSpamList(c.env, c.chatId, c.userId) },
    spamclear: { desc: "مسح علامة سبام لمستخدم", run: (c) => cmdSpamClear(c.env, c.chatId, c.userId, c.args) },
    searchhistory: { desc: "سجل بحث مستخدم", run: (c) => cmdSearchHistory(c.env, c.chatId, c.userId, c.args) },
    addevent: { desc: "إضافة حدث/مناسبة مجدولة", run: (c) => cmdAddEvent(c.env, c.chatId, c.userId, c.args) },
    events: { desc: "قائمة الأحداث المجدولة", run: (c) => cmdEvents(c.env, c.chatId, c.userId) },
    delevent: { desc: "حذف حدث مجدول", run: (c) => cmdDelEvent(c.env, c.chatId, c.userId, c.args) },
    voicegaps: { desc: "كلمات بلا تسجيل صوتي", run: (c) => cmdVoiceGaps(c.env, c.chatId, c.userId) },
    rebuildvoice: { desc: "إعادة بناء صوت كلمة", run: (c) => cmdRebuildVoice(c.env, c.chatId, c.userId, c.args) },
    myref: { desc: "رابط الدعوة الخاص بي", run: (c) => cmdMyRef(c.env, c.chatId, c.userId) },
    toptop: { desc: "أفضل الدعاة بالإحالات", run: (c) => cmdTopRef(c.env, c.chatId, c.userId) },
    refinfo: { desc: "تفاصيل إحالات مستخدم", run: (c) => cmdRefInfo(c.env, c.chatId, c.userId, c.args) },
    report: { desc: "الإبلاغ عن مستخدم", run: (c) => cmdReport(c.env, c.chatId, c.userId, c.args) },
    reports: { desc: "قائمة البلاغات المفتوحة", run: (c) => cmdReports(c.env, c.chatId, c.userId) },
    reportclose: { desc: "إغلاق بلاغ", run: (c) => cmdReportClose(c.env, c.chatId, c.userId, c.args) },
    rollout: { desc: "تدريج ميزة بنسبة مئوية", run: (c) => cmdRollout(c.env, c.chatId, c.userId, c.args) },
    rolloutallow: { desc: "سماح مستخدم بميزة", run: (c) => cmdRolloutAllow(c.env, c.chatId, c.userId, c.args) },
    rolloutdeny: { desc: "منع مستخدم من ميزة", run: (c) => cmdRolloutDeny(c.env, c.chatId, c.userId, c.args) },
    rollouts: { desc: "عرض تدريج الميزات", run: (c) => cmdRollouts(c.env, c.chatId, c.userId) },
    teamnote: { desc: "إضافة ملاحظة للفريق", run: (c) => cmdTeamNote(c.env, c.chatId, c.userId, c.args) },
    teamnotes: { desc: "قائمة ملاحظات الفريق", run: (c) => cmdTeamNotes(c.env, c.chatId, c.userId, c.args) },
    teamassign: { desc: "تعيين ملاحظة لمستخدم", run: (c) => cmdTeamAssign(c.env, c.chatId, c.userId, c.args) },
    teamdone: { desc: "إكمال ملاحظة فريق", run: (c) => cmdTeamDone(c.env, c.chatId, c.userId, c.args) },
    maintadv: { desc: "جدولة صيانة متقدمة", run: (c) => cmdMaintAdv(c.env, c.chatId, c.userId, c.args) },
    maintadvstatus: { desc: "حالة الصيانة المتقدمة", run: (c) => cmdMaintAdvStatus(c.env, c.chatId, c.userId) },
    maintadvcancel: { desc: "إلغاء الصيانة المتقدمة", run: (c) => cmdMaintAdvCancel(c.env, c.chatId, c.userId) },
    exitsupport: { desc: "إنهاء وضع محادثة الدعم", run: (c) => cmdExitSupport(c.env, c.chatId, c.userId) },
    done: { desc: "إنهاء وضع محادثة الدعم", run: (c) => cmdExitSupport(c.env, c.chatId, c.userId) },
    mytickets: { desc: "تذاكر الدعم الخاصة بي", run: (c) => cmdMyTickets(c.env, c.chatId, c.userId) },
  };

  // ==========================================================================
  // handle
  // ==========================================================================
  async function handle({ env, chatId, userId, text, raw }) {
    const source = String(raw ?? text ?? "").trim();
    // محادثة الدعم المتصلة: رسالة نصية عادية من مستخدم لديه وضع دعم نشط
    if (!source.startsWith("/")) {
      const flow = await getSupportFlow(env);
      if (flow[String(userId)]) {
        try {
          const fromName = raw?.from?.first_name || raw?.from?.username || "";
          await appendUserMessage(env, chatId, userId, source, fromName);
        } catch (error) {
          await say(env, chatId)(`❌ تعذّر إلحاق رسالة الدعم: ${esc(error instanceof Error ? error.message : "خطأ")}`);
        }
        return true;
      }
      return false;
    }
    const match = /^\/([a-zA-Z_0-9]+)(?:@[^\s]+)?(?:\s+([\s\S]*))?$/u.exec(source);
    if (!match) return false;
    const name = match[1].toLowerCase();
    const entry = COMMANDS[name];
    if (!entry) return false;
    // هذه الأوامر متاحة للجميع؛ بقية الأوامر تتطلب أدمن على الأقل
    const PUBLIC_COMMANDS = ["support", "report", "myref", "myrole", "exitsupport", "done", "mytickets"];
    if (!PUBLIC_COMMANDS.includes(name) && !isAdminUser(env, userId) && !(await hasRole(env, userId, ROLE_LEVELS.viewer))) {
      await say(env, chatId)("⛔ هذا الأمر مخصص لفريق الإدارة فقط.");
      return true;
    }
    try {
      const fromName = raw?.from?.first_name || raw?.from?.username || "";
      await entry.run({ env, chatId, userId, args: (match[2] ?? "").trim(), rawName: fromName });
    } catch (error) {
      await say(env, chatId)(`❌ تعذّر تنفيذ /${esc(name)}: ${esc(error instanceof Error ? error.message : "خطأ")}`);
    }
    return true;
  }

  // ==========================================================================
  // handleCallback (بادئة ap|)
  // ==========================================================================
  async function handleCallback({ env, callback }) {
    const userId = callback.from?.id;
    const chatId = callback.message?.chat?.id;
    const messageId = callback.message?.message_id;
    const data = String(callback.data ?? "");
    const parts = data.split("|");
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id }).catch(() => null);
    if (!chatId || !messageId) return true;
    // قائمة التحكم
    if (parts[1] === "menu") {
      if (!isAdminUser(env, userId) && !(await hasRole(env, userId, ROLE_LEVELS.viewer))) {
        await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "غير مصرح" }).catch(() => null);
        return true;
      }
      const section = parts[2] || "main";
      if (section === "close") {
        await telegram(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: "تم إغلاق لوحة التحكم. افتحها مجددًا بـ /proadmin." }).catch(() => null);
        return true;
      }
      await renderMenu(env, chatId, messageId, section);
      return true;
    }
    // حملة إعلانية مستهدفة
    if (parts[1] === "camp") {
      if (!isAdminUser(env, userId) && !(await hasRole(env, userId, ROLE_LEVELS.admin))) {
        await telegram(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: "⛔ غير مصرح بتأكيد الإرسال." }).catch(() => null);
        return true;
      }
      const state = await sget(env, AP.campaignState, null);
      const token = parts[3];
      if (!state || state.token !== token) {
        await telegram(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: "⌛️ انتهت صلاحية هذه المعاينة. أعد /targeted." }).catch(() => null);
        return true;
      }
      if (parts[2] === "cancel") {
        await sdel(env, AP.campaignState);
        await telegram(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: "❌ أُلغي الإعلان المستهدف ولم يُرسل لأحد." }).catch(() => null);
        return true;
      }
      if (parts[2] === "confirm") {
        state.status = "sending";
        state.startedAt = Date.now();
        await sput(env, AP.campaignState, state);
        await logSecurity(env, userId, "targeted_confirm", `total=${state.total}`);
        await telegram(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: `🚀 بدأ الإرسال التدريجي إلى <b>${fmt(state.total)}</b> مستخدم (${CAMPAIGN_BATCH} كل دقيقة). سأُخبرك عند الاكتمال.`, parse_mode: "HTML" }).catch(() => null);
        return true;
      }
    }
    return true;
  }

  // ==========================================================================
  // tick (مُخنق 60 ثانية)
  // ==========================================================================
  async function tick(env) {
    const now = Date.now();
    if (now - lastTickAt < 60000) return;
    lastTickAt = now;
    try { await campaignTick(env); } catch { /* ignore */ }
    try { await alertsTick(env); } catch { /* ignore */ }
    try { await weeklyTick(env); } catch { /* ignore */ }
    try { await antispamTick(env); } catch { /* ignore */ }
    try { await eventsTick(env); } catch { /* ignore */ }
    try { await maintAdvTick(env); } catch { /* ignore */ }
  }

  return { handle, handleCallback, tick, commands: COMMANDS, addPoints, registerReferral, isFeatureEnabled, bumpSpamCounter };
}
