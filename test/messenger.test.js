// Messenger webhook (Facebook Page) — core loop: verification, signature,
// dictionary search round-trip, quick-reply picks, voice attachment URL.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker, { localDictionaryCandidates, UserStore } from "../src/index.js";
import { suggestSimilar } from "../src/new-features.js";
import {
  verifyMessengerSignature,
  plainTextCard,
  buildQuickReplies,
  sendMessengerMessage,
  sendMessengerPhotoBytes,
  sendMessengerSenderAction,
  messengerAudioMessage,
  messengerAttachmentMessage,
  handleMessengerMessaging,
  MESSENGER_PICK_PREFIX,
  MESSENGER_SEND_URL,
  MESSENGER_VOICE_REPEATS,
} from "../src/messenger.js";
import { prebuiltAudioUrl, messengerVoiceUrl, recordedAudioUrl, humanAudioUrl } from "../src/neural-voice.js";
import records from "../data/dictionary.json" with { type: "json" };
import audioManifest from "../data/audio-manifest.json" with { type: "json" };
import audioVersions from "../data/audio-versions.json" with { type: "json" };

const VERIFY_TOKEN = "messenger-verify-test-token";
const APP_SECRET = "messenger-app-secret-test-value";
const PAGE_TOKEN = "messenger-page-token-test-value";
const env = {
  MESSENGER_VERIFY_TOKEN: VERIFY_TOKEN,
  MESSENGER_APP_SECRET: APP_SECRET,
  MESSENGER_PAGE_TOKEN: PAGE_TOKEN,
};
const SENDER_ID = "987654321";
const PAGE_ID = "61596442358492";
const AUDIO_BASE = "https://raw.githubusercontent.com/abr429701-oss/coptic-dictionary-bot/audio";

const sign = (rawBody) => `sha256=${createHmac("sha256", APP_SECRET).update(rawBody).digest("hex")}`;

function webhookRequest(rawBody, headers = {}) {
  return new Request("https://bot.test/messenger-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: rawBody,
  });
}

function messageEvent(message, senderId = SENDER_ID) {
  return {
    object: "page",
    entry: [{
      id: PAGE_ID,
      time: 1794791000000,
      messaging: [{
        sender: { id: senderId },
        recipient: { id: PAGE_ID },
        timestamp: 1794791000000,
        message,
      }],
    }],
  };
}

function postSigned(body, envOverride = env) {
  const raw = JSON.stringify(body);
  return worker.fetch(webhookRequest(raw, { "x-hub-signature-256": sign(raw) }), envOverride);
}

// In-memory UserStore Durable Object (same shape as live-monitor.test.js):
// backs the bare-number pick's last-list storage in tests.
function fakeKv() {
  const store = new Map();
  const storage = {
    get: async (key) => store.get(key),
    put: async (key, value) => { store.set(key, value); },
    delete: async (key) => { store.delete(key); },
    list: async ({ prefix = "", startAfter, limit } = {}) => {
      let entries = [...store].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      if (startAfter) entries = entries.filter(([key]) => key > startAfter);
      return new Map(limit ? entries.slice(0, limit) : entries);
    },
    setAlarm: async () => {},
  };
  const object = new UserStore({ storage }, env);
  return {
    store,
    object,
    idFromName: (name) => name,
    get: () => ({ fetch: (url, options) => object.fetch(new Request(url, options)) }),
  };
}

// Send one Messenger text and capture the outbound Send API calls.
async function sendMessengerText(text, { senderId = SENDER_ID, envOverride = env, stub = stubMessengerApi } = {}) {
  const calls = [];
  const restore = stub(calls);
  try {
    const response = await postSigned(messageEvent({ text }, senderId), envOverride);
    assert.equal(response.status, 200);
    return calls;
  } finally {
    restore();
  }
}

// Tap a quick reply and capture the outbound Send API calls. The text
// mirrors the button label (what the user would see); the payload is
// what the bot routes on.
async function tapQuickReply(payload, { senderId = SENDER_ID, envOverride = env } = {}) {
  const calls = [];
  const restore = stubMessengerApi(calls);
  try {
    const text = payload === "list|next" ? "التالي ⏭" : payload === "list|prev" ? "⏮ السابق" : "";
    const response = await postSigned(messageEvent({ text, quick_reply: { payload } }, senderId), envOverride);
    assert.equal(response.status, 200);
    return calls;
  } finally {
    restore();
  }
}

// Numbered "N. label" lines across every text message of a turn.
function numberedLines(calls) {
  return calls
    .map((call) => call.payload?.message?.text ?? "")
    .flatMap((text) => text.split("\n"))
    .filter((line) => /^\d+\. /u.test(line));
}

// Test-local Arabic normalizer (same folds as the bot's normalize, for the
// ordering check only): strip diacritics/tatweel, fold alef forms.
const foldArabic = (value) => String(value ?? "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f\u064b-\u0652\u0640\u0651\u0653-\u0655]/gu, "")
  .replace(/[أإآٱ]/gu, "ا")
  .replace(/ى/gu, "ي")
  .replace(/ة/gu, "ه")
  .replace(/\s+/gu, " ")
  .trim();

// Stub the Send API: capture every outbound call, answer like Meta.
function stubMessengerApi(calls) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      headers: options?.headers ?? {},
      payload: options?.body ? JSON.parse(options.body) : null,
    });
    return Response.json({ recipient_id: SENDER_ID, message_id: "mid.test-1" });
  };
  return () => { globalThis.fetch = realFetch; };
}

const firstMeaning = (value) => String(value ?? "").split(/[،,]/u)[0].trim();

// One English query that resolves to exactly one candidate AND has a
// prebuilt voice, so the round-trip can assert text-then-voice.
const SINGLE = (() => {
  for (const record of records) {
    const query = firstMeaning(record.english);
    if (!query || query.length < 3 || !audioManifest[String(record.id)]) continue;
    const result = localDictionaryCandidates(query, 10);
    if (result.ok && result.candidates.length === 1) return { query, record };
  }
  return null;
})();

// One typo query with suggestions but no local match, found the same way:
// delete one middle letter of a long first-segment word (whole-cell fuzzy
// misses it; first-segment did-you-mean catches it).
const TYPO = (() => {
  const typo = (s) => { const i = Math.floor(s.length / 2); return s.slice(0, i) + s.slice(i + 1); };
  for (const record of records) {
    for (const field of ["english", "translation_fr", "translation_de"]) {
      const seg = firstMeaning(record[field]);
      if (!seg || seg.length < 8 || /\s/u.test(seg)) continue;
      const query = typo(seg);
      if (query.length < 5) continue;
      const suggestions = suggestSimilar(query, 3);
      if (!localDictionaryCandidates(query, 10).ok && suggestions.length) return { query, suggestions };
    }
  }
  return null;
})();

test("messenger verification accepts the right token and returns the challenge", async () => {
  const response = await worker.fetch(
    new Request(`https://bot.test/messenger-webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=challenge-123`),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "challenge-123");
});

