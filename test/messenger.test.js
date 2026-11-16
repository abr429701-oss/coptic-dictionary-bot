// Messenger webhook (Facebook Page) — core loop: verification, signature,
// dictionary search round-trip, quick-reply picks, voice attachment URL.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker, { localDictionaryCandidates } from "../src/index.js";
import { suggestSimilar } from "../src/new-features.js";
import {
  verifyMessengerSignature,
  plainTextCard,
  buildQuickReplies,
  MESSENGER_PICK_PREFIX,
  MESSENGER_SEND_URL,
} from "../src/messenger.js";
import { prebuiltAudioUrl } from "../src/neural-voice.js";
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

function postSigned(body) {
  const raw = JSON.stringify(body);
  return worker.fetch(webhookRequest(raw, { "x-hub-signature-256": sign(raw) }), env);
}

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

test("messenger search round-trip: one exact match sends the card text then the voice", async () => {
  assert.ok(SINGLE, "expected a single-candidate voiced word in the dictionary");
  const calls = [];
  const restore = stubMessengerApi(calls);
  try {
    const response = await postSigned(messageEvent({ text: SINGLE.query }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2, `expected text + audio, got ${JSON.stringify(calls.map((c) => c.payload?.message))}`);
    const [textCall, audioCall] = calls;
    for (const call of calls) {
      assert.equal(call.url, MESSENGER_SEND_URL);
      assert.equal(call.headers.authorization, `Bearer ${PAGE_TOKEN}`);
      assert.equal(call.payload.recipient.id, SENDER_ID);
      assert.equal(call.payload.messaging_type, "RESPONSE");
    }
    assert.match(textCall.payload.message.text, /\*Word:\*/u);
    assert.ok(textCall.payload.message.text.includes(String(SINGLE.record.coptic)), "card must carry the Coptic headword");
    assert.doesNotMatch(textCall.payload.message.text, /<b>|<\/b>/u);
    assert.equal(audioCall.payload.message.attachment.type, "audio");
    const audioUrl = audioCall.payload.message.attachment.payload.url;
    assert.ok(audioUrl.startsWith(`${AUDIO_BASE}/`), audioUrl);
    assert.ok(audioUrl.includes(`?v=${audioVersions[String(SINGLE.record.id)]}`), audioUrl);
    assert.equal(
      decodeURIComponent(audioUrl.slice(AUDIO_BASE.length + 1).split("?v=")[0]),
      audioManifest[String(SINGLE.record.id)],
    );
  } finally {
    restore();
  }
});

test("messenger search round-trip: several matches send the full list with quick replies", async () => {
  const calls = [];
  const restore = stubMessengerApi(calls);
  try {
    const response = await postSigned(messageEvent({ text: "نور" }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1, "a list sends one text message and no voice yet");
    const message = calls[0].payload.message;
    assert.match(message.text, /^اختر من الاقتراحات التالية:/u);
    assert.match(message.text, /\n1\. /u);
    assert.doesNotMatch(message.text, /<b>|<\/b>| — /u);
    assert.ok(Array.isArray(message.quick_replies) && message.quick_replies.length > 1);
    assert.ok(message.quick_replies.length <= 13, "Meta caps quick replies at 13");
    for (const reply of message.quick_replies) {
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
    assert.equal(calls.length, 1);
    const message = calls[0].payload.message;
    // Header language follows the query's UI language (the Telegram bot's
    // own uiTextFor: Latin queries get the English header on a cold cache).
    assert.match(message.text, /^🤔 (هل تقصد|Did you mean|Meinten Sie|Vouliez-vous dire)/u);
    assert.ok(message.text.includes(TYPO.suggestions[0].label), `expected suggestion ${TYPO.suggestions[0].label}`);
    assert.ok(Array.isArray(message.quick_replies) && message.quick_replies.length === TYPO.suggestions.length);
    assert.equal(message.quick_replies[0].payload, `${MESSENGER_PICK_PREFIX}${TYPO.suggestions[0].index}`);
  } finally {
    restore();
  }
});

test("messenger quick-reply pick sends the full word card", async () => {
  const suggestion = suggestSimilar("أشكرك", 3)[0];
  assert.ok(suggestion);
  const record = records[suggestion.index];
  const calls = [];
  const restore = stubMessengerApi(calls);
  try {
    const response = await postSigned(messageEvent({
      text: suggestion.label,
      quick_reply: { payload: `${MESSENGER_PICK_PREFIX}${suggestion.index}` },
    }));
    assert.equal(response.status, 200);
    assert.ok(calls.length >= 1);
    const text = calls[0].payload.message.text;
    assert.ok(text.includes(String(record.coptic)), "card must carry the Coptic headword");
    assert.ok(text.includes(suggestion.label), "card must carry the picked word's meaning");
    assert.doesNotMatch(text, /<b>|<\/b>/u);
  } finally {
    restore();
  }
});

test("messenger /start returns the welcome text", async () => {
  const calls = [];
  const restore = stubMessengerApi(calls);
  try {
    const response = await postSigned(messageEvent({ text: "/start" }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.match(calls[0].payload.message.text, /القاموس القبطي/u);
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
