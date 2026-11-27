import test from "node:test";
import assert from "node:assert/strict";
import { translateSentence, formatTranslation } from "../src/translate.js";

function t(input) {
  const r = translateSentence(input);
  assert.equal(r.ok, true, `${input} → ${r.error ?? JSON.stringify(r)}`);
  return r.coptic;
}

test("phrasebook (book examples)", () => {
  assert.equal(t("الله محبة"), "Ⲫ̀ⲛⲟⲩϯ ⲟⲩⲁⲅⲁⲡⲏ ⲡⲉ");
  assert.equal(t("أنت هو بطرس"), "ⲛ̀ⲑⲟⲕ ⲡⲉ Ⲡⲉⲧⲣⲟⲥ");
  assert.equal(t("أبانا الذي في السماوات"), "Ⲡⲉⲛⲓⲱⲧ ⲉⲧϧⲉⲛ ⲛⲓⲫⲏⲟⲩⲓ");
  assert.equal(t("ليتقدس اسمك"), "ⲙⲁⲣⲉϥⲧⲟⲩⲃⲟ ⲛ̀ϫⲉ ⲡⲉⲕⲣⲁⲛ");
  assert.equal(t("إن شاء الله"), "ⲁⲣⲉϣⲁⲛ Ⲫ̀ⲛⲟⲩϯ ⲟⲩⲱϣ");
});

test("nominal sentences", () => {
  assert.equal(t("أنا بطرس"), "ⲁⲛⲟⲕ Ⲡⲉⲧⲣⲟⲥ ⲡⲉ");
  assert.equal(t("مينا رجل حكيم"), "Ⲙⲏⲛⲁ ⲟⲩⲣⲱⲙⲓ ⲛ̀ⲥⲁⲃⲉ ⲡⲉ");
  assert.equal(t("الكنيسة جديدة"), "ϯⲉⲕⲕⲗⲏⲥⲓⲁ ⲟⲩⲃⲉⲣⲓ ⲧⲉ");
  assert.equal(t("أنا في الكنيسة"), "ⲁⲛⲟⲕ ϧⲉⲛ ϯⲉⲕⲕⲗⲏⲥⲓⲁ");
});

test("present tense, pronoun subject", () => {
  assert.equal(t("أنا أكتب"), "Ϯⲥ̀ϧⲁⲓ");
  assert.equal(t("هو يكتب الدرس"), "ϥ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  assert.equal(t("هي تكتب الدرس"), "ⲥ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  assert.equal(t("أنا أحب الله"), "Ϯⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
  assert.equal(t("هو يحب الله"), "ϥ̀ⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
  assert.equal(t("نحن نحب الله"), "ⲧⲉⲛⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
});

test("past and future", () => {
  assert.equal(t("كتبت الدرس"), "ⲁⲓⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  assert.equal(t("هو كتب الدرس"), "ⲁϥⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  assert.equal(t("سأكتب الدرس"), "ϯⲛⲁⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  assert.equal(t("هو سيكتب الدرس"), "ϥ̀ⲛⲁⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
});

test("noun subject", () => {
  assert.equal(t("مينا يكتب الدرس"), "Ⲙⲏⲛⲁ ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  assert.equal(t("مينا كتب الدرس"), "ⲁ Ⲙⲏⲛⲁ ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  assert.equal(t("الرجل يكتب الدرس"), "ⲡⲓⲣⲱⲙⲓ ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
});

test("negation", () => {
  assert.equal(t("لا أكتب"), "Ϯⲥ̀ϧⲁⲓ ⲁⲛ");
  assert.equal(t("لم أكتب"), "ⲙ̀ⲡⲓⲥ̀ϧⲁⲓ");
  assert.equal(t("أنا لا أحب الظلمة"), "Ϯⲙⲉⲓ ⲛ̀ ⲡⲓⲥⲕⲟⲧⲟⲥ ⲁⲛ");
});

test("possessives, يوجد, عندي", () => {
  assert.equal(t("كتابي"), "ⲡⲁϫⲱⲱⲙ");
  assert.equal(t("الكتاب الجديد"), "ⲡⲓϫⲱⲱⲙ ⲛ̀ⲃⲉⲣⲓ");
  assert.equal(t("في الكنيسة"), "ϧⲉⲛ ϯⲉⲕⲕⲗⲏⲥⲓⲁ");
  assert.equal(t("يوجد كتاب"), "ⲟⲩⲟⲛ ⲟⲩϫⲱⲱⲙ");
  assert.equal(t("عندي كتاب"), "ⲟⲩⲛⲧⲏⲓ ⲟⲩϫⲱⲱⲙ");
});

test("questions, imperative, prohibition", () => {
  assert.equal(t("من هذا؟"), "ⲛⲓⲙ ⲫⲁⲓ");
  assert.equal(t("اجلس"), "ϩⲉⲙⲥⲓ");
  assert.equal(t("افتح الباب"), "ⲁⲟⲩⲱⲛ ⲛ̀ ⲡⲓⲣⲟ");
  assert.equal(t("لا تتكلم"), "ⲙ̀ⲡⲉⲣⲥⲁϫⲓ");
  assert.equal(t("قل الحق"), "ⲁϫⲉ ⲉ̀ ϯⲁⲗⲏⲑⲓⲁ");
});

test("prepositional phrases", () => {
  assert.equal(t("هو يذهب إلى الكنيسة"), "ϥ̀ϣⲉⲛⲁϥ ⲉ ϯⲉⲕⲕⲗⲏⲥⲓⲁ");
  assert.equal(t("هو يصلي في الكنيسة"), "ϥ̀ⲧⲱⲃϩ ϧⲉⲛ ϯⲉⲕⲕⲗⲏⲥⲓⲁ");
});

test("unknown words are reported, not guessed", () => {
  const r = translateSentence("أنا أحب البرمجة");
  assert.equal(r.ok, true);
  assert.equal(r.coptic, "Ϯⲙⲉⲓ");
  assert.deepEqual(r.unknown, ["البرمجه"]);
  assert.match(formatTranslation("أنا أحب البرمجة"), /كلمات غير معروفة/);
});

test("invalid input", () => {
  assert.equal(translateSentence("").ok, false);
  assert.equal(translateSentence("hello world").ok, false);
  assert.equal(translateSentence("أنا أكتب الدرس في الكنيسة كل يوم في الصباح الباكر جدا قبل الظهر").ok, false);
});
