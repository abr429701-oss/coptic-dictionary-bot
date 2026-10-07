// scripts/archive_voices.mjs
//
// Collects the recordings that the dictionary bot posts into the private archive group.
// It runs as the SECOND bot (the "archiver") with getUpdates, so it needs no server.
//
//   node scripts/archive_voices.mjs fetch <outDir>   download new voice messages to <outDir>/<word id>.ogg
//   node scripts/archive_voices.mjs ack   <outDir>   confirm them to Telegram (call only after the upload worked)
//
// Env: ARCHIVE_BOT_TOKEN (archiver bot), ARCHIVE_CHAT_ID (the group id, e.g. -1001234567890)
// Notes: the archiver bot must have Bot-to-Bot Communication Mode ON and Group Privacy OFF in @BotFather,
// and it must NOT have a webhook (getUpdates and webhooks are mutually exclusive).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const TOKEN = process.env.ARCHIVE_BOT_TOKEN ?? "";
const CHAT = String(process.env.ARCHIVE_CHAT_ID ?? "").trim();
const BASE = process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org";
const [mode = "fetch", outArg = "archive-out"] = process.argv.slice(2);
const outDir = path.resolve(outArg);
const offsetFile = path.join(outDir, ".next-offset");

if (!TOKEN || !CHAT) {
  console.error("Set ARCHIVE_BOT_TOKEN and ARCHIVE_CHAT_ID first.");
  process.exit(1);
}

async function api(method, params = {}) {
  const response = await fetch(`${BASE}/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => ({}));
  if (!data.ok) {
    const hint = response.status === 409
      ? " (the archiver bot has a webhook set; remove it with deleteWebhook)"
      : "";
    throw new Error(`${method} failed: ${data.description ?? response.status}${hint}`);
  }
  return data.result;
}

await mkdir(outDir, { recursive: true });

if (mode === "ack") {
  if (!existsSync(offsetFile)) {
    console.log("Nothing to confirm.");
    process.exit(0);
  }
  const next = Number(await readFile(offsetFile, "utf8"));
  if (Number.isFinite(next) && next > 0) {
    await api("getUpdates", { offset: next, limit: 1, timeout: 0 });
    console.log(`Confirmed updates up to ${next - 1}.`);
  }
  process.exit(0);
}

// Up to 100 pending updates per run; the rest are picked up by the next run.
const updates = await api("getUpdates", { limit: 100, timeout: 0, allowed_updates: ["message"] });
let saved = 0;
let highest = 0;
for (const update of updates) {
  highest = Math.max(highest, update.update_id);
  const message = update.message;
  if (!message?.voice || String(message.chat?.id) !== CHAT) continue;
  const id = /^#(\d+)/u.exec(String(message.caption ?? ""))?.[1];
  if (!id) continue;
  try {
    const file = await api("getFile", { file_id: message.voice.file_id });
    const response = await fetch(`${BASE}/file/bot${TOKEN}/${file.file_path}`, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`download HTTP ${response.status}`);
    await writeFile(path.join(outDir, `${id}.ogg`), new Uint8Array(await response.arrayBuffer()));
    saved++;
  } catch (error) {
    // Do not confirm anything if a file could not be downloaded: the next run retries all of them.
    console.error(`Recording #${id} failed: ${error.message}`);
    process.exit(1);
  }
}
if (highest) await writeFile(offsetFile, String(highest + 1));
console.log(`${updates.length} updates, ${saved} recordings saved to ${outDir}`);
