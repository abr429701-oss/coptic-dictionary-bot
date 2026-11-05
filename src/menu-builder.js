// src/menu-builder.js — MenuBuilder-style custom menus for the dictionary bot.
// Admins build menus (title + message text) and buttons on them from inside
// Telegram; users open them with /menu or /start menu_<id> and tap buttons.
// A button action is one of: text, photo, video, audio, document, url, popup,
// submenu, command. Video lessons are a built-in menu whose buttons are video
// actions ("🎬 دروس فيديو"); /videolessons opens it, /addvideo adds to it.
// This module is self-contained and must not import index.js (no circular import).
// Storage (the menus structure) lives in the Durable Object via storeCall in
// index.js under MENUS_KEY; this module only validates data and builds
// texts/keyboards. No shop/cart/payments — those do not fit a dictionary bot.

export const MENUS_KEY = "menus:v1";
export const MAX_MENUS = 20;
export const MAX_MENU_BUTTONS = 20;
export const MAX_MENU_TITLE = 80;
export const MAX_MENU_TEXT = 3000;
export const MAX_BUTTON_LABEL = 40;
export const VIDEO_MENU_ID = "m_video";
export const VIDEO_MENU_TITLE = "🎬 دروس فيديو";
export const VIDEO_MENU_TEXT = "🎬 <b>دروس فيديو</b>\n\nاختر درسًا لمشاهدته:";

export const BUTTON_KINDS = ["text", "photo", "video", "audio", "document", "url", "popup", "submenu", "command"];
export const MEDIA_KINDS = ["photo", "video", "audio", "document"];
export const KIND_LABELS = {
  text: "نص", photo: "صورة", video: "فيديو", audio: "صوت", document: "ملف",
  url: "رابط", popup: "تنبيه منبثق", submenu: "قائمة فرعية", command: "أمر",
};
// Commands a command-button may run (existing bot commands only).
export const ALLOWED_COMMANDS = ["/quiz", "/lessons", "/videolessons", "/flashcards", "/help", "/dailyquiz", "/menu", "/random"];

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Short stable ids, e.g. "m_mjx8k2q1" / "b_mjx8k2q1". `salt` (a short base36
// string) disambiguates ids created in the same millisecond; tests pass a
// fixed `now` and no salt for deterministic ids. Keeps callback_data
// ("mb|btn|<menuId>|<buttonId>") far under Telegram's 64-byte limit.
export function makeMenuId(now = Date.now(), salt = "") {
  return `m_${Math.max(0, Number(now) || 0).toString(36)}${salt ? `_${salt}` : ""}`;
}
export function makeButtonId(now = Date.now(), salt = "") {
  return `b_${Math.max(0, Number(now) || 0).toString(36)}${salt ? `_${salt}` : ""}`;
}

export function cleanMenuTitle(title) {
  return String(title ?? "").replace(/\s+/gu, " ").trim().slice(0, MAX_MENU_TITLE);
}
export function cleanMenuText(text) {
  return String(text ?? "").trim().slice(0, MAX_MENU_TEXT);
}
export function cleanButtonLabel(label) {
  return String(label ?? "").replace(/\s+/gu, " ").trim().slice(0, MAX_BUTTON_LABEL);
}
export function cleanUrl(url) {
  const u = String(url ?? "").trim().slice(0, 500);
  return /^https?:\/\/\S+$/u.test(u) ? u : "";
}
export function cleanCommand(command) {
  const c = String(command ?? "").trim().toLowerCase().split(/\s+/u)[0] ?? "";
  return ALLOWED_COMMANDS.includes(c) ? c : "";
}

function normalizeButton(raw, menuIds) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id ?? "").trim();
  const label = cleanButtonLabel(raw.label);
  const kind = String(raw.kind ?? "");
  if (!id || id.length > 40 || !label || !BUTTON_KINDS.includes(kind)) return null;
  const button = { id, label, kind, adminOnly: raw.adminOnly === true };
  if (kind === "text" || kind === "popup") {
    button.text = String(raw.text ?? "").slice(0, kind === "popup" ? 200 : 3000);
    if (!button.text.trim()) return null;
  }
  if (MEDIA_KINDS.includes(kind)) {
    button.fileId = String(raw.fileId ?? "").trim();
    if (!button.fileId) return null;
    button.fileKind = kind;
    button.text = String(raw.text ?? "").slice(0, 1000); // caption, may be empty
  }
  if (kind === "url") {
    button.url = cleanUrl(raw.url);
    if (!button.url) return null;
  }
  if (kind === "submenu") {
    button.targetMenuId = String(raw.targetMenuId ?? "").trim();
    if (!button.targetMenuId || !menuIds.has(button.targetMenuId)) return null;
  }
  if (kind === "command") {
    button.command = cleanCommand(raw.command);
    if (!button.command) return null;
  }
  return button;
}