test("messenger verification rejects a wrong token, a wrong mode, and a missing token", async () => {
  const wrongToken = await worker.fetch(
    new Request(`https://bot.test/messenger-webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=x`),
    env,
  );
  assert.equal(wrongToken.status, 403);
  const wrongMode = await worker.fetch(
    new Request(`https://bot.test/messenger-webhook?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=x`),
    env,
  );
  assert.equal(wrongMode.status, 403);
  const noToken = await worker.fetch(
    new Request(`https://bot.test/messenger-webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=x`),
    {},
  );
  assert.equal(noToken.status, 403);
});

test("messenger POST rejects a missing or bad signature and sends nothing", async () => {
  const calls = [];
  const restore = stubMessengerApi(calls);
  try {
    const body = JSON.stringify(messageEvent({ text: "hello" }));
    const missing = await worker.fetch(webhookRequest(body), env);
    assert.equal(missing.status, 403);
    const bad = await worker.fetch(webhookRequest(body, { "x-hub-signature-256": `sha256=${"0".repeat(64)}` }), env);
    assert.equal(bad.status, 403);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("messenger POST 403s when the Messenger env vars are unset", async () => {
  const body = JSON.stringify(messageEvent({ text: "hello" }));
  const response = await worker.fetch(webhookRequest(body, { "x-hub-signature-256": sign(body) }), {});
  assert.equal(response.status, 403);
});

test("messenger POST accepts a valid signature but ignores non-page objects", async () => {
  const calls = [];
  const restore = stubMessengerApi(calls);
  try {
    const response = await postSigned({ object: "user", entry: [] });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "EVENT_RECEIVED");
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("messenger POST ignores echoes and delivery receipts", async () => {
  const calls = [];
  const restore = stubMessengerApi(calls);
  try {
    const echo = await postSigned(messageEvent({ text: "hello", is_echo: true }));
    assert.equal(echo.status, 200);
    const receiptBody = {
      object: "page",
      entry: [{ id: PAGE_ID, messaging: [{ sender: { id: SENDER_ID }, recipient: { id: PAGE_ID }, delivery: { mids: ["mid.1"] } }] }],
    };
    const receipt = await postSigned(receiptBody);
    assert.equal(receipt.status, 200);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("messenger search round-trip: one exact match sends the card text then the voice 3 times", async () => {
  assert.ok(SINGLE, "expected a single-candidate voiced word in the dictionary");
  const calls = [];
  const restore = stubMessengerApi(calls);
  try {
    const response = await postSigned(messageEvent({ text: SINGLE.query }));
    assert.equal(response.status, 200);
    // typing_on first, then the card text, then the voice 3 times.
    assert.equal(calls.length, 2 + MESSENGER_VOICE_REPEATS, `expected typing + text + ${MESSENGER_VOICE_REPEATS} audio, got ${JSON.stringify(calls.map((c) => c.payload?.message ?? c.payload?.sender_action))}`);
    const [typingCall, textCall, ...audioCalls] = calls;
    assert.equal(typingCall.payload.sender_action, "typing_on", "the user must see 'typing...' while the card is computed");
    assert.equal(typingCall.payload.message, undefined, "a sender action carries no message");
    assert.equal(audioCalls.length, MESSENGER_VOICE_REPEATS);
    for (const call of calls) {
      assert.equal(call.url, MESSENGER_SEND_URL);
      assert.equal(call.headers.authorization, `Bearer ${PAGE_TOKEN}`);
      assert.equal(call.payload.recipient.id, SENDER_ID);
      assert.equal(call.payload.messaging_type, "RESPONSE");
    }
    assert.match(textCall.payload.message.text, /\*Word:\*/u);
    assert.ok(textCall.payload.message.text.includes(String(SINGLE.record.coptic)), "card must carry the Coptic headword");
    assert.doesNotMatch(textCall.payload.message.text, /<b>|<\/b>/u);
    for (const audioCall of audioCalls) {
      assert.equal(audioCall.payload.message.attachment.type, "audio");
      const audioUrl = audioCall.payload.message.attachment.payload.url;
      assert.ok(audioUrl.startsWith(`${AUDIO_BASE}/`), audioUrl);
      assert.ok(audioUrl.includes(`?v=${audioVersions[String(SINGLE.record.id)]}`), audioUrl);
      assert.equal(audioCall.payload.message.attachment.payload.is_reusable, true, "is_reusable must be sent so Meta caches the file");
      assert.equal(
        decodeURIComponent(audioUrl.slice(AUDIO_BASE.length + 1).split("?v=")[0]),
        audioManifest[String(SINGLE.record.id)],
      );
    }
  } finally {
    restore();
  }
});

test("messenger search round-trip: several matches send page 1 (15) with a Next quick reply", async () => {
  const calls = [];
  const restore = stubMessengerApi(calls);
  try {
    const response = await postSigned(messageEvent({ text: "نور" }));
    assert.equal(response.status, 200);
    // "نور" has 45 candidates at the 200 limit (was 10): page 1 shows
    // the first 15 in one text message, and the list message is the LAST
    // (and only) message of the turn, so its quick replies stay visible.
    assert.equal(calls.length, 2, "typing_on + one list text, no voice, nothing after the list");
    assert.equal(calls[0].payload.sender_action, "typing_on");
    const message = calls[1].payload.message;
    assert.match(message.text, /^اختر من الاقتراحات التالية:/u);
    const lines = message.text.split("\n");
    assert.equal(lines[1], "أرسل رقمًا للاختيار.", "the pick instruction sits above the items, under the title");
    assert.equal(lines[2], "صفحة 1 من 3", "page indicator under the instruction");
    const items = lines.filter((line) => /^\d+\. /u.test(line));
    assert.equal(items.length, 15, "page 1 shows the first 15 of 45");
    assert.match(message.text, /\n1\. /u);
    assert.doesNotMatch(message.text, /<b>|<\/b>| — /u, "labels are word-only: no meaning, no em-dash separator");
    assert.ok(Array.isArray(message.quick_replies) && message.quick_replies.length > 1);
    // 1 nav + 12 picks: quick replies cap at Meta's 13, nav first so it
    // always survives the cap.
    assert.equal(message.quick_replies.length, 13, "quick replies cap at Meta's 13");
    assert.equal(message.quick_replies[0].title, "التالي ⏭");
    assert.equal(message.quick_replies[0].payload, "list|next");
    assert.ok(!message.quick_replies.some((r) => r.payload === "list|prev"), "no Previous on page 1");
    for (const reply of message.quick_replies.slice(1)) {
      assert.equal(reply.content_type, "text");
      assert.ok([...reply.title].length <= 20, `title over 20 chars: ${reply.title}`);
      assert.match(reply.payload, new RegExp(`^${MESSENGER_PICK_PREFIX}\\d+$`, "u"));
    }
  } finally {
    restore();
  }
});

test("messenger no-result search offers did-you-mean suggestions", async () => {
  // A one-letter deletion of a long first-segment word: the local search
  // (whole-cell fuzzy) misses it, while did-you-mean (first-segment
  // Levenshtein) still catches it.
  assert.ok(TYPO, "expected a typo query with suggestions but no local match");
  const calls = [];
  const restore = stubMessengerApi(calls);
  try {
    const response = await postSigned(messageEvent({ text: TYPO.query }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2, "typing_on + the suggestions text");
    assert.equal(calls[0].payload.sender_action, "typing_on");
    const message = calls[1].payload.message;
    // Header language follows the query's UI language (the Telegram bot's
    // own uiTextFor: Latin queries get the English header on a cold cache).
    assert.match(message.text, /^🤔 (هل تقصد|Did you mean|Meinten Sie|Vouliez-vous dire)/u);
    assert.equal(message.text.split("\n")[1], "أرسل رقمًا للاختيار.");
    assert.ok(message.text.includes(TYPO.suggestions[0].label), `expected suggestion ${TYPO.suggestions[0].label}`);
    assert.ok(Array.isArray(message.quick_replies) && message.quick_replies.length === TYPO.suggestions.length);
    assert.equal(message.quick_replies[0].payload, `${MESSENGER_PICK_PREFIX}${TYPO.suggestions[0].index}`);
  } finally {
    restore();
  }
});

test("messenger quick-reply pick sends the full word card and the voice 3 times", async () => {
  const suggestion = suggestSimilar("أشكرك", 3)[0];
  assert.ok(suggestion);
  const record = records[suggestion.index];
  assert.ok(audioManifest[String(record.id)], "the picked word must have a prebuilt voice for the x3 check");
  const calls = [];
  const restore = stubMessengerApi(calls);
  try {
    const response = await postSigned(messageEvent({
      text: suggestion.label,
      quick_reply: { payload: `${MESSENGER_PICK_PREFIX}${suggestion.index}` },
    }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2 + MESSENGER_VOICE_REPEATS, "typing_on + text + 3 audio sends");
    assert.equal(calls[0].payload.sender_action, "typing_on");
    const text = calls[1].payload.message.text;
    assert.ok(text.includes(String(record.coptic)), "card must carry the Coptic headword");
    assert.ok(text.includes(suggestion.label), "card must carry the picked word's meaning");
    assert.doesNotMatch(text, /<b>|<\/b>/u);
    for (const audioCall of calls.slice(2)) {
      assert.equal(audioCall.payload.message.attachment.type, "audio");
      assert.equal(audioCall.payload.message.attachment.payload.url, prebuiltAudioUrl(env, record.id));
      assert.equal(audioCall.payload.message.attachment.payload.is_reusable, true);
    }
  } finally {
    restore();
  }
});

test("messenger exact match among many candidates sends the card directly, not the list", async () => {
  // ⲁⲑⲙⲟϣⲓ: exactCount 1 but 10 candidates at the old cap — the live bug
  // showed the 10-item list; Telegram shows the card.
  assert.equal(localDictionaryCandidates("ⲁⲑⲙⲟϣⲓ", 10).exactCount, 1);
  assert.equal(localDictionaryCandidates("ⲁⲑⲙⲟϣⲓ", 10).candidates.length, 10);
  const calls = await sendMessengerText("ⲁⲑⲙⲟϣⲓ");
  assert.equal(calls.length, 2 + MESSENGER_VOICE_REPEATS, "typing_on + card text + voice 3 times");
  assert.equal(calls[0].payload.sender_action, "typing_on");
  const text = calls[1].payload.message.text;
  assert.ok(text.includes("ⲁⲑⲙⲟϣⲓ"), "card must carry the exact word");
  assert.doesNotMatch(text, /^اختر من الاقتراحات التالية:/u, "must not be the suggestions list");
  assert.ok(!calls[1].payload.message.quick_replies, "a card carries no quick replies");
  const record = records.find((r) => r.coptic === "ⲁⲑⲙⲟϣⲓ");
  for (const audioCall of calls.slice(2)) {
    assert.equal(audioCall.payload.message.attachment.payload.url, prebuiltAudioUrl(env, record.id));
  }
});

test("messenger same-spelling exact matches in several rows open the card", async () => {
  // ⲁⲃⲁϫⲏⲓⲛⲓ: exactCount 2, one normalized headword — WhatsApp dedupes
  // same-spelling rows to one word, so the card opens directly.
  assert.ok(localDictionaryCandidates("ⲁⲃⲁϫⲏⲓⲛⲓ", 200).exactCount > 1);
  const calls = await sendMessengerText("ⲁⲃⲁϫⲏⲓⲛⲓ");
  assert.ok(calls.length >= 2);
  assert.equal(calls[0].payload.sender_action, "typing_on");
  const text = calls[1].payload.message.text;
  assert.ok(text.includes("ⲁⲃⲁϫⲏⲓⲛⲓ"));
  assert.doesNotMatch(text, /^اختر من الاقتراحات التالية:/u, "same word, several rows: card, not list");
});

test("messenger list order: labels starting with the query come first", async () => {
  // 'مال': WhatsApp's verified example — the first 38 labels all start
  // with "مال", the rest follow. The Messenger list must partition the
  // same way; localDictionaryCandidates alone does NOT (it sorts partials
  // by length difference). Lists are paginated (15 per page), so the
  // partition is checked across the first three pages (45 labels: 38
  // starters, then 7 contains).
  const kvEnv = { ...env, USERS: fakeKv() };
  const page1 = await sendMessengerText("مال", { envOverride: kvEnv });
  const labels1 = numberedLines(page1).map((line) => line.replace(/^\d+\. /u, ""));
  assert.equal(labels1.length, 15, "page 1 shows 15");
  const page2 = await tapQuickReply("list|next", { envOverride: kvEnv });
  const labels2 = numberedLines(page2).map((line) => line.replace(/^\d+\. /u, ""));
  assert.equal(labels2.length, 15, "page 2 shows 15");
  const page3 = await tapQuickReply("list|next", { envOverride: kvEnv });
  const labels3 = numberedLines(page3).map((line) => line.replace(/^\d+\. /u, ""));
  assert.equal(labels3.length, 15, "page 3 shows 15");
  const labels = [...labels1, ...labels2, ...labels3];
  assert.ok(labels.length > 0);
  const starts = labels.map((label) => foldArabic(label).startsWith(foldArabic("مال")));
  assert.ok(starts[0], `first label must start with the query, got: ${labels[0]}`);
  assert.ok(starts.some(Boolean) && starts.some((s) => !s), "mixed list: some labels start with the query, some do not");
  let seenRest = false;
  for (const s of starts) {
    if (!s) seenRest = true;
    else assert.ok(!seenRest, "a query-starting label appeared after a contains label");
  }
});

test("messenger paginated list: Next/Prev quick replies turn pages, 15 per page", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  // Page 1: one text message, 15 items, Next only.
  const page1 = await sendMessengerText("نور", { envOverride: kvEnv });
  assert.equal(page1.length, 2, "typing_on + one list text: 15 items fit one message");
  assert.equal(page1[0].payload.sender_action, "typing_on");
  assert.ok(page1[1].payload.message.text.length <= 2000, "page fits Meta's 2000-char text limit");
  assert.equal(numberedLines(page1).length, 15);
  assert.match(page1[1].payload.message.text, /صفحة 1 من 3/u);
  const qr1 = page1[1].payload.message.quick_replies;
  assert.equal(qr1.length, 13, "1 nav + 12 picks");
  assert.equal(qr1[0].payload, "list|next");
  assert.ok(!qr1.some((r) => r.payload === "list|prev"), "no Previous on page 1");
  // Page 2: different 15 items, Prev + Next.
  const page2 = await tapQuickReply("list|next", { envOverride: kvEnv });
  assert.equal(numberedLines(page2).length, 15);
  assert.match(page2[1].payload.message.text, /صفحة 2 من 3/u);
  assert.notDeepEqual(numberedLines(page2), numberedLines(page1), "page 2 shows different items");
  const qr2 = page2[1].payload.message.quick_replies;
  assert.equal(qr2[0].payload, "list|prev");
  assert.equal(qr2[1].payload, "list|next");
  // Page 3: last page, Prev only.
  const page3 = await tapQuickReply("list|next", { envOverride: kvEnv });
  assert.equal(numberedLines(page3).length, 15);
  assert.match(page3[1].payload.message.text, /صفحة 3 من 3/u);
  const qr3 = page3[1].payload.message.quick_replies;
  assert.equal(qr3[0].payload, "list|prev");
  assert.ok(!qr3.some((r) => r.payload === "list|next"), "no Next on the last page");
  // Next on the last page: short end text, no list.
  const end = await tapQuickReply("list|next", { envOverride: kvEnv });
  assert.equal(end[1].payload.message.text, "لا توجد نتائج أخرى.");
  // Prev returns to page 2.
  const back = await tapQuickReply("list|prev", { envOverride: kvEnv });
  assert.match(back[1].payload.message.text, /صفحة 2 من 3/u);
  assert.equal(numberedLines(back).length, 15);
});

test("messenger typed التالي/السابق pages the list", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await sendMessengerText("نور", { envOverride: kvEnv });
  const page2 = await sendMessengerText("التالي", { envOverride: kvEnv });
  assert.match(page2[1].payload.message.text, /صفحة 2 من 3/u);
  assert.equal(numberedLines(page2).length, 15);
  const page1 = await sendMessengerText("السابق", { envOverride: kvEnv });
  assert.match(page1[1].payload.message.text, /صفحة 1 من 3/u);
  const end = await sendMessengerText("السابق", { envOverride: kvEnv });
  assert.equal(end[1].payload.message.text, "لا توجد نتائج أخرى.");
  // The emoji form of the button label navigates too.
  const page2b = await sendMessengerText("التالي ⏭", { envOverride: kvEnv });
  assert.match(page2b[1].payload.message.text, /صفحة 2 من 3/u);
});

test("messenger bare number on page 2 picks the correct global result", async () => {
  const kv = fakeKv();
  const kvEnv = { ...env, USERS: kv };
  await sendMessengerText("نور", { envOverride: kvEnv });
  await tapQuickReply("list|next", { envOverride: kvEnv });
  const stored = kv.store.get(`messenger:lastlist:${SENDER_ID}`);
  assert.ok(stored && Array.isArray(stored.indices) && stored.indices.length === 45, "full list stored with page 2");
  assert.equal(stored.page, 1);
  const expected = records[stored.indices[15]];
  const pick1 = await sendMessengerText("1", { envOverride: kvEnv });
  assert.ok(pick1[1].payload.message.text.includes(String(expected.coptic)), "page 2 number 1 opens the 16th result");
  assert.doesNotMatch(pick1[1].payload.message.text, /^اختر من الاقتراحات التالية:/u, "a pick is a card, not another list");
  const expected15 = records[stored.indices[29]];
  const pick15 = await sendMessengerText("15", { envOverride: kvEnv });
  assert.ok(pick15[1].payload.message.text.includes(String(expected15.coptic)), "page 2 number 15 opens the 30th result");
  // And page 1's number 1 is a different word.
  await tapQuickReply("list|prev", { envOverride: kvEnv });
  const pick1Page1 = await sendMessengerText("1", { envOverride: kvEnv });
  assert.ok(pick1Page1[1].payload.message.text.includes(String(records[stored.indices[0]].coptic)));
  assert.notEqual(pick1Page1[1].payload.message.text, pick1[1].payload.message.text);
});

test("messenger Next on a single-page list does not appear", async () => {
  assert.ok(TYPO, "expected a typo query with suggestions but no local match");
  const kvEnv = { ...env, USERS: fakeKv() };
  const calls = await sendMessengerText(TYPO.query, { envOverride: kvEnv });
  const message = calls[1].payload.message;
  assert.ok(Array.isArray(message.quick_replies));
  assert.ok(!message.quick_replies.some((r) => r.payload === "list|next" || r.payload === "list|prev"), "single-page list has no nav buttons");
  const end = await sendMessengerText("التالي", { envOverride: kvEnv });
  assert.equal(end[1].payload.message.text, "لا توجد نتائج أخرى.");
});

test("messenger stale list state: expired list falls back, pre-paging list asks for a fresh search", async () => {
  const kv = fakeKv();
  const kvEnv = { ...env, USERS: kv };
  const key = `messenger:lastlist:${SENDER_ID}`;
  // Expired (11 minutes old): "التالي" behaves as today — no live list,
  // so parity answers that there is no active list.
  kv.store.set(key, { indices: [0, 1, 2], labels: ["a", "b", "c"], title: "اختر من الاقتراحات التالية:", at: Date.now() - 11 * 60 * 1000, page: 0 });
  const expired = await sendMessengerText("التالي", { envOverride: kvEnv });
  assert.match(expired[1].payload.message.text, /لا توجد قائمة نشطة/u);
  // Pre-paging shape (indices but no labels/title): the list cannot be
  // re-rendered, so the pager asks for a fresh search.
  kv.store.set(key, { indices: [0, 1, 2], at: Date.now() });
  const legacy = await tapQuickReply("list|next", { envOverride: kvEnv });
  assert.equal(legacy[1].payload.message.text, "انتهت هذه القائمة، ابحث عن الكلمة مرة أخرى.");
  // And a nav tap with no stored list at all says the same.
  kv.store.delete(key);
  const none = await tapQuickReply("list|next", { envOverride: kvEnv });
  assert.equal(none[1].payload.message.text, "انتهت هذه القائمة، ابحث عن الكلمة مرة أخرى.");
});

test("messenger voice repeats reuse Meta's attachment id instead of re-fetching the URL", async () => {
  assert.ok(SINGLE, "expected a single-candidate voiced word in the dictionary");
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const payload = options?.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), payload });
    const isAudio = payload?.message?.attachment?.type === "audio";
    return Response.json({
      recipient_id: SENDER_ID,
      message_id: "mid.test-1",
      ...(isAudio ? { attachment_id: "att-test-1" } : {}),
    });
  };
  try {
    const response = await postSigned(messageEvent({ text: SINGLE.query }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2 + MESSENGER_VOICE_REPEATS);
    assert.equal(calls[0].payload.sender_action, "typing_on");
    const [first, second, third] = calls.slice(2);
    assert.equal(first.payload.message.attachment.payload.url, prebuiltAudioUrl(env, SINGLE.record.id));
    assert.equal(first.payload.message.attachment.payload.is_reusable, true);
    for (const repeat of [second, third]) {
      assert.equal(repeat.payload.message.attachment.payload.attachment_id, "att-test-1");
      assert.equal(repeat.payload.message.attachment.payload.url, undefined, "repeats must not re-send the URL");
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("sendMessengerMessage returns Meta's attachment id", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ recipient_id: SENDER_ID, message_id: "mid.1", attachment_id: "att-9" });
  try {
    const result = await sendMessengerMessage(env, SENDER_ID, messengerAudioMessage("https://example.invalid/x.ogg"));
    assert.equal(result.ok, true);
    assert.equal(result.attachmentId, "att-9");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("sendMessengerSenderAction posts typing_on / typing_off with no message payload", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), payload: JSON.parse(options.body), auth: options.headers?.authorization });
    return Response.json({ recipient_id: SENDER_ID });
  };
  try {
    const on = await sendMessengerSenderAction(env, SENDER_ID, "typing_on");
    assert.equal(on.ok, true);
    assert.equal(on.recipientId, SENDER_ID);
    const off = await sendMessengerSenderAction(env, SENDER_ID, "typing_off");
    assert.equal(off.ok, true);
    assert.equal(calls.length, 2);
    for (const [i, action] of ["typing_on", "typing_off"].entries()) {
      assert.equal(calls[i].url, MESSENGER_SEND_URL);
      assert.equal(calls[i].auth, `Bearer ${PAGE_TOKEN}`);
      assert.equal(calls[i].payload.recipient.id, SENDER_ID);
      assert.equal(calls[i].payload.sender_action, action);
      assert.equal(calls[i].payload.messaging_type, "RESPONSE");
      assert.equal(calls[i].payload.message, undefined, "a sender action carries no message");
    }
    assert.equal((await sendMessengerSenderAction({}, SENDER_ID, "typing_on")).error, "missing-page-token");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("messenger plan failure turns typing off and stays silent", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ payload: JSON.parse(options.body) });
    return Response.json({ recipient_id: SENDER_ID, message_id: "mid.test-1" });
  };
  const planFor = {
    text: async () => { throw new Error("boom"); },
    pick: async () => null,
  };
  const event = {
    sender: { id: SENDER_ID },
    recipient: { id: PAGE_ID },
    timestamp: 1794791000000,
    message: { mid: "mid.1", text: "hello" },
  };
  assert.equal(await handleMessengerMessaging(env, event, planFor, fetchImpl), false);
  assert.deepEqual(calls.map((c) => c.payload.sender_action), ["typing_on", "typing_off"]);
  assert.ok(calls.every((c) => c.payload.message === undefined));
});

test("messengerVoiceUrl priority: recorded human, then prebuilt, then Joanna, then none", () => {
  const recordedBase = "https://example.invalid/recorded";
  const rec55 = records.find((r) => String(r.id) === "55");
  const rec25344 = records.find((r) => String(r.id) === "25344");
  assert.ok(rec55 && rec25344, "expected the two recorded words in the dictionary");
  // Recorded wins over prebuilt when the files are hosted (base set).
  assert.equal(messengerVoiceUrl({ ...env, RECORDED_AUDIO_BASE_URL: recordedBase }, rec55), `${recordedBase}/55.ogg`);
  assert.equal(messengerVoiceUrl({ ...env, RECORDED_AUDIO_BASE_URL: `${recordedBase}/` }, rec25344), `${recordedBase}/25344.ogg`);
  // No host configured: no recorded URL is served (never a dead URL) —
  // the word falls through to its prebuilt voice.
  assert.equal(recordedAudioUrl(env, 55), null);
  assert.equal(messengerVoiceUrl(env, rec55), prebuiltAudioUrl(env, 55));
  assert.equal(messengerVoiceUrl(env, rec25344), prebuiltAudioUrl(env, 25344));
  // A word with no recording falls back to prebuilt.
  assert.ok(!Object.hasOwn({ 55: 1, 25344: 1 }, String(SINGLE.record.id)));
  assert.equal(messengerVoiceUrl(env, SINGLE.record), prebuiltAudioUrl(env, SINGLE.record.id));
  // Joanna is the last tier, only with HUMAN_AUDIO on and no prebuilt
  // file; without the flag there is no voice at all for such an id.
  const ghost = { id: 999999999 };
  assert.equal(messengerVoiceUrl({ ...env, HUMAN_AUDIO: "on" }, ghost), humanAudioUrl({ ...env, HUMAN_AUDIO: "on" }, 999999999));
  assert.ok(messengerVoiceUrl({ ...env, HUMAN_AUDIO: "on" }, ghost).includes("audio-human/999999999.ogg"));
  assert.equal(messengerVoiceUrl(env, ghost), null);
  // A record with no id has no voice.
  const noId = records.find((r) => r.id == null);
  assert.ok(noId, "expected at least one record without an id");
  assert.equal(messengerVoiceUrl(env, noId), null);
  assert.equal(messengerVoiceUrl(env, null), null);
});

test("messenger bare number picks from the last list, same card as the quick reply", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  const listCalls = await sendMessengerText("نور", { envOverride: kvEnv });
  assert.equal(listCalls.length, 2, "typing_on + the list text");
  assert.equal(listCalls[0].payload.sender_action, "typing_on");
  const lines = listCalls[1].payload.message.text.split("\n");
  assert.equal(lines[1], "أرسل رقمًا للاختيار.");
  const label2 = lines.find((line) => line.startsWith("2. "))?.slice(3);
  assert.ok(label2, "expected a second list item");
  assert.equal(listCalls[1].payload.message.quick_replies[0].payload, "list|next", "page 1 carries the Next nav first");
  const pickPayload = listCalls[1].payload.message.quick_replies[2].payload;
  assert.match(pickPayload, new RegExp(`^${MESSENGER_PICK_PREFIX}\\d+$`, "u"));
  const numCalls = await sendMessengerText("2", { envOverride: kvEnv });
  const numCard = numCalls[1].payload.message.text;
  assert.ok(numCard.includes(label2), "the number pick must open item 2's card");
  assert.doesNotMatch(numCard, /^اختر من الاقتراحات التالية:/u, "a pick is a card, not another list");
  // The quick-reply tap itself, by payload, opens the same card.
  const tapCalls = [];
  const restore = stubMessengerApi(tapCalls);
  try {
    const response = await postSigned(messageEvent({ text: label2, quick_reply: { payload: pickPayload } }), kvEnv);
    assert.equal(response.status, 200);
  } finally {
    restore();
  }
  assert.equal(tapCalls[1].payload.message.text, numCard);
});

test("messenger Arabic-Indic digits pick from the last list", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await sendMessengerText("نور", { envOverride: kvEnv });
  const western = await sendMessengerText("2", { envOverride: kvEnv });
  const arabicIndic = await sendMessengerText("٢", { envOverride: kvEnv });
  assert.equal(arabicIndic[1].payload.message.text, western[1].payload.message.text);
  assert.doesNotMatch(arabicIndic[1].payload.message.text, /^اختر من الاقتراحات التالية:/u);
});

test("messenger out-of-range number falls back to search", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await sendMessengerText("نور", { envOverride: kvEnv });
  const otherSender = "111222333";
  const freshCalls = await sendMessengerText("46", { senderId: otherSender, envOverride: kvEnv });
  const rangedCalls = await sendMessengerText("46", { envOverride: kvEnv });
  assert.equal(rangedCalls.length, freshCalls.length, "out of range (نور has 45 items): same reply as a fresh search for 46");
  assert.equal(rangedCalls[1].payload.message.text, freshCalls[1].payload.message.text);
});

