// src/pro-user2.js — additional user-facing features (batch 6).
// Self-contained: bundled dictionary data + DO user record + telegram only.
import records from "../data/dictionary.json" with { type: "json" };
import audioManifest from "../data/audio-manifest.json" with { type: "json" };
import { quickLookup } from "./features.js";

const COPTIC_TO_LATIN = { "ⲁ":"a","ⲃ":"v","ⲅ":"g","ⲇ":"d","ⲉ":"e","ⲋ":"s","ⲍ":"z","ⲏ":"ē","ⲑ":"th","ⲓ":"i","ⲕ":"k","ⲗ":"l","ⲙ":"m","ⲛ":"n","ⲝ":"x","ⲟ":"o","ⲡ":"p","ⲣ":"r","ⲥ":"s","ⲧ":"t","ⲩ":"u","ⲫ":"ph","ⲭ":"kh","ⲯ":"ps","ⲱ":"ō","ϣ":"š","ϥ":"f","ϧ":"ḫ","ϩ":"h","ϫ":"j","ϭ":"č","ϯ":"ti","ⳉ":"ḫ" };
const COPTIC_NUMERALS = { 1:"ⲁ",2:"ⲃ",3:"ⲅ",4:"ⲇ",5:"ⲉ",6:"ⲋ",7:"ⲍ",8:"ⲏ",9:"ⲑ",10:"ⲓ",20:"ⲕ",30:"ⲗ",40:"ⲙ",50:"ⲛ",60:"ⲝ",70:"ⲟ",80:"ⲡ",90:"ⲣ",100:"ⲥ",200:"ⲧ",300:"ⲩ",400:"ⲫ",500:"ⲭ",600:"ⲯ",700:"ⲱ",800:"ϣ",900:"ϥ",1000:"ϩ",2000:"ϫ",3000:"ϭ",4000:"ϯ",5000:"ⳉ",6000:"Ⳉ",7000:"Ⳋ",8000:"ⳋ",9000:"Ⳍ" };

