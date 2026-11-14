// src/menu-studio.js — MenuBuilderBot-style menu studio for this bot.
//
// Every panel in here is a PERSISTENT REPLY KEYBOARD (ReplyKeyboardMarkup): the
// admin taps real Telegram buttons under the message field, the tap arrives as
// ordinary text, and the text is matched against the panel that is on screen.
// This module never builds an InlineKeyboardMarkup and never produces
// callback_data — the whole editing surface is bottom buttons + typed text.
//
// Studio state lives on the admin's user record under `menuStudio`:
//   { step, menuId?, buttonId?, field?, kind?, label? }
// and the user's current reply-menu position under `menuNav` (menu id).
//
// It must not import index.js (no circular import); everything it needs is
// injected through createMenuStudio(deps).

import {
  normalizeMenus, findMenu, findButton, rootMenus, descendantMenuIds,
  addMenu, addButton, updateButton, deleteButton, deleteMenu, moveButton,
  cleanMenuTitle, cleanMenuText, cleanButtonLabel, cleanUrl, cleanCommand,
  KIND_LABELS, BUTTON_KINDS, MEDIA_KINDS, ALLOWED_COMMANDS,
  MAX_MENUS, MAX_MENU_BUTTONS, ensureVideoMenu, VIDEO_MENU_ID,
} from "./menu-builder.js";

// Panel labels. Button/menu entries are numbered ("1. …") so they can never
// collide with these exact strings.
export const S = {
  MENUS: "🧩 قوائمي",
  NEW: "➕ قائمة جديدة",
  TREE: "🌳 شجرة القوائم",
  SEARCH: "🔎 بحث",
  STATS: "📊 إحصاءات",
  BACKUP: "💾 نسخة احتياطية",
  IMPORT: "📥 استيراد",
  TOOLS: "🛠 أدوات",
  EXIT: "🚪 خروج",
  TITLE: "✏️ عنوان القائمة",
  TEXT: "📝 نص القائمة",
  ADDBTN: "➕ زر جديد",
  NEWSUB: "🗂 قائمة فرعية",
  ROWS: "🧱 تخطيط الصفوف",
  BACKON: "⬅️ زر الرجوع",
  HOMEON: "🏠 زر الرئيسية",
  PREVIEW: "👁 معاينة",
  DELMENU: "🗑 حذف القائمة",
  DELCONFIRM: "✅ تأكيد الحذف",
  BACK: "🔙 رجوع",
  LABEL: "✏️ التسمية",
  CONTENT: "🔗 المحتوى",
  MOVEKIND: "🔀 تغيير النوع",
  LOCK: "🔒 الظهور",
  UP: "⬆️ أعلى",
  DOWN: "⬇️ أسفل",
  ROW: "↕️ رقم الصف",
  DUP: "📋 نسخ",
  LINK: "🪢 ربط بقائمة",
  DEL: "🗑 حذف",
  WIPE: "🗑 حذف كل القوائم",
  CLEAN: "🧹 تنظيف",
  ADMIN: "⚙️ إدارة القوائم",
  ROOT: "🏠 الرئيسية",
  VIDEO: "🎬 دروس الفيديو",
};

export const STUDIO_HOME_LABEL = S.ADMIN;