test("messenger number with no stored list is a search, per sender", async () => {
  const kvEnv = { ...env, USERS: fakeKv() };
  await sendMessengerText("نور", { envOverride: kvEnv });
  const calls = await sendMessengerText("2", { senderId: "999888777", envOverride: kvEnv });
  assert.match(calls[1].payload.message.text, /^اختر من الاقتراحات التالية:/u, "another sender has no list: 2 is searched, not picked");
});

test("messenger /start returns the welcome text", async () => {
  const calls = [];
  const restore = stubMessengerApi(calls);
  try {
    const response = await postSigned(messageEvent({ text: "/start" }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2, "typing_on + welcome text");
    assert.equal(calls[0].payload.sender_action, "typing_on");
    assert.match(calls[1].payload.message.text, /القاموس القبطي/u);
  } finally {
    restore();
  }
});

test("prebuiltAudioUrl returns the manifest file with ?v=, and null without a manifest entry", () => {
  assert.ok(SINGLE, "expected a single-candidate voiced word in the dictionary");
  const url = prebuiltAudioUrl(env, SINGLE.record.id);
  assert.ok(url.startsWith(`${AUDIO_BASE}/`), url);
  assert.ok(url.includes(`?v=${audioVersions[String(SINGLE.record.id)]}`), url);
  assert.equal(
    decodeURIComponent(url.slice(AUDIO_BASE.length + 1).split("?v=")[0]),
    audioManifest[String(SINGLE.record.id)],
  );
  assert.equal(prebuiltAudioUrl(env, 999999999), null);
  assert.equal(prebuiltAudioUrl(env, null), null);
});

test("plainTextCard strips HTML and keeps *bold* labels", () => {
  assert.equal(
    plainTextCard("<b>الكلمة:</b> ⲁⲑⲙⲟϣⲓ\n<b>المعنى:</b> x &amp; y"),
    "*الكلمة:* ⲁⲑⲙⲟϣⲓ\n*المعنى:* x & y",
  );
  assert.equal(plainTextCard(""), "");
});

test("buildQuickReplies caps at 13 and truncates titles to 20 chars", () => {
  const items = Array.from({ length: 15 }, (_, i) => ({ title: `word-${i}`, payload: `${MESSENGER_PICK_PREFIX}${i}` }));
  const replies = buildQuickReplies(items);
  assert.equal(replies.length, 13);
  assert.equal(replies[0].content_type, "text");
  assert.equal(replies[0].payload, `${MESSENGER_PICK_PREFIX}0`);
  const long = buildQuickReplies([{ title: "abcdefghijklmnopqrstuvwxyz0123456789", payload: "pick|1" }]);
  assert.equal([...long[0].title].length, 20);
  assert.equal(long[0].title, "abcdefghijklmnopqrst");
  assert.deepEqual(buildQuickReplies([{ title: "  ", payload: "pick|1" }, { title: "x", payload: "" }]), []);
});

test("verifyMessengerSignature accepts a good signature and rejects a bad one", async () => {
  const rawBody = JSON.stringify({ object: "page", entry: [] });
  assert.equal(await verifyMessengerSignature(rawBody, sign(rawBody), APP_SECRET), true);
  assert.equal(await verifyMessengerSignature(rawBody, `sha256=${"0".repeat(64)}`, APP_SECRET), false);
  assert.equal(await verifyMessengerSignature(rawBody, null, APP_SECRET), false);
  assert.equal(await verifyMessengerSignature(rawBody, sign(rawBody), ""), false);
  assert.equal(await verifyMessengerSignature(`${rawBody} `, sign(rawBody), APP_SECRET), false);
});

test("messengerAttachmentMessage shapes image/video by URL with is_reusable", () => {
  assert.deepEqual(messengerAttachmentMessage("video", "https://example.invalid/x.mp4"), {
    attachment: { type: "video", payload: { url: "https://example.invalid/x.mp4", is_reusable: true } },
  });
  assert.equal(messengerAttachmentMessage("bogus", "https://example.invalid/x").attachment.type, "image");
});

test("messenger parity quick reply routes the raw payload to planFor.pick", async () => {
  const seen = [];
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), payload: JSON.parse(options.body) });
    return Response.json({ recipient_id: SENDER_ID, message_id: "mid.test-1" });
  };
  const planFor = {
    text: async () => { throw new Error("text must not run for a quick-reply tap"); },
    pick: async (payload, senderId) => {
      seen.push([payload, senderId]);
      return { texts: [{ text: "ok" }], voiceUrl: null };
    },
  };
  const event = {
    sender: { id: SENDER_ID },
    recipient: { id: PAGE_ID },
    timestamp: 1794791000000,
    message: { mid: "mid.qr", text: "المستوى الأول", quick_reply: { payload: "learn|level:m_learn_l1" } },
  };
  assert.equal(await handleMessengerMessaging(env, event, planFor, fetchImpl), true);
  assert.deepEqual(seen, [["learn|level:m_learn_l1", SENDER_ID]]);
  assert.equal(calls.length, 2, "typing_on + the reply text");
  assert.equal(calls[0].payload.sender_action, "typing_on");
  assert.equal(calls[1].payload.message.text, "ok");
});

