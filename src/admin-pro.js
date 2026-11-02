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
  async function cmdSupport(env, chatId, userId, args, fromName) {
    if (!args.trim()) {
      await say(env, chatId)("ℹ️ اكتب مشكلتك بعد الأمر: <code>/support نص المشكلة</code>");
      return;
    }
    const ticketId = await nextTicketId(env);
    const tickets = await getTickets(env);
    tickets.push({ id: ticketId, userId: String(userId), name: String(fromName ?? "").slice(0, 60), chatId: String(chatId), text: String(args).slice(0, 2000), status: "open", createdAt: Date.now(), replies: [] });
    await sput(env, AP.tickets, tickets.slice(-200));
    await say(env, chatId)(`✅ ${esc(DEFAULT_STRINGS.support_thanks)}\nرقم تذكرتك: <b>${esc(ticketId)}</b>`);
    await notifyAdmins(env, `🎫 <b>تذكرة دعم جديدة</b>\n${HR}\nالرقم: <b>${esc(ticketId)}</b>\nالمستخدم: <code>${esc(userId)}</code> ${esc(fromName ? `(${fromName})` : "")}\nالنص: ${esc(String(args).slice(0, 300))}`);
  }
  async function cmdTickets(env, chatId, userId) {
    if (!await requireRole(env, userId, chatId, ROLE_LEVELS.mod)) return;
    const tickets = await getTickets(env);
    const open = tickets.filter((t) => t.status === "open");
    if (!open.length) { await say(env, chatId)("📭 لا توجد تذاكر مفتوحة حاليًا."); return; }
    const lines = ["🎫 <b>قائمة التذاكر المفتوحة</b>", HR];
    for (const t of open.slice(-20)) {
      lines.push(`• <b>${esc(t.id)}</b> — <code>${esc(t.userId)}</code> ${esc(t.name ? `(${t.name})` : "")}\n  ${esc(String(t.text).slice(0, 120))}`);
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
    t.replies.push({ by: String(userId), text: String(m[2]).slice(0, 2000), at: Date.now() });
    await sput(env, AP.tickets, tickets);
    await telegram(env, "sendMessage", { chat_id: t.chatId, text: `📩 <b>رد على تذكرتك ${esc(t.id)}</b>\n${HR}\n${esc(String(m[2]))}`, parse_mode: "HTML", disable_web_page_preview: true }).catch(() => null);
    await logSecurity(env, userId, "ticket_reply", `ticket=${t.id}`);
    await say(env, chatId)(`✅ تم إرسال الرد على <b>${esc(t.id)}</b> وإشعار المستخدم.`);
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
    await telegram(env, "sendMessage", { chat_id: t.chatId, text: `✅ تم إغلاق تذكرتك <b>${esc(t.id)}</b>. إذا كانت المشكلة مستمرة، افتح تذكرة جديدة عبر /support.`, parse_mode: "HTML" }).catch(() => null);
    await logSecurity(env, userId, "ticket_close", `ticket=${t.id}`);
    await say(env, chatId)(`✅ تم إغلاق التذكرة <b>${esc(t.id)}</b> وإشعار المستخدم.`);
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
  };

  // ==========================================================================
  // handle
  // ==========================================================================
  async function handle({ env, chatId, userId, text, raw }) {
    const source = String(raw ?? text ?? "").trim();
    if (!source.startsWith("/")) return false;
    const match = /^\/([a-zA-Z_0-9]+)(?:@[^\s]+)?(?:\s+([\s\S]*))?$/u.exec(source);
    if (!match) return false;
    const name = match[1].toLowerCase();
    const entry = COMMANDS[name];
    if (!entry) return false;
    // /support متاح للجميع؛ بقية الأوامر تتطلب أدمن على الأقل
    if (name !== "support" && !isAdminUser(env, userId) && !(await hasRole(env, userId, ROLE_LEVELS.viewer))) {
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
  }

  return { handle, handleCallback, tick, commands: COMMANDS };
}