function kb(rows) {
  const keyboard = (rows ?? [])
    .map((row) => (Array.isArray(row) ? row : [row]).filter(Boolean).map((label) => ({ text: String(label).slice(0, 64) })))
    .filter((row) => row.length);
  if (!keyboard.length) keyboard.push([{ text: S.MENUS }]);
  // NOT persistent (user 2026-11-13): a persistent keyboard tells Telegram
  // to always show it, so ReplyKeyboardRemove on the lesson's first message
  // was ignored and the keyboard kept shrinking the lesson view. Without
  // is_persistent the menu keyboard still shows when a menu opens, the
  // lesson can hide it, and the user can hide it with the keyboard icon.
  return { keyboard, resize_keyboard: true };
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------- panel models

export function mainPanelRows() {
  return [[S.MENUS, S.NEW], [S.TREE, S.SEARCH], [S.STATS, S.BACKUP], [S.IMPORT, S.TOOLS], [S.VIDEO, S.EXIT]];
}

export function menusPanelRows(menus) {
  const list = normalizeMenus(menus).menus;
  return [...chunk(list.map((m, i) => `${i + 1}. ${m.title}`), 2), [S.NEW, S.BACK]];
}

export function menuPanelRows(menu) {
  const rows = [[S.TITLE, S.TEXT], [S.ADDBTN, S.ROWS], [S.NEWSUB, S.LINK], [S.BACKON, S.HOMEON], [S.PREVIEW, S.DELMENU]];
  for (const [i, b] of (menu?.buttons ?? []).entries()) rows.push([`${i + 1}. ${b.adminOnly ? "🔒 " : ""}${b.label}`]);
  rows.push([S.MENUS, S.EXIT]);
  return rows;
}

export function buttonPanelRows() {
  return [[S.LABEL, S.CONTENT], [S.MOVEKIND, S.LOCK], [S.UP, S.DOWN], [S.ROW, S.DUP], [S.DEL], [S.BACK]];
}

// The menu exactly as a normal user sees it: a real bottom keyboard.
export function buildReplyMenuKeyboard(menus, menu, { isAdmin = false } = {}) {
  if (!menu) return kb([[S.MENUS]]);
  const byRow = new Map();
  (menu.buttons ?? [])
    .filter((b) => isAdmin || !b.adminOnly)
    .forEach((b, index) => {
      const row = Number.isInteger(b.row) && b.row >= 0 ? b.row : index;
      if (!byRow.has(row)) byRow.set(row, []);
      byRow.get(row).push(`${b.adminOnly && isAdmin ? "🔒 " : ""}${b.label}`);
    });
  const rows = [...byRow.keys()].sort((a, b) => a - b).map((key) => byRow.get(key));
  const nav = [];
  if (menu.parentId && menu.showBack !== false) nav.push(menu.backLabel || S.BACK);
  if (menu.parentId && menu.showHome !== false) nav.push(menu.homeLabel || S.ROOT);
  if (nav.length) rows.push(nav);
  if (isAdmin) rows.push([S.ADMIN]);
  if (!rows.length) rows.push([S.ROOT]);
  return kb(rows);
}

export function buildRootReplyKeyboard(menus, { isAdmin = false } = {}) {
  const rows = chunk(rootMenus(menus).map((m) => m.title), 2);
  if (isAdmin) rows.push([S.ADMIN]);
  if (!rows.length) rows.push([S.ROOT]);
  return kb(rows);
}

// A plain-text tap -> { kind:"menu", menu } | { kind:"button", menu, button } |
// { kind:"admin" } | null. The menu the user is inside wins, then a root menu
// title, then the buttons of the root menus.
export function resolveMenuLabel(menus, text, { currentMenuId = null, isAdmin = false } = {}) {
  const label = String(text ?? "").trim();
  if (!label) return null;
  const list = normalizeMenus(menus).menus;
  const current = currentMenuId ? list.find((m) => m.id === currentMenuId) : null;
  const matchButton = (menu) => {
    const hit = (menu?.buttons ?? [])
      .filter((b) => isAdmin || !b.adminOnly)
      .find((b) => String(b.label).trim() === label || (b.adminOnly && isAdmin && `🔒 ${b.label}` === label));
    return hit ? { kind: "button", menu, button: hit } : null;
  };
  if (current) {
    const hit = matchButton(current);
    if (hit) return hit;
    if (label === (current.backLabel || S.BACK)) {
      const parent = current.parentId ? list.find((m) => m.id === current.parentId) : null;
      if (parent) return { kind: "menu", menu: parent };
    }
    if (label === (current.homeLabel || S.ROOT)) {
      const firstRoot = list.find((m) => !m.parentId);
      if (firstRoot) return { kind: "menu", menu: firstRoot };
    }
  }
  if (isAdmin && label === S.ADMIN) return { kind: "admin" };
  const byTitle = list.find((m) => String(m.title).trim() === label);
  if (byTitle) return { kind: "menu", menu: byTitle };
  if (label === S.ROOT || label === S.BACK) {
    const firstRoot = list.find((m) => !m.parentId);
    if (firstRoot) return { kind: "menu", menu: firstRoot };
  }
  for (const menu of list.filter((m) => !m.parentId)) {
    const hit = matchButton(menu);
    if (hit) return hit;
  }
  return null;
}

// Re-assign `row` from a plan such as "2,1,3" (buttons per row, top to bottom).
export function applyRowPlan(menus, menuId, plan) {
  const numbers = String(plan ?? "")
    .split(/[^\d]+/u)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.min(10, n));
  const list = normalizeMenus(menus).menus;
  const menu = list.find((m) => m.id === String(menuId));
  if (!menu || !numbers.length) return { menus: { menus: list }, applied: false };
  const rows = [];
  for (const [rowIndex, size] of numbers.entries()) for (let i = 0; i < size; i += 1) rows.push(rowIndex);
  const buttons = menu.buttons.map((b, i) => ({ ...b, row: rows[i] ?? rows.at(-1) ?? 0 }));
  return { menus: { menus: list.map((m) => (m.id === menu.id ? { ...m, buttons } : m)) }, applied: true };
}

