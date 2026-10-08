// TEMPORARY stand-in for the second bot: logs what it receives in the group and answers every voice message with a short reply.
// It never deletes a webhook and never confirms updates, so a real server can still receive them later.
const TOKEN = process.env.TEST_BOT_TOKEN ?? "";
const MINUTES = Number(process.env.TEST_MINUTES ?? 6);
if (!TOKEN) { console.error("TEST_BOT_TOKEN is missing"); process.exit(1); }

async function api(method, params = {}) {
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params),
  });
  return response.json().catch(() => ({ ok: false, description: `HTTP ${response.status}` }));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const me = await api("getMe");
if (!me.ok) { console.error("getMe failed:", me.description); process.exit(1); }
console.log(`Bot: @${me.result.username} (id ${me.result.id})`);
console.log(`can_read_all_group_messages (Group Privacy OFF): ${me.result.can_read_all_group_messages}`);

const hook = await api("getWebhookInfo");
console.log(`Webhook: ${hook.result?.url ? "ACTIVE -> " + new URL(hook.result.url).host : "none"}; pending updates: ${hook.result?.pending_update_count}; last error: ${hook.result?.last_error_message ?? "-"}`);
if (hook.result?.url) {
  console.log("A webhook is active, so getUpdates cannot be used. Nothing was changed. Stopping.");
  process.exit(0);
}

const startedAt = Math.floor(Date.now() / 1000);
const seen = new Set();
const statusOf = new Map();
const end = Date.now() + MINUTES * 60 * 1000;
console.log(`Listening for ${MINUTES} minutes: send the voice from the first bot in the group now...`);
while (Date.now() < end) {
  const res = await api("getUpdates", { limit: 100, timeout: 0, allowed_updates: ["message", "channel_post", "edited_message"] });
  if (!res.ok) { console.log("getUpdates error (a webhook was probably set again):", res.description); break; }
  for (const update of res.result) {
    if (seen.has(update.update_id)) continue;
    seen.add(update.update_id);
    const m = update.message ?? update.channel_post ?? update.edited_message;
    if (!m) continue;
    const kind = m.voice ? "VOICE" : m.audio ? "AUDIO" : m.text ? "text" : "other";
    if (!statusOf.has(m.chat.id) && m.chat.type !== "private") {
      const member = await api("getChatMember", { chat_id: m.chat.id, user_id: me.result.id });
      statusOf.set(m.chat.id, member.ok ? member.result.status : `error: ${member.description}`);
    }
    console.log(`update ${update.update_id}: chat ${m.chat.id} (${m.chat.type}) bot-status=${statusOf.get(m.chat.id) ?? "-"} | from ${m.from?.username ?? m.from?.id} is_bot=${m.from?.is_bot === true} | ${kind}${m.caption ? " | caption: " + m.caption.slice(0, 40).replace(/\n/g, " ") : ""}`);
    if ((m.voice || m.audio) && m.date >= startedAt - 5) {
      const reply = await api("sendMessage", {
        chat_id: m.chat.id,
        text: "✅ تم استلام الرسالة",
        reply_parameters: { message_id: m.message_id },
      });
      console.log(reply.ok ? "  -> replied: تم استلام الرسالة" : `  -> reply failed: ${reply.description}`);
    }
  }
  await sleep(3000);
}
console.log(`Finished. Updates seen: ${seen.size}`);
