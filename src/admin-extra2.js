// ============================================================================
// admin-extra2.js — الحزمة الثانية من أدوات الأدمن (v1.2.0)
//
// 22 أمرًا جديدًا: فحص ذاتي، مراقبة المزامنة، ملخص يومي، بث بمعاينة، نسخ احتياطي
// تلقائي، صيانة مجدولة، تصدير السجلات، تدقيق الكلمات، وأدوات تشغيلية أخرى.
// ============================================================================

const A2 = {
  digest: "a2:digest",
  backup: "a2:backupauto",
  maint: "a2:maintplan",
  watch: "a2:syncwatch",
  announce: "a2:announce",
};
const HR = "━━━━━━━━━━━━";
const GAP_FIELDS = ["coptic", "greek", "pronunciation", "english", "meaning", "kind", "origin", "translation_fr", "translation_de"];

export function createAdminExtras2(api) {
  const {
    telegram, escapeHtml, storeCall, getUser, bannedSet, readAnalyticsReport, readErrorLog,
    readMisses, flushMisses, sendTextFile, logAdminAction, adminIds, driveConfig, callAppsScript,
    records, formatUptime, getUserHistory, maintenanceOn, setMaintenance, customMaintenanceMessage,
    recentSearches, botVersion,
  } = api;

  const esc = (value) => escapeHtml(String(value ?? ""));
  const fmt = (value) => Number(value ?? 0).toLocaleString("en-US");
  const iso = () => new Date().toISOString();
  const day = () => iso().slice(0, 10);
  const norm = (value) => String(value ?? "").toLowerCase().replace(/\s+/gu, " ").trim();

  const say = (env, chatId) => (text, extra = {}) => telegram(env, "sendMessage", {
    chat_id: chatId, text: String(text).slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, ...extra,
  });
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
  const csv = (rows) => rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");

  async function allUsers(env, max = 6000) {
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

  const sheetRows = async (env) => {
    const config = await driveConfig(env).catch(() => null);
    if (!config) return { ok: false, error: "لا يوجد رابط Apps Script" };
    try {
      const result = await callAppsScript(config, { action: "users_count" });
      return { ok: true, rows: Number(result.rows ?? 0) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "خطأ" };
    }
  };

  // ------------------------------------------------------------------ /selfcheck
  async function selfCheck(env, chatId) {
    const reply = say(env, chatId);
    const lines = ["🩺 <b>الفحص الذاتي الشامل</b>", HR];
    let pass = 0, fail = 0;
    const mark = (ok) => { if (ok) pass += 1; else fail += 1; return ok ? "✅" : "❌"; };

    lines.push(`${mark(Boolean(env.USERS))} تخزين المستخدمين (Durable Object)`);
    lines.push(`${mark(Boolean(env.TELEGRAM_BOT_TOKEN))} توكن البوت`);

    const me = await telegram(env, "getMe", {}).catch(() => null);
    lines.push(`${mark(me?.ok === true)} الاتصال بـ Telegram API${me?.result?.username ? ` (@${esc(me.result.username)})` : ""}`);

    const hook = await telegram(env, "getWebhookInfo", {}).catch(() => null);
    const pending = hook?.result?.pending_update_count ?? 0;
    lines.push(`${mark(hook?.ok === true && pending < 50)} الـwebhook${hook?.ok ? ` — معلّق: ${fmt(pending)}` : ""}`);

    let kvOk = false;
    if (env.USERS) {
      try {
        await storeCall(env, { op: "put", key: "a2:selfcheck", value: iso() });
        const back = (await storeCall(env, { op: "get", key: "a2:selfcheck" })).value;
        await storeCall(env, { op: "delete", key: "a2:selfcheck" });
        kvOk = Boolean(back);
      } catch { kvOk = false; }
    }
    lines.push(`${mark(kvOk)} قراءة/كتابة التخزين`);

    const config = await driveConfig(env).catch(() => null);
    lines.push(`${mark(Boolean(config))} ربط Google Apps Script`);
    if (config) {
      const ping = await callAppsScript(config, { action: "ping" }).then(() => true).catch(() => false);
      lines.push(`${mark(ping)} استجابة السكربت (ping)`);
      const sheet = await sheetRows(env);
      lines.push(`${mark(sheet.ok)} عدّ صفوف ورقة users${sheet.ok ? ` (${fmt(sheet.rows)})` : " — أعد نشر Code.gs"}`);
    }

    lines.push(`${mark(records.length > 1000)} القاموس في الذاكرة: ${fmt(records.length)} سجل`);
    const errors = await readErrorLog(env).catch(() => []);
    lines.push(`${mark(errors.length === 0)} سجل الأخطاء: ${fmt(errors.length)}`);
    const maint = await maintenanceOn(env);
    lines.push(`ℹ️ وضع الصيانة: ${maint ? "🔧 مفعّل" : "✅ متوقف"}`);
    lines.push(HR, fail === 0 ? `✅ كل الفحوصات ناجحة (${pass}).` : `⚠️ نجح ${pass} وفشل ${fail} — راجع السطور المعلّمة بـ❌.`);
    await reply(lines.join("\n"));
    return true;
  }

  // --------------------------------------------------------------- /statuspage
  async function statusPage(env, chatId) {
    const reply = say(env, chatId);
    const stats = await storeCall(env, { op: "adminStats" }).catch(() => ({}));
    const maint = await maintenanceOn(env);
    const text = [
      "📖 <b>بوت القاموس القبطي الناطق</b>",
      HR,
      `الحالة: ${maint ? "🔧 تحت الصيانة" : "✅ يعمل بكامل طاقته"}`,
      `📚 الكلمات: ${fmt(records.length)}`,
      `👥 المستخدمون: ${fmt(stats.users)}`,
      `🎙 التسجيلات الصوتية: ${fmt(stats.voices)}`,
      `🕒 آخر تحديث: ${esc(iso().slice(0, 16).replace("T", " "))} UTC`,
      HR,
      "اكتب أي كلمة قبطية أو عربية للبحث فورًا.",
    ].join("\n");
    await reply(`${text}\n\n<i>— يمكنك نسخ النص أعلاه ونشره في قناتك كما هو.</i>`);
    return true;
  }

  // ---------------------------------------------------------------- /sheetdiff
  async function sheetDiff(env, chatId) {
    const reply = say(env, chatId);
    const [stats, sheet, state] = await Promise.all([
      storeCall(env, { op: "adminStats" }).catch(() => ({})),
      sheetRows(env),
      sget(env, "user-sync:state", {}),
    ]);
    const stored = Number(stats.users ?? 0);
    if (!sheet.ok) {
      await reply(`❌ تعذّر قراءة الشيت: ${esc(sheet.error)}\nإن كان السكربت قديمًا فأعد نشر <code>apps-script/Code.gs</code> ثم أعد المحاولة.`);
      return true;
    }
    const diff = stored - sheet.rows;
    const status = diff === 0 ? "✅ متطابقان" : diff > 0 ? `⚠️ ناقص في الشيت: ${fmt(diff)}` : `⚠️ زائد في الشيت: ${fmt(-diff)}`;
    await reply([
      "📊 <b>مقارنة التخزين بورقة users</b>", HR,
      `• في التخزين: <b>${fmt(stored)}</b>`,
      `• في الشيت: <b>${fmt(sheet.rows)}</b>`,
      `• الفرق: ${status}`,
      HR,
      `آخر مزامنة: ${esc(state.lastRunAt ?? "لم تُسجّل")} (${fmt(state.lastRunTotal ?? 0)} مستخدم)`,
      `آخر خطأ: ${esc(state.lastError || "لا يوجد")}`,
      "",
      diff > 0 ? "▶️ لمزامنة الباقي: /syncusers" : "لا حاجة لإجراء.",
    ].join("\n"));
    return true;
  }

  // --------------------------------------------------------------- /syncwatch
  async function syncWatch(env, chatId, args) {
    const reply = say(env, chatId);
    const parts = String(args ?? "").trim().split(/\s+/u);
    const sub = (parts[0] ?? "").toLowerCase();
    const cfg = (await sget(env, A2.watch, { on: false, threshold: 25, lastAt: null })) ?? { on: false, threshold: 25 };
    if (sub === "on") {
      const threshold = Math.max(1, Number(parts[1]) || cfg.threshold || 25);
      await sput(env, A2.watch, { on: true, threshold, chatId: String(chatId), lastAt: null });
      await reply(`👁 شُغّلت مراقبة المزامنة: إذا زاد الفرق عن <b>${fmt(threshold)}</b> مستخدم تبدأ المزامنة تلقائيًا (فحص كل ٢٠ دقيقة).\nللإيقاف: /syncwatch off`);
      return true;
    }
    if (sub === "off") {
      await sput(env, A2.watch, { ...cfg, on: false });
      await reply("🛑 أُوقفت مراقبة المزامنة.");
      return true;
    }
    if (sub === "now") {
      const [stats, sheet] = await Promise.all([storeCall(env, { op: "adminStats" }).catch(() => ({})), sheetRows(env)]);
      if (!sheet.ok) { await reply(`❌ ${esc(sheet.error)}`); return true; }
      const diff = Number(stats.users ?? 0) - sheet.rows;
      await reply(`🔍 الفرق الحالي: <b>${fmt(diff)}</b> مستخدم (الحد المضبوط: ${fmt(cfg.threshold)}).\n${diff > cfg.threshold ? "▶️ يمكن البدء الآن بـ /syncusers" : "لا حاجة الآن."}`);
      return true;
    }
    await reply([
      "👁 <b>مراقبة المزامنة التلقائية</b>", HR,
      `• الحالة: <b>${cfg.on ? "مفعّلة ▶️" : "متوقفة ⏸"}</b>`,
      `• الحد: <b>${fmt(cfg.threshold)}</b> مستخدم`,
      `• آخر فحص: ${esc(cfg.lastAt ?? "لم يحدث")}`,
      HR,
      "الاستخدام: /syncwatch on 25 • /syncwatch off • /syncwatch now",
    ].join("\n"));
    return true;
  }

  // ------------------------------------------------------------------- /digest
  async function digestCmd(env, chatId, args) {
    const reply = say(env, chatId);
    const parts = String(args ?? "").trim().split(/\s+/u);
    const sub = (parts[0] ?? "").toLowerCase();
    const cfg = (await sget(env, A2.digest, { on: false, hour: 8 })) ?? { on: false, hour: 8 };
    if (sub === "on") {
      const hour = Math.min(23, Math.max(0, Number(parts[1]) ?? 8));
      await sput(env, A2.digest, { on: true, hour, chatId: String(chatId), lastSent: cfg.lastSent ?? "" });
      await reply(`📬 فُعّل الملخص اليومي الساعة <b>${String(hour).padStart(2, "0")}:00 UTC</b> في هذه المحادثة.\nيُرسل عند أول نشاط للبوت بعد الموعد.`);
      return true;
    }
    if (sub === "off") { await sput(env, A2.digest, { ...cfg, on: false }); await reply("🛑 أُوقف الملخص اليومي."); return true; }
    await reply(await buildDigest(env));
    return true;
  }

  async function buildDigest(env) {
    const [stats, analytics, errors, state, maint, misses] = await Promise.all([
      storeCall(env, { op: "adminStats" }).catch(() => ({})),
      readAnalyticsReport(env).catch(() => ({ searches: 0, commands: 0, inline: 0, topWords: [] })),
      readErrorLog(env).catch(() => []),
      sget(env, "user-sync:state", {}),
      maintenanceOn(env),
      readMisses(env).catch(() => []),
    ]);
    const top = analytics.topWords?.[0];
    const topMiss = misses?.[0];
    return [
      `🗞 <b>الملخص اليومي — ${esc(day())}</b>`, HR,
      `📚 كلمات: <b>${fmt(records.length)}</b> | 🎙 تسجيلات: <b>${fmt(stats.voices)}</b>`,
      `👥 مستخدمون: <b>${fmt(stats.users)}</b> | 🚫 محظورون: <b>${fmt(stats.blocked)}</b> | ⏳ ينتظر الرفع: <b>${fmt(stats.pendingUploads)}</b>`,
      `🔎 بحث: <b>${fmt(analytics.searches)}</b> | أوامر: <b>${fmt(analytics.commands)}</b> | Inline: <b>${fmt(analytics.inline)}</b>`,
      top ? `🔝 أكثر كلمة: <b>${esc(top[0])}</b> (${fmt(top[1])})` : "🔝 لا بحث مسجل بعد",
      topMiss ? `🕳 أكثر كلمة مفقودة: <b>${esc(topMiss[0])}</b> (${fmt(topMiss[1])})` : "🕳 لا كلمات مفقودة",
      `⚠️ أخطاء مسجلة: <b>${fmt(errors.length)}</b>`,
      `🔄 المزامنة: ${esc(state.lastRunAt ?? "لم تعمل")} — ${fmt(state.lastRunTotal ?? 0)} مستخدم`,
      `🔧 الصيانة: ${maint ? "مفعّلة" : "متوقفة"} | ⏱ التشغيل: ${formatUptime(Date.now() - START)}`,
    ].join("\n");
  }

  // --------------------------------------------------------------- /backupauto
  async function backupCmd(env, chatId, args) {
    const reply = say(env, chatId);
    const parts = String(args ?? "").trim().split(/\s+/u);
    const sub = (parts[0] ?? "").toLowerCase();
    const cfg = (await sget(env, A2.backup, { on: false, hour: 3 })) ?? { on: false, hour: 3 };
    if (sub === "on") {
      const hour = Math.min(23, Math.max(0, Number(parts[1]) ?? 3));
      await sput(env, A2.backup, { on: true, hour, chatId: String(chatId), lastSent: cfg.lastSent ?? "" });
      await reply(`💾 فُعّل النسخ الاحتياطي اليومي الساعة <b>${String(hour).padStart(2, "0")}:00 UTC</b>.`);
      return true;
    }
    if (sub === "off") { await sput(env, A2.backup, { ...cfg, on: false }); await reply("🛑 أُوقف النسخ التلقائي."); return true; }
    const outcome = await sendAutoBackup(env, chatId);
    await reply(outcome ? "💾 أرسلت النسخة الاحتياطية." : "❌ تعذّر إرسال النسخة.");
    return true;
  }

  async function sendAutoBackup(env, chatId) {
    const [users, notes, bans, flags, audit, state] = await Promise.all([
      allUsers(env, 3000),
      sget(env, "admin:usernotes", {}),
      bannedSet(env),
      sget(env, "admin:features", {}),
      sget(env, "admin:audit:actions", []),
      sget(env, "user-sync:state", {}),
    ]);
    const payload = {
      at: iso(), botVersion, counts: { records: records.length, users: users.length },
      users: users.map(({ id, record }) => ({ id, ...record })),
      notes, bans, featureFlags: flags, syncState: state, adminAudit: audit,
    };
    const stamp = iso().slice(0, 19).replaceAll(":", "-");
    const outcome = await sendTextFile(env, chatId, `auto-backup-${stamp}.json`, JSON.stringify(payload, null, 2),
      `💾 نسخة تلقائية — ${fmt(users.length)} مستخدم`, "application/json");
    return Boolean(outcome?.ok);
  }

  // ---------------------------------------------------------------- /maintplan
  async function maintPlan(env, chatId, args) {
    const reply = say(env, chatId);
    const text = String(args ?? "").trim();
    if (!text || text === "off" || text === "إلغاء") {
      await sdel(env, A2.maint);
      await reply("🧹 أُلغي جدول الصيانة (إن كان موجودًا).");
      return true;
    }
    const parts = text.split(/\s+/u);
    const when = Date.parse(parts[0]);
    if (!Number.isFinite(when)) {
      await reply([
        "✏️ الاستخدام: <code>/maintplan 2026-10-28T22:00 on</code>",
        "• الموعد بصيغة ISO (UTC)، ثم <code>on</code> أو <code>off</code>.",
        "• للإلغاء: <code>/maintplan off</code>",
      ].join("\n"));
      return true;
    }
    const on = (parts[1] ?? "on").toLowerCase() !== "off";
    await sput(env, A2.maint, { at: new Date(when).toISOString(), on, chatId: String(chatId) });
    await reply(`⏰ جُدولت الصيانة: <b>${on ? "تشغيل" : "إيقاف"}</b> عند <code>${esc(new Date(when).toISOString().slice(0, 16))}</code> UTC.\nتُنفّذ عند أول نشاط للبوت بعد الموعد.`);
    return true;
  }

  // ---------------------------------------------------------------- /announce
  async function announce(env, chatId, userId, args) {
    const reply = say(env, chatId);
    const text = String(args ?? "").trim();
    if (!text) {
      await reply("✏️ الاستخدام: /announce <نص الإعلان>\nسيصلك معاينة أولًا، ولن يُرسل لأحد قبل ضغطك «تأكيد».");
      return true;
    }
    const preview = await telegram(env, "sendMessage", { chat_id: chatId, text: text.slice(0, 4000) });
    if (!preview?.ok) { await reply("❌ تعذّر إرسال المعاينة."); return true; }
    const count = await storeCall(env, { op: "bccount", exclude: adminIds(env) }).catch(() => ({ count: 0 }));
    await sput(env, A2.announce, { text: text.slice(0, 4000), previewId: preview.result.message_id, chatId: String(chatId) });
    await telegram(env, "sendMessage", {
      chat_id: chatId,
      text: `👀 <b>معاينة الإعلان</b> (الرسالة أعلاه)\nسيُرسل إلى <b>${fmt(count?.count ?? 0)}</b> مستخدم.\nهل تريد الإرسال؟`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[
        { text: "🚀 تأكيد الإرسال", callback_data: "a2|send" },
        { text: "❌ إلغاء", callback_data: "a2|cancel" },
      ]] },
    });
    if (logAdminAction) await logAdminAction(env, userId, "announce_preview", `${text.length} chars`);
    return true;
  }

  // ------------------------------------------------------------- exports group
  async function exportAudit(env, chatId) {
    const reply = say(env, chatId);
    const list = (await sget(env, "admin:audit:actions", [])) ?? [];
    if (!list.length) { await reply("📭 سجل إجراءات الأدمن فارغ."); return true; }
    const rows = [["at", "admin", "action", "detail"], ...list.map((e) => [e.at, e.admin, e.action, e.detail])];
    const outcome = await sendTextFile(env, chatId, `admin-audit-${day()}.csv`, csv(rows), `📋 سجل الإجراءات — ${fmt(list.length)} سطر.`, "text/csv");
    if (!outcome?.ok) await reply("❌ تعذّر إرسال الملف.");
    return true;
  }

  async function exportErrors(env, chatId) {
    const reply = say(env, chatId);
    const list = await readErrorLog(env).catch(() => []);
    if (!list.length) { await reply("✅ لا أخطاء مسجلة."); return true; }
    const outcome = await sendTextFile(env, chatId, `errors-${day()}.json`, JSON.stringify(list, null, 2), `⚠️ سجل الأخطاء — ${fmt(list.length)} عنصر.`, "application/json");
    if (!outcome?.ok) await reply("❌ تعذّر إرسال الملف.");
    return true;
  }

  async function exportMisses(env, chatId) {
    const reply = say(env, chatId);
    if (flushMisses) await flushMisses(env);
    const items = (await readMisses(env)) ?? [];
    if (!items.length) { await reply("✅ لا كلمات مفقودة."); return true; }
    const rows = [["word", "count"], ...items.map(([word, count]) => [word, count])];
    const outcome = await sendTextFile(env, chatId, `unanswered-${day()}.csv`, csv(rows), `🕳 كلمات بلا نتائج — ${fmt(items.length)} كلمة.`, "text/csv");
    if (!outcome?.ok) await reply("❌ تعذّر إرسال الملف.");
    return true;
  }

  async function exportBans(env, chatId) {
    const reply = say(env, chatId);
    const bans = await bannedSet(env);
    const items = Object.entries(bans);
    if (!items.length) { await reply("✅ لا محظورين."); return true; }
    const rows = [["user_id", "reason", "banned_at"], ...items.map(([id, info]) => [id, info?.reason ?? "", info?.at ?? ""])];
    const outcome = await sendTextFile(env, chatId, `bans-${day()}.csv`, csv(rows), `🚫 المحظورون — ${fmt(items.length)} مستخدم.`, "text/csv");
    if (!outcome?.ok) await reply("❌ تعذّر إرسال الملف.");
    return true;
  }

  // --------------------------------------------------------------- /adminscore
  async function adminScore(env, chatId) {
    const reply = say(env, chatId);
    const list = (await sget(env, "admin:audit:actions", [])) ?? [];
    if (!list.length) { await reply("📭 لا إجراءات مسجلة لتقييم الأداء."); return true; }
    const perAdmin = new Map();
    const perAction = new Map();
    for (const entry of list) {
      const key = String(entry.admin ?? "?");
      const rec = perAdmin.get(key) ?? { count: 0, last: "", actions: new Set() };
      rec.count += 1;
      if (String(entry.at ?? "") > rec.last) rec.last = String(entry.at ?? "");
      rec.actions.add(String(entry.action ?? ""));
      perAdmin.set(key, rec);
      perAction.set(String(entry.action ?? "?"), (perAction.get(String(entry.action ?? "?")) ?? 0) + 1);
    }
    const admins = [...perAdmin.entries()].sort((a, b) => b[1].count - a[1].count);
    const actions = [...perAction.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    await reply([
      "🏅 <b>أداء فريق الإدارة</b>", HR,
      ...admins.slice(0, 10).map(([id, rec], i) => `${i + 1}. <code>${esc(id)}</code> — <b>${fmt(rec.count)}</b> إجراء (${fmt(rec.actions.size)} نوع) — آخر: ${esc(rec.last.slice(0, 16).replace("T", " "))}`),
      HR,
      "<b>أكثر الإجراءات تكرارًا:</b>",
      ...actions.map(([action, count]) => `• ${esc(action)} — ${fmt(count)}`),
    ].join("\n"));
    return true;
  }

  // ------------------------------------------------------------------- /trace
  async function trace(env, chatId, args) {
    const reply = say(env, chatId);
    const id = String(args ?? "").trim();
    if (!/^\d+$/u.test(id)) { await reply("✏️ الاستخدام: /trace <user_id>"); return true; }
    const [user, history, bans, notes] = await Promise.all([
      getUser(env, id),
      getUserHistory(env, id).catch(() => []),
      bannedSet(env),
      sget(env, "admin:usernotes", {}),
    ]);
    if (!user && !history.length) { await reply(`📭 لا يوجد أثر للمستخدم <code>${esc(id)}</code>.`); return true; }
    const note = notes?.[id];
    await reply([
      `🧭 <b>تتبّع كامل</b> <code>${esc(id)}</code>`, HR,
      `• الاسم: ${esc(user?.name ?? user?.tgName ?? "—")}`,
      `• المعرّف: ${user?.username ? "@" + esc(user.username) : "—"}`,
      `• أول ظهور: ${esc(String(user?.firstSeen ?? "—").slice(0, 16))}`,
      `• اكتمال التسجيل: ${user?.registeredAt ? esc(String(user.registeredAt).slice(0, 16)) : "❌ لم يكتمل"}`,
      `• آخر نشاط: ${user?.lastSeen ? esc(String(user.lastSeen).slice(0, 16)) : "—"}`,
      `• محظور: ${bans[id] || user?.blocked ? `🚫 (${esc(bans[id]?.reason ?? "بدون سبب")})` : "لا"}`,
      `• نقاط/تفاعل: ${fmt(user?.points ?? 0)}`,
      `• ملاحظة إدارية: ${note ? esc(note.note) : "—"}`,
      HR,
      `<b>آخر ${Math.min(10, history.length)} عملية بحث:</b>`,
      ...(history.slice(0, 10).map((h) => `• ${esc(String(h.at ?? "").slice(11, 16))} ${esc(String(h.q ?? "").slice(0, 40))}`)),
      history.length ? "" : "لا سجل بحث.",
    ].join("\n"));
    return true;
  }

  // -------------------------------------------------------------- /usertimeline
  async function userTimeline(env, chatId, args) {
    const reply = say(env, chatId);
    const id = String(args ?? "").trim();
    if (!/^\d+$/u.test(id)) { await reply("✏️ الاستخدام: /usertimeline <user_id>"); return true; }
    const [user, history] = await Promise.all([getUser(env, id), getUserHistory(env, id).catch(() => [])]);
    if (!user) { await reply(`📭 لا مستخدم بالمعرّف <code>${esc(id)}</code>.`); return true; }
    const events = [];
    if (user.firstSeen) events.push([user.firstSeen, "👋 أول ظهور"]);
    if (user.registeredAt) events.push([user.registeredAt, "📝 أكمل التسجيل"]);
    if (user.bannedAt) events.push([user.bannedAt, "🚫 حُظر"]);
    if (user.blockedAt) events.push([user.blockedAt, "⛔ حظر البوت"]);
    if (user.lastSeen) events.push([user.lastSeen, "⚡️ آخر نشاط"]);
    for (const h of history.slice(0, 8)) events.push([h.at, `🔎 بحث: ${String(h.q ?? "").slice(0, 30)}`]);
    events.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    await reply([
      `⏳ <b>خط زمني</b> — <code>${esc(id)}</code> ${esc(user.name ?? "")}`, HR,
      ...events.map(([at, label]) => `<code>${esc(String(at ?? "").slice(0, 16).replace("T", " "))}</code> — ${esc(label)}`),
      events.length ? "" : "لا أحداث مسجلة.",
    ].join("\n"));
    return true;
  }

  // ------------------------------------------------------------- /searchstats
  async function searchStats(env, chatId) {
    const reply = say(env, chatId);
    const [analytics, misses] = await Promise.all([
      readAnalyticsReport(env).catch(() => ({ searches: 0, commands: 0, inline: 0, topWords: [] })),
      readMisses(env).catch(() => []),
    ]);
    const missTotal = misses.reduce((sum, [, count]) => sum + Number(count), 0);
    const totalSearches = Number(analytics.searches ?? 0);
    const hitRate = totalSearches + missTotal > 0 ? Math.round((totalSearches / (totalSearches + missTotal)) * 1000) / 10 : 0;
    await reply([
      "🔬 <b>إحصاءات البحث</b>", HR,
      `• عمليات البحث المسجلة: <b>${fmt(totalSearches)}</b>`,
      `• أوامر: <b>${fmt(analytics.commands)}</b> | Inline: <b>${fmt(analytics.inline)}</b>`,
      `• كلمات بلا نتائج: <b>${fmt(missTotal)}</b> (${fmt(misses.length)} كلمة مختلفة)`,
      `• نسبة النجاح التقديرية: <b>${hitRate}%</b>`,
      `• بحث في الذاكرة الآن: <b>${fmt(recentSearches?.length ?? 0)}</b>`,
      HR,
      "<b>أعلى ٥ كلمات:</b>",
      ...(analytics.topWords ?? []).slice(0, 5).map(([word, count], i) => `${i + 1}. ${esc(word)} — ${fmt(count)}`),
    ].join("\n"));
    return true;
  }

  // ---------------------------------------------------------------- /livewords
  async function liveWords(env, chatId, args) {
    const reply = say(env, chatId);
    const limit = Math.min(40, Math.max(1, Number(args) || 15));
    const list = recentSearches ?? [];
    if (!list.length) { await reply("📭 لا عمليات بحث في ذاكرة هذه النسخة بعد (تُصفَّر مع كل نشر)."); return true; }
    const counts = new Map();
    for (const item of list) {
      const key = norm(item.query).slice(0, 60);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    await reply([
      `🔥 <b>الأكثر بحثًا الآن</b> (من ${fmt(list.length)} عملية في الذاكرة)`, HR,
      ...top.map(([word, count], i) => `${i + 1}. ${esc(word)} — <b>${fmt(count)}</b>`),
    ].join("\n"));
    return true;
  }

  // --------------------------------------------------------------- /wordaudit
  async function wordAudit(env, chatId, args) {
    const reply = say(env, chatId);
    const query = norm(args);
    if (!query) { await reply("✏️ الاستخدام: /wordaudit <كلمة>"); return true; }
    const index = records.findIndex((record) =>
      norm(record.coptic) === query || norm(record.coptic).includes(query) ||
      norm(record.meaning).includes(query) || norm(record.english).includes(query));
    if (index < 0) {
      await reply(`📭 «${esc(String(args).trim())}» غير موجودة في القاموس.\n💡 أضفها من /admin ← تعديل القاموس ← إضافة كلمة، ثم أرسل /misses لمراجعة الطلبات المتكررة.`);
      return true;
    }
    const record = records[index];
    const missing = GAP_FIELDS.filter((field) => !String(record[field] ?? "").trim());
    const meanings = String(record.meaning ?? "").split(/[،,;|]/u).filter((part) => part.trim()).length;
    const media = await storeCall(env, { op: "media", id: record.id }).catch(() => null);
    await reply([
      `🔍 <b>تدقيق كلمة</b> — ${esc(record.coptic)}`, HR,
      `• رقم الصف في الذاكرة: <code>${fmt(index)}</code> | id: <code>${esc(record.id ?? "—")}</code>`,
      `• المعنى: ${esc(String(record.meaning ?? "—").slice(0, 120))}`,
      `• عدد المعاني المفصولة: <b>${fmt(meanings)}</b>`,
      `• النطق: ${record.pronunciation ? "✅" : "❌"} | اليوناني: ${record.greek ? "✅" : "❌"} | النوع: ${record.kind ? "✅" : "❌"} | الأصل: ${record.origin ? "✅" : "❌"}`,
      `• الترجمة الفرنسية: ${record.translation_fr ? "✅" : "❌"} | الألمانية: ${record.translation_de ? "✅" : "❌"}`,
      `• تسجيل صوتي محفوظ: ${media?.voice ? "🎙 موجود" : "🔇 لا يوجد (يُستخدم الصوت المولّد)"}`,
      `• بطاقة مصوّرة: ${media?.card ? (media?.disabled ? "🖼 مخفية إداريًا" : "🖼 موجودة") : "— لا بطاقة"}`,
      missing.length ? `• حقول ناقصة: <b>${esc(missing.join(", "))}</b>` : "• ✅ كل الحقول ممتلئة",
      HR,
      `للتعديل: /admin ← تعديل القاموس، وابحث عن «${esc(String(record.coptic).slice(0, 30))}».`,
    ].join("\n"));
    return true;
  }

  // ---------------------------------------------------------------- /gapfill
  async function gapFill(env, chatId, args) {
    const reply = say(env, chatId);
    const parts = String(args ?? "").trim().split(/\s+/u);
    const field = parts[0] ?? "";
    const limit = Math.min(40, Math.max(1, Number(parts[1]) || 20));
    if (!GAP_FIELDS.includes(field)) {
      await reply(`✏️ الاستخدام: /gapfill <الحقل> [عدد]\nالحقول: ${GAP_FIELDS.join(", ")}`);
      return true;
    }
    const hits = [];
    records.forEach((record, index) => {
      if (hits.length >= limit) return;
      if (!String(record[field] ?? "").trim()) hits.push({ index, record });
    });
    if (!hits.length) { await reply(`✅ لا كلمات ناقصة في الحقل <code>${esc(field)}</code>.`); return true; }
    const total = records.filter((record) => !String(record[field] ?? "").trim()).length;
    await reply([
      `🧩 <b>أول ${hits.length} كلمة ناقصة في «${esc(field)}»</b> (الإجمالي: ${fmt(total)})`, HR,
      ...hits.map(({ index, record }) => `<code>${fmt(index)}</code> <b>${esc(String(record.coptic ?? "").slice(0, 34))}</b> — ${esc(String(record.meaning ?? "").slice(0, 40))}`),
      HR,
      "افتح /admin ← تعديل القاموس وابحث بالكلمة لتعبئة الحقل، ثم أعد /fieldreport لقياس التحسن.",
    ].join("\n"));
    return true;
  }

  // ------------------------------------------------------------ /voicecoverage
  async function voiceCoverage(env, chatId) {
    const reply = say(env, chatId);
    const ids = (await storeCall(env, { op: "voiceIds" }).catch(() => ({ ids: [] })))?.ids ?? [];
    const total = Math.max(1, records.length);
    const percent = Math.round((ids.length / total) * 1000) / 10;
    const bars = "█".repeat(Math.max(1, Math.round(percent / 5)));
    await reply([
      "🎙 <b>تغطية التسجيلات الصوتية</b>", HR,
      `${bars} <b>${percent}%</b>`,
      `• كلمات مُسجَّلة: <b>${fmt(ids.length)}</b> من <b>${fmt(records.length)}</b>`,
      `• متبقّية: <b>${fmt(records.length - ids.length)}</b> كلمة`,
      HR,
      "لسدّ الفجوة: /record لتسجيل الكلمة التالية، و/record_choose لاختيار كلمة بعينها.",
    ].join("\n"));
    return true;
  }

  // ------------------------------------------------------------ /welcomepreview
  async function welcomePreview(env, chatId) {
    const reply = say(env, chatId);
    const custom = (await sget(env, "welcome:caption", "")) ?? "";
    await reply([
      "👋 <b>نص الترحيب الحالي</b>", HR,
      custom ? esc(custom) : "<i>النص الافتراضي (لم يُخصَّص)</i>",
      HR,
      "للتغيير: /editwelcome النص… واستخدم {name} لاسم المستخدم • للإرجاع: /resetwelcome",
    ].join("\n"));
    return true;
  }

  // ---------------------------------------------------------------- /a2help
  async function a2help(env, chatId) {
    const reply = say(env, chatId);
    const groups = [
      ["🩺 فحص وتشغيل", ["selfcheck", "statuspage", "sheetdiff", "syncwatch", "digest"]],
      ["📣 نشر وتواصل", ["announce", "backupauto", "maintplan", "welcomepreview"]],
      ["📤 تصدير", ["exportaudit", "exporterrors", "exportmisses", "exportbans"]],
      ["👤 مستخدمون", ["trace", "usertimeline", "adminscore"]],
      ["📖 قاموس وبحث", ["wordaudit", "gapfill", "searchstats", "livewords", "voicecoverage"]],
    ];
    const lines = ["🧰 <b>حزمة الأدمن الثانية (v1.2.0)</b>", HR];
    for (const [title, names] of groups) lines.push(`<b>${title}</b>`, names.map((name) => `/${name}`).join(" • "), "");
    lines.push("كل الأوامر السابقة تعمل كما هي.");
    await reply(lines.join("\n"));
    return true;
  }

  const START = globalThis.__copticBotStartedAt ?? Date.now();

  // -------------------------------------------------------------- auto runners
  async function runAutoMaintenance(env) {
    const plan = await sget(env, A2.maint, null);
    if (!plan?.at || Date.parse(plan.at) > Date.now()) return;
    await setMaintenance(env, Boolean(plan.on));
    await sdel(env, A2.maint);
    if (plan.chatId) {
      const note = await customMaintenanceMessage(env).catch(() => "");
      await telegram(env, "sendMessage", {
        chat_id: plan.chatId,
        text: `${plan.on ? "🔧 فُعّل وضع الصيانة" : "✅ أُوقف وضع الصيانة"} تلقائيًا حسب الجدول.${plan.on && note ? `\nالرسالة الظاهرة للمستخدمين:\n${note}` : ""}`,
      }).catch(() => null);
    }
  }

  async function runAutoDigest(env) {
    const cfg = await sget(env, A2.digest, null);
    if (!cfg?.on || !cfg.chatId) return;
    const now = new Date();
    if (now.getUTCHours() < Number(cfg.hour ?? 8) || cfg.lastSent === day()) return;
    const text = await buildDigest(env);
    const outcome = await telegram(env, "sendMessage", { chat_id: cfg.chatId, text, parse_mode: "HTML", disable_web_page_preview: true }).catch(() => null);
    if (outcome?.ok) await sput(env, A2.digest, { ...cfg, lastSent: day() });
  }

  async function runAutoBackup(env) {
    const cfg = await sget(env, A2.backup, null);
    if (!cfg?.on || !cfg.chatId) return;
    const now = new Date();
    if (now.getUTCHours() < Number(cfg.hour ?? 3) || cfg.lastSent === day()) return;
    const ok = await sendAutoBackup(env, cfg.chatId);
    if (ok) await sput(env, A2.backup, { ...cfg, lastSent: day() });
  }

  async function runSyncWatch(env) {
    const cfg = await sget(env, A2.watch, null);
    if (!cfg?.on) return;
    if (cfg.lastAt && Date.now() - Date.parse(cfg.lastAt) < 20 * 60000) return;
    await sput(env, A2.watch, { ...cfg, lastAt: iso() });
    const [stats, sheet] = await Promise.all([
      storeCall(env, { op: "adminStats" }).catch(() => ({})),
      sheetRows(env),
    ]);
    if (!sheet.ok) return;
    const diff = Number(stats.users ?? 0) - sheet.rows;
    if (diff <= Number(cfg.threshold ?? 25)) return;
    const started = await storeCall(env, { op: "sync_start", fromChat: cfg.chatId, input: "fast" }).catch(() => null);
    if (started) {
      await telegram(env, "sendMessage", {
        chat_id: cfg.chatId,
        text: `👁 اكتشفت مراقبة المزامنة فرقًا قدره <b>${fmt(diff)}</b> مستخدم، فبدأت المزامنة تلقائيًا. تابع بـ /syncstatus.`,
        parse_mode: "HTML",
      }).catch(() => null);
    }
  }

  // Cheap: one module-level timestamp so a normal message costs nothing.
  let lastTickAt = 0;
  async function tick(env) {
    const now = Date.now();
    if (now - lastTickAt < 60000) return;
    lastTickAt = now;
    try { await runAutoMaintenance(env); } catch { /* ignore */ }
    try { await runAutoDigest(env); } catch { /* ignore */ }
    try { await runAutoBackup(env); } catch { /* ignore */ }
    try { await runSyncWatch(env); } catch { /* ignore */ }
  }

  const COMMANDS = {
    selfcheck: { desc: "فحص ذاتي شامل", run: (c) => selfCheck(c.env, c.chatId) },
    statuspage: { desc: "نص حالة جاهز للنشر", run: (c) => statusPage(c.env, c.chatId) },
    sheetdiff: { desc: "فرق المستخدمين بين التخزين والشيت", run: (c) => sheetDiff(c.env, c.chatId) },
    syncwatch: { desc: "مراقبة المزامنة التلقائية", run: (c) => syncWatch(c.env, c.chatId, c.args) },
    digest: { desc: "الملخص الإداري اليومي", run: (c) => digestCmd(c.env, c.chatId, c.args) },
    announce: { desc: "إعلان بمعاينة قبل الإرسال", run: (c) => announce(c.env, c.chatId, c.userId, c.args) },
    backupauto: { desc: "نسخة احتياطية تلقائية يومية", run: (c) => backupCmd(c.env, c.chatId, c.args) },
    maintplan: { desc: "صيانة مجدولة", run: (c) => maintPlan(c.env, c.chatId, c.args) },
    welcomepreview: { desc: "معاينة نص الترحيب", run: (c) => welcomePreview(c.env, c.chatId) },
    exportaudit: { desc: "تصدير سجل إجراءات الأدمن", run: (c) => exportAudit(c.env, c.chatId) },
    exporterrors: { desc: "تصدير سجل الأخطاء", run: (c) => exportErrors(c.env, c.chatId) },
    exportmisses: { desc: "تصدير الكلمات بلا نتائج", run: (c) => exportMisses(c.env, c.chatId) },
    exportbans: { desc: "تصدير قائمة المحظورين", run: (c) => exportBans(c.env, c.chatId) },
    trace: { desc: "تتبّع مستخدم بالكامل", run: (c) => trace(c.env, c.chatId, c.args) },
    usertimeline: { desc: "خط زمني لمستخدم", run: (c) => userTimeline(c.env, c.chatId, c.args) },
    adminscore: { desc: "أداء فريق الإدارة", run: (c) => adminScore(c.env, c.chatId) },
    wordaudit: { desc: "تدقيق كلمة تفصيلي", run: (c) => wordAudit(c.env, c.chatId, c.args) },
    gapfill: { desc: "كلمات ناقصة حقل معين", run: (c) => gapFill(c.env, c.chatId, c.args) },
    searchstats: { desc: "إحصاءات البحث الشاملة", run: (c) => searchStats(c.env, c.chatId) },
    livewords: { desc: "الأكثر بحثًا في الذاكرة", run: (c) => liveWords(c.env, c.chatId, c.args) },
    voicecoverage: { desc: "تغطية التسجيلات الصوتية", run: (c) => voiceCoverage(c.env, c.chatId) },
    a2help: { desc: "أوامر الحزمة الثانية", run: (c) => a2help(c.env, c.chatId) },
  };

  async function handle({ env, chatId, userId, text, raw }) {
    const source = String(raw ?? text ?? "").trim();
    if (!source.startsWith("/")) return false;
    const match = /^\/([a-zA-Z_0-9]+)(?:@[^\s]+)?(?:\s+([\s\S]*))?$/u.exec(source);
    if (!match) return false;
    const name = match[1].toLowerCase();
    const entry = COMMANDS[name];
    if (!entry) return false;
    try {
      await entry.run({ env, chatId, userId, args: (match[2] ?? "").trim() });
    } catch (error) {
      await say(env, chatId)(`❌ تعذّر تنفيذ /${esc(name)}: ${esc(error instanceof Error ? error.message : "خطأ")}`);
    }
    return true;
  }

  async function handleCallback({ env, callback }) {
    const userId = callback.from?.id;
    if (!adminIds(env).map(String).includes(String(userId))) return false;
    const chatId = callback.message?.chat?.id;
    if (!chatId) return false;
    const action = String(callback.data ?? "").split("|")[1];
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id }).catch(() => null);
    const state = await sget(env, A2.announce, null);
    if (!state) {
      await telegram(env, "editMessageText", { chat_id: chatId, message_id: callback.message.message_id, text: "⌛️ انتهت صلاحية هذه المعاينة. أعد /announce." }).catch(() => null);
      return true;
    }
    if (action === "cancel") {
      await sdel(env, A2.announce);
      await telegram(env, "editMessageText", { chat_id: chatId, message_id: callback.message.message_id, text: "❌ أُلغي الإعلان ولم يُرسل لأحد." }).catch(() => null);
      return true;
    }
    if (action === "send") {
      const result = await storeCall(env, { op: "bcstart", exclude: adminIds(env), fromChat: state.chatId, messageId: state.previewId }).catch(() => null);
      await sdel(env, A2.announce);
      const total = Number(result?.total ?? 0);
      const busy = result?.busy === true;
      await telegram(env, "editMessageText", {
        chat_id: chatId,
        message_id: callback.message.message_id,
        text: busy ? "⚠️ هناك إرسال جماعي يعمل بالفعل. أوقفه أو انتظره ثم أعد /announce." : `🚀 بدأ الإرسال إلى ${fmt(total)} مستخدم. تابع الحالة بـ /bcstatus.`,
      }).catch(() => null);
      if (logAdminAction) await logAdminAction(env, userId, "announce_send", `to ${total}`);
      return true;
    }
    return true;
  }

  return { handle, handleCallback, tick, commands: COMMANDS };
}
