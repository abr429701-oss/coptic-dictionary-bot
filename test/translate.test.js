import test from "node:test";
import assert from "node:assert/strict";
import { translateSentence, formatTranslation, translateReverse, formatReverseTranslation, setReverseTarget, getReverseTarget } from "../src/translate.js";

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

test("unknown-word fixes: wider index, plurals, و, genitive", () => {
  const check = (input, expected) => {
    const r = translateSentence(input);
    assert.equal(r.ok, true, `${input} → ${r.error ?? JSON.stringify(r)}`);
    assert.equal(r.coptic, expected);
    assert.deepEqual(r.unknown, [], `${input} should have no unknown words`);
  };
  check("صديق", "ⲟⲩϣ̀ⲫⲉⲣ");
  check("الصديقين", "ⲛⲓϣ̀ⲫⲉⲣⲓ");
  check("الصديقون", "ⲛⲓϣ̀ⲫⲉⲣⲓ");
  check("صديقي", "ⲡⲁϣ̀ⲫⲉⲣ");
  check("تهليل الصديقين", "ⲡⲓⲑⲉⲗⲏⲗ ⲛ̀ⲛⲓϣ̀ⲫⲉⲣⲓ");
  check("نور العالم", "ⲡⲓⲟⲩⲱⲓⲛⲓ ⲙ̀ⲡⲓⲕⲟⲥⲙⲟⲥ");
  check("العالم", "ⲡⲓⲕⲟⲥⲙⲟⲥ");
  check("أخي وأختي", "ⲡⲁⲥⲟⲛ ⲟⲩⲟϩ ⲧⲁⲥⲱⲛⲓ");
  check("أخي و أختي", "ⲡⲁⲥⲟⲛ ⲟⲩⲟϩ ⲧⲁⲥⲱⲛⲓ");
  // plurals of other stems (article-only plural, book 1 §5)
  check("المعلمون", "ⲛⲓⲣⲉϥϯⲥ̀ⲃⲱ");
  check("المؤمنون", "ⲛⲓⲡⲓⲥⲧⲓⲕⲟⲥ");
  check("الكلمات", "ⲛⲓⲥⲁϫⲓ");
  // genitive: first noun takes the definite article, link assimilates to ⲙ̀ before labials
  check("كتاب المعلم", "ⲡⲓϫⲱⲱⲙ ⲙ̀ⲡⲓⲣⲉϥϯⲥ̀ⲃⲱ");
  // NOTE: "نور العالم" is NOT asserted here — the genitive structure is right but عالم
  // currently resolves to the astronomer (ⲁⲥⲧⲣⲟⲛⲟⲙⲟⲥ) instead of the world (ⲕⲟⲥⲙⲟⲥ);
  // that sense disambiguation is a separate issue, not part of the unknown-word fix.
  // names ending in plural suffixes must NOT be stripped (stay unknown, never wrong)
  assert.deepEqual(translateSentence("شعبان").unknown, ["شعبان"]);
  assert.deepEqual(translateSentence("الرحمن").unknown, ["الرحمن"]);
  assert.deepEqual(translateSentence("فرحان").unknown, ["فرحان"]);
});

test("plural + possessive (hamza restore)", () => {
  const check = (input, expected) => {
    const r = translateSentence(input);
    assert.equal(r.ok, true, `${input} → ${r.error ?? JSON.stringify(r)}`);
    assert.equal(r.coptic, expected);
    assert.deepEqual(r.unknown, [], `${input} should have no unknown words`);
  };
  // the ء of أصدقاء survives normalizeArabic as ي/و (اصدقاي/اصدقاو) and is restored
  check("أصدقائي", "ⲛⲁϣ̀ⲫⲉⲣⲓ");
  check("أصدقاؤك", "ⲛⲉⲕϣ̀ⲫⲉⲣⲓ");
  check("أصدقاؤه", "ⲛⲉϥϣ̀ⲫⲉⲣⲓ");
  check("أصدقائنا", "ⲛⲉⲛϣ̀ⲫⲉⲣⲓ");
  check("أصدقائهم", "ⲛⲟⲩϣ̀ⲫⲉⲣⲓ");
  check("سمائي", "ⲧⲁⲫⲉ");
  // singular possessives still work, and the plural forms above do not leak into names
  check("معلمي", "ⲡⲁⲣⲉϥϯⲥ̀ⲃⲱ");
  check("كتبي", "ⲛⲁϫⲱⲱⲙ");
  assert.deepEqual(translateSentence("رحماني").unknown, ["رحماني"]);
  assert.deepEqual(translateSentence("شعباني").unknown, ["شعباني"]);
  assert.deepEqual(translateSentence("رحمني").unknown, ["رحمني"]);
});