// Validate/normalize a stored menus value into { menus: [...] }.
// Drops menus with no id/title and buttons that are invalid or point at a
// missing menu; menus whose parent is missing become root menus; caps at
// MAX_MENUS menus and MAX_MENU_BUTTONS buttons per menu. Never throws.
export function normalizeMenus(value) {
  const raw = Array.isArray(value?.menus) ? value.menus : Array.isArray(value) ? value : [];
  const byId = new Map();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id ?? "").trim();
    const title = cleanMenuTitle(item.title);
    if (!id || id.length > 40 || !title || byId.has(id)) continue;
    byId.set(id, { id, title, text: cleanMenuText(item.text) || title, parentId: null, buttons: [], _rawButtons: Array.isArray(item.buttons) ? item.buttons : [] });
  }
  // Second pass: parents must exist (otherwise root), then buttons (submenu
  // targets must exist too).
  const menuIds = new Set(byId.keys());
  for (const menu of byId.values()) {
    const rawMenu = raw.find((r) => r && String(r.id ?? "").trim() === menu.id);
    const parentId = String(rawMenu?.parentId ?? "").trim();
    menu.parentId = parentId && menuIds.has(parentId) && parentId !== menu.id ? parentId : null;
  }
  for (const menu of byId.values()) {
    const seen = new Set();
    for (const rawBtn of menu._rawButtons) {
      const button = normalizeButton(rawBtn, menuIds);
      if (!button || seen.has(button.id)) continue;
      seen.add(button.id);
      menu.buttons.push(button);
      if (menu.buttons.length >= MAX_MENU_BUTTONS) break;
    }
    delete menu._rawButtons;
  }
  return { menus: [...byId.values()].slice(0, MAX_MENUS) };
}

export function findMenu(menus, id) {
  const list = normalizeMenus(menus).menus;
  return list.find((m) => m.id === String(id ?? "").trim()) ?? null;
}
export function findButton(menu, buttonId) {
  if (!menu) return null;
  return (menu.buttons ?? []).find((b) => b.id === String(buttonId ?? "").trim()) ?? null;
}
export function rootMenus(menus) {
  return normalizeMenus(menus).menus.filter((m) => !m.parentId);
}
export function childMenus(menus, parentId) {
  return normalizeMenus(menus).menus.filter((m) => m.parentId === String(parentId));
}
// All descendant menu ids of `id` (for cycle-safe submenu picking).
export function descendantMenuIds(menus, id) {
  const list = normalizeMenus(menus).menus;
  const out = new Set();
  const walk = (pid) => {
    for (const m of list) {
      if (m.parentId === pid && !out.has(m.id)) { out.add(m.id); walk(m.id); }
    }
  };
  walk(String(id));
  return out;
}

// Buttons a user may see (admin-only buttons are hidden from normal users).
export function visibleButtons(menu, isAdmin) {
  if (!menu) return [];
  return (menu.buttons ?? []).filter((b) => isAdmin || !b.adminOnly);
}

// Inline keyboard for one menu. URL buttons open the link directly; every
// other button is a callback ("mb|btn|<menuId>|<buttonId>"). Submenus get an
// automatic "🔙 رجوع" row back to the parent menu.
export function buildMenuKeyboard(menus, menu, isAdmin = false) {
  const rows = [];
  for (const b of visibleButtons(menu, isAdmin)) {
    if (b.kind === "url") rows.push([{ text: `${b.adminOnly && isAdmin ? "🔒 " : ""}${b.label}`, url: b.url }]);
    else rows.push([{ text: `${b.adminOnly && isAdmin ? "🔒 " : ""}${b.label}`, callback_data: `mb|btn|${menu.id}|${b.id}` }]);
  }
  if (menu?.parentId) rows.push([{ text: "🔙 رجوع", callback_data: `mb|open|${menu.parentId}` }]);
  return { inline_keyboard: rows };
}