function escapeHtml(value) { return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function stripMarks(value) { return String(value ?? "").replace(/[\u0300-\u036f\u064b-\u065f\u0670\u06d6-\u06ed]/gu,"").replace(/`/gu,"").replace(/\s*\([^)]*\)/gu,"").replace(/\s+/gu," ").trim(); }

const GAME_TTL = 15 * 60 * 1000;
const flashState = new Map(); // userId -> { cards, index, revealed }
const quiz2State = new Map(); // userId -> { answer, options, word }
const hangmanState = new Map(); // userId -> { word, masked, wrong, hint }

export function createProUser2({ telegram, storeCall, getUser, saveUser, isAdmin, notifyAdmins, sendTextFile }) {
  async function doGet(key, fallback = null) { try { return (await storeCall({ op: "get", key })).value ?? fallback; } catch { return fallback; } }
  async function doPut(key, value) { try { await storeCall({ op: "put", key, value }); return true; } catch { return false; } }
  const send = (env, chatId, text, extra = {}) => telegram(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra }).catch(() => null);

  function wodOfDay(dayOffset = 0) {
    const day = Math.floor(Date.now() / 86400000) + dayOffset;
    return records[((day % records.length) + records.length) % records.length];
  }
  function transliterate(coptic) {
    return [...stripMarks(coptic)].map((c) => COPTIC_TO_LATIN[c] ?? c).join("");
  }
  function copticNumeral(n) {
    const num = Math.max(0, Math.min(99999, Math.floor(Number(n) || 0)));
    if (num === 0) return "ⲟⲩ (صفر)";
    let out = "";
    let rem = num;
    const units = [1000, 100, 10, 1];
    for (const u of units) {
      const d = Math.floor(rem / u);
      if (d > 0) { out += COPTIC_NUMERALS[d * u] ?? ""; rem -= d * u; }
    }
    return out || "—";
  }

  const handlers = {
    async subscribe(env, chatId, userId, on) {
      const u = (await getUser(env, userId)) ?? {};
      await saveUser(env, userId, { ...u, wodSub: on });
      await send(env, chatId, on ? "🔔 تم اشتراكك في كلمة اليوم. ستستلمها تلقائيًا." : "🔕 تم إلغاء اشتراكك في كلمة اليوم.");
      return true;
    },
    async rate(env, chatId, userId, arg) {
      const parts = arg.split(/\s+/u);
      const stars = Number(parts[parts.length - 1]);
      const word = parts.slice(0, -1).join(" ").trim();
      if (!word || !(stars >= 1 && stars <= 5)) { await send(env, chatId, "✏️ الاستخدام: /rate <الكلمة> <تقييم من 1 إلى 5>\nمثال: /rate ⲁⲛⲁⲩ 5"); return true; }
      const key = `ratings:${stripMarks(word).toLowerCase().slice(0, 60)}`;
      const cur = (await doGet(key, { sum: 0, count: 0 })) || { sum: 0, count: 0 };
      cur.sum += stars; cur.count += 1;
      await doPut(key, cur);
      await send(env, chatId, `⭐ شكرًا لتقييمك (${stars}/5). متوسط تقييم «${escapeHtml(word.slice(0, 40))}» الآن: ${(cur.sum / cur.count).toFixed(1)} من ${cur.count} تقييم.`);
      return true;
    },
    async flashcards(env, chatId, userId) {
      const pool = records.filter((r) => String(r.pronunciation ?? "").trim() && String(r.meaning ?? "").trim());
      const cards = [];
      const used = new Set();
      while (cards.length < 10 && used.size < pool.length) { const i = Math.floor(Math.random() * pool.length); if (used.has(i)) continue; used.add(i); cards.push(pool[i]); }
      flashState.set(String(userId), { cards, index: 0, revealed: false, at: Date.now() });
      const c = cards[0];
      await telegram(env, "sendMessage", { chat_id: chatId, text: `🃏 <b>بطاقة 1/${cards.length}</b>\n\n🔤 <b>${escapeHtml(stripMarks(c.coptic))}</b> [${escapeHtml(String(c.pronunciation ?? "").trim())}]\n\nاضغط «إظهار المعنى» لرؤية الترجمة.`, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "👁 إظهار المعنى", callback_data: "pu2|fc|show" }, { text: "⏭ التالية", callback_data: "pu2|fc|next" }], [{ text: "⏹ إنهاء", callback_data: "pu2|fc|stop" }]] } }).catch(() => null);
      return true;
    },
    async achievements(env, chatId, userId) {
      const u = (await getUser(env, userId)) ?? {};
      const favs = Array.isArray(u.favorites) ? u.favorites.length : 0;
      const searches = Number(u.searchCount ?? u.gamify?.points ?? 0);
      const streak = Number(u.gamify?.streak ?? u.streak ?? 0);
      const badges = [];
      if (searches >= 1) badges.push("🌱 مبتدئ — أول بحث");
      if (searches >= 50) badges.push("📚 طالب — 50 بحث");
      if (searches >= 500) badges.push("🎓 باحث — 500 بحث");
      if (favs >= 5) badges.push("⭐ جامع — 5 كلمات مفضلة");
      if (streak >= 3) badges.push(`🔥 متواصل — سلسلة ${streak} أيام`);
      if (u.registeredAt) badges.push("✅ مسجّل — أكمل التسجيل");
      if (!badges.length) badges.push("ابحث عن كلمات واحفظ مفضلاتك لكسب إنجازات!");
      await send(env, chatId, `🏆 <b>إنجازاتك</b>\n\n${badges.map((b) => `• ${b}`).join("\n")}\n\nإحصائيات: ${searches} بحث · ${favs} مفضلة · سلسلة ${streak} أيام`);
      return true;
    },
    async streak(env, chatId, userId) {
      const u = (await getUser(env, userId)) ?? {};
      const s = Number(u.gamify?.streak ?? u.streak ?? 0);
      await send(env, chatId, s > 0 ? `🔥 سلسلتك الحالية: <b>${s}</b> يومًا متتاليًا من البحث. واصل!` : "🌱 ليس لديك سلسلة نشطة بعد. ابحث عن كلمة اليوم لتبدأ سلسلة.");
      return true;
    },
    async setlang(env, chatId, userId, arg) {
      const lang = (arg ?? "").toLowerCase();
      if (!["ar", "en", "coptic"].includes(lang)) { await send(env, chatId, "✏️ الاستخدام: /lang ar — أو /lang en — لتعيين لغة واجهتك."); return true; }
      const u = (await getUser(env, userId)) ?? {};
      await saveUser(env, userId, { ...u, lang });
      await send(env, chatId, `✅ تم تعيين لغتك: ${lang}. (تُطبّق تدريجيًا على الرسائل الأساسية.)`);
      return true;
    },
    async report(env, chatId, userId, arg, label) {
      if (!arg) { await send(env, chatId, `✏️ اكتب ${label === "bug" ? "وصف المشكلة" : "بلاغك"} بعد الأمر، مثل: /${label === "bug" ? "bug" : "report"} النص.`); return true; }
      await notifyAdmins?.(env, `🚨 ${label === "bug" ? "بلاغ خطأ" : "إبلاغ"} من <code>${escapeHtml(String(userId))}</code>:\n${escapeHtml(arg.slice(0, 800))}`);
      await send(env, chatId, "✅ تم استلام بلاغك وسيُراجعه فريق الإدارة. شكرًا!");
      return true;
    },
    async daily(env, chatId, userId) {
      const u = (await getUser(env, userId)) ?? {};
      const today = new Date().toISOString().slice(0, 10);
      const w = wodOfDay();
      await send(env, chatId, `📅 <b>ملخصك اليومي</b> (${today})\n\nكلمة اليوم: <b>${escapeHtml(stripMarks(w.coptic))}</b> — ${escapeHtml(String(w.meaning ?? "").split(/[،,]/u)[0].trim().slice(0, 60))}\nنقاطك: ${Number(u.gamify?.points ?? 0)}\nمفضلتك: ${Array.isArray(u.favorites) ? u.favorites.length : 0}\nابحث عن كلمة جديدة اليوم للحفاظ على سلسلتك!`);
      return true;
    },
    async compare(env, chatId, arg) {
      const parts = arg.split(/\s*[,،\-]\s*|\s+/u).filter(Boolean);
      if (parts.length < 2) { await send(env, chatId, "✏️ الاستخدام: /compare <كلمة1> <كلمة2> — تقارن مدخلين جنبًا إلى جنب."); return true; }
      const a = quickLookup(parts[0]); const b = quickLookup(parts[1]);
      if (!a || !b) { await send(env, chatId, `❌ لم أجد ${!a ? `«${escapeHtml(parts[0])}»` : ""}${!a && !b ? " و" : ""}${!b ? `«${escapeHtml(parts[1])}»` : ""} في القاموس.`); return true; }
      const row = (label, va, vb) => `${label}:\n  ① ${escapeHtml(String(va ?? "—").slice(0, 60))}\n  ② ${escapeHtml(String(vb ?? "—").slice(0, 60))}`;
      await send(env, chatId, `⚖️ <b>مقارنة</b>\n① ${escapeHtml(stripMarks(a.coptic))}\n② ${escapeHtml(stripMarks(b.coptic))}\n\n${row("🇪🇬 عربي", a.meaning, b.meaning)}\n${row("🇬🇧 إنجليزي", a.english, b.english)}\n${row("🏛️ أصل", a.origin, b.origin)}\n${row("📦 نوع", a.kind, b.kind)}`);
      return true;
    },
    async etymology(env, chatId, arg) {
      const hit = quickLookup(arg);
      if (!hit) { await send(env, chatId, `❌ لم أجد «${escapeHtml(arg?.slice(0, 40) ?? "")}».`); return true; }
      const origin = String(hit.origin ?? "").trim() || "غير محدد";
      const same = records.filter((r) => String(r.origin ?? "").trim() === origin).length;
      await send(env, chatId, `🏛️ <b>أصل الكلمة</b> «${escapeHtml(stripMarks(hit.coptic))}»\n\nالأصل: <b>${escapeHtml(origin)}</b>\nاليوناني: ${escapeHtml(String(hit.greek ?? "—").slice(0, 80))}\nالنوع: ${escapeHtml(String(hit.kind ?? "—"))}\nكلمات أخرى بنفس الأصل في القاموس: ${same.toLocaleString("en-US")}`);
      return true;
    },
    async examples(env, chatId, arg) {
      const hit = quickLookup(arg);
      if (!hit) { await send(env, chatId, `❌ لم أجد «${escapeHtml(arg?.slice(0, 40) ?? "")}».`); return true; }
      const kind = String(hit.kind ?? "").trim();
      const ex = records.filter((r) => String(r.kind ?? "").trim() === kind && String(r.id) !== String(hit.id)).slice(0, 6);
      await send(env, chatId, ex.length ? `📝 كلمات من نفس النوع (${escapeHtml(kind || "عام")}) كأمثلة:\n${ex.map((r) => `• <b>${escapeHtml(stripMarks(r.coptic))}</b> — ${escapeHtml(String(r.meaning ?? "").split(/[،,]/u)[0].trim().slice(0, 50))}`).join("\n")}` : "📝 لا توجد أمثلة أخرى من نفس النوع.");
      return true;
    },
    async wod(env, chatId) {
      const w = wodOfDay();
      const hasAudio = Boolean(audioManifest[w.id] || audioManifest[String(w.id)]);
      await send(env, chatId, `🌟 <b>كلمة اليوم</b>\n\n🔤 <b>${escapeHtml(stripMarks(w.coptic))}</b>${w.pronunciation ? ` [${escapeHtml(String(w.pronunciation).trim())}]` : ""}\n🇪🇬 ${escapeHtml(String(w.meaning ?? "").slice(0, 120))}\n🇬🇧 ${escapeHtml(String(w.english ?? "—").slice(0, 80))}\n🏛️ الأصل: ${escapeHtml(String(w.origin ?? "—"))}${hasAudio ? "\n🔊 لها تسجيل صوتي — ابحث عنها لسماعه." : ""}\n\nللاشتراك اليومي: /subscribe`);
      return true;
    },
    async pronounce(env, chatId, arg) {
      const hit = quickLookup(arg);
      if (!hit) { await send(env, chatId, `❌ لم أجد «${escapeHtml(arg?.slice(0, 40) ?? "")}».`); return true; }
      const hasAudio = Boolean(audioManifest[hit.id] || audioManifest[String(hit.id)]);
      await send(env, chatId, `🔊 <b>النطق</b>: ${escapeHtml(stripMarks(hit.coptic))}\n\nالنطق المكتوب: ${escapeHtml(String(hit.pronunciation ?? "غير متوفر").trim())}\nالنقل الصوتي (باللاتيني): ${escapeHtml(transliterate(hit.coptic))}\nتسجيل صوتي: ${hasAudio ? "✅ متوفر — ابحث عن الكلمة لسماعها." : "⬜ غير متوفر حاليًا."}`);
      return true;
    },
    async quiz2(env, chatId, userId) {
      const pool = records.filter((r) => String(r.meaning ?? "").trim() && stripMarks(r.coptic).length >= 3);
      const answer = pool[Math.floor(Math.random() * pool.length)];
      const options = [answer];
      const used = new Set([String(answer.id)]);
      while (options.length < 4) { const r = pool[Math.floor(Math.random() * pool.length)]; if (used.has(String(r.id))) continue; used.add(String(r.id)); options.push(r); }
      options.sort(() => Math.random() - 0.5);
      quiz2State.set(String(userId), { answerId: String(answer.id), at: Date.now() });
      await telegram(env, "sendMessage", { chat_id: chatId, text: `🧠 <b>اختبار النوع الثاني</b>\n\nما معنى الكلمة: <b>${escapeHtml(stripMarks(answer.coptic))}</b>؟\nاختر إجابة من الأزرار.`, parse_mode: "HTML", reply_markup: { inline_keyboard: options.map((o, i) => [{ text: String(o.meaning ?? "").split(/[،,]/u)[0].trim().slice(0, 40) || `الخيار ${i + 1}`, callback_data: `pu2|q2|${o.id}` }]) } }).catch(() => null);
      return true;
    },
    async hangman(env, chatId, userId) {
      const pool = records.filter((r) => { const b = stripMarks(r.coptic); return b.length >= 4 && b.length <= 8 && /^[\u2C80-\u2CFF\s]+$/u.test(b); });
      const word = pool[Math.floor(Math.random() * pool.length)];
      const bare = stripMarks(word.coptic).replace(/\s+/gu, "");
      hangmanState.set(String(userId), { word: bare, hint: String(word.meaning ?? "").split(/[،,]/u)[0].trim().slice(0, 40), wrong: 0, guessed: new Set(), at: Date.now() });
      await send(env, chatId, `🎯 <b>لعبة الشنق (الكلمة القبطية)</b>\n\nالكلمة: ${"◻️".repeat(bare.length)}\nالتلميح: ${escapeHtml(hangmanState.get(String(userId)).hint)}\nالحرف المقبول: حرف قبطي واحد.\nالغالب: /hangman stop`);
      return true;
    },
    async exportmydata(env, chatId, userId) {
      const u = (await getUser(env, userId)) ?? {};
      const safe = { ...u }; delete safe._internal;
      const json = JSON.stringify(safe, null, 2);
      if (sendTextFile) { await sendTextFile(env, chatId, `my-data-${userId}.json`, json, "📦 بياناتك الشخصية وفق طلبك (GDPR).", "application/json"); }
      else { await send(env, chatId, "⚠️ تعذّر إرسال الملف حاليًا."); }
      return true;
    },
    async deleteme(env, chatId, userId, arg) {
      if (arg !== "confirm") { await send(env, chatId, "⚠️ <b>حذف حسابك</b>: سيتم مسح اسمك وسجلك وبياناتك من البوت نهائيًا (لا يمكن التراجع).\nلتأكيد الحذف أرسل: /deleteme confirm\nللإلغاء: تجاهل الرسالة."); return true; }
      const u = (await getUser(env, userId)) ?? {};
      await saveUser(env, userId, { deleted: true, deletedAt: new Date().toISOString(), name: undefined, favorites: [], history: [], lang: undefined, wodSub: false });
      await send(env, chatId, "🗑 تم حذف حسابك وبياناتك. يمكنك إعادة التسجيل في أي وقت بـ /start.");
      await notifyAdmins?.(env, `🗑 مستخدم <code>${escapeHtml(String(userId))}</code> حذف حسابه (طلب GDPR).`);
      return true;
    },
    async donate(env, chatId) {
      await send(env, chatId, "💝 <b>ادعم القاموس القبطي</b>\n\nهذا البوت مشروع تعليمي مجاني مفتوح المصدر. إذا أعجبك، يمكنك دعمه:\n• مشاركة البوت مع الأصدقاء (@ + اسم البوت)\n• اقتراح كلمات ناقصة عبر /suggest\n• تسجيل نطق الكلمات (تواصل مع الإدارة عبر /contact)\n\nكل مساعدة تساعد في إثراء القاموس للجميع. شكرًا!");
      return true;
    },
    async about(env, chatId) {
      await send(env, chatId, `ℹ️ <b>عن البوت</b>\n\nالقاموس القبطي البحيري — بوت تعليمي للغة القبطية.\n• ${records.length.toLocaleString("en-US")} مدخل لغوي\n• نطق صوتي للكلمات\n• ألعاب واختبارات وبطاقات تعليمية\n• مشروع مجاني مفتوح المصدر\n\nالأوامر: /start · البحث مباشر بكتابة أي كلمة.`);
      return true;
    },
    async largefont(env, chatId, userId) {
      const u = (await getUser(env, userId)) ?? {};
      const next = !u.largeFont;
      await saveUser(env, userId, { ...u, largeFont: next });
      await send(env, chatId, next ? "🔠 فعّلت الخط الكبير في تفضيلاتك." : "🔤 عُدّت إلى الخط العادي.");
      return true;
    },
    async clearhistory(env, chatId, userId) {
      const u = (await getUser(env, userId)) ?? {};
      await saveUser(env, userId, { ...u, history: [], recentSearches: [] });
      await send(env, chatId, "🧹 تم مسح سجل عمليات بحثك.");
      return true;
    },
    async favorites(env, chatId, userId) {
      const u = (await getUser(env, userId)) ?? {};
      const favs = Array.isArray(u.favorites) ? u.favorites : [];
      if (!favs.length) { await send(env, chatId, "⭐ مفضلتك فارغة. ابحث عن كلمة ثم أرسل /fav لحفظها."); return true; }
      await send(env, chatId, `⭐ <b>مفضلتك</b> (${favs.length}):\n${favs.slice(0, 20).map((f) => `• <b>${escapeHtml(String(f.word ?? "").slice(0, 40))}</b> — ${escapeHtml(String(f.meaning ?? "").slice(0, 40))}`).join("\n")}\n\nحذف كلمة: /removefav <الكلمة>`);
      return true;
    },
    async removefav(env, chatId, userId, arg) {
      if (!arg) { await send(env, chatId, "✏️ الاستخدام: /removefav <الكلمة>"); return true; }
      const u = (await getUser(env, userId)) ?? {};
      const favs = Array.isArray(u.favorites) ? u.favorites : [];
      const target = stripMarks(arg).toLowerCase();
      const next = favs.filter((f) => stripMarks(f.word ?? "").toLowerCase() !== target);
      await saveUser(env, userId, { ...u, favorites: next });
      await send(env, chatId, next.length < favs.length ? "🗑 تمت الإزالة من المفضلة." : "⚠️ هذه الكلمة ليست في مفضلتك.");
      return true;
    },
    async contribute(env, chatId, userId, arg) {
      if (!arg) { await send(env, chatId, "✏️ اكتب اقتراحك: /contribute الكلمة القبطية — المعنى. سيُراجعها الأدمن."); return true; }
      const list = (await doGet("suggestions:list", [])) || [];
      list.push({ userId, text: arg.slice(0, 500), at: Date.now() });
      await doPut("suggestions:list", list.slice(-200));
      await notifyAdmins?.(env, `💡 مساهمة جديدة من <code>${escapeHtml(String(userId))}</code>:\n${escapeHtml(arg.slice(0, 500))}`);
      await send(env, chatId, "✅ تم استلام مساهمتك وسيُراجعها الأدمن. شكرًا لإثرائك القاموس!");
      return true;
    },
    async theme(env, chatId, userId, arg) {
      const t = (arg ?? "").toLowerCase();
      if (!["light", "dark", "sepia"].includes(t)) { await send(env, chatId, "✏️ الاستخدام: /theme light|dark|sepia — تفضيلك البصري (يُحفظ لحين دعم الرسائل المصممة)."); return true; }
      const u = (await getUser(env, userId)) ?? {};
      await saveUser(env, userId, { ...u, theme: t });
      await send(env, chatId, `✅ تم حفظ سمتك: ${t}.`);
      return true;
    },
    async invite(env, chatId, userId) {
      const me = await telegram(env, "getMe", {}).catch(() => null);
      const username = me?.result?.username ?? "CopticDictBot";
      await send(env, chatId, `🔗 رابط دعوتك الشخصي:\nhttps://t.me/${escapeHtml(username)}?start=ref${escapeHtml(String(userId).slice(-6))}\nشاركه مع الأصدقاء ليتعلموا القبطية معك!`);
      return true;
    },
    async feedback(env, chatId, userId, arg) { return handlers.report(env, chatId, userId, arg, "feedback"); },
    async bug(env, chatId, userId, arg) { return handlers.report(env, chatId, userId, arg, "bug"); },
    async transliterateCmd(env, chatId, arg) {
      if (!arg) { await send(env, chatId, "✏️ الاستخدام: /transliterate <نص قبطي> — يحوله إلى حروف لاتينية."); return true; }
      await send(env, chatId, `🔤 النقل الصوتي:\n${escapeHtml(transliterate(arg))}`);
      return true;
    },
    async copticnum(env, chatId, arg) {
      const n = Number(arg);
      if (!(n >= 0)) { await send(env, chatId, "✏️ الاستخدام: /copticnum <رقم من 0 إلى 99999>"); return true; }
      await send(env, chatId, `🔢 الرقم ${n} بالأرقام القبطية:\n<b>${escapeHtml(copticNumeral(n))}</b>`);
      return true;
    },
    async quizstats(env, chatId, userId) {
      const u = (await getUser(env, userId)) ?? {};
      const qs = u.quizStats ?? { played: 0, correct: 0 };
      const pct = qs.played ? Math.round(qs.correct / qs.played * 100) : 0;
      await send(env, chatId, `🧠 <b>إحصائيات اختباراتك</b>\nأُجريت: ${qs.played}\nإجابات صحيحة: ${qs.correct} (${pct}%)`);
      return true;
    },
    async settings(env, chatId, userId) {
      const u = (await getUser(env, userId)) ?? {};
      await send(env, chatId, `⚙️ <b>إعداداتك</b>\nاللغة: ${escapeHtml(String(u.lang ?? "ar (افتراضي)"))}\nالصوت التلقائي: ${u.voiceOff ? "مطفأ" : "مفعّل"}\nالخط الكبير: ${u.largeFont ? "مفعّل" : "عادي"}\nالسمة: ${escapeHtml(String(u.theme ?? "افتراضية"))}\nاشتراك كلمة اليوم: ${u.wodSub ? "مفعّل 🔔" : "ملغى 🔕"}\nالإشعارات: ${u.notify === false ? "مطفأة" : "مفعّلة"}`);
      return true;
    },
    async notify(env, chatId, userId, arg) {
      const on = !/off|0|false/i.test(arg);
      const u = (await getUser(env, userId)) ?? {};
      await saveUser(env, userId, { ...u, notify: on });
      await send(env, chatId, on ? "🔔 فعّلت الإشعارات." : "🔕 أوقفت الإشعارات.");
      return true;
    },
  };

  async function handleCallback({ env, callback }) {
    const data = String(callback.data ?? "");
    const userId = callback.from?.id;
    const chatId = callback.message?.chat?.id;
    if (data.startsWith("pu2|fc|")) {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id }).catch(() => null);
      const st = flashState.get(String(userId));
      if (!st || !chatId) return true;
      const action = data.split("|")[2];
      if (action === "stop") { flashState.delete(String(userId)); await send(env, chatId, "⏹ تم إنهاء البطاقات."); return true; }
      if (action === "show") {
        const c = st.cards[st.index];
        await telegram(env, "editMessageText", { chat_id: chatId, message_id: callback.message?.message_id, text: `🃏 <b>بطاقة ${st.index + 1}/${st.cards.length}</b>\n\n🔤 <b>${escapeHtml(stripMarks(c.coptic))}</b> [${escapeHtml(String(c.pronunciation ?? "").trim())}]\n🇪🇬 ${escapeHtml(String(c.meaning ?? "").slice(0, 120))}`, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "⏭ التالية", callback_data: "pu2|fc|next" }, { text: "⏹ إنهاء", callback_data: "pu2|fc|stop" }]] } }).catch(() => null);
        return true;
      }
      if (action === "next") {
        st.index += 1;
        if (st.index >= st.cards.length) { flashState.delete(String(userId)); await telegram(env, "editMessageText", { chat_id: chatId, message_id: callback.message?.message_id, text: "🎉 انتهت البطاقات! أعد /flashcards لحزمة جديدة." }).catch(() => null); return true; }
        const c = st.cards[st.index];
        await telegram(env, "editMessageText", { chat_id: chatId, message_id: callback.message?.message_id, text: `🃏 <b>بطاقة ${st.index + 1}/${st.cards.length}</b>\n\n🔤 <b>${escapeHtml(stripMarks(c.coptic))}</b> [${escapeHtml(String(c.pronunciation ?? "").trim())}]`, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "👁 إظهار المعنى", callback_data: "pu2|fc|show" }, { text: "⏭ التالية", callback_data: "pu2|fc|next" }], [{ text: "⏹ إنهاء", callback_data: "pu2|fc|stop" }]] } }).catch(() => null);
        return true;
      }
      return true;
    }
    if (data.startsWith("pu2|q2|")) {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id }).catch(() => null);
      const picked = data.split("|")[2];
      const st = quiz2State.get(String(userId));
      quiz2State.delete(String(userId));
      const u = (await getUser(env, userId)) ?? {};
      const qs = u.quizStats ?? { played: 0, correct: 0 };
      qs.played += 1;
      const correct = st && picked === st.answerId;
      if (correct) qs.correct += 1;
      await saveUser(env, userId, { ...u, quizStats: qs });
      if (chatId) await send(env, chatId, correct ? "✅ إجابة صحيحة! أحسنت." : "❌ إجابة خاطئة. جرّب /quiz2 مرة أخرى.");
      return true;
    }
    return false;
  }

  // Hangman letter guesses are plain text; call from handle when a game is active.
  async function maybeHangman(env, chatId, userId, text) {
    const st = hangmanState.get(String(userId));
    if (!st) return false;
    if (text === "/hangman stop" || text === "stop") { hangmanState.delete(String(userId)); await send(env, chatId, "⏹ أوقفت اللعبة."); return true; }
    if (Date.now() - st.at > GAME_TTL) { hangmanState.delete(String(userId)); await send(env, chatId, `⌛ انتهى وقت اللعبة. الكلمة كانت: ${escapeHtml(st.word)}`); return true; }
    const letter = stripMarks(text).slice(0, 1);
    if (!letter || !/[\u2C80-\u2CFF]/u.test(letter)) { await send(env, chatId, "✏️ أرسل حرفًا قبطيًا واحدًا فقط."); return true; }
    if (st.guessed.has(letter)) { await send(env, chatId, "⚠️ جرّبت هذا الحرف من قبل."); return true; }
    st.guessed.add(letter);
    if (!st.word.includes(letter)) st.wrong += 1;
    const masked = [...st.word].map((c) => st.guessed.has(c) ? c : "◻️").join(" ");
    if (!masked.includes("◻️")) { hangmanState.delete(String(userId)); await send(env, chatId, `🎉 فزت! الكلمة: <b>${escapeHtml(st.word)}</b>\nالمعنى: ${escapeHtml(st.hint)}`); return true; }
    if (st.wrong >= 6) { hangmanState.delete(String(userId)); await send(env, chatId, `💀 خسرت! الكلمة كانت: <b>${escapeHtml(st.word)}</b>\nالمعنى: ${escapeHtml(st.hint)}`); return true; }
    await send(env, chatId, `🎯 ${masked}\nأخطاء: ${st.wrong}/6 · التلميح: ${escapeHtml(st.hint)}`);
    return true;
  }

  async function handle({ env, chatId, userId, text }) {
    const cmd = text.split(/\s/u)[0]?.split("@")[0] ?? "";
    const arg = text.slice(cmd.length).trim();
    // Hangman plain-text letter guess takes priority over search.
    if (hangmanState.has(String(userId)) && !text.startsWith("/")) { if (await maybeHangman(env, chatId, userId, text)) return true; }
    switch (cmd) {
      case "/subscribe": return handlers.subscribe(env, chatId, userId, true);
      case "/unsubscribe": return handlers.subscribe(env, chatId, userId, false);
      case "/rate": return handlers.rate(env, chatId, userId, arg);
      case "/flashcards": case "/study": return handlers.flashcards(env, chatId, userId);
      case "/achievements": return handlers.achievements(env, chatId, userId);
      case "/streak": return handlers.streak(env, chatId, userId);
      case "/lang": return handlers.setlang(env, chatId, userId, arg);
      case "/report": return handlers.report(env, chatId, userId, arg, "report");
      case "/daily": return handlers.daily(env, chatId, userId);
      case "/compare": return handlers.compare(env, chatId, arg);
      case "/etymology": return handlers.etymology(env, chatId, arg);
      case "/examples": return handlers.examples(env, chatId, arg);
      case "/wod": case "/wordoftheday": return handlers.wod(env, chatId);
      case "/pronounce": return handlers.pronounce(env, chatId, arg);
      case "/quiz2": return handlers.quiz2(env, chatId, userId);
      case "/hangman": if (arg === "stop") { hangmanState.delete(String(userId)); await send(env, chatId, "⏹ أوقفت لعبة الشنق."); return true; } return handlers.hangman(env, chatId, userId);
      case "/exportmydata": return handlers.exportmydata(env, chatId, userId);
      case "/deleteme": return handlers.deleteme(env, chatId, userId, arg);
      case "/donate": return handlers.donate(env, chatId);
      case "/about": return handlers.about(env, chatId);
      case "/largefont": return handlers.largefont(env, chatId, userId);
      case "/clearhistory": return handlers.clearhistory(env, chatId, userId);
      case "/favorites": case "/mywords": return handlers.favorites(env, chatId, userId);
      case "/removefav": return handlers.removefav(env, chatId, userId, arg);
      case "/contribute": case "/suggestword": return handlers.contribute(env, chatId, userId, arg);
      case "/theme": return handlers.theme(env, chatId, userId, arg);
      case "/invite": return handlers.invite(env, chatId, userId);
      case "/feedback": return handlers.feedback(env, chatId, userId, arg);
      case "/bug": return handlers.bug(env, chatId, userId, arg);
      case "/transliterate": return handlers.transliterateCmd(env, chatId, arg);
      case "/copticnum": return handlers.copticnum(env, chatId, arg);
      case "/quizstats": return handlers.quizstats(env, chatId, userId);
      case "/settings": return handlers.settings(env, chatId, userId);
      case "/notify": return handlers.notify(env, chatId, userId, arg);
      default: return false;
    }
  }

  return { handle, handleCallback };
}
