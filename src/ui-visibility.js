// src/ui-visibility.js — Admin-controlled visibility of UI buttons.
//
// Lets an admin hide any element shown to regular users:
//   * reply-keyboard buttons  -> matched by exact label text
//   * inline buttons          -> matched by exact label text OR callback_data
//   * bot commands (/foo)     -> matched by command name
//
// Hidden items are (1) stripped centrally in telegram() before the payload is
// sent, and (2) blocked if the user types the text/command manually. State is
// persisted in the Durable Object (storeCall get/put) under HIDDEN_UI_KEY,
// with a short-lived in-memory cache so the common send path stays fast.
//
// This module is pure + storage-only; it must NOT import index.js (no circular
// import). index.js passes its storeCall helper in.

export const HIDDEN_UI_KEY = "hidden_ui:v1";

// In-memory cache. Workers may run in multiple isolates, so the cache is
// best-effort and expires after TTL_MS; toggles refresh it immediately.
const cache = { value: null, at: 0 };
const TTL_MS = 60_000;
const MAX_PER_FIELD = 300;

function normCommand(s) {
  return String(s ?? "").trim().toLowerCase().replace(/^\/+/, "").split(/\s+/u)[0] ?? "";
}

export function normalizeHiddenUi(raw) {
  const v = raw && typeof raw === "object" ? raw : {};
  const clean = (arr) =>
    [...new Set((Array.isArray(arr) ? arr : []).map((s) => String(s ?? "").trim()).filter(Boolean))].slice(0, MAX_PER_FIELD);
  return {
    text: clean(v.text),
    callback: clean(v.callback),
    command: clean((v.command ?? []).map(normCommand)),
  };
}

export async function getHiddenUi(env, storeCall) {
  if (!env?.USERS) return normalizeHiddenUi(null);
  const now = Date.now();
  if (cache.value && now - cache.at < TTL_MS) return cache.value;
  let raw = null;
  try {
    raw = (await storeCall(env, { op: "get", key: HIDDEN_UI_KEY }))?.value ?? null;
  } catch {
    raw = null;
  }
  cache.value = normalizeHiddenUi(raw);
  cache.at = now;
  return cache.value;
}

export function invalidateHiddenUiCache() {
  cache.value = null;
  cache.at = 0;
}

export async function setHiddenUi(env, storeCall, value) {
  const v = normalizeHiddenUi(value);
  if (env?.USERS) {
    try {
      await storeCall(env, { op: "put", key: HIDDEN_UI_KEY, value: v });
    } catch {
      /* storage unavailable — keep in-memory only */
    }
  }
  cache.value = v;
  cache.at = Date.now();
  return v;
}

// kind: "text" | "callback" | "command". force: true = hide, false = show,
// undefined = toggle. Returns { ok, hidden, kind, key, value }.
export async function toggleHiddenUi(env, storeCall, kind, match, force) {
  const field = kind === "callback" ? "callback" : kind === "command" ? "command" : "text";
  const key = field === "command" ? normCommand(match) : String(match ?? "").trim();
  if (!key) return { ok: false, hidden: false, kind: field, key: "", value: await getHiddenUi(env, storeCall) };
  const cur = await getHiddenUi(env, storeCall);
  const set = new Set(cur[field]);
  const willHide = force === undefined ? !set.has(key) : Boolean(force);
  if (willHide) set.add(key);
  else set.delete(key);
  const next = { ...cur, [field]: [...set] };
  await setHiddenUi(env, storeCall, next);
  return { ok: true, hidden: willHide, kind: field, key, value: next };
}

// ---- Pure sync filters (used by the central telegram() hook) ----

export function stripHiddenCommands(commands, hidden) {
  if (!hidden?.command?.length) return commands;
  const set = new Set(hidden.command);
  return (commands ?? []).filter((c) => !set.has(normCommand(c?.command)));
}

function buttonLabel(b) {
  return typeof b === "string" ? b : String(b?.text ?? "");
}

// Reply keyboards: rows of strings or { text } objects. Drops empty rows.
export function stripHiddenReplyKeyboard(keyboard, hidden) {
  if (!hidden?.text?.length || !Array.isArray(keyboard)) return keyboard;
  const set = new Set(hidden.text);
  return keyboard
    .map((row) => (Array.isArray(row) ? row.filter((b) => !set.has(buttonLabel(b))) : row))
    .filter((row) => Array.isArray(row) && row.length > 0);
}

// Inline keyboards: hide by label text (hidden.text) OR by callback_data
// (hidden.callback). URL buttons are only matched by label. Drops empty rows.
export function stripHiddenInlineKeyboard(inlineKeyboard, hidden) {
  if (!Array.isArray(inlineKeyboard)) return inlineKeyboard;
  const hasText = !!hidden?.text?.length;
  const hasCb = !!hidden?.callback?.length;
  if (!hasText && !hasCb) return inlineKeyboard;
  const textSet = new Set(hidden.text ?? []);
  const cbSet = new Set(hidden.callback ?? []);
  return inlineKeyboard
    .map((row) =>
      Array.isArray(row)
        ? row.filter((b) => {
            if (hasText && textSet.has(String(b?.text ?? ""))) return false;
            if (hasCb && b?.callback_data != null && cbSet.has(String(b.callback_data))) return false;
            return true;
          })
        : row,
    )
    .filter((row) => Array.isArray(row) && row.length > 0);
}

// ---- Execution-block checks (user typed the hidden text/command manually) ----

export function isHiddenCommandText(text, hidden) {
  if (!hidden?.command?.length) return false;
  const t = String(text ?? "").trim();
  if (!t.startsWith("/")) return false;
  return hidden.command.includes(normCommand(t));
}

export function isHiddenReplyText(text, hidden) {
  if (!hidden?.text?.length) return false;
  return hidden.text.includes(String(text ?? "").trim());
}

export function countHidden(hidden) {
  const h = hidden ?? { text: [], callback: [], command: [] };
  return (h.text?.length ?? 0) + (h.callback?.length ?? 0) + (h.command?.length ?? 0);
}