test("messenger plan sends attachments, then photo, then texts, then runs the task", async () => {
  const calls = [];
  const tasks = [];
  const fetchImpl = async (url, options = {}) => {
    const body = options?.body;
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      calls.push({ kind: "form", file: body.get("filedata") });
    } else {
      calls.push({ kind: "json", payload: JSON.parse(body) });
    }
    return Response.json({ recipient_id: SENDER_ID, message_id: "mid.test-1" });
  };
  const planFor = {
    text: async () => ({
      attachments: [
        { type: "video", url: "https://example.invalid/lesson.mp4" },
        { type: "image", url: "https://example.invalid/lesson.jpg" },
      ],
      photoBytes: { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", fileName: "certificate.png" },
      texts: [{ text: "caption" }, { text: "nav", quickReplies: [{ content_type: "text", title: "التالي", payload: "learn|next:x" }] }],
      voiceUrl: null,
      task: { type: "broadcast", text: "hi", from: SENDER_ID },
    }),
    pick: async () => null,
    executeTask: async (task, senderId) => { tasks.push([task, senderId]); },
  };
  const event = {
    sender: { id: SENDER_ID },
    recipient: { id: PAGE_ID },
    timestamp: 1794791000000,
    message: { mid: "mid.1", text: "/learn" },
  };
  assert.equal(await handleMessengerMessaging(env, event, planFor, fetchImpl), true);
  assert.deepEqual(
    calls.map((c) => (c.kind === "form" ? "form" : (c.payload.sender_action ?? c.payload.message.attachment?.type ?? "text"))),
    ["typing_on", "video", "image", "form", "text", "text"],
    "typing first, then attachments, then photo upload, then texts — nothing after the last text",
  );
  assert.equal(calls[4].payload.message.text, "caption");
  assert.equal(calls[5].payload.message.text, "nav");
  assert.ok(Array.isArray(calls[5].payload.message.quick_replies), "quick replies stay on the last text");
  assert.deepEqual(tasks, [[{ type: "broadcast", text: "hi", from: SENDER_ID }, SENDER_ID]]);
});