// Keyboard for /menu: one row per root menu.
export function buildRootKeyboard(menus) {
  return { inline_keyboard: rootMenus(menus).map((m) => [{ text: m.title, callback_data: `mb|open|${m.id}` }]) };
}

// Text shown when a menu opens (its message text, HTML).
export function menuOpenText(menu) {
  return menu?.text ? String(menu.text) : escapeHtml(menu?.title ?? "");
}

// Admin list for /menuadmin: numbered menus with parent + button count.
export function menuAdminListText(menus) {
  const list = normalizeMenus(menus).menus;
  if (!list.length) return "🔘 لا توجد قوائم مخصصة بعد.\nأنشئ أول قائمة بـ /addmenu";
  const lines = ["🔘 <b>القوائم المخصصة</b>", ""];
  for (const [i, m] of list.entries()) {
    const parent = m.parentId ? (findMenu(list, m.parentId)?.title ?? "?") : "رئيسية";
    lines.push(`${i + 1}. ${escapeHtml(m.title)} — <code>${escapeHtml(m.id)}</code> (${parent}، ${m.buttons.length} زر)`);
  }
  lines.push("", "إدارة قائمة: /menuadmin ثم اخترها من الأزرار.");
  return lines.join("\n");
}

// Detail text for one menu in the admin panel.
export function menuAdminDetailText(menus, menuId) {
  const menu = findMenu(menus, menuId);
  if (!menu) return null;
  const lines = [`🔘 <b>${escapeHtml(menu.title)}</b>`, `المعرّف: <code>${escapeHtml(menu.id)}</code>`, `النص: ${escapeHtml(menu.text.slice(0, 200))}`, ""];
  if (!menu.buttons.length) lines.push("لا توجد أزرار بعد — أضف أول زر بالزر أدناه.");
  else {
    lines.push("<b>الأزرار:</b>");
    for (const [i, b] of menu.buttons.entries()) {
      lines.push(`${i + 1}. ${escapeHtml(b.label)} [${KIND_LABELS[b.kind] ?? b.kind}]${b.adminOnly ? " 🔒 للأدمن فقط" : ""}`);
    }
  }
  return lines.join("\n");
}

// Resolve a /delmenu, /addbutton... argument: 1-based number or menu id.
export function parseMenuTarget(arg, menus) {
  const list = normalizeMenus(menus).menus;
  const needle = String(arg ?? "").trim();
  if (!needle) return null;
  if (/^\d+$/u.test(needle)) {
    const index = Number(needle) - 1;
    return index >= 0 && index < list.length ? { menu: list[index], index } : null;
  }
  const index = list.findIndex((m) => m.id === needle);
  return index >= 0 ? { menu: list[index], index } : null;
}
export function parseButtonTarget(arg, menu) {
  const buttons = menu?.buttons ?? [];
  const needle = String(arg ?? "").trim();
  if (!needle) return null;
  if (/^\d+$/u.test(needle)) {
    const index = Number(needle) - 1;
    return index >= 0 && index < buttons.length ? { button: buttons[index], index } : null;
  }
  const index = buttons.findIndex((b) => b.id === needle);
  return index >= 0 ? { button: buttons[index], index } : null;
}