test("gender from the dictionary only", () => {
  const check = (input, expected) => {
    const r = translateSentence(input);
    assert.equal(r.ok, true, `${input} → ${r.error ?? JSON.stringify(r)}`);
    assert.equal(r.coptic, expected);
    assert.deepEqual(r.unknown, [], `${input} should have no unknown words`);
  };
  // feminine (kind "اسم مؤنث" in the dictionary)
  check("الكنيسة", "ϯⲉⲕⲕⲗⲏⲥⲓⲁ");
  check("كنيستي", "ⲧⲁⲉⲕⲕⲗⲏⲥⲓⲁ");
  check("الكنيسة الجديدة", "ϯⲉⲕⲕⲗⲏⲥⲓⲁ ⲙ̀ⲃⲉⲣⲉ");
  check("المرأة الحكيمة", "ϯⲥϩⲓⲙⲓ ⲛ̀ⲥⲁⲃⲏ");
  check("المدرسة", "ϯⲁⲛⲍⲏⲃ");
  check("بيتها", "ⲡⲉⲥⲏⲓ");
  // masculine counterparts
  check("الكتاب", "ⲡⲓϫⲱⲱⲙ");
  check("كتابي", "ⲡⲁϫⲱⲱⲙ");
  check("الكتاب الجديد", "ⲡⲓϫⲱⲱⲙ ⲙ̀ⲃⲉⲣⲓ");
  check("الرجل الحكيم", "ⲡⲓⲣⲱⲙⲓ ⲛ̀ⲥⲁⲃⲉ");
  check("بيته", "ⲡⲉϥⲏⲓ");
  // the verb "يأتي" must not be demoted to a possessed noun (regression: "متى يأتي؟"
  // once gave ⲑ̀ⲛⲁⲩ ⲧⲁⲔⲩⲣⲓⲉ via the "يأة" derivation from the vocative "يا")
  check("متى يأتي؟", "ⲑ̀ⲛⲁⲩ ⲉⲧⲉϥ̀ⲓ");
});

test("feminine -ة derivation from a masculine stem", () => {
  const check = (input, expected) => {
    const r = translateSentence(input);
    assert.equal(r.ok, true, `${input} → ${r.error ?? JSON.stringify(r)}`);
    assert.equal(r.coptic, expected);
    assert.deepEqual(r.unknown, [], `${input} should have no unknown words`);
  };
  // صديقة/معلمة DO have dictionary records (32385/26228) and the
  // record wins; the derivation below fires only where no record exists (book 1 §6)
  check("المعلمة", "ϯⲇⲓⲇⲁⲥⲕⲁⲗⲏ");
  check("صديقتي", "ⲧⲁϣ̀ⲫⲏⲣⲓ");
  check("معلمتي", "ⲧⲁⲇⲓⲇⲁⲥⲕⲁⲗⲏ");
  check("الصديقة", "ϯϣ̀ⲫⲏⲣⲓ");
  check("التلميذة", "ϯⲙⲁⲑⲏⲧⲏⲥ");
  // الخادمة has its own feminine dictionary record (25531: جارية، خادمة، أمة) — the record wins, not the masculine stem
  check("الخادمة", "ϯⲁⲗⲟⲩⲙ̀ⲃⲱⲕⲓ");
  // a real feminine dictionary word is not a derivation (لغة is اسم مؤنث)
  check("لغتي", "ⲧⲁⲁⲥⲡⲓ");
  check("مئتي", "ⲡⲁⲙⲱⲟⲩⲧ");
});