test("sendMessengerPhotoBytes posts multipart with recipient, message and filedata", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), body: options?.body, headers: options?.headers ?? {} });
    return Response.json({ recipient_id: SENDER_ID, message_id: "mid.photo-1" });
  };
  const result = await sendMessengerPhotoBytes(
    env,
    SENDER_ID,
    { bytes: new Uint8Array([9, 8, 7, 6]), contentType: "image/png", fileName: "certificate.png" },
    fetchImpl,
  );
  assert.equal(result.ok, true);
  assert.equal(result.messageId, "mid.photo-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, MESSENGER_SEND_URL);
  assert.ok(calls[0].body instanceof FormData, "photo upload must be multipart FormData");
  assert.deepEqual(JSON.parse(calls[0].body.get("recipient")), { id: SENDER_ID });
  assert.deepEqual(JSON.parse(calls[0].body.get("message")), { attachment: { type: "image", payload: {} } });
  const file = calls[0].body.get("filedata");
  assert.equal(file.name, "certificate.png");
  assert.equal(file.type, "image/png");
  assert.equal(file.size, 4);
  assert.equal(await sendMessengerPhotoBytes(env, SENDER_ID, { bytes: new Uint8Array([]) }, fetchImpl).then((r) => r.ok), false);
  assert.equal(await sendMessengerPhotoBytes({}, SENDER_ID, { bytes: new Uint8Array([1]) }, fetchImpl).then((r) => r.error), "missing-page-token");
});

