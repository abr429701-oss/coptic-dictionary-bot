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
  assert.equal(t("أنا لا أحب الظلمة"), "Ϯⲙⲉⲓ ⲙ̀ ⲡⲓⲥⲕⲟⲧⲟⲥ ⲁⲛ");
});

test("possessives, يوجد, عندي", () => {
  assert.equal(t("كتابي"), "ⲡⲁϫⲱⲱⲙ");
  assert.equal(t("الكتاب الجديد"), "ⲡⲓϫⲱⲱⲙ ⲙ̀ⲃⲉⲣⲓ");
  assert.equal(t("في الكنيسة"), "ϧⲉⲛ ϯⲉⲕⲕⲗⲏⲥⲓⲁ");
  assert.equal(t("يوجد كتاب"), "ⲟⲩⲟⲛ ⲟⲩϫⲱⲱⲙ");
  assert.equal(t("عندي كتاب"), "ⲟⲩⲛⲧⲏⲓ ⲟⲩϫⲱⲱⲙ");
});

test("questions, imperative, prohibition", () => {
  assert.equal(t("من هذا؟"), "ⲛⲓⲙ ⲫⲁⲓ");
  assert.equal(t("اجلس"), "ϩⲉⲙⲥⲓ");
  assert.equal(t("افتح الباب"), "ⲁⲟⲩⲱⲛ ⲙ̀ ⲡⲓⲣⲟ");
  assert.equal(t("لا تتكلم"), "ⲙ̀ⲡⲉⲣⲥⲁϫⲓ");
  assert.equal(t("قل الحق"), "ⲁϫⲉ ⲛ̀ ϯⲁⲗⲏⲑⲓⲁ");
});

test("prepositional phrases", () => {
  assert.equal(t("هو يذهب إلى الكنيسة"), "ϥ̀ϣⲉⲛⲁϥ ⲉ ϯⲉⲕⲕⲗⲏⲥⲓⲁ");
  assert.equal(t("هو يصلي في الكنيسة"), "ϥ̀ⲧⲱⲃϩ ϧⲉⲛ ϯⲉⲕⲕⲗⲏⲥⲓⲁ");
});

test("unknown words are reported, not guessed", () => {
  const r = translateSentence("أنا أحب البرمجة");
  assert.equal(r.ok, true);
  assert.equal(r.coptic, "Ϯⲙⲉⲓ");
  assert.deepEqual(r.unknown, ["البرمجة"]);
  assert.match(formatTranslation("أنا أحب البرمجة"), /كلمات غير معروفة/);
});

test("invalid input", () => {
  assert.equal(translateSentence("").ok, false);
  assert.equal(translateSentence("hello world").ok, false);
  assert.equal(translateSentence("أنا أكتب الدرس في الكنيسة كل يوم في الصباح الباكر جدا قبل الظهر").ok, false);
});