export function layoutText(menu) {
  if (!menu?.buttons?.length) return "لا توجد أزرار بعد.";
  const counts = new Map();
  for (const [i, b] of menu.buttons.entries()) {
    const row = Number.isInteger(b.row) && b.row >= 0 ? b.row : i;
    counts.set(row, (counts.get(row) ?? 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => a - b).map((row) => `صف ${row + 1}: ${counts.get(row)} زر`).join("\n");
}

function patchMenu(menus, menuId, patch) {
  const list = normalizeMenus(menus).menus;
  return { menus: { menus: list.map((m) => (m.id === String(menuId) ? { ...m, ...patch } : m)) } };
}

function treeLines(menus, parentId = null, depth = 0, lines = []) {
  for (const menu of normalizeMenus(menus).menus.filter((m) => (m.parentId ?? null) === parentId)) {
    lines.push(`${"　".repeat(depth)}${depth ? "└ " : ""}${menu.title} (${menu.buttons.length} زر)`);
    treeLines(menus, menu.id, depth + 1, lines);
  }
  return lines;
}

function statsText(menus) {
  const list = normalizeMenus(menus).menus;
  const buttons = list.reduce((sum, m) => sum + m.buttons.length, 0);
  const kinds = new Map();
  for (const menu of list) for (const b of menu.buttons) kinds.set(b.kind, (kinds.get(b.kind) ?? 0) + 1);
  const lines = ["📊 <b>إحصاءات القوائم</b>", `القوائم: <b>${list.length}</b> / ${MAX_MENUS}`, `الأزرار: <b>${buttons}</b>`, `قوائم رئيسية: ${list.filter((m) => !m.parentId).length}`];
  for (const [kind, count] of kinds) lines.push(`• ${KIND_LABELS[kind] ?? kind}: ${count}`);
  return lines.join("\n");
}

export function createMenuStudio(deps) {
  const { telegram, escapeHtml = (v) => String(v ?? ""), loadMenus, saveMenus, getUser, saveUser, logAdminAction = async () => {}, isAdmin = () => false } = deps;

  const send = (env, chatId, text, rows) => telegram(env, "sendMessage", {
    chat_id: chatId, text, parse_mode: "HTML", reply_markup: kb(rows),
  });

  async function readUser(env, userId) { return (await getUser(env, userId)) ?? {}; }
  async function writeState(env, userId, state) {
    const user = await readUser(env, userId);
    const next = { ...user };
    if (state) next.menuStudio = state; else delete next.menuStudio;
    await saveUser(env, userId, next);
  }

  async function showMain(env, chatId, userId) {
    await writeState(env, userId, { step: "main" });
    await send(env, chatId, [
      "🧩 <b>محرر القوائم</b>",
      "",
      "كل ما تفعله هنا يظهر للمستخدمين كأزرار سفلية تحت الحقل — لا أزرار شفافة.",
      `الحد: ${MAX_MENUS} قائمة، و${MAX_MENU_BUTTONS} زرًا للقائمة.`,
    ].join("\n"), mainPanelRows());
  }

  async function showMenus(env, chatId, userId) {
    const menus = await loadMenus(env);
    await writeState(env, userId, { step: "menus" });
    const list = normalizeMenus(menus).menus;
    const text = list.length
      ? ["🧩 <b>قوائمي</b>", "", ...list.map((m, i) => `${i + 1}. ${escapeHtml(m.title)} — ${m.buttons.length} زر${m.parentId ? " (فرعية)" : ""}`), "", "اضغط رقم قائمة لتعديلها."].join("\n")
      : "🧩 <b>قوائمي</b>\n\nلا توجد قوائم بعد — اضغط «➕ قائمة جديدة».";
    await send(env, chatId, text, menusPanelRows(menus));
  }

  async function showMenu(env, chatId, userId, menuId) {
    const menus = await loadMenus(env);
    const menu = findMenu(menus, menuId);
    if (!menu) { await showMenus(env, chatId, userId); return; }
    await writeState(env, userId, { step: "menu", menuId: menu.id });
    const parent = menu.parentId ? findMenu(menus, menu.parentId)?.title : null;
    await send(env, chatId, [
      `🧩 <b>${escapeHtml(menu.title)}</b>`,
      parent ? `الأب: ${escapeHtml(parent)}` : "قائمة رئيسية",
      `المعرّف: <code>${escapeHtml(menu.id)}</code>`,
      "",
      `<b>النص:</b> ${escapeHtml(menu.text.slice(0, 160))}`,
      "",
      `<b>الأزرار (${menu.buttons.length}):</b>`,
      layoutText(menu),
      "",
      "اضغط رقم زر لتعديله.",
    ].join("\n"), menuPanelRows(menu));
  }

  async function showButton(env, chatId, userId, menuId, buttonId) {
    const menus = await loadMenus(env);
    const menu = findMenu(menus, menuId);
    const button = findButton(menu, buttonId);
    if (!menu || !button) { await showMenu(env, chatId, userId, menuId); return; }
    await writeState(env, userId, { step: "button", menuId: menu.id, buttonId: button.id });
    const detail = button.kind === "url" ? button.url
      : button.kind === "command" ? button.command
      : button.kind === "submenu" ? `→ ${findMenu(menus, button.targetMenuId)?.title ?? "قائمة محذوفة"}`
      : MEDIA_KINDS.includes(button.kind) ? `ملف محفوظ (${KIND_LABELS[button.kind] ?? button.kind})`
      : String(button.text ?? "").slice(0, 120);
    await send(env, chatId, [
      `✏️ <b>${escapeHtml(button.label)}</b>`,
      `النوع: ${KIND_LABELS[button.kind] ?? button.kind}`,
      `المحتوى: ${escapeHtml(detail)}`,
      `الصف: ${Number.isInteger(button.row) ? button.row + 1 : "تلقائي"}`,
      `الظهور: ${button.adminOnly ? "🔒 للأدمن فقط" : "👥 للجميع"}`,
    ].join("\n"), buttonPanelRows());
  }

  async function showKind(env, chatId, userId, menuId) {
    await writeState(env, userId, { step: "kind", menuId });
    await send(env, chatId, "🔀 <b>نوع الزر</b>\n\nاختر النوع:", chunk(BUTTON_KINDS.map((k) => KIND_LABELS[k]), 3));
  }

  async function promptContent(env, chatId, userId, state, kind) {
    if (MEDIA_KINDS.includes(kind)) {
      await writeState(env, userId, { ...state, step: "media", kind });
      await send(env, chatId, "📎 أرسل الملف الآن (صورة/فيديو/صوت/ملف) ليُحفظ على الزر.", [S.BACK]);
      return;
    }
    if (kind === "submenu") {
      const menus = await loadMenus(env);
      const blocked = new Set([state.menuId, ...descendantMenuIds(menus, state.menuId)]);
      const candidates = normalizeMenus(menus).menus.filter((m) => !blocked.has(m.id));
      await writeState(env, userId, { ...state, step: "target", kind });
      await send(env, chatId, "🗂 اختر القائمة التي سيفتحها الزر:", [...chunk(candidates.map((m, i) => `${i + 1}. ${m.title}`), 2), [S.BACK]]);
      return;
    }
    const hint = kind === "text" ? "أرسل نص الرسالة التي ستُرسل عند الضغط."
      : kind === "popup" ? "أرسل نص التنبيه المنبثق (حتى 200 حرف)."
      : kind === "url" ? "أرسل الرابط (يبدأ بـ https://)."
      : `أرسل الأمر من: ${ALLOWED_COMMANDS.join(" ")}`;
    await writeState(env, userId, { ...state, step: "input", field: "content", kind });
    await send(env, chatId, `🔗 ${hint}`, [S.BACK]);
  }

  async function preview(env, chatId, userId, menuId) {
    const menus = await loadMenus(env);
    const menu = findMenu(menus, menuId);
    if (!menu) { await showMenus(env, chatId, userId); return; }
    await telegram(env, "sendMessage", {
      chat_id: chatId,
      text: `👁 <b>معاينة</b>\n\n${menu.text}`,
      parse_mode: "HTML",
      reply_markup: buildReplyMenuKeyboard(menus, menu, { isAdmin: isAdmin(env, userId) }),
    });
  }


  // --------------------------------------------------------------- entry point
  async function handleCommand(env, chatId, userId) { await showMain(env, chatId, userId); }

  async function handleText(env, chatId, userId, text) {
    const raw = String(text ?? "").trim();
    if (!raw || raw.startsWith("/")) return false;
    const user = await readUser(env, userId);
    const state = user.menuStudio;
    if (!state) return false;
    const menus = await loadMenus(env);
    const menu = state.menuId ? findMenu(menus, state.menuId) : null;
    const button = menu && state.buttonId ? findButton(menu, state.buttonId) : null;
    const back = async () => {
      if (state.menuId && findMenu(menus, state.menuId)) await showMenu(env, chatId, userId, state.menuId);
      else await showMain(env, chatId, userId);
    };

    // ---- typed input steps
    if (state.step === "input") {
      if (raw === S.BACK) { await back(); return true; }
      const field = state.field;
      if (field === "newmenu_title") {
        const title = cleanMenuTitle(raw);
        if (!title) { await send(env, chatId, "✏️ أرسل عنوانًا صحيحًا (حتى 80 حرفًا).", [S.BACK]); return true; }
        const parentId = state.parentId ?? null;
        const { menus: next, menu: created } = addMenu(menus, { title, parentId });
        if (!created) { await send(env, chatId, `❌ تعذّر الإنشاء (الحد ${MAX_MENUS} قائمة).`, [S.BACK]); return true; }
        await saveMenus(env, next);
        await logAdminAction(env, userId, "addmenu", title);
        // A submenu created from a parent is linked back to it right away, so the
        // admin never has to build the button by hand.
        if (parentId) {
          const parent = findMenu(next, parentId);
          if (parent) {
            const linked = addButton(next, parent.id, { label: title.slice(0, 40), kind: "submenu", targetMenuId: created.id });
            if (linked.button) await saveMenus(env, linked.menus);
          }
        }
        await showMenu(env, chatId, userId, created.id);
        return true;
      }
      if (field === "title" && menu) {
        const title = cleanMenuTitle(raw);
        if (!title) { await send(env, chatId, "✏️ أرسل عنوانًا صحيحًا (حتى 80 حرفًا).", [S.BACK]); return true; }
        await saveMenus(env, patchMenu(menus, menu.id, { title }).menus);
        await logAdminAction(env, userId, "menu_title", title);
        await showMenu(env, chatId, userId, menu.id);
        return true;
      }
      if (field === "text" && menu) {
        await saveMenus(env, patchMenu(menus, menu.id, { text: cleanMenuText(raw) || menu.title }).menus);
        await showMenu(env, chatId, userId, menu.id);
        return true;
      }
      if (field === "label" && menu && button) {
        const label = cleanButtonLabel(raw);
        if (!label) { await send(env, chatId, "✏️ أرسل تسمية صحيحة (حتى 64 حرفًا).", [S.BACK]); return true; }
        const { menus: next, button: updated } = updateButton(menus, menu.id, button.id, { label });
        if (!updated) { await send(env, chatId, "❌ تعذّر التعديل.", [S.BACK]); return true; }
        await saveMenus(env, next);
        await showButton(env, chatId, userId, menu.id, button.id);
        return true;
      }
      if (field === "newlabel" && menu) {
        const label = cleanButtonLabel(raw);
        if (!label) { await send(env, chatId, "✏️ أرسل تسمية صحيحة (حتى 64 حرفًا).", [S.BACK]); return true; }
        await promptContent(env, chatId, userId, { menuId: menu.id, label }, state.kind);
        return true;
      }
      if (field === "content" && menu) {
        const kind = button?.kind ?? state.kind;
        let content = null;
        if (kind === "text") content = { text: raw.slice(0, 3000) };
        else if (kind === "popup") content = { text: raw.slice(0, 200) };
        else if (kind === "url") content = { url: cleanUrl(raw) };
        else if (kind === "command") content = { command: cleanCommand(raw) };
        if (!content || !Object.values(content)[0]) {
          await send(env, chatId, kind === "url" ? "❌ رابط غير صالح — يجب أن يبدأ بـ https://" : kind === "command" ? `❌ أمر غير متاح. المتاح: ${ALLOWED_COMMANDS.join(" ")}` : "✏️ أرسل قيمة صحيحة.", [S.BACK]);
          return true;
        }
        if (button) {
          const { menus: next, button: updated } = updateButton(menus, menu.id, button.id, content);
          if (!updated) { await send(env, chatId, "❌ تعذّر تحديث المحتوى.", [S.BACK]); return true; }
          await saveMenus(env, next);
          await showButton(env, chatId, userId, menu.id, button.id);
          return true;
        }
        const kindNow = state.kind ?? "text";
        const { menus: next, button: created } = addButton(menus, menu.id, { label: state.label, kind: kindNow, ...content });
        if (!created) { await send(env, chatId, "❌ تعذّرت الإضافة (ربما وصلت القائمة للحد الأقصى).", [S.BACK]); return true; }
        await saveMenus(env, next);
        await logAdminAction(env, userId, "addbutton", `${state.label} (${kindNow})`);
        await showMenu(env, chatId, userId, menu.id);
        return true;
      }
      if (field === "rows" && menu) {
        const { menus: next, applied } = applyRowPlan(menus, menu.id, raw);
        if (!applied) { await send(env, chatId, "🧱 اكتب أعداد الأزرار في كل صف بالأرقام، مثال: 2,1,3", [S.BACK]); return true; }
        await saveMenus(env, next);
        await showMenu(env, chatId, userId, menu.id);
        return true;
      }
      if (field === "row" && menu && button) {
        const row = Number(raw.replace(/[^\d]/gu, "")) - 1;
        if (!Number.isFinite(row) || row < 0) { await send(env, chatId, "↕️ أرسل رقم صف صحيحًا (1، 2، 3 ...).", [S.BACK]); return true; }
        const { menus: next, button: updated } = updateButton(menus, menu.id, button.id, { row });
        if (!updated) { await send(env, chatId, "❌ تعذّر التعديل.", [S.BACK]); return true; }
        await saveMenus(env, next);
        await showButton(env, chatId, userId, menu.id, button.id);
        return true;
      }
      if (field === "search") {
        const needle = raw.toLowerCase();
        const hits = normalizeMenus(menus).menus.filter((m) => m.title.toLowerCase().includes(needle) || m.buttons.some((b) => b.label.toLowerCase().includes(needle)));
        await writeState(env, userId, { step: "search" });
        await send(env, chatId, hits.length ? `🔎 نتائج «${escapeHtml(raw)}» — اضغط الرقم:` : "🔎 لا نتائج.", [...chunk(hits.map((m, i) => `${i + 1}. ${m.title}`), 2), [S.BACK]]);
        return true;
      }
      if (field === "import") {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { parsed = null; }
        const normalized = normalizeMenus(parsed);
        if (!parsed || !normalized.menus.length) { await send(env, chatId, "❌ نص غير صالح. الصق JSON من «نسخة احتياطية».", [S.BACK]); return true; }
        await saveMenus(env, normalized);
        await logAdminAction(env, userId, "menu_import", `${normalized.menus.length} menus`);
        await showMenus(env, chatId, userId);
        return true;
      }
      await showMain(env, chatId, userId);
      return true;
    }

    if (state.step === "search") {
      if (raw === S.BACK) { await showMain(env, chatId, userId); return true; }
      const needle = state.query ?? "";
      void needle;
      const pick = /^(\d+)\./u.exec(raw);
      const hits = normalizeMenus(menus).menus;
      const target = pick ? hits[Number(pick[1]) - 1] : hits.find((m) => m.title.trim() === raw);
      if (target) { await showMenu(env, chatId, userId, target.id); return true; }
      await showMain(env, chatId, userId);
      return true;
    }

    if (state.step === "target" && menu) {
      if (raw === S.BACK) { await back(); return true; }
      const blocked = new Set([menu.id, ...descendantMenuIds(menus, menu.id)]);
      const candidates = normalizeMenus(menus).menus.filter((m) => !blocked.has(m.id));
      const pick = /^(\d+)\./u.exec(raw);
      const target = pick ? candidates[Number(pick[1]) - 1] : candidates.find((m) => m.title.trim() === raw);
      if (!target) { await send(env, chatId, "🗂 اختر قائمة من الأزرار.", [S.BACK]); return true; }
      if (state.buttonId && button) {
        const { menus: next, button: updated } = updateButton(menus, menu.id, button.id, { targetMenuId: target.id });
        if (!updated) { await send(env, chatId, "❌ تعذّر التعديل.", [S.BACK]); return true; }
        await saveMenus(env, next);
        await showButton(env, chatId, userId, menu.id, button.id);
        return true;
      }
      const { menus: next, button: created } = addButton(menus, menu.id, { label: state.label, kind: "submenu", targetMenuId: target.id });
      if (!created) { await send(env, chatId, "❌ تعذّرت الإضافة.", [S.BACK]); return true; }
      await saveMenus(env, next);
      await showMenu(env, chatId, userId, menu.id);
      return true;
    }

    if (state.step === "linkpick" && menu) {
      if (raw === S.BACK) { await showMenu(env, chatId, userId, menu.id); return true; }
      const pick = /^(\d+)\./u.exec(raw);
      const others = normalizeMenus(menus).menus.filter((m) => m.id !== menu.id && !descendantMenuIds(menus, menu.id).has(m.id));
      const target = pick ? others[Number(pick[1]) - 1] : others.find((m) => m.title.trim() === raw);
      if (!target) { await send(env, chatId, "🪢 اختر رقم القائمة من الأزرار، أو 🔙 رجوع.", [S.BACK]); return true; }
      const { menus: next, button: created } = addButton(menus, menu.id, { label: target.title.slice(0, 40), kind: "submenu", targetMenuId: target.id });
      if (!created) { await send(env, chatId, "❌ تعذّر إنشاء الزر (ربما وصلت القائمة للحد الأقصى).", [S.BACK]); return true; }
      await saveMenus(env, next);
      await logAdminAction(env, userId, "menu_link", `${menu.title} -> ${target.title}`);
      await showMenu(env, chatId, userId, menu.id);
      return true;
    }

    if (state.step === "kind" && menu) {
      if (raw === S.BACK) { await back(); return true; }
      const kind = BUTTON_KINDS.find((k) => KIND_LABELS[k] === raw);
      if (!kind) { await showKind(env, chatId, userId, menu.id); return true; }
      await writeState(env, userId, { step: "input", field: "newlabel", kind, menuId: menu.id });
      await send(env, chatId, `🔀 النوع: <b>${escapeHtml(KIND_LABELS[kind])}</b>\n\nأرسل تسمية الزر (ما يراه المستخدم).`, [S.BACK]);
      return true;
    }

    if (state.step === "main") {
      if (raw === S.EXIT) {
        await writeState(env, userId, null);
        await telegram(env, "sendMessage", { chat_id: chatId, text: "🚪 خرجت من محرر القوائم.", reply_markup: { remove_keyboard: true } });
        return true;
      }
      if (raw === S.NEW) {
        await writeState(env, userId, { step: "input", field: "newmenu_title" });
        await send(env, chatId, "➕ أرسل عنوان القائمة الجديدة (حتى 80 حرفًا).", [S.BACK]);
        return true;
      }
      if (raw === S.VIDEO) {
        const { menus: ensured } = ensureVideoMenu(menus);
        const vid = findMenu(ensured, VIDEO_MENU_ID);
        if (!vid) { await send(env, chatId, "❌ تعذّر تجهيز قائمة دروس الفيديو.", [S.BACK]); return true; }
        if (ensured.menus.length !== normalizeMenus(menus).menus.length) await saveMenus(env, ensured);
        await showMenu(env, chatId, userId, VIDEO_MENU_ID);
        return true;
      }
      if (raw === S.MENUS) { await showMenus(env, chatId, userId); return true; }
      if (raw === S.TREE) {
        const lines = treeLines(menus);
        await send(env, chatId, lines.length ? `🌳 <b>شجرة القوائم</b>\n\n${lines.join("\n")}` : "🌳 لا توجد قوائم بعد.", [[S.MENUS], [S.EXIT]]);
        return true;
      }
      if (raw === S.STATS) { await send(env, chatId, statsText(menus), [[S.MENUS], [S.EXIT]]); return true; }
      if (raw === S.SEARCH) {
        await writeState(env, userId, { step: "input", field: "search" });
        await send(env, chatId, "🔎 أرسل كلمة للبحث في عناوين القوائم وتسميات الأزرار.", [S.BACK]);
        return true;
      }
      if (raw === S.BACKUP) {
        const json = JSON.stringify(normalizeMenus(menus), null, 1);
        await send(env, chatId, `💾 <b>نسخة احتياطية</b>\n<pre>${escapeHtml(json.slice(0, 3400))}</pre>\n\nاحفظ النص أو استورده بـ «📥 استيراد».`);
        return true;
      }
      if (raw === S.IMPORT) {
        await writeState(env, userId, { step: "input", field: "import" });
        await send(env, chatId, "📥 الصق نص JSON المصدَّر من النسخة الاحتياطية.", [S.BACK]);
        return true;
      }
      if (raw === S.TOOLS) {
        await writeState(env, userId, { step: "tools" });
        await send(env, chatId, "🛠 <b>أدوات</b>", [[S.WIPE], [S.CLEAN], [S.BACK]]);
        return true;
      }
      return false;
    }

    if (state.step === "tools") {
      if (raw === S.WIPE) {
        await saveMenus(env, { menus: [] });
        await logAdminAction(env, userId, "menu_wipe", "all menus");
        await showMain(env, chatId, userId);
        return true;
      }
      if (raw === S.CLEAN) {
        const before = normalizeMenus(menus).menus.reduce((n, m) => n + m.buttons.length, 0);
        await saveMenus(env, normalizeMenus(menus));
        const after = normalizeMenus(await loadMenus(env)).menus.reduce((n, m) => n + m.buttons.length, 0);
        await send(env, chatId, `🧹 تم التنظيف. أزرار صالحة: ${after} (كانت ${before}).`, [[S.BACK]]);
        return true;
      }
      if (raw === S.BACK) { await showMain(env, chatId, userId); return true; }
      return false;
    }

    if (state.step === "menus") {
      if (raw === S.BACK) { await showMain(env, chatId, userId); return true; }
      if (raw === S.NEW) {
        await writeState(env, userId, { step: "input", field: "newmenu_title" });
        await send(env, chatId, "➕ أرسل عنوان القائمة الجديدة (حتى 80 حرفًا).", [S.BACK]);
        return true;
      }
      const list = normalizeMenus(menus).menus;
      const pick = /^(\d+)\./u.exec(raw);
      const target = pick ? list[Number(pick[1]) - 1] : list.find((m) => m.title.trim() === raw);
      if (target) { await showMenu(env, chatId, userId, target.id); return true; }
      return false;
    }

    if (state.step === "menu" && menu) {
      if (raw === S.BACK || raw === S.MENUS) { await showMenus(env, chatId, userId); return true; }
      if (raw === S.EXIT) {
        await writeState(env, userId, null);
        await telegram(env, "sendMessage", { chat_id: chatId, text: "🚪 خرجت من محرر القوائم.", reply_markup: { remove_keyboard: true } });
        return true;
      }
      if (raw === S.TITLE) {
        await writeState(env, userId, { step: "input", field: "title", menuId: menu.id });
        await send(env, chatId, `✏️ العنوان الحالي: «${escapeHtml(menu.title)}»\nأرسل العنوان الجديد.`, [S.BACK]);
        return true;
      }
      if (raw === S.TEXT) {
        await writeState(env, userId, { step: "input", field: "text", menuId: menu.id });
        await send(env, chatId, "📝 أرسل نص الرسالة عند فتح القائمة (حتى 3000 حرف).", [S.BACK]);
        return true;
      }
      if (raw === S.ADDBTN) { await showKind(env, chatId, userId, menu.id); return true; }
      if (raw === S.NEWSUB) {
        await writeState(env, userId, { step: "input", field: "newmenu_title", parentId: menu.id });
        await send(env, chatId, `🗂 أرسل عنوان القائمة الفرعية داخل «${escapeHtml(menu.title)}» (حتى 80 حرفًا).`, [S.BACK]);
        return true;
      }
      if (raw === S.LINK) {
        const others = normalizeMenus(menus).menus.filter((m) => m.id !== menu.id && !descendantMenuIds(menus, menu.id).has(m.id));
        if (!others.length) { await send(env, chatId, "🪢 لا توجد قائمة أخرى لربطها (أنشئ قائمة أولًا).", [S.BACK]); return true; }
        await writeState(env, userId, { step: "linkpick", menuId: menu.id });
        await send(env, chatId, "🪢 اختر القائمة التي سيُنشأ لها زر داخل هذه القائمة:", [...chunk(others.map((m, i) => `${i + 1}. ${m.title}`), 2), [S.BACK]]);
        return true;
      }
      if (raw === S.ROWS) {
        await writeState(env, userId, { step: "input", field: "rows", menuId: menu.id });
        await send(env, chatId, `🧱 <b>التخطيط الحالي</b>\n${layoutText(menu)}\n\nأرسل أعداد الأزرار في كل صف، مثال: 2,1,3`, [S.BACK]);
        return true;
      }
      if (raw === S.BACKON) {
        await saveMenus(env, patchMenu(menus, menu.id, { showBack: menu.showBack === false }).menus);
        await showMenu(env, chatId, userId, menu.id);
        return true;
      }
      if (raw === S.HOMEON) {
        await saveMenus(env, patchMenu(menus, menu.id, { showHome: menu.showHome === false }).menus);
        await showMenu(env, chatId, userId, menu.id);
        return true;
      }
      if (raw === S.PREVIEW) { await preview(env, chatId, userId, menu.id); return true; }
      if (raw === S.DELMENU) {
        // Ask first: deleting a menu removes it with all its submenus,
        // and that cannot be undone from the studio.
        const subCount = descendantMenuIds(menus, menu.id).size;
        await writeState(env, userId, { step: "confirmdel", menuId: menu.id });
        const subText = subCount ? ` وكل قوائمها الفرعية (${subCount})` : "";
        await send(env, chatId, `🗑 سيتم حذف القائمة «${escapeHtml(menu.title)}»${subText} نهائيًا. هل أنت متأكد؟`, [[S.DELCONFIRM], [S.BACK]]);
        return true;
      }
      const pick = /^(\d+)\./u.exec(raw);
      const target = pick ? menu.buttons[Number(pick[1]) - 1] : menu.buttons.find((b) => b.label.trim() === raw);
      if (target) { await showButton(env, chatId, userId, menu.id, target.id); return true; }
      return false;
    }

    if (state.step === "confirmdel" && menu) {
      if (raw === S.DELCONFIRM) {
        const { menus: next } = deleteMenu(menus, menu.id);
        await saveMenus(env, next);
        await logAdminAction(env, userId, "delmenu", menu.title);
        await showMenus(env, chatId, userId);
        return true;
      }
      if (raw === S.BACK) { await showMenu(env, chatId, userId, menu.id); return true; }
      return false;
    }

    if (state.step === "button" && menu && button) {
      if (raw === S.BACK) { await showMenu(env, chatId, userId, menu.id); return true; }
      if (raw === S.LABEL) {
        await writeState(env, userId, { step: "input", field: "label", menuId: menu.id, buttonId: button.id });
        await send(env, chatId, `✏️ التسمية الحالية: «${escapeHtml(button.label)}»\nأرسل التسمية الجديدة.`, [S.BACK]);
        return true;
      }
      if (raw === S.CONTENT) { await promptContent(env, chatId, userId, { menuId: menu.id, buttonId: button.id }, button.kind); return true; }
      if (raw === S.MOVEKIND) {
        // Kind is immutable on an existing button; the natural way is a duplicate
        // with the new kind, so the panel offers that instead of corrupting data.
        const others = BUTTON_KINDS.filter((k) => k !== button.kind);
        await writeState(env, userId, { step: "kindchange", menuId: menu.id, buttonId: button.id });
        await send(env, chatId, "🔀 <b>نوع جديد لهذا الزر</b>\nسيُعاد إنشاء الزر بنفس التسمية بالنوع المختار.", chunk(others.map((k) => KIND_LABELS[k]), 3));
        return true;
      }
      if (raw === S.LOCK) {
        const { menus: next, button: updated } = updateButton(menus, menu.id, button.id, { adminOnly: !button.adminOnly });
        if (!updated) { await send(env, chatId, "❌ تعذّر التعديل.", [S.BACK]); return true; }
        await saveMenus(env, next);
        await showButton(env, chatId, userId, menu.id, button.id);
        return true;
      }
      if (raw === S.UP || raw === S.DOWN) {
        const { menus: next, moved } = moveButton(menus, menu.id, button.id, raw === S.UP ? "up" : "down");
        if (!moved) { await send(env, chatId, "⚠️ لا يمكن النقل أكثر في هذا الاتجاه.", buttonPanelRows()); return true; }
        await saveMenus(env, next);
        await showButton(env, chatId, userId, menu.id, button.id);
        return true;
      }
      if (raw === S.ROW) {
        await writeState(env, userId, { step: "input", field: "row", menuId: menu.id, buttonId: button.id });
        await send(env, chatId, `↕️ الزر الآن في صف ${Number.isInteger(button.row) ? button.row + 1 : "تلقائي"}.\nأرسل رقم الصف الجديد.`, [S.BACK]);
        return true;
      }
      if (raw === S.DUP) {
        const { menus: next, button: created } = addButton(menus, menu.id, { ...button, id: undefined, label: `${button.label} (نسخة)`.slice(0, 64) });
        if (!created) { await send(env, chatId, "❌ تعذّر النسخ.", [S.BACK]); return true; }
        await saveMenus(env, next);
        await showMenu(env, chatId, userId, menu.id);
        return true;
      }
      if (raw === S.MENUS) { await showMenus(env, chatId, userId); return true; }
      // Jumping straight to a sibling from the button panel, exactly like the
      // Menu Builder flow: "3." or the button label moves the cursor.
      const sibling = /^(\d+)\./u.exec(raw);
      const siblingTarget = sibling
        ? menu.buttons[Number(sibling[1]) - 1]
        : menu.buttons.find((b) => b.label.trim() === raw);
      if (siblingTarget) { await showButton(env, chatId, userId, menu.id, siblingTarget.id); return true; }
      if (raw === S.DEL) {
        const { menus: next, removed } = deleteButton(menus, menu.id, button.id);
        if (!removed) { await send(env, chatId, "⚠️ الزر غير موجود.", [S.BACK]); return true; }
        await saveMenus(env, next);
        await logAdminAction(env, userId, "delbutton", removed.label);
        await showMenu(env, chatId, userId, menu.id);
        return true;
      }
      return false;
    }

    if (state.step === "kindchange" && menu && button) {
      if (raw === S.BACK) { await showButton(env, chatId, userId, menu.id, button.id); return true; }
      const kind = BUTTON_KINDS.find((k) => KIND_LABELS[k] === raw);
      if (!kind) { await showButton(env, chatId, userId, menu.id, button.id); return true; }
      const { menus: without, removed } = deleteButton(menus, menu.id, button.id);
      if (!removed) { await showButton(env, chatId, userId, menu.id, button.id); return true; }
      const { menus: next, button: created } = addButton(without, menu.id, { ...button, id: undefined, kind });
      if (!created) { await send(env, chatId, "❌ تعذّر تغيير النوع.", [S.BACK]); return true; }
      await saveMenus(env, next);
      await showButton(env, chatId, userId, menu.id, created.id);
      return true;
    }

    return false;
  }

  // A file sent while the studio waits for media becomes the button content.
  async function handleMedia(env, chatId, userId, message) {
    const user = await readUser(env, userId);
    const state = user.menuStudio;
    if (!state || state.step !== "media") return false;
    const pick = () => {
      if (message.photo?.length) { const p = message.photo.at(-1); return { fileId: p.file_id, fileUniqueId: p.file_unique_id ?? "", kind: "photo" }; }
      if (message.video) return { fileId: message.video.file_id, fileUniqueId: message.video.file_unique_id ?? "", kind: "video" };
      if (message.audio) return { fileId: message.audio.file_id, fileUniqueId: message.audio.file_unique_id ?? "", kind: "audio" };
      if (message.document) return { fileId: message.document.file_id, fileUniqueId: message.document.file_unique_id ?? "", kind: "document" };
      return null;
    };
    const file = pick();
    if (!file) { await send(env, chatId, "📎 أرسل صورة أو فيديو أو صوتًا أو ملفًا.", [S.BACK]); return true; }
    // Video-send fix (2026-11-05): the chosen kind must match what actually
    // arrived. A video sent "as a file" arrives as message.document, and a
    // photo sent for a video button arrives as message.photo; storing either
    // under kind "video" makes every later sendVideo fail with 400 (wrong
    // file identifier) and the user only sees the generic "could not send"
    // message. So on mismatch: save nothing, tell the admin what arrived
    // vs what the button needs, and keep the media step active so they can
    // resend correctly. When no kind was chosen yet, keep the old behaviour
    // and use the detected kind.
    if (state.kind && MEDIA_KINDS.includes(state.kind) && file.kind !== state.kind) {
      const needHint = state.kind === "video" ? "أرسل الفيديو كفيديو (من زر الإرفاق اختر «فيديو») وليس كملف"
        : state.kind === "photo" ? "أرسل صورة"
        : state.kind === "audio" ? "أرسل ملفًا صوتيًا"
        : "أرسل الملف كملف (من زر الإرفاق اختر «ملف»)";
      await send(env, chatId, `⚠️ وصل ${KIND_LABELS[file.kind] ?? file.kind} لكن الزر نوعه ${KIND_LABELS[state.kind] ?? state.kind} — لم يُحفظ شيء.\n${needHint} ثم أرسله مرة أخرى.`, [S.BACK]);
      return true;
    }
    const menus = await loadMenus(env);
    const menu = findMenu(menus, state.menuId);
    if (!menu) { await showMenus(env, chatId, userId); return true; }
    const caption = String(message.caption ?? "").slice(0, 1000);
    if (state.buttonId) {
      const { menus: next, button: updated } = updateButton(menus, menu.id, state.buttonId, { fileId: file.fileId, fileUniqueId: file.fileUniqueId, fileKind: file.kind, text: caption });
      if (!updated) { await send(env, chatId, "❌ تعذّر حفظ الملف.", [S.BACK]); return true; }
      await saveMenus(env, next);
      await showButton(env, chatId, userId, menu.id, state.buttonId);
      return true;
    }
    const { menus: next, button: created } = addButton(menus, menu.id, { label: state.label, kind: state.kind ?? file.kind, fileId: file.fileId, fileUniqueId: file.fileUniqueId, text: caption });
    if (!created) { await send(env, chatId, "❌ تعذّرت إضافة الزر.", [S.BACK]); return true; }
    await saveMenus(env, next);
    await showMenu(env, chatId, userId, menu.id);
    return true;
  }

  return { handleCommand, handleText, handleMedia, showMain, showMenus, showMenu, showButton, preview, readUser, writeState };
}