// ---------------------------------------------------------------------------
// Parity wiring (src/index.js): the Messenger POST branch constructs
// createMessengerParity with the live sources and routes parity-first.
// These round-trip through worker.fetch with a fake UserStore DO.
// ---------------------------------------------------------------------------

test("wiring: /learn returns the levels menu with quick replies (parity wired)", async () => {
  const kv = fakeKv();
  const calls = await sendMessengerText("/learn", { envOverride: { ...env, USERS: kv } });
  assert.ok(calls.length >= 2, "typing_on + one text should be sent");
  assert.equal(calls[0].payload.sender_action, "typing_on");
  const body = calls[1].payload.message.text;
  assert.match(body, /🎓 \*التعلم\* — اختر المستوى:/u);
  assert.match(body, /1\. .*\(17 درسًا\)/u, "level 1 lists 17 lessons");
  assert.match(body, /2\. .*\(10 درسًا\)/u, "level 2 lists 10 lessons");
  assert.ok(Array.isArray(calls[1].payload.message.quick_replies), "quick replies on the last text");
});

test("wiring: non-admin /admin stays silent (fail-closed, no admin PSID configured)", async () => {
  const calls = await sendMessengerText("/admin", { envOverride: env });
  // Typing on, then off again: no message is ever sent, and no stale
  // "typing..." lingers for the stranger.
  assert.equal(calls.length, 2, "a non-admin must get no reply at all, only typing on/off");
  assert.equal(calls[0].payload.sender_action, "typing_on");
  assert.equal(calls[1].payload.sender_action, "typing_off");
  assert.ok(calls.every((c) => c.payload.message === undefined), "no message payload in either call");
});