test("second-person feminine (R4)", () => {
  assert.equal(t("أنتِ تكتبين الدرس"), "ⲧⲉⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  assert.equal(t("أنتِ كتبتِ الدرس"), "ⲁⲣⲉⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  assert.equal(t("أنتِ ستكتبين الدرس"), "ⲧⲉⲣⲁⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  assert.equal(t("أنتِ تحبين الله"), "ⲧⲉⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
  assert.equal(t("أنت تكتب الدرس"), "ⲕ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
});

test("لن future negation (R2)", () => {
  assert.equal(t("لن أكتب الدرس"), "ϯⲛⲁⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ ⲁⲛ");
  assert.equal(t("لن تكتب الدرس"), "ⲭ̀ⲛⲁⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ ⲁⲛ");
  assert.equal(t("بطرس لن يكتب الدرس"), "Ⲡⲉⲧⲣⲟⲥ ⲛⲁⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ ⲁⲛ");
});

test("عندي forms (R5/R6)", () => {
  assert.equal(t("عندهم كتاب"), "ⲟⲩⲛⲧⲟⲩ ⲟⲩϫⲱⲱⲙ");
  assert.equal(t("عندكي كتاب"), "ⲟⲩⲛⲧⲉ ⲟⲩϫⲱⲱⲙ");
});

test("demonstratives (R17/R31)", () => {
  assert.equal(t("هذا الرجل"), "ⲡⲁⲓⲣⲱⲙⲓ");
  assert.equal(t("هذه المرأة"), "ⲧⲁⲓⲥϩⲓⲙⲓ");
  assert.equal(t("هؤلاء الرجال"), "ⲛⲁⲓⲣⲱⲙⲓ");
  assert.equal(t("أولئك الرجال"), "ⲛⲏⲉⲧⲣⲱⲙⲓ");
  assert.equal(t("هذا هو الرجل"), "ⲫⲁⲓ ⲡⲉ ⲡⲓⲣⲱⲙⲓ");
  assert.equal(t("هؤلاء يكتبون الدرس"), "ⲛⲁⲓ ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
});

test("questions: أين/كم and ⲉⲧⲉ- (R24/R25/R26/R27)", () => {
  assert.equal(t("أين الكتاب؟"), "ⲑⲱⲛ ⲡⲓϫⲱⲱⲙ");
  assert.equal(t("كم كتابا؟"), "ⲟⲩⲏⲣ ⲛ̀ϫⲱⲱⲙ");
  assert.equal(t("كم رجلا؟"), "ⲟⲩⲏⲣ ⲛ̀ⲣⲱⲙⲓ");
  assert.equal(t("من يكتب الدرس؟"), "ⲛⲓⲙ ⲉⲧⲉϥ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  assert.equal(t("ماذا تكتب؟"), "ⲁϣ ⲉⲧⲉⲕ̀ⲥ̀ϧⲁⲓ");
  assert.equal(t("متى تكتب الدرس؟"), "ⲑ̀ⲛⲁⲩ ⲉⲧⲉⲕ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  assert.equal(t("هل أنت بطرس؟"), "ⲙⲏ ⲛ̀ⲑⲟⲕ ⲡⲉ Ⲡⲉⲧⲣⲟⲥ");
});

test("audit-rule regressions (R3/R7/R9/R10/R13/R14/R15/R16/R18/R23/R28/G1)", () => {
  assert.equal(t("بطرس لم يكتب الدرس"), "ⲙ̀ⲡⲉ Ⲡⲉⲧⲣⲟⲥ ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  assert.equal(t("هذا كتابه"), "ⲡⲁⲓⲡⲉϥϫⲱⲱⲙ");
  assert.equal(t("كنيستي"), "ⲧⲁⲉⲕⲕⲗⲏⲥⲓⲁ");
  assert.equal(t("الأم"), "ⲑ̀ⲙⲁⲩ");
  assert.equal(t("الشمس"), "ⲫ̀ⲣⲏ");
  assert.equal(t("امش إلى الكنيسة"), "ⲙⲟϣⲓ ⲉ ϯⲉⲕⲕⲗⲏⲥⲓⲁ");
  assert.equal(t("أعطني الكتاب"), "ⲙⲟⲓ ⲛⲏⲓ ⲙ̀ ⲡⲓϫⲱⲱⲙ");
  assert.equal(t("لا تخف"), "ⲙ̀ⲡⲉⲣⲉⲣϩⲟϯ");
  assert.equal(t("الله ليس محبة"), "Ⲫ̀ⲛⲟⲩϯ ⲟⲩⲁⲅⲁⲡⲏ ⲁⲛ ⲡⲉ");
  assert.equal(t("هو يحب رجلا"), "ϥ̀ⲙⲉⲓ ⲛ̀ ⲟⲩⲣⲱⲙⲓ");
  assert.equal(t("هو رأى رجلا"), "ⲁϥⲛⲁⲩ ⲉⲟⲩⲣⲱⲙⲓ");
  assert.equal(t("كتب درسا"), "ⲁϥⲥ̀ϧⲁⲓ ⲙ̀ ⲟⲩⲙⲁⲑⲏⲙⲁ");
  assert.equal(t("نحن كتبنا الدرس"), "ⲁⲛⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  assert.equal(t("هي امرأة حكيمة"), "ⲛ̀ⲑⲟⲥ ⲟⲩⲥϩⲓⲙⲓ ⲛ̀ⲥⲁⲃⲏ ⲧⲉ");
});
