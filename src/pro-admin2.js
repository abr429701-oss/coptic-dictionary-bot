// src/pro-admin2.js — additional professional admin commands (batch 6).
// Self-contained: uses storeCall get/put/listprefix + telegram helpers only.
// Every command returns true from handle() when it consumes the message.
import records from "../data/dictionary.json" with { type: "json" };

const K = {
  lockdown: "lockdown", verifygate: "verifygate", captcha: "captcha",
  ratewarn: "ratewarn", logchannel: "logchannel", welcomemedia: "welcomemedia",
  leavemsg: "leavemsg", joinmsg: "joinmsg", menubuttons: "menubuttons",
  tags: "tags", donations: "donations", defaultlang: "defaultlang",
  adminpwd: "adminpwd", welcomesticker: "welcomesticker", bcstats: "broadcast:stats",
};

export function createProAdmin2({ telegram, escapeHtml, storeCall, getUser, saveUser, isAdmin, adminIds, logAdminAction, notifyAdmins, invalidateSettingsCache }) {
  async function doGet(key, fallback = null) {
    try { return (await storeCall({ op: "get", key })).value ?? fallback; } catch { return fallback; }
  }
  async function doPut(key, value) {
    try { await storeCall({ op: "put", key, value }); return true; } catch { return false; }
  }
  async function listPrefix(prefix, limit = 100) {
    try {
      const r = await storeCall({ op: "listprefix", key: prefix, limit });
      return Array.isArray(r?.items) ? r.items : (Array.isArray(r?.value) ? r.value : []);
    } catch { return []; }
  }
  const reply = (chatId, text, extra = {}) => telegram(null, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra }).catch(() => null);
  // telegram helper needs env; callers pass env through. We re-wrap here.
  const send = (env, chatId, text, extra = {}) => telegram(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra }).catch(() => null);

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const handlers = {
    // ---- Extra admin password gate (second factor alternative) ----
    async password(env, chatId, userId, arg) {
      if (!arg) { await send(env, chatId, "✏️ الاستخدام: /password <كلمة مرور جديدة> — تضيف بوابة كلمة مرور إضافية للأوامر الحساسة. أرسل /unlock <كلمة> لفتح جلسة 30 دقيقة. لحذفها: /password off"); return true; }
      if (arg === "off") { await doPut(K.adminpwd, null); await send(env, chatId, "✅ تم حذف كلمة المرور الإدارية."); await logAdminAction?.(env, userId, "password_removed"); return true; }
      const salt = crypto.getRandomValues(new Uint8Array(16)).join("");
      const hash = await sha256Hex(`${salt}:${arg}`);
      await doPut(K.adminpwd, { salt, hash });
      await send(env, chatId, "✅ تم تعيين كلمة المرور الإدارية. استخدم /unlock <كلمة> لفتح جلسة حساسة مدتها 30 دقيقة.");
      await logAdminAction?.(env, userId, "password_set");
      return true;
    },
    async unlock(env, chatId, userId, arg) {
      const pwd = await doGet(K.adminpwd, null);
      if (!pwd?.hash) { await send(env, chatId, "ℹ️ لم تُعيّن كلمة مرور إدارية بعد."); return true; }
      if (!arg) { await send(env, chatId, "✏️ الاستخدام: /unlock <كلمة المرور>"); return true; }
      const hash = await sha256Hex(`${pwd.salt}:${arg}`);
      if (hash !== pwd.hash) { await send(env, chatId, "❌ كلمة مرور خاطئة."); return true; }
      await doPut(`unlock:${userId}`, { until: Date.now() + 30 * 60 * 1000 });
      await send(env, chatId, "🔓 تم فتح الجلسة الإدارية لمدة 30 دقيقة.");
      return true;
    },
    async lockdown(env, chatId, userId, arg) {
      const parts = arg.split(/\s+/u);
      const mode = (parts[0] ?? "").toLowerCase();
      if (mode === "off") { await doPut(K.lockdown, { on: false }); invalidateSettingsCache?.(K.lockdown); await send(env, chatId, "✅ تم رفع الحظر الشامل (Lockdown). عاد البوت ليعمل بشكل طبيعي."); await logAdminAction?.(env, userId, "lockdown_off"); return true; }
      if (mode === "on" || mode === "") {
        const msg = parts.slice(mode ? 1 : 0).join(" ").trim() || "🔒 البوت متوقف حاليًا بشكل كامل (Lockdown). سيعود قريبًا.";
        await doPut(K.lockdown, { on: true, msg, at: Date.now() });
        invalidateSettingsCache?.(K.lockdown);
        await send(env, chatId, `🔒 تم تفعيل الحظر الشامل. جميع المستخدمين (عدا الأدمن) سيستلمون رسالة التوقف.\nللإلغاء: /lockdown off`);
        await logAdminAction?.(env, userId, "lockdown_on");
        return true;
      }
      await send(env, chatId, "✏️ الاستخدام: /lockdown on [رسالة]  أو  /lockdown off"); return true;
    },
    async purgeinactive(env, chatId, userId, arg) {
      const days = Number(arg) || 90;
      await send(env, chatId, `🗑 بدأ حذف المستخدمين غير النشطين منذ ${days} يومًا (في الخلفية)...`);
      try {
        const r = await storeCall({ op: "purge_inactive", days, adminChat: chatId });
        await send(env, chatId, `✅ اكتمل الحذف. ${r?.deleted ?? r?.count ?? "—"} مستخدمًا حُذف.`);
      } catch { await send(env, chatId, "⚠️ تعذّر تنفيذ الحذف عبر المخزن."); }
      await logAdminAction?.(env, userId, "purgeinactive", String(days));
      return true;
    },
    async massdm(env, chatId, userId, text) {
      const rest = text.slice("/massdm".length).trim();
      const sep = rest.indexOf(" ");
      if (sep < 0) { await send(env, chatId, "✏️ الاستخدام: /massdm <معرف1,معرف2,...> <الرسالة>"); return true; }
      const ids = rest.slice(0, sep).split(",").map((s) => s.trim()).filter(Boolean);
      const msg = rest.slice(sep + 1).trim();
      if (!ids.length || !msg) { await send(env, chatId, "✏️ أرسل قائمة معرفات مفصولة بفواصل ورسالة نصية."); return true; }
      let ok = 0, fail = 0;
      for (const id of ids) {
        const r = await telegram(env, "sendMessage", { chat_id: id, text: msg, parse_mode: "HTML" }).catch(() => null);
        if (r?.ok) ok += 1; else fail += 1;
      }
      await send(env, chatId, `📨 تم الإرسال: ${ok} نجاح، ${fail} فشل.`);
      await logAdminAction?.(env, userId, "massdm", `${ids.length} ids`);
      return true;
    },
    async logchannel(env, chatId, userId, arg) {
      if (!arg) { const cur = await doGet(K.logchannel, null); await send(env, chatId, cur ? `📢 قناة السجلات الحالية: <code>${escapeHtml(String(cur))}</code>\nلتغييرها: /logchannel <المعرف>` : "✏️ الاستخدام: /logchannel <معرف القناة/المجموعة> — تُرسل إليها نسخة من إجراءات الأدمن."); return true; }
      await doPut(K.logchannel, arg.trim());
      await send(env, chatId, `✅ تم تعيين قناة السجلات: <code>${escapeHtml(arg.trim())}</code>`);
      return true;
    },
    async verifygate(env, chatId, userId, arg) {
      const on = !/off|0|false/i.test(arg);
      await doPut(K.verifygate, { on });
      invalidateSettingsCache?.(K.verifygate);
      await send(env, chatId, on ? "✅ تم تفعيل بوابة التحقق: المستخدم الجديد يجب أن يضغط زر «أنا لست روبوت» قبل البحث." : "✅ تم إيقاف بوابة التحقق.");
      await logAdminAction?.(env, userId, "verifygate", on ? "on" : "off");
      return true;
    },
    async captcha(env, chatId, userId, arg) {
      const on = !/off|0|false/i.test(arg);
      await doPut(K.captcha, { on });
      await send(env, chatId, on ? "✅ تم تفعيل الكابتشا للأعضاء الجدد في المجموعات." : "✅ تم إيقاف الكابتشا.");
      return true;
    },
    async ratewarn(env, chatId, userId, arg) {
      const n = Number(arg);
      if (!(n > 0)) { await send(env, chatId, "✏️ الاستخدام: /ratewarn <عدد> — حد التحذير قبل كتم المستخدم مؤقتًا."); return true; }
      await doPut(K.ratewarn, { threshold: n });
      await send(env, chatId, `✅ تم تعيين حد التحذير: ${n} طلبات خلال النافذة.`);
      return true;
    },
    async welcomemedia(env, message, chatId, userId) {
      const media = message.reply_to_message?.photo?.slice(-1)[0]?.file_id || message.reply_to_message?.video?.file_id || message.reply_to_message?.animation?.file_id;
      const type = message.reply_to_message?.video ? "video" : message.reply_to_message?.animation ? "animation" : "photo";
      if (!media) { await send(env, chatId, "✏️ أعد الأمر ردًا على صورة/فيديو/gif تريد أن يرسلها البوت كترحيب."); return true; }
      await doPut(K.welcomemedia, { file_id: media, type, caption: String(message.reply_to_message?.caption ?? "").slice(0, 500) });
      await send(env, chatId, "✅ تم حفظ الوسائط الترحيبية. ستُرسل مع رسالة الترحيب للمستخدمين الجدد. للحذف: /welcomemedia clear");
      return true;
    },
    async leavemsg(env, chatId, userId, arg) {
      if (!arg) { await send(env, chatId, "✏️ الاستخدام: /leavemsg <نص رسالة المغادرة> — تُرسل عندما يغادر عضو المجموعة. للحذف: /leavemsg off"); return true; }
      if (arg === "off") { await doPut(K.leavemsg, null); await send(env, chatId, "✅ تم حذف رسالة المغادرة."); return true; }
      await doPut(K.leavemsg, arg.slice(0, 500));
      await send(env, chatId, "✅ تم حفظ رسالة المغادرة.");
      return true;
    },
    async joinmsg(env, chatId, userId, arg) {
      if (!arg) { await send(env, chatId, "✏️ الاستخدام: /setjoinmsg <نص رسالة الانضمام> — للحذف: /setjoinmsg off"); return true; }
      if (arg === "off") { await doPut(K.joinmsg, null); await send(env, chatId, "✅ تم حذف رسالة الانضمام."); return true; }
      await doPut(K.joinmsg, arg.slice(0, 500));
      await send(env, chatId, "✅ تم حفظ رسالة الانضمام.");
      return true;
    },
    async menueditor(env, chatId, userId, arg) {
      const parts = arg.split(/\s+/u);
      const cmd = (parts[0] ?? "").toLowerCase();
      const list = (await doGet(K.menubuttons, [])) || [];
      if (cmd === "list" || !cmd) { await send(env, chatId, list.length ? `🔘 الأزرار المخصصة (${list.length}):\n${list.map((b, i) => `${i + 1}. ${escapeHtml(b.text)} → ${escapeHtml(b.command)}`).join("\n")}\n\nعرضها: /menu\nحذف: /menueditor del <رقم>` : "🔘 لا توجد أزرار مخصصة. أضف: /menueditor add النص | /الأمر"); return true; }
      if (cmd === "clear") { await doPut(K.menubuttons, []); await send(env, chatId, "✅ تم مسح الأزرار المخصصة."); return true; }
      if (cmd === "del") { const i = Number(parts[1]) - 1; if (i >= 0 && list[i]) { list.splice(i, 1); await doPut(K.menubuttons, list); await send(env, chatId, "✅ تم حذف الزر."); } else await send(env, chatId, "❌ رقم غير صحيح."); return true; }
      if (cmd === "add") { const rest = parts.slice(1).join(" "); const sep = rest.indexOf("|"); if (sep < 0) { await send(env, chatId, "✏️ الصيغة: /menueditor add نص الزر | /الأمر"); return true; } const text = rest.slice(0, sep).trim(); const command = rest.slice(sep + 1).trim(); if (!text || !command) { await send(env, chatId, "✏️ نص الزر والأمر مطلوبان."); return true; } list.push({ text: text.slice(0, 40), command: command.slice(0, 60) }); await doPut(K.menubuttons, list.slice(-20)); await send(env, chatId, `✅ أُضيف الزر «${escapeHtml(text)}». عرض الكيبورد: /menu`); return true; }
      await send(env, chatId, "✏️ الأوامر: /menueditor add <نص> | <cmd> · list · del <n> · clear"); return true;
    },
    async segment(env, chatId, userId, arg) {
      const parts = arg.split(/\s+/u);
      const cmd = (parts[0] ?? "").toLowerCase();
      const tags = (await doGet(K.tags, {})) || {};
      if (cmd === "list" || !cmd) { const lines = Object.entries(tags).map(([tag, ids]) => `${escapeHtml(tag)}: ${ids.length} مستخدم`); await send(env, chatId, lines.length ? `🏷 الشرائح (${lines.length}):\n${lines.join("\n")}\n\nإرسال: /segment send <tag> <رسالة>` : "🏷 لا توجد شرائح. أضف: /segment add <معرف> <tag>"); return true; }
      if (cmd === "add") { const id = parts[1]; const tag = parts[2]; if (!id || !tag) { await send(env, chatId, "✏️ /segment add <معرف المستخدم> <اسم الشريحة>"); return true; } (tags[tag] ??= []); if (!tags[tag].includes(String(id))) tags[tag].push(String(id)); await doPut(K.tags, tags); await send(env, chatId, `✅ أُضيف المستخدم ${id} إلى شريحة «${escapeHtml(tag)}».`); return true; }
      if (cmd === "del") { const id = parts[1]; const tag = parts[2]; if (tags[tag]) { tags[tag] = tags[tag].filter((x) => x !== String(id)); if (!tags[tag].length) delete tags[tag]; await doPut(K.tags, tags); } await send(env, chatId, "✅ تمت الإزالة."); return true; }
      if (cmd === "send") { const tag = parts[1]; const msg = parts.slice(2).join(" ").trim(); if (!tag || !msg) { await send(env, chatId, "✏️ /segment send <اسم الشريحة> <الرسالة>"); return true; } const ids = tags[tag] ?? []; let ok = 0; for (const id of ids) { const r = await telegram(env, "sendMessage", { chat_id: id, text: msg, parse_mode: "HTML" }).catch(() => null); if (r?.ok) ok += 1; } await send(env, chatId, `📨 أُرسلت إلى ${ok}/${ids.length} في شريحة «${escapeHtml(tag)}».`); await logAdminAction?.(env, userId, "segment_send", tag); return true; }
      await send(env, chatId, "✏️ /segment add|del|list|send"); return true;
    },
    async toptags(env, chatId) {
      const tags = (await doGet(K.tags, {})) || {};
      const sorted = Object.entries(tags).sort((a, b) => b[1].length - a[1].length);
      await send(env, chatId, sorted.length ? `🏷 أعلى الشرائح عضوية:\n${sorted.slice(0, 15).map(([t, ids]) => `• ${escapeHtml(t)} — ${ids.length}`).join("\n")}` : "🏷 لا توجد شرائح بعد.");
      return true;
    },
    async templateslib(env, chatId) {
      try {
        const r = await storeCall({ op: "templates_get" });
        const tpls = r?.value ?? {};
        const keys = Object.keys(tpls);
        await send(env, chatId, keys.length ? `📚 مكتبة القوالب (${keys.length}):\n${keys.slice(0, 30).map((k) => `• ${escapeHtml(k)} — ${escapeHtml(String(tpls[k]?.text ?? tpls[k] ?? "").slice(0, 40))}`).join("\n")}\n\nإرسال قالب: /tplsend <اسم>` : "📚 المكتبة فارغة. احفظ قالبًا بـ /tplsave <اسم> <نص>.");
      } catch { await send(env, chatId, "⚠️ تعذّر قراءة القوالب."); }
      return true;
    },
    async setlang(env, chatId, userId, arg) {
      const lang = (arg ?? "").toLowerCase();
      if (!["ar", "en", "coptic"].includes(lang)) { await send(env, chatId, "✏️ الاستخدام: /setlang ar|en — لغة الواجهة الافتراضية للمستخدمين الجدد."); return true; }
      await doPut(K.defaultlang, lang);
      await send(env, chatId, `✅ تم تعيين اللغة الافتراضية: ${lang}`);
      return true;
    },
    async donation(env, chatId, userId, arg) {
      const parts = arg.split(/\s+/u);
      if ((parts[0] ?? "").toLowerCase() === "list") {
        const list = (await doGet(K.donations, [])) || [];
        const total = list.reduce((s, d) => s + Number(d.amount ?? 0), 0);
        await send(env, chatId, list.length ? `💝 التبرعات (${list.length}، الإجمالي ${total}):\n${list.slice(-15).map((d) => `• ${escapeHtml(String(d.amount))} — ${escapeHtml(String(d.note ?? "").slice(0, 40))} (${new Date(d.at).toISOString().slice(0, 10)})`).join("\n")}` : "💝 لا توجد تبرعات مسجلة. أضف: /donation add <المبلغ> <ملاحظة>");
        return true;
      }
      if ((parts[0] ?? "").toLowerCase() === "add") {
        const amount = Number(parts[1]);
        const note = parts.slice(2).join(" ").trim() || "تبرع";
        if (!(amount > 0)) { await send(env, chatId, "✏️ /donation add <المبلغ> <ملاحظة>"); return true; }
        const list = (await doGet(K.donations, [])) || [];
        list.push({ amount, note, at: Date.now() });
        await doPut(K.donations, list.slice(-200));
        await send(env, chatId, `✅ سُجّل تبرع ${amount}.`);
        return true;
      }
      await send(env, chatId, "✏️ /donation add <مبلغ> <ملاحظة>  أو  /donation list"); return true;
    },
    async setshortdesc(env, chatId, userId, arg) {
      if (!arg) { await send(env, chatId, "✏️ الاستخدام: /setshortdesc <الوصف القصير> (يظهر أسفل اسم البوت في ملفه التعريفي)."); return true; }
      const r = await telegram(env, "setMyShortDescription", { short_description: arg.slice(0, 120) }).catch(() => null);
      await send(env, chatId, r?.ok ? "✅ تم تحديث الوصف القصير." : "⚠️ لم يتم التحديث.");
      return true;
    },
    async webhook(env, chatId) {
      const r = await telegram(env, "getWebhookInfo", {}).catch(() => null);
      const w = r?.result ?? {};
      await send(env, chatId, `🔗 <b>Webhook</b>\nURL: <code>${escapeHtml(String(w.url ?? "—"))}</code>\nPending: ${w.pending_update_count ?? 0}\nLast error: ${escapeHtml(String(w.last_error_message ?? "—"))}\nIP: <code>${escapeHtml(String(w.ip_address ?? "—"))}</code>\nMax connections: ${w.max_connections ?? "—"}`);
      return true;
    },
    async envcheck(env, chatId) {
      const keys = ["TELEGRAM_BOT_TOKEN", "WEBHOOK_SECRET", "USERS", "ASSETS", "SHEET_URL", "DRIVE_FOLDER", "VOICE_REPEATS", "ADMIN_IDS"];
      const lines = keys.map((k) => { const v = env[k]; const present = v !== undefined && v !== null && v !== ""; return `${present ? "✅" : "⬜"} ${k}${present && typeof v !== "object" ? " (مضبوط)" : ""}`; });
      await send(env, chatId, `🧪 فحص متغيرات البيئة (بدون طباعة أي قيم):\n${lines.join("\n")}`);
      return true;
    },
    async dostat(env, chatId) {
      try {
        const s = await storeCall({ op: "adminStats" });
        await send(env, chatId, `💾 <b>إحصائيات المخزن الدائم</b>\n${Object.entries(s ?? {}).slice(0, 20).map(([k, v]) => `• ${escapeHtml(k)}: ${escapeHtml(String(v))}`).join("\n")}`);
      } catch { await send(env, chatId, "⚠️ تعذّر جلب إحصائيات المخزن."); }
      return true;
    },
    async bottest(env, chatId, userId) {
      await send(env, chatId, `🧪 رسالة اختبار من البوت.\nالوقت: ${new Date().toISOString()}\nمعرفك: <code>${escapeHtml(String(userId))}</code>\nالقاموس: ${records.length.toLocaleString("en-US")} مدخل.`);
      return true;
    },
    async dictversion(env, chatId) {
      await send(env, chatId, `📚 <b>إصدار القاموس</b>\nالمدخلات: ${records.length.toLocaleString("en-US")}\nأول معرف: ${escapeHtml(String(records[0]?.id ?? "—"))}\nآخر معرف: ${escapeHtml(String(records[records.length - 1]?.id ?? "—"))}\nحقل الأصل: ${new Set(records.map((r) => String(r.origin ?? "").trim()).filter(Boolean)).size} تصنيف`);
      return true;
    },
    async sessionlist(env, chatId) {
      const items = await listPrefix("user:", 100);
      const active = items.filter((it) => { const r = it.record ?? it.value ?? {}; return r.adminFlow || r.awaitingName || r.awaitingContact || r.bc; }).slice(0, 30);
      await send(env, chatId, active.length ? `⏳ الجلسات/التدفقات النشطة (${active.length} من آخر 100 مستخدم):\n${active.map((it) => `• <code>${escapeHtml(String(it.id ?? it.key ?? "?"))}</code> — ${it.record?.adminFlow?.kind || it.record?.awaitingName ? "awaitingName" : it.record?.awaitingContact ? "awaitingContact" : it.record?.bc ? "broadcast" : "flow"}`).join("\n")}\n\nإنهاء جلسة: /kill <معرف>` : "⏳ لا توجد جلسات نشطة (من آخر 100 مستخدم مسجّل).");
      return true;
    },
    async kill(env, chatId, userId, arg) {
      const id = (arg ?? "").trim();
      if (!id) { await send(env, chatId, "✏️ الاستخدام: /kill <معرف المستخدم> — ينهي أي تدفق معلّق (بث، انتظار اسم، رد...)."); return true; }
      const u = (await getUser(env, id)) ?? {};
      await saveUser(env, id, { ...u, adminFlow: undefined, awaitingName: undefined, awaitingContact: undefined, bc: undefined });
      await send(env, chatId, `✅ تم إنهاء الجلسات المعلّقة للمستخدم <code>${escapeHtml(id)}</code>.`);
      await logAdminAction?.(env, userId, "kill_session", id);
      return true;
    },
    async resetsessions(env, chatId, userId) {
      const items = await listPrefix("user:", 100);
      let n = 0;
      for (const it of items) {
        const id = it.id ?? String(it.key ?? "").replace(/^user:/u, "");
        const r = it.record ?? it.value ?? {};
        if (r.adminFlow || r.awaitingName || r.awaitingContact || r.bc) { await saveUser(env, id, { ...r, adminFlow: undefined, awaitingName: undefined, awaitingContact: undefined, bc: undefined }); n += 1; }
      }
      await send(env, chatId, `✅ تم مسح ${n} جلسة معلّقة (من آخر 100 مستخدم).`);
      await logAdminAction?.(env, userId, "resetsessions", String(n));
      return true;
    },
    async welcomesticker(env, message, chatId) {
      const fileId = message.reply_to_message?.sticker?.file_id;
      if (!fileId) { await send(env, chatId, "✏️ أعد الأمر ردًا على ستيكر ليُرسل مع الترحيب. للحذف: /welcomesticker clear"); return true; }
      await doPut(K.welcomesticker, fileId);
      await send(env, chatId, "✅ تم حفظ الستيكر الترحيبي.");
      return true;
    },
    async broadcaststats(env, chatId) {
      const s = await doGet(K.bcstats, null);
      if (!s) { await send(env, chatId, "📊 لا توجد إحصائيات بث محفوظة بعد. سيُحفظ ملخص آخر بث تلقائيًا."); return true; }
      await send(env, chatId, `📊 <b>آخر بث</b> (${new Date(s.at ?? 0).toISOString().slice(0, 16)} UTC)\nالمستلمون: ${s.total ?? "—"}\nنجاح: ${s.ok ?? "—"}\nفشل/محظور: ${s.fail ?? "—"}\nالمدة: ${s.durationSec ?? "—"} ثانية`);
      return true;
    },
  };

  // Menu command shows custom buttons (self-contained reply keyboard).
  async function showMenu(env, chatId) {
    const list = (await doGet(K.menubuttons, [])) || [];
    if (!list.length) { await send(env, chatId, "🔘 لا توجد أزرار مخصصة. أضفها بـ /menueditor add <نص> | <cmd>"); return true; }
    const keyboard = [list.map((b) => ({ text: b.text }))];
    await telegram(env, "sendMessage", { chat_id: chatId, text: "🔘 القائمة المخصصة:", reply_markup: { keyboard, resize_keyboard: true, one_time_keyboard: true } }).catch(() => null);
    return true;
  }

  async function handleCallback({ env, callback }) {
    const data = String(callback.data ?? "");
    if (data === "pa2|verify") {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id }).catch(() => null);
      const userId = callback.from?.id;
      const u = (await getUser(env, userId)) ?? {};
      await saveUser(env, userId, { ...u, verified: true, verifiedAt: new Date().toISOString() });
      await telegram(env, "sendMessage", { chat_id: callback.message?.chat?.id, text: "✅ تم التحقق! يمكنك الآن البحث في القاموس — اكتب أي كلمة." }).catch(() => null);
      return true;
    }
    return false;
  }

  async function handle({ env, chatId, userId, text, message }) {
    if (!isAdmin(env, userId)) return false;
    const cmd = text.split(/\s/u)[0]?.split("@")[0] ?? "";
    const arg = text.slice(cmd.length).trim();
    switch (cmd) {
      case "/password": return handlers.password(env, chatId, userId, arg);
      case "/unlock": return handlers.unlock(env, chatId, userId, arg);
      case "/lockdown": return handlers.lockdown(env, chatId, userId, arg);
      case "/purgeinactive": return handlers.purgeinactive(env, chatId, userId, arg);
      case "/massdm": return handlers.massdm(env, chatId, userId, text);
      case "/logchannel": return handlers.logchannel(env, chatId, userId, arg);
      case "/verifygate": return handlers.verifygate(env, chatId, userId, arg);
      case "/captcha": return handlers.captcha(env, chatId, userId, arg);
      case "/ratewarn": return handlers.ratewarn(env, chatId, userId, arg);
      case "/welcomemedia": return arg === "clear" ? (await doPut(K.welcomemedia, null), send(env, chatId, "✅ تم حذف الوسائط الترحيبية."), true) : handlers.welcomemedia(env, message, chatId, userId);
      case "/leavemsg": return handlers.leavemsg(env, chatId, userId, arg);
      case "/setjoinmsg": return handlers.joinmsg(env, chatId, userId, arg);
      case "/menueditor": return handlers.menueditor(env, chatId, userId, arg);
      case "/menu": return showMenu(env, chatId);
      case "/segment": return handlers.segment(env, chatId, userId, arg);
      case "/toptags": return handlers.toptags(env, chatId);
      case "/templateslib": return handlers.templateslib(env, chatId);
      case "/setlang": return handlers.setlang(env, chatId, userId, arg);
      case "/donation": return handlers.donation(env, chatId, userId, arg);
      case "/setshortdesc": return handlers.setshortdesc(env, chatId, userId, arg);
      case "/webhook": return handlers.webhook(env, chatId);
      case "/envcheck": return handlers.envcheck(env, chatId);
      case "/dostat": return handlers.dostat(env, chatId);
      case "/bottest": return handlers.bottest(env, chatId, userId);
      case "/dictversion": return handlers.dictversion(env, chatId);
      case "/sessionlist": return handlers.sessionlist(env, chatId);
      case "/kill": return handlers.kill(env, chatId, userId, arg);
      case "/resetsessions": return handlers.resetsessions(env, chatId, userId);
      case "/welcomesticker": return arg === "clear" ? (await doPut(K.welcomesticker, null), send(env, chatId, "✅ تم حذف الستيكر الترحيبي."), true) : handlers.welcomesticker(env, message, chatId);
      case "/broadcaststats": return handlers.broadcaststats(env, chatId);
      default: return false;
    }
  }

  return { handle, handleCallback, keys: K };
}