test("wiring: bare number routes to the most recent list — dictionary list beats a stale menu", async () => {
  const kv = fakeKv();
  const kvEnv = { ...env, USERS: kv };
  await sendMessengerText("/learn", { envOverride: kvEnv });
  await sendMessengerText("نور", { envOverride: kvEnv });
  const calls = await sendMessengerText("1", { envOverride: kvEnv });
  const texts = calls.map((c) => c.payload.message?.text ?? "").join("\n");
  assert.match(texts, /المعنى/u, "number 1 picks the first dictionary word, not lesson 1");
});

test("wiring: bare number routes to the parity menu when the menu is newest", async () => {
  const kv = fakeKv();
  const kvEnv = { ...env, USERS: kv };
  await sendMessengerText("نور", { envOverride: kvEnv });
  await sendMessengerText("/learn", { envOverride: kvEnv });
  const calls = await sendMessengerText("1", { envOverride: kvEnv });
  const texts = calls.map((c) => c.payload.message?.text ?? "").join("\n");
  assert.match(texts, /درس/u, "number 1 opens the first level's lessons");
});

test("wiring: /cert1 asks for the code; /getcode walks name -> phone -> instructions (no macro URL)", async () => {
  const kv = fakeKv();
  const kvEnv = { ...env, USERS: kv };
  let calls = await sendMessengerText("/cert1", { envOverride: kvEnv });
  assert.match(calls.at(-1).payload.message.text, /أدخل الرقم الكودي/u);
  await sendMessengerText("/cancel", { envOverride: kvEnv });
  calls = await sendMessengerText("/getcode", { envOverride: kvEnv });
  assert.match(calls.at(-1).payload.message.text, /اكتب اسمك الثلاثي/u);
  calls = await sendMessengerText("أحمد محمد علي", { envOverride: kvEnv });
  assert.match(calls.at(-1).payload.message.text, /اكتب رقم موبايلك/u);
  calls = await sendMessengerText("01234567890", { envOverride: kvEnv });
  assert.match(calls.at(-1).payload.message.text, /تعذّر إحضار الرقم الكودي/u, "no macro URL: falls back to the registration instructions, never invents a code");
});

