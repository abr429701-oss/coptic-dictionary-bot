import io, re, sys
p = 'src/index.js'
s = io.open(p, encoding='utf-8').read()
orig = s
def sub(old, new, count=1, label=""):
    global s
    assert old in s, "MISSING ANCHOR: " + label
    s = s.replace(old, new, count)

# 1) import the studio
sub('import { MENUS_KEY, BUTTON_KINDS, MEDIA_KINDS, KIND_LABELS, ALLOWED_COMMANDS, VIDEO_MENU_ID, cleanMenuTitle, cleanMenuText, cleanButtonLabel, cleanUrl, cleanCommand, normalizeMenus, findMenu, findButton, rootMenus, descendantMenuIds, buildMenuKeyboard, buildRootKeyboard, menuOpenText, menuAdminListText, menuAdminDetailText, parseMenuTarget, parseButtonTarget, addMenu, deleteMenu, addButton, deleteButton, moveButton, updateButton, ensureVideoMenu } from "./menu-builder.js";',
    'import { MENUS_KEY, BUTTON_KINDS, MEDIA_KINDS, KIND_LABELS, ALLOWED_COMMANDS, VIDEO_MENU_ID, cleanMenuTitle, cleanMenuText, cleanButtonLabel, cleanUrl, cleanCommand, normalizeMenus, findMenu, findButton, rootMenus, descendantMenuIds, buildMenuKeyboard, buildRootKeyboard, menuOpenText, menuAdminListText, menuAdminDetailText, parseMenuTarget, parseButtonTarget, addMenu, deleteMenu, addButton, deleteButton, moveButton, updateButton, ensureVideoMenu } from "./menu-builder.js";\nimport { createMenuStudio, resolveMenuLabel, buildReplyMenuKeyboard, buildRootReplyKeyboard, STUDIO_HOME_LABEL } from "./menu-studio.js";',
    label="import")

# 2) reply-keyboard navigation helpers + studio instance, placed right after the imports
anchor = 'import { createMenuStudio, resolveMenuLabel, buildReplyMenuKeyboard, buildRootReplyKeyboard, STUDIO_HOME_LABEL } from "./menu-studio.js";'
helpers = anchor + '''

// ---- reply-keyboard menus (real buttons under the field, no inline) --------
// The position of a user inside the menus is remembered so a plain-text tap can
// be resolved without any callback data.
const PLAIN_CALLBACK = "__plain__";
async function menuNavOf(env, userId) {
  const user = await getUser(env, userId);
  return user?.menuNav ? String(user.menuNav) : null;
}
async function setMenuNav(env, userId, menuId) {
  const user = (await getUser(env, userId)) ?? {};
  const next = { ...user };
  if (menuId) next.menuNav = String(menuId); else delete next.menuNav;
  await saveUser(env, userId, next);
}
async function openReplyMenu(env, chatId, userId, menu) {
  if (!chatId) return;
  const stored = await loadMenus(env);
  const target = typeof menu === "string" ? findMenu(stored, menu) : menu;
  if (!target) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "⚠️ هذه القائمة غير موجودة. أرسل /menu لعرض القوائم." });
    return;
  }
  await setMenuNav(env, userId, target.id);
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: menuOpenText(target),
    parse_mode: "HTML",
    reply_markup: buildReplyMenuKeyboard(stored, target, { isAdmin: isAdmin(env, userId) }),
  });
}
async function followMenuHit(env, chatId, userId, hit) {
  if (hit.kind === "admin") {
    await studio.handleCommand(env, chatId, userId);
    return true;
  }
  if (hit.kind === "menu") { await openReplyMenu(env, chatId, userId, hit.menu); return true; }
  if (hit.kind === "button") {
    await handleMenuButton(env, {
      id: PLAIN_CALLBACK,
      from: { id: userId },
      message: { chat: { id: chatId } },
      data: `mb|btn|${hit.menu.id}|${hit.button.id}`,
    });
    return true;
  }
  return false;
}
const studio = createMenuStudio({
  telegram,
  escapeHtml,
  loadMenus,
  saveMenus,
  getUser,
  saveUser,
  logAdminAction,
  isAdmin,
});'''
sub(anchor, helpers, label="studio instance")

# 3) handleMenuButton: no answerCallbackQuery for a plain tap, reply keyboard for submenus
sub('''  const parts = String(callback.data ?? "").split("|");
  const menuId = parts[2] ?? "";
  const buttonId = parts[3] ?? "";
  const userId = callback.from?.id;''',
    '''  const plain = callback.id === PLAIN_CALLBACK;
  const parts = String(callback.data ?? "").split("|");
  const menuId = parts[2] ?? "";
  const buttonId = parts[3] ?? "";
  const userId = callback.from?.id;''', label="plain flag")

sub('''  if (!button) {
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "الزر غير موجود (ربما حُذف). أرسل /menu لعرض القوائم الحالية.", show_alert: true });
    return;
  }
  if (button.adminOnly && !isAdmin(env, userId)) {
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "⛔ هذا الزر للأدمن فقط.", show_alert: true });
    return;
  }
  await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });''',
    '''  if (!button) {
    const text = "الزر غير موجود (ربما حُذف). أرسل /menu لعرض القوائم الحالية.";
    if (plain) await telegram(env, "sendMessage", { chat_id: chatId, text });
    else await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text, show_alert: true });
    return;
  }
  if (button.adminOnly && !isAdmin(env, userId)) {
    const text = "⛔ هذا الزر للأدمن فقط.";
    if (plain) await telegram(env, "sendMessage", { chat_id: chatId, text });
    else await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text, show_alert: true });
    return;
  }
  if (!plain) await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });''', label="handleMenuButton guards")

