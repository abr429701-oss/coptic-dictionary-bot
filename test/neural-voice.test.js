import test from "node:test";
import assert from "node:assert/strict";
import { ipaForSpeech, ipaToEspeak, audioUrl, fetchPrebuiltSpeech, fetchHumanSpeech, humanAudioUrl } from "../src/neural-voice.js";

test("IPA is cleaned for the engine", () => {
  assert.equal(ipaForSpeech({ pronunciation: "ref-tshoːl" }), "ref tʃoːl");
  assert.equal(ipaForSpeech({ pronunciation: "sopʰ os" }), "sofos");
  assert.equal(ipaForSpeech({ pronunciation: "sopʰ os" }, { liturgical: false }), "sopʰos");
  assert.equal(ipaForSpeech({ pronunciation: "ɑ , ɑ (ɑlpʰɑ)" }), "a");
  assert.equal(ipaForSpeech({ pronunciation: "" }), "");
});

test("IPA converts to espeak phonemes", () => {
  assert.equal(ipaToEspeak("ref tʃoːl"), "r'ef tS'o:l");
  assert.equal(ipaToEspeak("kakθi"), "k'akTi");
  assert.equal(ipaToEspeak("dʒoː"), "dZ'o:");
});

test("prebuilt audio is fetched by word id", async () => {
  assert.match(audioUrl({}, 7), /\/audio\/7\.ogg$/u);
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).endsWith("/5.ogg") ? new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2])) : new Response("", { status: 404 }));
  try {
    assert.equal((await fetchPrebuiltSpeech({}, { id: 5 })).byteLength, 6);
    assert.equal(await fetchPrebuiltSpeech({}, { id: 6 }), null);
    globalThis.fetch = async () => Response.json({ ok: true });
    assert.equal(await fetchPrebuiltSpeech({}, { id: 5 }), null);
  } finally { globalThis.fetch = original; }
});

test("human audio is opt-in and read from the audio-human branch", async () => {
  assert.match(humanAudioUrl({}, 7), /\/audio-human\/7\.ogg$/u);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    return String(url).endsWith("/5.ogg")
      ? new Response(new Uint8Array([79, 103, 103, 83, 1, 2]))
      : new Response("", { status: 404 });
  };
  try {
    assert.equal(await fetchHumanSpeech({}, { id: 5 }), null);
    assert.equal(calls, 0);
    assert.equal((await fetchHumanSpeech({ HUMAN_AUDIO: "on" }, { id: 5 })).byteLength, 6);
    assert.equal(await fetchHumanSpeech({ HUMAN_AUDIO: "on" }, { id: 6 }), null);
  } finally {
    globalThis.fetch = original;
  }
});