test("wiring: admin /broadcast confirms, then the task sends to Messenger recipients and reports done", async () => {
  const kv = fakeKv();
  kv.store.set("user:msgr:222", { name: "Recipient" });
  const adminEnv = { ...env, USERS: kv, MESSENGER_ADMIN_PSID: SENDER_ID };
  const confirmCalls = await sendMessengerText("/broadcast hello from the bot", { envOverride: adminEnv });
  assert.ok(confirmCalls.length >= 1, "confirm prompt is sent");
  const calls = await sendMessengerText("نعم", { envOverride: adminEnv });
  const texts = calls.map((c) => c.payload.message?.text ?? "");
  assert.ok(texts.some((t) => t.includes("hello from the bot")), "broadcast text reaches recipients");
  assert.ok(texts.some((t) => /تم إرسال البث إلى 2 من 2/u.test(t)), "admin gets the done report");
});

// ---------------------------------------------------------------------------
// First-time name registration (Telegram parity: FIRST_TIME_TEXT /
// isValidFullName / name capture in src/index.js). The gate asks ONLY on
// /start; while waiting, plain text is the name attempt, commands keep
// working, /cancel never clears the gate, and a valid name registers
// the user (welcome + help) and notifies the admin.
// ---------------------------------------------------------------------------

const FIRST_TIME_TEXT = "مرحبًا بك! يبدو أنك تستخدم البوت لأول مرة، الرجاء إدخال اسمك بدون رموز للبدء في استخدام القاموس القبطي الناطق.";
const NAME_RETRY_TEXT = "الرجاء إدخال اسمك صحيحاً بالحروف فقط بدون رموز ولا أرقام.";

test("wiring: first /start asks for the name; invalid names retry; a valid name registers and lifts the gate", async () => {
  const kv = fakeKv();
  const kvEnv = { ...env, USERS: kv };
  // New user: /start asks for the name, nothing else.
  let calls = await sendMessengerText("/start", { envOverride: kvEnv });
  assert.equal(calls.length, 2, "typing_on + the first-time prompt");
  assert.equal(calls[0].payload.sender_action, "typing_on");
  assert.equal(calls[1].payload.message.text, FIRST_TIME_TEXT);
  // A word while waiting is a name attempt, not a search: digits fail
  // validation, so the retry text comes back and no card/list is sent.
  calls = await sendMessengerText("123", { envOverride: kvEnv });
  assert.equal(calls.length, 2, "typing_on + retry text");
  assert.equal(calls[1].payload.message.text, NAME_RETRY_TEXT);
  assert.doesNotMatch(calls[1].payload.message.text, /المعنى|نتائج/u);
  // Symbols/digits mixed into a name fail the same way, gate stays.
  calls = await sendMessengerText("أحمد123", { envOverride: kvEnv });
  assert.equal(calls[1].payload.message.text, NAME_RETRY_TEXT);
  // A valid name registers: welcome caption + help, quick replies on
  // the last text — Telegram's welcome + commands list, plain text.
  calls = await sendMessengerText("أحمد محمد علي", { envOverride: kvEnv });
  assert.equal(calls.length, 3, "typing_on + welcome + help");
  assert.match(calls[1].payload.message.text, /مرحبًا بك أحمد محمد علي، في القاموس القبطي الناطق/u);
  assert.match(calls[2].payload.message.text, /القاموس القبطي — المساعدة/u);
  assert.ok(Array.isArray(calls[2].payload.message.quick_replies), "menu quick replies on the last text");
  const stored = kv.store.get("user:msgr:987654321");
  assert.equal(stored?.name, "أحمد محمد علي");
  assert.equal(stored?.awaitingName, undefined);
  assert.equal(typeof stored?.registeredAt, "string");
  // The gate is lifted: a search works, and /start shows the welcome.
  calls = await sendMessengerText("نور", { envOverride: kvEnv });
  assert.match(calls.map((c) => c.payload.message?.text ?? "").join("\n"), /أرسل رقمًا للاختيار/u);
  calls = await sendMessengerText("/start", { envOverride: kvEnv });
  assert.match(calls.at(-1).payload.message.text, /ابعت أي كلمة/u, "registered /start shows the parity welcome, not the name prompt");
  assert.doesNotMatch(calls.map((c) => c.payload.message?.text ?? "").join("\n"), /لأول مرة/u);
});

test("wiring: registering notifies the admin by Messenger DM, but not when the sender is the admin", async () => {
  const kv = fakeKv();
  const adminEnv = { ...env, USERS: kv, MESSENGER_ADMIN_PSID: "111222333" };
  await sendMessengerText("/start", { envOverride: adminEnv });
  const calls = await sendMessengerText("ليلى أحمد حسن", { envOverride: adminEnv });
  const adminDm = calls.find((c) => c.payload.recipient?.id === "111222333");
  assert.ok(adminDm, "an admin DM is sent on registration");
  assert.match(adminDm.payload.message.text, /أكمل التسجيل: ليلى أحمد حسن/u);
  assert.match(adminDm.payload.message.text, /987654321/u);
  // The admin registering themself gets no DM (Telegram skips the
  // notify for admins).
  const kv2 = fakeKv();
  const selfAdminEnv = { ...env, USERS: kv2, MESSENGER_ADMIN_PSID: SENDER_ID };
  await sendMessengerText("/start", { envOverride: selfAdminEnv });
  const selfCalls = await sendMessengerText("منى أحمد علي", { envOverride: selfAdminEnv });
  assert.equal(selfCalls.length, 3, "typing_on + welcome + help, no admin DM");
  assert.doesNotMatch(selfCalls.map((c) => c.payload.message?.text ?? "").join("\n"), /أكمل التسجيل/u);
});

test("wiring: /cancel while waiting for the name does not clear the gate; /menu still works", async () => {
  const kv = fakeKv();
  const kvEnv = { ...env, USERS: kv };
  await sendMessengerText("/start", { envOverride: kvEnv });
  // /menu is a command: it works while waiting (Telegram: commands
  // keep working) and the gate stays.
  let calls = await sendMessengerText("/menu", { envOverride: kvEnv });
  assert.match(calls.at(-1).payload.message.text, /القاموس القبطي\* — القائمة/u);
  // /cancel while waiting: Telegram's fallback text, gate stays.
  calls = await sendMessengerText("/cancel", { envOverride: kvEnv });
  assert.equal(calls.at(-1).payload.message.text, "اكتب الكلمة مباشرة للبحث أو استخدم /start للبدء.");
  // /start re-prompts, and the name still registers afterwards.
  calls = await sendMessengerText("/start", { envOverride: kvEnv });
  assert.equal(calls.at(-1).payload.message.text, FIRST_TIME_TEXT);
  calls = await sendMessengerText("منى علي حسن", { envOverride: kvEnv });
  assert.match(calls[1].payload.message.text, /مرحبًا بك منى علي حسن/u);
});