sub('''  if (button.kind === "popup") {
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: button.text ?? "", show_alert: true });
    return;
  }''',
    '''  if (button.kind === "popup") {
    if (plain) await telegram(env, "sendMessage", { chat_id: chatId, text: `⚠️ ${button.text ?? ""}` });
    else await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: button.text ?? "", show_alert: true });
    return;
  }''', label="popup")

sub('''  if (button.kind === "submenu") { await openMenu(env, chatId, button.targetMenuId, userId); return; }''',
    '''  if (button.kind === "submenu") {
    if (plain) await openReplyMenu(env, chatId, userId, button.targetMenuId);
    else await openMenu(env, chatId, button.targetMenuId, userId);
    return;
  }''', label="submenu")

# 4) /menu -> real reply keyboard
sub('''async function sendRootMenus(env, chatId) {
  const stored = await loadMenus(env);
  const roots = rootMenus(stored);
  if (!roots.length) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "🔘 لا توجد قوائم مخصصة بعد.\\n(للأدمن: أنشئ أول قائمة بـ /addmenu)" });
    return;
  }
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: "🔘 <b>القوائم</b>\\nاختر قائمة:",
    parse_mode: "HTML",
    reply_markup: buildRootKeyboard(stored),
  });
}''',
    '''async function sendRootMenus(env, chatId, userId = chatId) {
  const stored = await loadMenus(env);
  const roots = rootMenus(stored);
  if (!roots.length) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: "🔘 لا توجد قوائم مخصصة بعد.\\n(للأدمن: أنشئ أول قائمة من /menuadmin)" });
    return;
  }
  await setMenuNav(env, userId, null);
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: "🔘 <b>القوائم</b>\\nاضغط زر القائمة تحت الحقل:",
    parse_mode: "HTML",
    reply_markup: buildRootReplyKeyboard(stored, { isAdmin: isAdmin(env, userId) }),
  });
}''', label="sendRootMenus")

sub('if (action === "menu") return sendRootMenus(env, chatId);',
    'if (action === "menu") return sendRootMenus(env, chatId, userId);', label="nf menu action")
sub('if (text === "/menu") { await sendRootMenus(env, message.chat.id); return; }',
    'if (text === "/menu") { await sendRootMenus(env, message.chat.id, userId); return; }', label="/menu")
sub('if (command === "/menu") { await sendRootMenus(env, chatId); return; }',
    'if (command === "/menu") { await sendRootMenus(env, chatId, chatId); return; }', label="runMenuCommand /menu")

# 5) deep link opens a real reply keyboard
sub('''    const menuLink = /^menu_(.+)$/u.exec(startParam);
    if (menuLink) {
      await openMenu(env, message.chat.id, menuLink[1], userId);
      return;
    }''',
    '''    const menuLink = /^menu_(.+)$/u.exec(startParam);
    if (menuLink) {
      await openReplyMenu(env, message.chat.id, userId, menuLink[1]);
      return;
    }''', label="deep link")

# 6) /menuadmin -> the reply-keyboard studio
sub('    if (text === "/menuadmin") { await sendMenuAdminPanel(env, message.chat.id); return; }',
    '    if (text === "/menuadmin") { await studio.handleCommand(env, message.chat.id, userId); return; }', label="/menuadmin")

# 7) route plain text / files into the studio, then into the user reply menus
sub('''    if (await handleAdminFlow(env, message, userId, admin, text)) return;''',
    '''    // Menu builder studio (reply keyboard) + user menu taps, before any other
    // text handler so a button label is never mistaken for a dictionary search.
    if (admin?.menuStudio && text === "/cancel") {
      await clearAdminFlow(env, userId);
      await studio.writeState(env, userId, null);
      await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "✅ تم إلغاء العملية الحالية.", reply_markup: { remove_keyboard: true } });
      return;
    }
    if (isAdmin(env, userId) && (message.photo || message.video || message.audio || message.document)
      && await studio.handleMedia(env, message.chat.id, userId, message)) return;
    if (text && !text.startsWith("/")) {
      if (isAdmin(env, userId) && await studio.handleText(env, message.chat.id, userId, text)) return;
      const chatMenus = await loadMenus(env);
      const navId = await menuNavOf(env, userId);
      const isRootLabel = rootMenus(chatMenus).some((m) => String(m.title).trim() === text);
      if (navId || isRootLabel || (isAdmin(env, userId) && text === STUDIO_HOME_LABEL)) {
        const hit = resolveMenuLabel(chatMenus, text, { currentMenuId: navId, isAdmin: isAdmin(env, userId) });
        if (hit && await followMenuHit(env, message.chat.id, userId, hit)) return;
      }
    }
    if (await handleAdminFlow(env, message, userId, admin, text)) return;''', label="studio routing")

io.open(p, 'w', encoding='utf-8').write(s)
print("patched index.js:", len(orig), "->", len(s))
