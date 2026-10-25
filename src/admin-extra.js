// ============================================================================
// admin-extra.js — حزمة أدوات الأدمن الإضافية (الإصدار 1.1.0)
//
// كل الأوامر هنا تُبنى فوق الدوال التي يمررها index.js داخل الكائن `api`،
// حتى لا تتكرر منطقية التخزين ولا يتضخم ملف العامل الأساسي أكثر من اللازم.
// ============================================================================

const MAX_TEXT = 3800;
const SCHED_KEY = "sched:list";

export function createAdminExtras(api) {
  const {
    telegram, escapeHtml, storeCall, getUser, saveUser, bannedSet, readAnalyticsReport,
    readErrorLog, sendTextFile, logAdminAction, adminIds, driveConfig, callAppsScript,
    records, formatUptime, readMisses, flushMisses, clearMisses, cacheInfo, botVersion,
    adminStatsOp,
  } = api;

  const esc = (value) => escapeHtml(String(value ?? ""));
  const fmt = (value) => Number(value ?? 0).toLocaleString("en-US");
  const nowIso = () => new Date().toISOString();
  const replyTo = (env, chatId) => (text, extra = {}) => telegram(env, "sendMessage", {
    chat_id: chatId,
    text: String(text).slice(0, MAX_TEXT + 200),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
  const storeGet = async (env, key, fallback = null) => {
    if (!env.USERS) return fallback;
    try { return (await storeCall(env, { op: "get", key })).value ?? fallback; } catch { return fallback; }
  };
  const storePut = async (env, key, value) => {
    if (!env.USERS) return false;
    try { await storeCall(env, { op: "put", key, value }); return true; } catch { return false; }
  };

  // All users, paged. Small helper reused by the reporting commands.
  async function allUsers(env, max = 6000) {
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

  const ageDays = (iso) => {
    if (!iso) return null;
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) return null;
    return Math.floor((Date.now() - time) / 86400000);
  };

  // ------------------------------------------------------------------ ping
  async function runPing(env, chatId) {
    const reply = replyTo(env, chatId);
    const t0 = Date.now();
    const me = await telegram(env, "getMe", {});
    const apiMs = Date.now() - t0;
    const started = Date.now();
    await storeCall(env, { op: "get", key: "ping" }).catch(() => null);
    const storeMs = env.USERS ? Date.now() - started : -1;
    await reply([
      "🏓 <b>قياس زمن الاستجابة</b>",
      `• Telegram API: <b>${apiMs} ms</b>`,
      `• تخزين المستخدمين: <b>${storeMs >= 0 ? `${storeMs} ms` : "غير مفعّل"}</b>`,
      `• البوت: @${esc(me?.result?.username ?? "?")}`,
      `• المدة منذ تشغيل النسخة: ${formatUptime(Date.now() - BOT_START_REF)}`,
    ].join("\n"));
    return true;
  }

  // ---------------------------------------------------------------- version
  async function runVersion(env, chatId) {
    const reply = replyTo(env, chatId);
    await reply([
      "🏷 <b>إصدار البوت</b>",
      `• النسخة: <code>${esc(botVersion)}</code>`,
      `• سجلات القاموس: ${fmt(records.length)}`,
      `• مدة تشغيل النسخة: ${formatUptime(Date.now() - BOT_START_REF)}`,
      `• الوقت الآن (UTC): ${esc(nowIso().slice(0, 19))}`,
    ].join("\n"));
    return true;
  }

  // ------------------------------------------------------------------ debug
  async function runDebug(env, chatId) {
    const reply = replyTo(env, chatId);
    const stats = adminStatsOp ? await adminStatsOp() : {};
    const drive = await driveConfig(env).catch(() => null);
    const keys = Object.keys(env ?? {}).sort();
    await reply([
      "🧪 <b>لقطة تشخيصية</b>",
      `• Bindings: USERS=${env.USERS ? "✅" : "❌"} | Drive=${drive ? "✅" : "❌"} | Token=${env.TELEGRAM_BOT_TOKEN ? "✅" : "❌"} | HookSecret=${env.WEBHOOK_SECRET ? "✅" : "❌"}`,
      `• القاموس في الذاكرة: ${fmt(records.length)} سجل`,
      `• المستخدمون: ${fmt(stats.users)} | المحظورون: ${fmt(stats.blocked)} | التسجيلات: ${fmt(stats.voices)}`,
      `• ينتظر الرفع: ${fmt(stats.pendingUploads)}`,
      `• متغيّرات البيئة (${keys.length}): <code>${esc(keys.slice(0, 40).join(", "))}</code>`,
      `• مدة التشغيل: ${formatUptime(Date.now() - BOT_START_REF)}`,
    ].join("\n"));
    return true;
  }

  // ------------------------------------------------------------------ limits
  async function runLimits(env, chatId) {
    const reply = replyTo(env, chatId);
    const [limit, slow, maint, flags] = await Promise.all([
      storeGet(env, "searchlimit:daily", 0),
      storeGet(env, "admin:slowmode", { on: false, seconds: 5 }),
      storeGet(env, "maintenance:on", false),
      storeGet(env, "admin:features", {}),
    ]);
    const off = Object.entries(flags ?? {}).filter(([, on]) => on === false).map(([name]) => name);
    await reply([
      "⚙️ <b>الحدود والإعدادات الحالية</b>",
      `• حد البحث اليومي: <b>${Number(limit) > 0 ? Number(limit) : "بلا حد"}</b>`,
      `• الوضع البطيء: <b>${slow?.on ? `مفعّل (${slow.seconds} ث)` : "متوقف"}</b>`,
      `• وضع الصيانة: <b>${maint ? "🔧 مفعّل" : "✅ متوقف"}</b>`,
      `• ميزات مغلقة: <b>${off.length ? esc(off.join(", ")) : "لا شيء"}</b>`,
      "",
      "للتغيير: /searchlimit، /slowmode، /maintenance، /feature",
    ].join("\n"));
    return true;
  }

  // -------------------------------------------------------------- cacheinfo
  async function runCacheInfo(env, chatId) {
    const reply = replyTo(env, chatId);
    const rows = typeof cacheInfo === "function" ? cacheInfo() : [];
    await reply([
      "🗄 <b>حالة الكاش داخل النسخة الحالية</b>",
      ...rows.map(([name, size]) => `• ${esc(name)}: <b>${fmt(size)}</b>`),
      "",
      "الكاش يُصفَّر تلقائيًا مع كل نشر جديد، ويمكن تصفيره يدويًا بـ /clearcache.",
    ].join("\n"));
    return true;
  }

  // ------------------------------------------------------------ syncstatus
  async function runSyncStatus(env, chatId) {
    const reply = replyTo(env, chatId);
    const [state, job, cursor, stats] = await Promise.all([
      storeGet(env, "user-sync:state", {}),
      storeGet(env, "sync:job", null),
      storeGet(env, "users-sync-cursor", null),
      adminStatsOp ? adminStatsOp() : {},
    ]);
    const drive = await driveConfig(env).catch(() => null);
    const lines = [
      "🔄 <b>حالة مزامنة المستخدمين</b>",
      `• ربط Apps Script: <b>${drive ? "✅" : "❌ غير مرتبط"}</b>`,
      `• مستخدمون في التخزين: <b>${fmt(stats.users)}</b>`,
      `• مزامنة تعمل الآن: <b>${job ? (job.paused ? "متوقفة مؤقتًا ⏸" : "تعمل ▶️") : "لا"}</b>`,
      `• آخر تشغيل: <b>${esc(state.lastRunAt ?? "لم يعمل بعد")}</b>`,
      `• آخر عدد في التشغيل: <b>${fmt(state.lastRunTotal ?? 0)}</b>`,
      `• مؤشر الاستكمال: <code>${esc(cursor ?? "—")}</code>`,
      `• آخر خطأ: <b>${esc(state.lastError || job?.lastError || "لا يوجد")}</b>`,
    ];
    if (job) lines.push(`• الجولات: ${fmt(job.rounds ?? 0)} | الإجمالي: ${fmt(job.total ?? 0)} | محاولات فاشلة: ${fmt(job.attempts ?? 0)}`);
    lines.push("", "▶️ للبدء: /syncusers • ⏹ للإيقاف: /synccancel • 🔁 من البداية: /syncreset");
    await reply(lines.join("\n"));
    return true;
  }

  // -------------------------------------------------------------- synctest
  async function runSyncTest(env, chatId, userId) {
    const reply = replyTo(env, chatId);
    const config = await driveConfig(env).catch(() => null);
    if (!config) { await reply("❌ لا يوجد رابط Apps Script. استخدم /setdrive <الرابط> أو أضف السر APPS_SCRIPT_URL."); return true; }
    const out = [];
    out.push("🧪 <b>اختبار اتصال الشيت</b>");
    let t0 = Date.now();
    try {
      await callAppsScript(config, { action: "ping" });
      out.push(`• ping: ✅ ${Date.now() - t0} ms`);
    } catch (error) {
      out.push(`• ping: ❌ ${esc(error instanceof Error ? error.message : "خطأ")}`);
      await reply(out.join("\n"));
      return true;
    }
    t0 = Date.now();
    try {
      const result = await callAppsScript(config, {
        action: "users",
        users: [{ id: String(userId), name: "اختبار المزامنة", username: "", joined_at: nowIso(), registered_at: "" }],
      });
      const ms = Date.now() - t0;
      out.push(`• كتابة صف واحد: ✅ ${ms} ms (أُضيف ${fmt(result.added)}, حُدّث ${fmt(result.updated)})`);
      out.push(ms > 5000 ? "⚠️ الكتابة بطيئة: قد تكون نسخة Apps Script المنشورة قديمة (اكتب صفًّا صفًّا). أعد نشر Code.gs." : "• سرعة الكتابة طبيعية ✅");
    } catch (error) {
      out.push(`• كتابة صف: ❌ ${esc(error instanceof Error ? error.message : "خطأ")}`);
    }
    try {
      const count = await callAppsScript(config, { action: "users_count" });
      out.push(`• صفوف ورقة users حاليًا: <b>${fmt(count.rows ?? 0)}</b>`);
    } catch (error) {
      out.push(`• عدّ الصفوف: ❌ ${esc(error instanceof Error ? error.message : "خطأ")} (أعد نشر Code.gs لدعم users_count)`);
    }
    await reply(out.join("\n"));
    return true;
  }

  // ------------------------------------------------------------- usercount
  async function runUserCount(env, chatId) {
    const reply = replyTo(env, chatId);
    const users = await allUsers(env);
    const bans = await bannedSet(env);
    const today = nowIso().slice(0, 10);
    const weekAgo = Date.now() - 7 * 86400000;
    const monthAgo = Date.now() - 30 * 86400000;
    let named = 0, unnamed = 0, blocked = 0, todayCount = 0, week = 0, month = 0, banned = 0;
    for (const { id, record } of users) {
      const when = Date.parse(record?.firstSeen ?? record?.registeredAt ?? "");
      if (record?.name || record?.registeredAt) named += 1; else unnamed += 1;
      if (record?.blocked) blocked += 1;
      if (bans[id]) banned += 1;
      if (Number.isFinite(when)) {
        if (new Date(when).toISOString().slice(0, 10) === today) todayCount += 1;
        if (when >= weekAgo) week += 1;
        if (when >= monthAgo) month += 1;
      }
    }
    await reply([
      "👥 <b>إحصاء المستخدمين</b>",
      `• الإجمالي: <b>${fmt(users.length)}</b>`,
      `• مكتمل التسجيل: <b>${fmt(named)}</b> | بلا اسم: <b>${fmt(unnamed)}</b>`,
      `• حظر البوت: <b>${fmt(blocked)}</b> | محظور إداريًا: <b>${fmt(banned)}</b>`,
      `• انضموا اليوم: <b>${fmt(todayCount)}</b> | آخر ٧ أيام: <b>${fmt(week)}</b> | آخر ٣٠ يومًا: <b>${fmt(month)}</b>`,
    ].join("\n"));
    return true;
  }

  // ---------------------------------------------------------------- growth
  async function runGrowth(env, chatId) {
    const reply = replyTo(env, chatId);
    const users = await allUsers(env);
    const buckets = new Map();
    for (const { record } of users) {
      const iso = record?.firstSeen ?? record?.registeredAt;
      const day = iso ? String(iso).slice(0, 10) : "";
      if (!day) continue;
      buckets.set(day, (buckets.get(day) ?? 0) + 1);
    }
    const days = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14);
    const max = Math.max(1, ...days.map(([, count]) => count));
    const lines = ["📈 <b>نمو المستخدمين (آخر ١٤ يومًا نشاطًا)</b>", ""];
    for (const [day, count] of days) {
      const bars = "█".repeat(Math.max(1, Math.round((count / max) * 14)));
      lines.push(`<code>${esc(day)}</code> ${bars} <b>${fmt(count)}</b>`);
    }
    if (!days.length) lines.push("لا توجد تواريخ انضمام مسجلة.");
    lines.push("", `الإجمالي: <b>${fmt(users.length)}</b> مستخدم.`);
    await reply(lines.join("\n"));
    return true;
  }

  // -------------------------------------------------------------- inactive
  async function runInactive(env, chatId, args) {
    const reply = replyTo(env, chatId);
    const days = Math.max(1, Number(args) || 30);
    const users = await allUsers(env);
    const idle = [];
    for (const { id, record } of users) {
      const stamp = record?.lastSeen ?? record?.registeredAt ?? record?.firstSeen;
      const age = ageDays(stamp);
      if (age !== null && age >= days) idle.push({ id, age, name: record?.name ?? record?.tgName ?? "" });
    }
    idle.sort((a, b) => b.age - a.age);
    const lines = [`😴 <b>خاملون ${days} يومًا فأكثر</b> — العدد: <b>${fmt(idle.length)}</b>`, ""];
    for (const item of idle.slice(0, 40)) lines.push(`• <code>${esc(item.id)}</code> — ${esc(item.name || "بدون اسم")} (${fmt(item.age)} يوم)`);
    if (idle.length > 40) lines.push(`… و${fmt(idle.length - 40)} آخرين.`);
    if (!idle.length) lines.push("✅ لا يوجد خاملون بهذا الحد.");
    lines.push("", "للحذف الفعلي: /purge <أيام> (يحذف من التخزين).");
    await reply(lines.join("\n"));
    return true;
  }

  // ------------------------------------------------------------ userlookup
  async function runUserLookup(env, chatId, args) {
    const reply = replyTo(env, chatId);
    const query = String(args ?? "").trim();
    if (!query) { await reply("✏️ الاستخدام: /userlookup <id أو @username أو جزء من الاسم>"); return true; }
    const needle = query.replace(/^@/u, "").toLowerCase();
    const users = await allUsers(env, 4000);
    const hits = users.filter(({ id, record }) =>
      id === query || id.includes(query) ||
      String(record?.username ?? "").toLowerCase().includes(needle) ||
      String(record?.name ?? "").toLowerCase().includes(query.toLowerCase()) ||
      String(record?.tgName ?? "").toLowerCase().includes(query.toLowerCase())).slice(0, 20);
    if (!hits.length) { await reply("📭 لا نتائج."); return true; }
    const bans = await bannedSet(env);
    const lines = [`🔎 <b>نتائج البحث عن «${esc(query)}»</b> (${fmt(hits.length)})`, ""];
    for (const { id, record } of hits) {
      const tag = bans[id] || record?.blocked ? " 🚫" : "";
      lines.push(`• <code>${esc(id)}</code> — ${esc(record?.name ?? record?.tgName ?? "بدون اسم")}${record?.username ? ` (@${esc(record.username)})` : ""}${tag}`);
    }
    lines.push("", "التفاصيل: /userinfo <id>");
    await reply(lines.join("\n"));
    return true;
  }

  // ------------------------------------------------------------ userdelete
  async function runUserDelete(env, chatId, args, userId) {
    const reply = replyTo(env, chatId);
    const id = String(args ?? "").trim();
    if (!/^\d+$/u.test(id)) { await reply("✏️ الاستخدام: /userdelete <id>"); return true; }
    if (adminIds(env).includes(id)) { await reply("❌ لا يمكن حذف حساب أدمن."); return true; }
    const existing = await getUser(env, id);
    if (!existing) { await reply(`📭 لا يوجد مستخدم بالمعرّف <code>${esc(id)}</code>.`); return true; }
    await storeCall(env, { op: "delete", key: `user:${id}` });
    if (logAdminAction) await logAdminAction(env, userId, "userdelete", id);
    await reply(`🗑 حُذف المستخدم <code>${esc(id)}</code> من التخزين. ملاحظة: يبقى صفّه في الشيت كما هو.`);
    return true;
  }

  // ------------------------------------------------------------- usernotes
  async function runUserNote(env, chatId, args, userId) {
    const reply = replyTo(env, chatId);
    const parts = String(args ?? "").trim().split(/\s+/u);
    const id = parts.shift() ?? "";
    const note = parts.join(" ").trim();
    const all = await storeGet(env, "admin:usernotes", {});
    if (!/^\d+$/u.test(id)) { await reply("✏️ الاستخدام: /usernote <id> <النص> — امسحها بـ /usernote <id> حذف"); return true; }
    if (!note) {
      const current = all[id];
      await reply(current ? `📝 ملاحظة عن <code>${esc(id)}</code>:\n${esc(current.note)}\n<span>(${esc(current.at)})</span>` : `📭 لا ملاحظة عن <code>${esc(id)}</code>.`);
      return true;
    }
    if (note === "حذف" || note.toLowerCase() === "del") {
      delete all[id];
      await storePut(env, "admin:usernotes", all);
      await reply(`🗑 حُذفت ملاحظة <code>${esc(id)}</code>.`);
      return true;
    }
    all[id] = { note: note.slice(0, 400), by: String(userId), at: nowIso() };
    await storePut(env, "admin:usernotes", all);
    await reply(`✅ حفظت ملاحظة عن <code>${esc(id)}</code>.`);
    return true;
  }

  async function runUserNotes(env, chatId) {
    const reply = replyTo(env, chatId);
    const all = await storeGet(env, "admin:usernotes", {});
    const items = Object.entries(all);
    if (!items.length) { await reply("📭 لا ملاحظات على المستخدمين. أضف بـ /usernote <id> <النص>"); return true; }
    const lines = [`📝 <b>ملاحظات المستخدمين</b> (${fmt(items.length)})`, ""];
    for (const [id, item] of items.slice(-30).reverse()) lines.push(`• <code>${esc(id)}</code>: ${esc(item.note)}`);
    await reply(lines.join("\n"));
    return true;
  }

  // -------------------------------------------------------------- topwords
  async function runTopWords(env, chatId, args) {
    const reply = replyTo(env, chatId);
    const limit = Math.min(50, Math.max(1, Number(args) || 15));
    const report = await readAnalyticsReport(env);
    const lines = [`🔝 <b>أكثر ${limit} كلمة بحثًا</b>`, ""];
    if (!report.topWords.length) lines.push("لا توجد عمليات بحث مسجلة بعد.");
    report.topWords.slice(0, limit).forEach(([word, count], i) => lines.push(`${i + 1}. ${esc(word)} — <b>${fmt(count)}</b>`));
    lines.push("", `إجمالي البحث: ${fmt(report.searches)} • الأوامر: ${fmt(report.commands)} • Inline: ${fmt(report.inline)}`);
    await reply(lines.join("\n"));
    return true;
  }

  // ---------------------------------------------------------------- misses
  async function runMisses(env, chatId, args) {
    const reply = replyTo(env, chatId);
    const sub = String(args ?? "").trim();
    if (sub === "مسح" || sub === "clear") {
      if (clearMisses) await clearMisses(env);
      await reply("🧹 مُسح سجل الكلمات غير الموجودة.");
      return true;
    }
    if (flushMisses) await flushMisses(env);
    const items = (await readMisses(env)) ?? [];
    const lines = ["🕳 <b>كلمات بحث عنها المستخدمون ولم تُوجد</b>", ""];
    if (!items.length) lines.push("✅ لا يوجد — كل عمليات البحث أنتجت نتائج.");
    items.slice(0, 30).forEach(([word, count], i) => lines.push(`${i + 1}. ${esc(word)} — <b>${fmt(count)}</b>`));
    lines.push("", "💡 هذه أفضل قائمة لاقتراح كلمات جديدة للقاموس.", "للمسح: /misses مسح");
    await reply(lines.join("\n"));
    return true;
  }

  // ------------------------------------------------------------ dicthealth
  async function runDictHealth(env, chatId) {
    const reply = replyTo(env, chatId);
    const seen = new Map();
    let dup = 0, emptyCoptic = 0, noPron = 0, noMeaning = 0, noEnglish = 0, noGreek = 0, noOrigin = 0;
    const dupSamples = [];
    for (const record of records) {
      const coptic = String(record?.coptic ?? "").trim();
      if (!coptic) emptyCoptic += 1;
      const key = coptic.replace(/\s+/gu, "");
      if (key) {
        if (seen.has(key)) { dup += 1; if (dupSamples.length < 5) dupSamples.push(coptic); } else seen.set(key, true);
      }
      if (!String(record?.pronunciation ?? "").trim()) noPron += 1;
      if (!String(record?.meaning ?? "").trim()) noMeaning += 1;
      if (!String(record?.english ?? "").trim()) noEnglish += 1;
      if (!String(record?.greek ?? "").trim()) noGreek += 1;
      if (!String(record?.origin ?? "").trim()) noOrigin += 1;
    }
    const total = records.length;
    const pct = (value) => `${Math.round((value / Math.max(1, total)) * 1000) / 10}%`;
    const lines = [
      "🩺 <b>صحة القاموس</b>",
      `• السجلات: <b>${fmt(total)}</b>`,
      `• كلمات مكررة: <b>${fmt(dup)}</b>${dupSamples.length ? ` (مثال: ${esc(dupSamples.join(" / "))})` : ""}`,
      `• بلا كلمة قبطية: <b>${fmt(emptyCoptic)}</b>`,
      `• بلا نطق: <b>${fmt(noPron)}</b> (${pct(noPron)})`,
      `• بلا معنى عربي: <b>${fmt(noMeaning)}</b> (${pct(noMeaning)})`,
      `• بلا إنجليزي: <b>${fmt(noEnglish)}</b> (${pct(noEnglish)})`,
      `• بلا يوناني: <b>${fmt(noGreek)}</b> (${pct(noGreek)})`,
      `• بلا أصل: <b>${fmt(noOrigin)}</b> (${pct(noOrigin)})`,
      "",
      "تقارير مفصلة: /nopronounce • /noaudio • /duplicates • /fieldreport",
    ];
    await reply(lines.join("\n"));
    return true;
  }

  // ----------------------------------------------------------- fieldreport
  const DICT_FIELDS = ["coptic", "greek", "pronunciation", "english", "meaning", "kind", "origin", "translation_fr", "translation_de"];
  async function runFieldReport(env, chatId, args) {
    const reply = replyTo(env, chatId);
    const only = String(args ?? "").trim();
    const fields = only ? DICT_FIELDS.filter((f) => f === only) : DICT_FIELDS;
    if (!fields.length) { await reply(`✏️ الحقول المتاحة: ${DICT_FIELDS.join(", ")}`); return true; }
    const counts = Object.fromEntries(fields.map((f) => [f, 0]));
    for (const record of records) for (const field of fields) if (String(record?.[field] ?? "").trim()) counts[field] += 1;
    const total = Math.max(1, records.length);
    const lines = ["📋 <b>نسبة امتلاء حقول القاموس</b>", ""];
    for (const field of fields) {
      const filled = counts[field];
      const percent = Math.round((filled / total) * 1000) / 10;
      const bars = "█".repeat(Math.max(1, Math.round(percent / 10)));
      lines.push(`• <code>${field}</code> ${bars} <b>${percent}%</b> (${fmt(filled)}/${fmt(records.length)})`);
    }
    await reply(lines.join("\n"));
    return true;
  }

  // ------------------------------------------------------------ randomword
  async function runRandomWord(env, chatId) {
    const reply = replyTo(env, chatId);
    const record = records[Math.floor(Math.random() * records.length)];
    if (!record) { await reply("📭 القاموس فارغ."); return true; }
    const row = (label, value) => (String(value ?? "").trim() ? `${label}: ${esc(value)}` : null);
    const lines = [
      "🎲 <b>كلمة عشوائية</b>",
      "",
      ...["coptic", "greek", "pronunciation", "kind", "origin", "meaning", "english", "translation_fr", "translation_de"]
        .map((field) => row(`<b>${field}</b>`, record[field])).filter(Boolean),
      "",
      `<code>id: ${esc(record.id ?? "—")}</code>`,
    ];
    await reply(lines.join("\n"));
    return true;
  }

  // ------------------------------------------------------------ wordsearch
  async function runWordSearch(env, chatId, args) {
    const reply = replyTo(env, chatId);
    const query = String(args ?? "").trim();
    if (!query) { await reply("✏️ الاستخدام: /wordsearch <نص> — يبحث في كل الحقول ويعرض المطابقة مع رقم الصف."); return true; }
    const needle = query.toLowerCase();
    const hits = [];
    records.forEach((record, index) => {
      if (hits.length >= 20) return;
      const haystack = ["coptic", "greek", "pronunciation", "english", "meaning", "translation_fr", "translation_de"]
        .map((field) => String(record?.[field] ?? "").toLowerCase()).join(" ");
      if (haystack.includes(needle)) hits.push({ index, record });
    });
    if (!hits.length) { await reply(`📭 لا مطابقة لـ «${esc(query)}».`); return true; }
    const lines = [`🔎 <b>نتائج «${esc(query)}»</b> (${fmt(hits.length)}${hits.length >= 20 ? "+" : ""})`, ""];
    for (const { index, record } of hits) {
      lines.push(`• <code>${index}</code> <b>${esc(record.coptic)}</b> — ${esc(String(record.meaning ?? "").slice(0, 60))}`);
    }
    lines.push("", "للتعديل السريع: /wordset <رقم_الصف> <الحقل> <القيمة>");
    await reply(lines.join("\n"));
    return true;
  }

  // ------------------------------------------------------------ exportcsv
  async function runExportCsv(env, chatId) {
    const reply = replyTo(env, chatId);
    const header = ["row", ...DICT_FIELDS];
    const escapeCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const lines = [header.join(",")];
    records.forEach((record, index) => lines.push([index, ...DICT_FIELDS.map((field) => escapeCell(record?.[field]))].join(",")));
    const stamp = nowIso().slice(0, 10);
    const outcome = await sendTextFile(env, chatId, `dictionary-${stamp}.csv`, lines.join("\n"), `📦 القاموس CSV — ${fmt(records.length)} سجل.`, "text/csv");
    if (!outcome?.ok) await reply("❌ تعذّر إرسال الملف إلى Telegram.");
    return true;
  }

  // ----------------------------------------------------------- exportfull
  async function runExportFull(env, chatId) {
    const reply = replyTo(env, chatId);
    const [users, notes, banList, flags, state, audit, misses] = await Promise.all([
      allUsers(env),
      storeGet(env, "admin:usernotes", {}),
      bannedSet(env),
      storeGet(env, "admin:features", {}),
      storeGet(env, "user-sync:state", {}),
      storeGet(env, "admin:audit:actions", []),
      (async () => { if (flushMisses) await flushMisses(env); return (await readMisses(env)) ?? []; })(),
    ]);
    const stats = adminStatsOp ? await adminStatsOp() : {};
    const payload = {
      exportedAt: nowIso(),
      botVersion,
      counts: { records: records.length, ...stats },
      users: users.map(({ id, record }) => ({ id, ...record })),
      notes,
      bans: banList,
      featureFlags: flags,
      syncState: state,
      adminAudit: audit,
      unansweredSearches: misses.slice(0, 200).map(([word, count]) => ({ word, count })),
    };
    const stamp = nowIso().slice(0, 19).replaceAll(":", "-");
    const outcome = await sendTextFile(env, chatId, `full-backup-${stamp}.json`, JSON.stringify(payload, null, 2), `🗂 نسخة شاملة: ${fmt(payload.users.length)} مستخدم + الإعدادات والإحصاءات.`, "application/json");
    if (!outcome?.ok) await reply("❌ تعذّر إرسال الملف.");
    return true;
  }

  // -------------------------------------------------------------- banlist
  async function runBanList(env, chatId) {
    const reply = replyTo(env, chatId);
    const bans = await bannedSet(env);
    const items = Object.entries(bans);
    if (!items.length) { await reply("✅ لا يوجد محظورون."); return true; }
    const lines = [`🚫 <b>قائمة المحظورين</b> (${fmt(items.length)})`, ""];
    for (const [id, info] of items.slice(-40).reverse()) {
      lines.push(`• <code>${esc(id)}</code> — ${esc(info?.reason || "بلا سبب")} <span>(${esc(String(info?.at ?? "").slice(0, 10))})</span>`);
    }
    lines.push("", "للفك: /unban <id>");
    await reply(lines.join("\n"));
    return true;
  }

  // ---------------------------------------------------------------- report
  async function runReport(env, chatId) {
    const reply = replyTo(env, chatId);
    const [stats, analytics, errors, days, state, job, bans] = await Promise.all([
      adminStatsOp ? adminStatsOp() : {},
      readAnalyticsReport(env),
      readErrorLog(env),
      storeCall(env, { op: "usageReport", limit: 3 }).catch(() => ({ days: [] })),
      storeGet(env, "user-sync:state", {}),
      storeGet(env, "sync:job", null),
      bannedSet(env),
    ]);
    const usage = (days?.days ?? []).map((day) => `${esc(day.day)}: ${fmt(day.count)}`).join(" | ") || "—";
    const drive = await driveConfig(env).catch(() => null);
    await reply([
      "📊 <b>التقرير الإداري الشامل</b>",
      "",
      `📚 القاموس: <b>${fmt(records.length)}</b> كلمة | 🎙 تسجيلات: <b>${fmt(stats.voices)}</b>`,
      `👥 المستخدمون: <b>${fmt(stats.users)}</b> | 🚫 حظر: <b>${fmt(Object.keys(bans).length)}</b>`,
      `🔎 بحث: <b>${fmt(analytics.searches)}</b> | أوامر: <b>${fmt(analytics.commands)}</b> | Inline: <b>${fmt(analytics.inline)}</b>`,
      `🕒 طلبات آخر ٣ أيام: ${usage}`,
      `🔄 المزامنة: ${job ? (job.paused ? "متوقفة ⏸" : "تعمل ▶️") : "متوقفة"} | آخر خطأ: ${esc(state.lastError || "لا يوجد")}`,
      `☁️ Drive: ${drive ? "✅" : "❌"} | ⚠️ أخطاء مسجلة: <b>${fmt(errors.length)}</b>`,
      `⏱ مدة التشغيل: ${formatUptime(Date.now() - BOT_START_REF)}`,
    ].join("\n"));
    return true;
  }

  // -------------------------------------------------------------- schedule
  async function runSchedule(env, chatId, args) {
    const reply = replyTo(env, chatId);
    const text = String(args ?? "").trim();
    const match = /^(\d{1,4})\s+(.{2,1000})$/su.exec(text);
    if (!match) { await reply("✏️ الاستخدام: /schedule <عدد الدقائق> <النص>\nمثال: /schedule 30 تذكير: مراجعة كلمات الدرس."); return true; }
    const minutes = Number(match[1]);
    const body = match[2];
    const list = (await storeGet(env, SCHED_KEY, [])) ?? [];
    const item = { id: String(Date.now()).slice(-6), at: new Date(Date.now() + minutes * 60000).toISOString(), text: body, chatId: String(chatId) };
    list.push(item);
    await storePut(env, SCHED_KEY, list.slice(-50));
    await reply(`⏰ جُدولت الرسالة <code>#${esc(item.id)}</code> بعد ${minutes} دقيقة (${esc(item.at.slice(0, 16))} UTC).\nتُرسل عند أول نشاط للبوت بعد الموعد.`);
    return true;
  }

  async function runSchedules(env, chatId) {
    const reply = replyTo(env, chatId);
    const list = (await storeGet(env, SCHED_KEY, [])) ?? [];
    if (!list.length) { await reply("📭 لا رسائل مجدولة. أضف بـ /schedule <دقائق> <النص>"); return true; }
    const lines = ["⏰ <b>الرسائل المجدولة</b>", ""];
    for (const item of list) lines.push(`• <code>#${esc(item.id)}</code> ${esc(String(item.at).slice(0, 16))} → ${esc(String(item.text).slice(0, 70))}`);
    lines.push("", "للإلغاء: /unschedule <المعرّف> أو /unschedule all");
    await reply(lines.join("\n"));
    return true;
  }

  async function runUnschedule(env, chatId, args) {
    const reply = replyTo(env, chatId);
    const id = String(args ?? "").trim();
    const list = (await storeGet(env, SCHED_KEY, [])) ?? [];
    if (!id) { await reply("✏️ الاستخدام: /unschedule <المعرّف> | /unschedule all"); return true; }
    const next = id === "all" ? [] : list.filter((item) => item.id !== id);
    await storePut(env, SCHED_KEY, next);
    await reply(id === "all" ? "🧹 أُلغيت كل الرسائل المجدولة." : `🗑 أُلغيت الرسالة <code>${esc(id)}</code> (${list.length - next.length} محذوف).`);
    return true;
  }

  // Sends whatever is due. Called in the background on every update, so no cron is required.
  async function processSchedules(env) {
    if (!env.USERS) return 0;
    let list;
    try { list = (await storeGet(env, SCHED_KEY, [])) ?? []; } catch { return 0; }
    if (!list.length) return 0;
    const due = list.filter((item) => Date.parse(item.at) <= Date.now());
    if (!due.length) return 0;
    let sent = 0;
    for (const item of due) {
      const result = await telegram(env, "sendMessage", { chat_id: item.chatId, text: `⏰ ${item.text}`.slice(0, 4000) }).catch(() => null);
      if (result?.ok) sent += 1;
    }
    await storePut(env, SCHED_KEY, list.filter((item) => Date.parse(item.at) > Date.now()));
    return sent;
  }

  // --------------------------------------------------------------- cleanup
  async function runCleanup(env, chatId, args) {
    const reply = replyTo(env, chatId);
    const run = String(args ?? "").trim() === "run";
    const days = (await storeCall(env, { op: "usageReport", limit: 400 }).catch(() => ({ days: [] })))?.days ?? [];
    const cutoff = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const old = days.filter((day) => day.day < cutoff);
    if (!run) {
      await reply([
        "🧹 <b>تنظيف البيانات القديمة</b>",
        `• عدّادات استخدام أقدم من ٦٠ يومًا: <b>${fmt(old.length)}</b>`,
        "• سجل الأخطاء سيُقصّ إلى آخر ٢٠ عنصرًا.",
        "• سجل إجراءات الأدمن سيُقصّ إلى آخر ٥٠ عنصرًا.",
        "",
        "للتنفيذ: /cleanup run",
      ].join("\n"));
      return true;
    }
    let removed = 0;
    for (const day of old) {
      try { await storeCall(env, { op: "delete", key: `usage:${day.day}` }); removed += 1; } catch { /* ignore */ }
    }
    const errors = (await storeGet(env, "errors:recent", [])) ?? [];
    if (errors.length > 20) await storePut(env, "errors:recent", errors.slice(-20));
    const audit = (await storeGet(env, "admin:audit:actions", [])) ?? [];
    if (audit.length > 50) await storePut(env, "admin:audit:actions", audit.slice(0, 50));
    if (logAdminAction) await logAdminAction(env, "cleanup", "cleanup", `${removed} day counters`);
    await reply(`✅ تم التنظيف: حُذف ${fmt(removed)} عدّاد يومي، وقُصّت سجلات الأخطاء والإجراءات.`);
    return true;
  }

  // -------------------------------------------------------------- newhelp
  async function runNewHelp(env, chatId) {
    const reply = replyTo(env, chatId);
    const groups = [
      ["🔧 تشخيص ومراقبة", ["ping", "debug", "version", "limits", "cacheinfo", "report"]],
      ["🔄 مزامنة المستخدمين", ["syncstatus", "synctest", "syncusers", "syncreset", "synccancel"]],
      ["👥 إدارة المستخدمين", ["usercount", "growth", "inactive", "userlookup", "userinfo", "userdelete", "usernote", "usernotes"]],
      ["📖 القاموس والتحليلات", ["dicthealth", "fieldreport", "randomword", "wordsearch", "topwords", "misses", "exportcsv", "exportfull"]],
      ["🛡 الحظر والجدولة", ["banlist", "ban", "unban", "schedule", "schedules", "unschedule", "cleanup"]],
    ];
    const lines = ["🧰 <b>أوامر الأدمن الإضافية (جديدة)</b>", ""];
    for (const [title, names] of groups) lines.push(`<b>${title}</b>`, names.map((name) => `/${name}`).join(" • "), "");
    lines.push("كل الأوامر القديمة كما هي — هذه إضافات فوقها.");
    await reply(lines.join("\n"));
    return true;
  }

  const BOT_START_REF = globalThis.__copticBotStartedAt ?? Date.now();

  // name → { desc, run }
  const COMMANDS = {
    ping: { desc: "قياس زمن استجابة البوت", run: ({ env, chatId }) => runPing(env, chatId) },
    debug: { desc: "لقطة تشخيصية للبيئة والبيانات", run: ({ env, chatId }) => runDebug(env, chatId) },
    version: { desc: "إصدار البوت", run: ({ env, chatId }) => runVersion(env, chatId) },
    limits: { desc: "الحدود والإعدادات الحالية", run: ({ env, chatId }) => runLimits(env, chatId) },
    cacheinfo: { desc: "حالة الكاش الداخلي", run: ({ env, chatId }) => runCacheInfo(env, chatId) },
    report: { desc: "تقرير إداري شامل", run: ({ env, chatId }) => runReport(env, chatId) },
    syncstatus: { desc: "حالة مزامنة المستخدمين", run: ({ env, chatId }) => runSyncStatus(env, chatId) },
    synctest: { desc: "اختبار اتصال Google Sheets", run: ({ env, chatId, userId }) => runSyncTest(env, chatId, userId) },
    usercount: { desc: "إحصاء المستخدمين بتفصيل", run: ({ env, chatId }) => runUserCount(env, chatId) },
    growth: { desc: "نمو المستخدمين اليومي", run: ({ env, chatId }) => runGrowth(env, chatId) },
    inactive: { desc: "المستخدمون الخاملون", run: ({ env, chatId, args }) => runInactive(env, chatId, args) },
    userlookup: { desc: "بحث عن مستخدم", run: ({ env, chatId, args }) => runUserLookup(env, chatId, args) },
    userdelete: { desc: "حذف مستخدم من التخزين", run: ({ env, chatId, args, userId }) => runUserDelete(env, chatId, args, userId) },
    usernote: { desc: "ملاحظة عن مستخدم", run: ({ env, chatId, args, userId }) => runUserNote(env, chatId, args, userId) },
    usernotes: { desc: "كل ملاحظات المستخدمين", run: ({ env, chatId }) => runUserNotes(env, chatId) },
    topwords: { desc: "أكثر الكلمات بحثًا", run: ({ env, chatId, args }) => runTopWords(env, chatId, args) },
    misses: { desc: "كلمات بحث بلا نتائج", run: ({ env, chatId, args }) => runMisses(env, chatId, args) },
    dicthealth: { desc: "فحص صحة القاموس الشامل", run: ({ env, chatId }) => runDictHealth(env, chatId) },
    fieldreport: { desc: "نسبة امتلاء حقول القاموس", run: ({ env, chatId, args }) => runFieldReport(env, chatId, args) },
    randomword: { desc: "كلمة عشوائية بكل حقولها", run: ({ env, chatId }) => runRandomWord(env, chatId) },
    wordsearch: { desc: "بحث إداري متقدم في القاموس", run: ({ env, chatId, args }) => runWordSearch(env, chatId, args) },
    exportcsv: { desc: "تصدير القاموس CSV", run: ({ env, chatId }) => runExportCsv(env, chatId) },
    exportfull: { desc: "نسخة احتياطية شاملة", run: ({ env, chatId }) => runExportFull(env, chatId) },
    banlist: { desc: "قائمة المحظورين", run: ({ env, chatId }) => runBanList(env, chatId) },
    schedule: { desc: "جدولة رسالة", run: ({ env, chatId, args }) => runSchedule(env, chatId, args) },
    schedules: { desc: "الرسائل المجدولة", run: ({ env, chatId }) => runSchedules(env, chatId) },
    unschedule: { desc: "إلغاء رسالة مجدولة", run: ({ env, chatId, args }) => runUnschedule(env, chatId, args) },
    cleanup: { desc: "تنظيف البيانات القديمة", run: ({ env, chatId, args }) => runCleanup(env, chatId, args) },
    newhelp: { desc: "قائمة الأوامر الإضافية", run: ({ env, chatId }) => runNewHelp(env, chatId) },
  };

  function commandList() {
    return Object.entries(COMMANDS).map(([command, meta]) => ({ command, description: meta.desc }));
  }

  // Returns true when the message was one of the extra commands (so the caller stops).
  async function handle({ env, chatId, userId, text, raw }) {
    const source = String(raw ?? text ?? "").trim();
    if (!source.startsWith("/")) return false;
    const match = /^\/([a-zA-Z_]+)(?:@[^\s]+)?(?:\s+([\s\S]*))?$/u.exec(source);
    if (!match) return false;
    const name = match[1].toLowerCase();
    const args = (match[2] ?? "").trim();
    const entry = COMMANDS[name];
    if (!entry) return false;
    try {
      await entry.run({ env, chatId, userId, args, text: source });
    } catch (error) {
      await replyTo(env, chatId)(`❌ تعذّر تنفيذ /${esc(name)}: ${esc(error instanceof Error ? error.message : "خطأ غير معروف")}`);
    }
    return true;
  }

  return { handle, commands: COMMANDS, commandList, processSchedules };
}
