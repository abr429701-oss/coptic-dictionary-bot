import test from "node:test";
import assert from "node:assert/strict";
import { parseFormPage, formIdsFromLessons } from "../scripts/generate-exam-data.mjs";

// Minimal viewform page: one of each question type the 12 real exams use
// (short text with code validation, section, multiple choice with image,
// dropdown) plus the submit form action.
const PAGE = `<html><head><title>x</title></head><body>
<form action="https://docs.google.com/forms/d/e/ABC123/formResponse" method="POST"></form>
<script>var FB_PUBLIC_LOAD_DATA_ = [null,["الدرس الأول",[
[111,"ادخل الرقم الكودي",null,0,[[1001,null,1,null,[[4,301,["(111|222)"],"الرقم الكودي غير صحيح"]]]],null,null,null,null,null,null,[null,"<b>ادخل الرقم الكودي</b>"]],
[222,"أسئلة الامتحان",null,8,null,null,null,null,null,null,null,null,[null,"أسئلة الامتحان"]],
[333,"كم عدد الحروف؟",null,2,[[1002,[["7",null,null,null,0],["8",null,null,null,0]],1,null,null,null,null,null,0]],null,null,null,null,[["IMGID1",null,[100,50,0]]],null,[null,"كم عدد الحروف؟"]],
[444,"اختر إجابة",null,4,[[1003,[["أ",null,null,null,0],["ب",null,null,null,0]],1]],null,null,null,null,null,null,null,[null,"اختر إجابة"]]
],["تم الاستلام",0,0,0,0],null,null,[null,0],null,[1,"رسالة الإغلاق"],"الامتحان الأول من المستوى الأول",76]];
</script></body></html>`;

test("parseFormPage extracts the exam faithfully", () => {
  const form = parseFormPage(PAGE, "FORM1");
  assert.equal(form.formId, "FORM1");
  assert.equal(form.title, "الامتحان الأول من المستوى الأول");
  assert.equal(form.label, "الدرس الأول");
  assert.equal(form.confirmationMessage, "تم الاستلام");
  assert.equal(form.closedMessage, "رسالة الإغلاق");
  assert.equal(form.submitUrl, "https://docs.google.com/forms/d/e/ABC123/formResponse");
  assert.equal(form.questions.length, 4);

  const code = form.questions[0];
  assert.equal(code.type, 0);
  assert.equal(code.typeName, "short text");
  assert.equal(code.entryId, 1001);
  assert.equal(code.required, true);
  assert.equal(code.validation.pattern, "(111|222)");
  assert.equal(code.validation.errorText, "الرقم الكودي غير صحيح");
  // The verbatim pattern, anchored as a full-string match like Google's
  // "matches" validation, accepts only the listed codes.
  const re = new RegExp(`^(?:${code.validation.pattern})$`);
  assert.equal(re.test("111"), true);
  assert.equal(re.test("222"), true);
  assert.equal(re.test("1112"), false);
  assert.equal(re.test("x111"), false);

  const section = form.questions[1];
  assert.equal(section.type, 8);
  assert.equal(section.entryId, null);

  const mc = form.questions[2];
  assert.equal(mc.type, 2);
  assert.equal(mc.entryId, 1002);
  assert.deepEqual(mc.options, ["7", "8"]);
  assert.equal(mc.imageId, "IMGID1");
  assert.equal(mc.required, true);

  const dd = form.questions[3];
  assert.equal(dd.type, 4);
  assert.equal(dd.entryId, 1003);
  assert.deepEqual(dd.options, ["أ", "ب"]);
});

test("parseFormPage throws without load data", () => {
  assert.throws(() => parseFormPage("<html></html>", "X"), /no FB_PUBLIC_LOAD_DATA_/u);
});

test("formIdsFromLessons collects exam forms in order, deduped", () => {
  const lessons = {
    levels: [
      { lessons: [{ items: [{ kind: "url", url: "https://docs.google.com/forms/d/AAA/edit" }, { kind: "video", driveId: "v" }] }] },
      { lessons: [{ items: [{ kind: "url", url: "https://docs.google.com/forms/d/BBB/edit?usp=send_form" }, { kind: "url", url: "https://docs.google.com/forms/d/AAA/edit" }] }] },
    ],
  };
  assert.deepEqual(formIdsFromLessons(lessons), ["AAA", "BBB"]);
});