test("hollow verbs, curated verbs, geminate past", () => {
  const check = (input, expected) => {
    const r = translateSentence(input);
    assert.equal(r.ok, true, `${input} → ${r.error ?? JSON.stringify(r)}`);
    assert.equal(r.coptic, expected);
    assert.deepEqual(r.unknown, [], `${input} should have no unknown words`);
  };
  // hollow present stems (يقول/يموت/يكون/يدور/يعيش/يجيء/يقوم) resolve to their past
  // root, present only — the bare stems stay nouns (دور → ⲟⲩⲟⲣⲇⲓⲛⲟⲛ, كون → ⲟⲩⲑⲟ)
  check("هو يقول الحق", "ϥ̀ϫⲱ ⲛ̀ ϯⲁⲗⲏⲑⲓⲁ");
  check("هو يقوم", "ϥ̀ⲧⲱⲛ");
  check("هو يموت", "ϥ̀ⲙⲟⲩ");
  check("هو يكون", "ϥ̀ϣⲱⲡⲓ");
  check("هو يدور", "ϥ̀ⲕⲱϯ");
  check("هو يعيش", "ϥ̀ⲱⲛϧ");
  check("هو يجيء", "ϥ̀ⲓ");
  // curated past verbs: سار/كان take the dictionary's own past form, not ⲁϥⲛⲁ
  check("هو سار", "ⲁϥⲙⲟϣⲓ");
  check("هو كان", "ⲁϥϣⲱⲡⲓ");
  // geminate past: أحببت → أحبب → أحب (the doubled root is un-doubled before lookup)
  check("أنا أحببت الله", "ⲁⲓⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
  check("دور", "ⲟⲩⲟⲣⲇⲓⲛⲟⲛ");
  check("كون", "ⲟⲩⲑⲟ");
});

test("English input", () => {
  const check = (input, expected) => {
    assert.equal(formatTranslation(input), expected, input);
  };
  // required sentences
  check("I write the lesson", "Ϯⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("I love God", "Ϯⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
  check("the light of the world", "ⲡⲓⲟⲩⲱⲓⲛⲓ ⲙ̀ⲡⲓⲕⲟⲥⲙⲟⲥ");
  check("my brother and my sister", "ⲡⲁⲥⲟⲛ ⲟⲩⲟϩ ⲧⲁⲥⲱⲛⲓ");
  // tenses and persons
  check("I wrote the lesson", "ⲁⲓⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("I will write the lesson", "ϯⲛⲁⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("I have written the lesson", "ⲁⲓⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("he writes the lesson", "ϥ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("she loves God", "ⲥ̀ⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
  check("we love God", "ⲧⲉⲛⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
  check("they write the lesson", "ⲥⲉⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("you love God", "ⲭ̀ⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
  // questions, negation, possessives, plurals, prepositions, copula, imperative, have
  check("who writes the lesson?", "ⲛⲓⲙ ⲉⲧⲉϥ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("what do you write?", "ⲁϣ ⲉⲧⲉⲕ̀ⲥ̀ϧⲁⲓ");
  check("where is the church?", "ⲑⲱⲛ ϯⲉⲕⲕⲗⲏⲥⲓⲁ");
  check("do you love God?", "ⲙⲏ ⲉⲧⲉⲭ̀ⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
  check("I do not love the world", "Ϯⲙⲉⲓ ⲙ̀ ⲡⲓⲕⲟⲥⲙⲟⲥ ⲁⲛ");
  check("I love my father and my mother", "Ϯⲙⲉⲓ ⲙ̀ ⲡⲁⲓⲱⲧ ⲟⲩⲟϩ ⲛ̀ ⲧⲁⲙⲁⲩ");
  check("I love my wife", "Ϯⲙⲉⲓ ⲛ̀ ⲧⲁⲥϩⲓⲙⲓ");
  check("my wife", "ⲧⲁⲥϩⲓⲙⲓ");
  check("my husband", "ⲡⲁⲏⲓ");
  check("my friends", "ⲛⲁϣ̀ⲫⲉⲣⲓ");
  check("the friends of God", "ⲛⲓϣ̀ⲫⲉⲣⲓ ⲙ̀Ⲫ̀ⲛⲟⲩϯ");
  check("the book of God", "ⲡⲓϫⲱⲱⲙ ⲙ̀Ⲫ̀ⲛⲟⲩϯ");
  check("the teacher writes the lesson", "ⲡⲓⲣⲉϥϯⲥ̀ⲃⲱ ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("the students love the teacher", "ⲥⲉⲙⲉⲓ ⲙ̀ ⲡⲓⲣⲉϥϯⲥ̀ⲃⲱ");
  check("I am in the church", "ⲁⲛⲟⲕ ϧⲉⲛ ϯⲉⲕⲕⲗⲏⲥⲓⲁ");
  check("God is great", "Ⲫ̀ⲛⲟⲩϯ ⲟⲩⲛⲓϣϯ ⲡⲉ");
  check("the church is holy", "ϯⲉⲕⲕⲗⲏⲥⲓⲁ ⲟⲩⲁⲅⲓⲁ ⲧⲉ");
  check("the light is beautiful", "ⲡⲓⲟⲩⲱⲓⲛⲓ ⲟⲩⲥⲁⲓⲉ ⲡⲉ");
  check("write the lesson", "ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("I have a book", "ⲟⲩⲛⲧⲏⲓ ⲟⲩϫⲱⲱⲙ");
});

test("French input", () => {
  const check = (input, expected) => {
    assert.equal(formatTranslation(input), expected, input);
  };
  // required sentences
  check("J'écris la leçon", "Ϯⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("J'aime Dieu", "Ϯⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
  check("la lumière du monde", "ⲡⲓⲟⲩⲱⲓⲛⲓ ⲙ̀ⲡⲓⲕⲟⲥⲙⲟⲥ");
  // tenses: present, passé composé, futur; persons; negation; questions
  check("tu écris la leçon", "ⲕ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("il écrit la leçon", "ϥ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("nous aimons Dieu", "ⲧⲉⲛⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
  check("j'ai écrit la leçon", "ⲁⲓⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("j'ai fait la leçon", "ⲁⲓⲁⲓⲧ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("je vais écrire la leçon", "ϯⲛⲁⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("je n'aime pas le monde", "Ϯⲙⲉⲓ ⲙ̀ ⲡⲓⲕⲟⲥⲙⲟⲥ ⲁⲛ");
  check("qui écrit la leçon?", "ⲛⲓⲙ ⲉⲧⲉϥ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("aimes-tu Dieu?", "ⲙⲏ ⲉⲧⲉⲭ̀ⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
  // possessives, genitive, copula, imperative, have
  check("mon frère et ma sœur", "ⲡⲁⲥⲟⲛ ⲟⲩⲟϩ ⲧⲁⲥⲱⲛⲓ");
  check("ma femme", "ⲧⲁⲥϩⲓⲙⲓ");
  check("mon mari", "ⲡⲁⲏⲓ");
  check("mes amis", "ⲛⲁϣ̀ⲫⲉⲣⲓ");
  check("le livre de Dieu", "ⲡⲓϫⲱⲱⲙ ⲙ̀Ⲫ̀ⲛⲟⲩϯ");
  check("Dieu est grand", "Ⲫ̀ⲛⲟⲩϯ ⲟⲩⲛⲓϣϯ ⲡⲉ");
  check("écris la leçon", "ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("j'ai un livre", "ⲟⲩⲛⲧⲏⲓ ⲟⲩϫⲱⲱⲙ");
});

test("German input", () => {
  const check = (input, expected) => {
    assert.equal(formatTranslation(input), expected, input);
  };
  // required sentences
  check("Ich schreibe die Lektion", "Ϯⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("Ich liebe Gott", "Ϯⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
  check("das Licht der Welt", "ⲡⲓⲟⲩⲱⲓⲛⲓ ⲙ̀ⲡⲓⲕⲟⲥⲙⲟⲥ");
  // tenses: present, Perfekt, Futur; persons; negation; questions
  check("du schreibst die Lektion", "ⲕ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("er schreibt die Lektion", "ϥ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("wir lieben Gott", "ⲧⲉⲛⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
  check("ich habe die Lektion geschrieben", "ⲁⲓⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("ich werde die Lektion schreiben", "ϯⲛⲁⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("ich liebe die Welt nicht", "Ϯⲙⲉⲓ ⲙ̀ ⲡⲓⲕⲟⲥⲙⲟⲥ ⲁⲛ");
  check("wer schreibt die Lektion?", "ⲛⲓⲙ ⲉⲧⲉϥ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("liebst du Gott?", "ⲙⲏ ⲉⲧⲉⲭ̀ⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ");
  // possessives, genitive -s, copula, imperative, have, locative
  check("mein Bruder und meine Schwester", "ⲡⲁⲥⲟⲛ ⲟⲩⲟϩ ⲧⲁⲥⲱⲛⲓ");
  check("meine Frau", "ⲧⲁⲥϩⲓⲙⲓ");
  check("meine Freunde", "ⲛⲁϣ̀ⲫⲉⲣⲓ");
  check("das Buch Gottes", "ⲡⲓϫⲱⲱⲙ ⲙ̀Ⲫ̀ⲛⲟⲩϯ");
  check("Gott ist groß", "Ⲫ̀ⲛⲟⲩϯ ⲟⲩⲛⲓϣϯ ⲡⲉ");
  check("schreib die Lektion", "ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  check("ich habe ein Buch", "ⲟⲩⲛⲧⲏⲓ ⲟⲩϫⲱⲱⲙ");
  check("ich bin in der Kirche", "ⲁⲛⲟⲕ ϧⲉⲛ ϯⲉⲕⲕⲗⲏⲥⲓⲁ");
});

test("foreign input: detection and unknown words", () => {
  // translateSentence stays Arabic-only: Latin input is not its job.
  assert.equal(translateSentence("hello world").ok, false);
  // unknown words are reported, never guessed; a bare article is not unknown.
  assert.match(formatTranslation("hello world"), /⚠️ كلمات غير معروفة: hello/);
  assert.equal(formatTranslation("je xyzzy"), "⚠️ كلمات غير معروفة: xyzzy");
  assert.equal(formatTranslation("ich xyzzy"), "⚠️ كلمات غير معروفة: xyzzy");
  assert.match(formatTranslation("I xyzzy the florp"), /xyzzy، florp/);
  assert.doesNotMatch(formatTranslation("I xyzzy the florp"), /the/);
  // the English verb "am" is not the German contraction "an dem".
  assert.equal(formatTranslation("I am in the church"), "ⲁⲛⲟⲕ ϧⲉⲛ ϯⲉⲕⲕⲗⲏⲥⲓⲁ");
});

test("kinship possessives", () => {
  const check = (input, expected) => {
    const r = translateSentence(input);
    assert.equal(r.ok, true, `${input} → ${r.error ?? JSON.stringify(r)}`);
    assert.equal(r.coptic, expected);
    assert.deepEqual(r.unknown, [], `${input} should have no unknown words`);
  };
  // whole-word noun records used to hijack these ("عمى" blindness, "خالي" empty,
  // "جدي" kid-goat, "زوجتي" a Rachel phrase, "أمي" illiterate, "أبي" a fragment)
  check("أبي", "ⲡⲁⲓⲱⲧ");
  check("أمي", "ⲧⲁⲙⲁⲩ");
  check("عمي", "ⲡⲁⲥⲟⲛⲓⲱⲧ");
  check("خالي", "ⲡⲁⲥⲟⲛⲙⲁⲩ");
  check("جدي", "ⲡⲁⲛⲓϣⲓⲱⲧ");
  check("جدتي", "ⲧⲁⲛⲓϣⲙⲁⲩ");
  check("زوجتي", "ⲧⲁⲥϩⲓⲙⲓ");
  check("زوجي", "ⲡⲁⲏⲓ");
  check("ابني", "ⲡⲁϣⲏⲣⲓ");
  check("ابنتي", "ⲧⲁϣⲉⲣⲓ");
  check("أخي", "ⲡⲁⲥⲟⲛ");
  check("أختي", "ⲧⲁⲥⲱⲛⲓ");
  check("أنا أحب أبي و أمي", "Ϯⲙⲉⲓ ⲙ̀ ⲡⲁⲓⲱⲧ ⲟⲩⲟϩ ⲛ̀ ⲧⲁⲙⲁⲩ");
  // the ال guard: "الجدي" is the kid goat, not "my grandfather"; "مصري" is
  // Egyptian, not "my Egypt" — the kinship rule does not touch them.
  check("الجدي", "ϯⲃⲁⲉⲙⲡⲓ");
  check("مصري", "ⲟⲩⲁⲓⲅⲩⲡⲧⲓⲟⲥ");
});

test("predicate adjectives are not verbs", () => {
  const check = (input, expected) => {
    const r = translateSentence(input);
    assert.equal(r.ok, true, `${input} → ${r.error ?? JSON.stringify(r)}`);
    assert.equal(r.coptic, expected);
    assert.deepEqual(r.unknown, [], `${input} should have no unknown words`);
  };
  // "جميل"/"صالح" also resolve as past verbs — in predicate position they are
  // adjectives ("النور جميل" = the light is beautiful, not "the light beautified")
  check("النور جميل", "ⲡⲓⲟⲩⲱⲓⲛⲓ ⲟⲩⲥⲁⲓⲉ ⲡⲉ");
  check("النور صالح", "ⲡⲓⲟⲩⲱⲓⲛⲓ ⲟⲩⲁⲅⲁⲑⲟⲥ ⲡⲉ");
  check("النور حكيم", "ⲡⲓⲟⲩⲱⲓⲛⲓ ⲟⲩⲥⲁⲃⲉ ⲡⲉ");
  check("النور كبير", "ⲡⲓⲟⲩⲱⲓⲛⲓ ⲟⲩⲛⲓϣϯ ⲡⲉ");
  check("هو جميل", "ⲛ̀ⲑⲟϥ ⲟⲩⲥⲁⲓⲉ̀ ⲡⲉ");
});

// ---------- Reverse translation (Coptic → Arabic / English / French / German) ----------
function rt(input, lang = "ar") {
  const r = translateReverse(input, lang);
  assert.equal(r.ok, true, `${input} (${lang}) → ${JSON.stringify(r)}`);
  assert.deepEqual(r.unknown, [], `${input} (${lang}) should have no unknown words`);
  return r.text;
}

test("reverse: word level", () => {
  assert.equal(rt("ϫⲱⲱⲙ", "ar"), "كتاب");
  assert.equal(rt("ϫⲱⲱⲙ", "en"), "book");
  assert.equal(rt("ϫⲱⲱⲙ", "fr"), "livre");
  assert.equal(rt("ϫⲱⲱⲙ", "de"), "Buch");
  assert.equal(rt("ⲉⲕⲕⲗⲏⲥⲓⲁ", "ar"), "كنيسة");
  assert.equal(rt("ⲉⲕⲕⲗⲏⲥⲓⲁ", "en"), "church");
  assert.equal(rt("ⲉⲕⲕⲗⲏⲥⲓⲁ", "fr"), "église");
  assert.equal(rt("ⲉⲕⲕⲗⲏⲥⲓⲁ", "de"), "Kirche");
  assert.equal(rt("ⲙⲱⲟⲩ", "ar"), "ماء");
  assert.equal(rt("ⲙⲱⲟⲩ", "en"), "water");
  assert.equal(rt("ⲙⲱⲟⲩ", "fr"), "eau");
  assert.equal(rt("ⲙⲱⲟⲩ", "de"), "Wasser");
  // articles and plurals derive from the singular
  assert.equal(rt("ⲡⲓϫⲱⲱⲙ", "ar"), "الكتاب");
  assert.equal(rt("ⲡⲓϫⲱⲱⲙ", "en"), "the book");
  assert.equal(rt("ⲡⲓϫⲱⲱⲙ", "fr"), "le livre");
  assert.equal(rt("ⲡⲓϫⲱⲱⲙ", "de"), "das Buch");
  assert.equal(rt("ⲛⲓϫⲱⲱⲙ", "ar"), "الكتب");
  assert.equal(rt("ⲛⲓϫⲱⲱⲙ", "en"), "the books");
  assert.equal(rt("ⲛⲓϫⲱⲱⲙ", "fr"), "les livres");
  assert.equal(rt("ⲛⲓϫⲱⲱⲙ", "de"), "die Bücher");
});

test("reverse: sentences to Arabic", () => {
  assert.equal(rt("Ϯⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ"), "أنا أحب الله");
  assert.equal(rt("Ϯⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ"), "أنا أكتب الدرس");
  assert.equal(rt("ⲡⲓⲟⲩⲱⲓⲛⲓ ⲙ̀ⲡⲓⲕⲟⲥⲙⲟⲥ"), "نور العالم");
  assert.equal(rt("ⲡⲁⲥⲟⲛ ⲟⲩⲟϩ ⲧⲁⲥⲱⲛⲓ"), "أخي وأختي");
  assert.equal(rt("ⲛⲁϣ̀ⲫⲉⲣⲓ"), "أصدقائي");
});

test("reverse: same sentences to English, French, German", () => {
  assert.equal(rt("Ϯⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ", "en"), "I love God");
  assert.equal(rt("Ϯⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "en"), "I write the lesson");
  assert.equal(rt("ⲡⲓⲟⲩⲱⲓⲛⲓ ⲙ̀ⲡⲓⲕⲟⲥⲙⲟⲥ", "en"), "the light of the world");
  assert.equal(rt("Ϯⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ", "fr"), "J'aime Dieu");
  assert.equal(rt("Ϯⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "fr"), "J'écris la leçon");
  assert.equal(rt("ⲡⲓⲟⲩⲱⲓⲛⲓ ⲙ̀ⲡⲓⲕⲟⲥⲙⲟⲥ", "fr"), "la lumière du monde");
  assert.equal(rt("Ϯⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ", "de"), "Ich liebe Gott");
  assert.equal(rt("Ϯⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "de"), "Ich schreibe die Lektion");
  assert.equal(rt("ⲡⲓⲟⲩⲱⲓⲛⲓ ⲙ̀ⲡⲓⲕⲟⲥⲙⲟⲥ", "de"), "das Licht der Welt");
  assert.equal(rt("ⲛⲁϣ̀ⲫⲉⲣⲓ", "en"), "my friends");
  assert.equal(rt("ⲛⲁϣ̀ⲫⲉⲣⲓ", "fr"), "mes amis");
  assert.equal(rt("ⲛⲁϣ̀ⲫⲉⲣⲓ", "de"), "meine Freunde");
});

test("reverse: past and future tenses", () => {
  assert.equal(rt("ⲁⲓⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ"), "أنا كتبت الدرس");
  assert.equal(rt("ⲁⲓⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "en"), "I wrote the lesson");
  // the future drops the Arabic subject pronoun (سأكتب الدرس, not أنا سأكتب الدرس)
  assert.equal(rt("ϯⲛⲁⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ"), "سأكتب الدرس");
  assert.equal(rt("ϯⲛⲁⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "en"), "I will write the lesson");
  assert.equal(rt("ⲁϥⲥⲱⲧⲉⲙ ⲙ̀ ⲡⲓⲥⲁϫⲓ"), "هو سمع الكلمة");
  assert.equal(rt("ⲁϥⲥⲱⲧⲉⲙ ⲙ̀ ⲡⲓⲥⲁϫⲓ", "en"), "He heard the word");
});

test("reverse: persons, negation, noun subjects", () => {
  assert.equal(rt("ϥ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ"), "هو يكتب الدرس");
  assert.equal(rt("ϥ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "en"), "He writes the lesson");
  assert.equal(rt("ϥ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "fr"), "Il écrit la leçon");
  assert.equal(rt("ϥ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "de"), "Er schreibt die Lektion");
  assert.equal(rt("ⲕ̀ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ"), "أنتَ تكتب الدرس");
  assert.equal(rt("ⲭ̀ⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ"), "أنتَ تحب الله"); // ⲕ̀ → ⲭ̀ before ⲙ
  assert.equal(rt("ⲓⲱϣ ⲙ̀ ⲡⲓϫⲱⲱⲙ"), "أنا أقرأ الكتاب"); // Ϯ → ⲓ before a vowel verb
  assert.equal(rt("Ϯⲥ̀ϧⲁⲓ ⲁⲛ"), "أنا لا أكتب");
  assert.equal(rt("Ϯⲥ̀ϧⲁⲓ ⲁⲛ", "en"), "I don't write");
  assert.equal(rt("Ϯⲥ̀ϧⲁⲓ ⲁⲛ", "fr"), "Je n'écris pas");
  assert.equal(rt("Ϯⲥ̀ϧⲁⲓ ⲁⲛ", "de"), "Ich schreibe nicht");
  assert.equal(rt("ⲙ̀ⲡⲓⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ"), "أنا لم أكتب الدرس");
  assert.equal(rt("ⲙ̀ⲡⲓⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "en"), "I didn't write the lesson");
  assert.equal(rt("ⲡⲓⲣⲱⲙⲓ ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ"), "الرجل يكتب الدرس");
  assert.equal(rt("ⲡⲓⲣⲱⲙⲓ ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "en"), "The man writes the lesson");
  assert.equal(rt("ⲁ ⲡⲓⲣⲱⲙⲓ ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ"), "الرجل كتب الدرس");
  assert.equal(rt("ⲁ ⲡⲓⲣⲱⲙⲓ ⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "en"), "The man wrote the lesson");
});

test("reverse: nominal, existential, have, prepositions, adjectives", () => {
  assert.equal(rt("ⲛ̀ⲑⲟⲕ ⲡⲉ Ⲡⲉⲧⲣⲟⲥ"), "أنتَ بطرس");
  assert.equal(rt("ⲛ̀ⲑⲟⲕ ⲡⲉ Ⲡⲉⲧⲣⲟⲥ", "en"), "You are Peter");
  assert.equal(rt("ⲛ̀ⲑⲟⲕ ⲡⲉ Ⲡⲉⲧⲣⲟⲥ", "fr"), "Tu es Pierre");
  assert.equal(rt("ⲛ̀ⲑⲟⲕ ⲡⲉ Ⲡⲉⲧⲣⲟⲥ", "de"), "Du bist Petrus");
  assert.equal(rt("ⲡⲓⲣⲱⲙⲓ ⲟⲩⲥⲁⲃⲉ ⲡⲉ"), "الرجل حكيم");
  assert.equal(rt("ⲡⲓⲣⲱⲙⲓ ⲟⲩⲥⲁⲃⲉ ⲡⲉ", "en"), "The man is wise");
  assert.equal(rt("ⲡⲓⲣⲱⲙⲓ ⲟⲩⲥⲁⲃⲉ ⲡⲉ", "de"), "Der Mann ist weise");
  assert.equal(rt("ⲟⲩⲟⲛ ⲡⲓϫⲱⲱⲙ"), "يوجد الكتاب");
  assert.equal(rt("ⲟⲩⲟⲛ ⲡⲓϫⲱⲱⲙ", "en"), "There is the book");
  assert.equal(rt("ⲙ̀ⲙⲟⲛ ⲡⲓϫⲱⲱⲙ"), "لا يوجد كتاب");
  assert.equal(rt("ⲙ̀ⲙⲟⲛ ⲡⲓϫⲱⲱⲙ", "en"), "There is no book");
  assert.equal(rt("ⲟⲩⲛⲧⲏⲓ ⲡⲓϫⲱⲱⲙ"), "عندي الكتاب");
  assert.equal(rt("ⲟⲩⲛⲧⲏⲓ ⲡⲓϫⲱⲱⲙ", "en"), "I have the book");
  assert.equal(rt("Ϯⲥ̀ϧⲁⲓ ϧⲉⲛ ⲡⲓⲏⲓ"), "أنا أكتب في البيت");
  assert.equal(rt("Ϯⲥ̀ϧⲁⲓ ϧⲉⲛ ⲡⲓⲏⲓ", "en"), "I write in the house");
  assert.equal(rt("ⲡⲓⲣⲱⲙⲓ ⲛ̀ⲥⲁⲃⲉ"), "الرجل حكيم");
  assert.equal(rt("ⲡⲓⲣⲱⲙⲓ ⲛ̀ⲥⲁⲃⲉ", "en"), "the wise man");
  assert.equal(rt("ⲡⲓⲣⲱⲙⲓ ⲛ̀ⲥⲁⲃⲉ", "fr"), "l'homme sage");
  assert.equal(rt("ⲡⲓⲣⲱⲙⲓ ⲛ̀ⲥⲁⲃⲉ", "de"), "der weise Mann");
  assert.equal(rt("ⲛⲓⲙ ⲫⲁⲓ"), "من هذا؟");
  assert.equal(rt("ⲛⲓⲙ ⲫⲁⲓ", "en"), "Who is this?");
  assert.equal(rt("ⲫⲁⲓ ⲡⲉ ⲡⲓⲣⲱⲙⲓ", "en"), "This is the man");
  assert.equal(rt("ⲁϣ ⲉⲧⲉⲥ̀ⲥ̀ϧⲁⲓ"), "ماذا هي تكتب؟");
  assert.equal(rt("ⲁϣ ⲉⲧⲉⲥ̀ⲥ̀ϧⲁⲓ", "en"), "What does she write?");
  assert.equal(rt("ⲁϣ ⲉⲧⲉⲥ̀ⲥ̀ϧⲁⲓ", "fr"), "Qu'est-ce qu'elle écrit?");
  assert.equal(rt("ⲁϣ ⲉⲧⲉⲥ̀ⲥ̀ϧⲁⲓ", "de"), "Was schreibt sie?");
  assert.equal(rt("ⲛⲓⲙ ⲉⲧⲉϥⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ"), "من يكتب الدرس؟");
  assert.equal(rt("ⲛⲓⲙ ⲉⲧⲉϥⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "en"), "Who writes the lesson?");
  assert.equal(rt("ⲛⲓⲙ ⲉⲧⲉϥⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "fr"), "Qui écrit la leçon?");
  assert.equal(rt("ⲛⲓⲙ ⲉⲧⲉϥⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "de"), "Wer schreibt die Lektion?");
  assert.equal(rt("ⲑⲱⲛ ⲉⲧⲉϥⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "en"), "Where does he write the lesson?");
  assert.equal(rt("ⲑⲱⲛ ⲉⲧⲉϥⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "fr"), "Où est-ce qu'il écrit la leçon?");
  assert.equal(rt("ⲑⲱⲛ ⲉⲧⲉϥⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ", "de"), "Wo schreibt er die Lektion?");
  assert.equal(rt("ⲑⲱⲛ ⲡⲉ Ⲡⲉⲧⲣⲟⲥ"), "أين بطرس؟");
  assert.equal(rt("ⲑⲱⲛ ⲡⲉ Ⲡⲉⲧⲣⲟⲥ", "en"), "Where is Peter?");
  assert.equal(rt("ⲑⲱⲛ ⲡⲉ Ⲡⲉⲧⲣⲟⲥ", "fr"), "Où est Pierre?");
  assert.equal(rt("ⲑⲱⲛ ⲡⲉ Ⲡⲉⲧⲣⲟⲥ", "de"), "Wo ist Petrus?");
});

test("reverse: unknown words are reported, never guessed", () => {
  const r = translateReverse("Ϯⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲃⲗⲁϩⲃⲗⲁϩ", "ar");
  assert.equal(r.ok, true);
  assert.deepEqual(r.unknown, ["ⲡⲓⲃⲗⲁϩⲃⲗⲁϩ"]);
  assert.match(formatReverseTranslation("Ϯⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲃⲗⲁϩⲃⲗⲁϩ", "ar"), /⚠️ كلمات غير معروفة: ⲡⲓⲃⲗⲁϩⲃⲗⲁϩ/);
  const noSense = translateReverse("ⲃⲗⲁϩⲃⲗⲁϩ", "ar");
  assert.equal(noSense.ok, false);
});

test("reverse: session target switching", () => {
  assert.equal(getReverseTarget(), "ar");
  assert.equal(setReverseTarget("en"), "en");
  assert.equal(getReverseTarget(), "en");
  assert.equal(setReverseTarget("xx"), "en"); // invalid target keeps the old one
  assert.equal(setReverseTarget("ar"), "ar");
});

test("reverse: formatTranslation routes Coptic input to the reverse engine", () => {
  assert.equal(formatTranslation("Ϯⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ"), "أنا أحب الله");
  setReverseTarget("en");
  assert.equal(formatTranslation("Ϯⲙⲉⲓ ⲙ̀ Ⲫ̀ⲛⲟⲩϯ"), "I love God");
  setReverseTarget("ar");
  // Arabic and Latin input keep the existing forward engine byte-identical
  assert.equal(formatTranslation("أنا أكتب الدرس"), "Ϯⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
  assert.equal(formatTranslation("I write the lesson"), "Ϯⲥ̀ϧⲁⲓ ⲙ̀ ⲡⲓⲙⲁⲑⲏⲙⲁ");
});

test("reverse: round-trip with the forward engine", () => {
  const fwd = (ar) => translateSentence(ar).coptic;
  assert.equal(rt(fwd("أنا أكتب الدرس")), "أنا أكتب الدرس");
  assert.equal(rt(fwd("سأكتب الدرس")), "سأكتب الدرس");
  assert.equal(rt(fwd("أنا أحب الله")), "أنا أحب الله");
  assert.equal(rt(fwd("هو يكتب الدرس"), "en"), "He writes the lesson");
  assert.equal(rt(fwd("الرجل يكتب الدرس"), "en"), "The man writes the lesson");
});
