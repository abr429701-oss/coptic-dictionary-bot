import test from "node:test";
import assert from "node:assert/strict";
import { ipaForSpeech, buildSsml } from "../src/neural-voice.js";

test("IPA is cleaned for the engine", () => {
  assert.equal(ipaForSpeech({ pronunciation: "ref-tshoːl" }), "ref tʃoːl");
  assert.equal(ipaForSpeech({ pronunciation: "sopʰ os" }), "sofos");
  assert.equal(ipaForSpeech({ pronunciation: "sopʰ os" }, { liturgical: false }), "sopʰos");
  assert.equal(ipaForSpeech({ pronunciation: "ɑ , ɑ (ɑlpʰɑ)" }), "a");
  assert.equal(ipaForSpeech({ pronunciation: "metrefohi erɑtf" }), "metrefohi eratf");
  assert.equal(ipaForSpeech({ pronunciation: "" }), "");
});

test("SSML uses a male voice and IPA phonemes", () => {
  const ssml = buildSsml({ pronunciation: "ioː", english: "iw" });
  assert.match(ssml, /el-GR-NestorasNeural/u);
  assert.match(ssml, /<phoneme alphabet="ipa" ph="ioː">iw<\/phoneme>/u);
  assert.equal(buildSsml({ pronunciation: "" }), "");
});