// Pure mutations (each returns { menus, ... } with a normalized copy).
export function addMenu(menus, { title, text = "", parentId = null }) {
  const list = normalizeMenus(menus).menus;
  const cleanTitle = cleanMenuTitle(title);
  if (!cleanTitle) return { menus: { menus: list }, menu: null };
  if (list.length >= MAX_MENUS) return { menus: { menus: list }, menu: null };
  const parent = parentId ? list.find((m) => m.id === String(parentId)) : null;
  if (parentId && !parent) return { menus: { menus: list }, menu: null };
  const menu = { id: makeMenuId(Date.now(), Math.floor(Math.random() * 1296).toString(36)), title: cleanTitle, text: cleanMenuText(text) || cleanTitle, parentId: parent ? parent.id : null, buttons: [] };
  return { menus: { menus: [...list, menu] }, menu };
}
export function deleteMenu(menus, target) {
  const list = normalizeMenus(menus).menus;
  const found = parseMenuTarget(target, list);
  if (!found) return { menus: { menus: list }, removed: null };
  const { menu, index } = found;
  const kept = list.filter((_, i) => i !== index).map((m) => ({
    ...m,
    // Children of the deleted menu move up to its parent; buttons pointing
    // at the deleted menu disappear with it.
    parentId: m.parentId === menu.id ? menu.parentId : m.parentId,
    buttons: m.buttons.filter((b) => !(b.kind === "submenu" && b.targetMenuId === menu.id)),
  }));
  return { menus: { menus: kept }, removed: menu };
}
export function addButton(menus, menuId, button) {
  const list = normalizeMenus(menus).menus;
  const menu = list.find((m) => m.id === String(menuId));
  if (!menu) return { menus: { menus: list }, button: null };
  if (menu.buttons.length >= MAX_MENU_BUTTONS) return { menus: { menus: list }, button: null };
  const clean = normalizeButton({ ...button, id: button?.id || makeButtonId(Date.now(), Math.floor(Math.random() * 1296).toString(36)) }, new Set(list.map((m) => m.id)));
  if (!clean) return { menus: { menus: list }, button: null };
  const next = list.map((m) => (m.id === menu.id ? { ...m, buttons: [...m.buttons, clean] } : m));
  return { menus: { menus: next }, button: clean };
}
export function deleteButton(menus, menuId, target) {
  const list = normalizeMenus(menus).menus;
  const menu = list.find((m) => m.id === String(menuId));
  if (!menu) return { menus: { menus: list }, removed: null };
  const found = parseButtonTarget(target, menu);
  if (!found) return { menus: { menus: list }, removed: null };
  const next = list.map((m) => (m.id === menu.id ? { ...m, buttons: m.buttons.filter((_, i) => i !== found.index) } : m));
  return { menus: { menus: next }, removed: found.button };
}
export function moveButton(menus, menuId, buttonId, dir) {
  const list = normalizeMenus(menus).menus;
  const menu = list.find((m) => m.id === String(menuId));
  if (!menu) return { menus: { menus: list }, moved: false };
  const index = menu.buttons.findIndex((b) => b.id === String(buttonId));
  const to = index + (dir === "up" ? -1 : 1);
  if (index < 0 || to < 0 || to >= menu.buttons.length) return { menus: { menus: list }, moved: false };
  const buttons = [...menu.buttons];
  [buttons[index], buttons[to]] = [buttons[to], buttons[index]];
  const next = list.map((m) => (m.id === menu.id ? { ...m, buttons } : m));
  return { menus: { menus: next }, moved: true };
}
export function updateButton(menus, menuId, buttonId, patch) {
  const list = normalizeMenus(menus).menus;
  const menu = list.find((m) => m.id === String(menuId));
  if (!menu) return { menus: { menus: list }, button: null };
  const index = menu.buttons.findIndex((b) => b.id === String(buttonId));
  if (index < 0) return { menus: { menus: list }, button: null };
  const merged = { ...menu.buttons[index], ...patch, id: menu.buttons[index].id, kind: menu.buttons[index].kind };
  const clean = normalizeButton(merged, new Set(list.map((m) => m.id)));
  if (!clean) return { menus: { menus: list }, button: null };
  const buttons = [...menu.buttons];
  buttons[index] = clean;
  const next = list.map((m) => (m.id === menu.id ? { ...m, buttons } : m));
  return { menus: { menus: next }, button: clean };
}

// The built-in video-lessons menu. Created lazily (and only once) the first
// time /videolessons or /addvideo is used; its buttons are video actions.
export function ensureVideoMenu(menus) {
  const list = normalizeMenus(menus).menus;
  const existing = list.find((m) => m.id === VIDEO_MENU_ID);
  if (existing) return { menus: { menus: list }, menu: existing, created: false };
  if (list.length >= MAX_MENUS) return { menus: { menus: list }, menu: null, created: false };
  const menu = { id: VIDEO_MENU_ID, title: VIDEO_MENU_TITLE, text: VIDEO_MENU_TEXT, parentId: null, buttons: [] };
  return { menus: { menus: [...list, menu] }, menu, created: true };
}
