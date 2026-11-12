import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LEARN_LEVELS } from "../src/learn-manifest.js";

const testRoot = fileURLToPath(new URL("..", import.meta.url));
const appJson = JSON.parse(readFileSync(resolve(testRoot, "public", "learn-app", "lessons.json"), "utf8"));
const examJson = JSON.parse(readFileSync(resolve(testRoot, "public", "learn-app", "exams.json"), "utf8"));
const appHtml = readFileSync(resolve(testRoot, "public", "learn-app", "index.html"), "utf8");

// The learning web app (2026-11-13): static page, no locks, all lessons open.
// lessons.json is generated from the frozen manifest — this test pins them
// together so a stale regeneration fails the suite instead of shipping
// silently wrong content.
test("learn-app: lessons.json matches the frozen manifest exactly", () => {
  assert.equal(appJson.version, 1);
  assert.deepEqual(appJson.levels, LEARN_LEVELS);
});

test("learn-app: every lesson is complete and every item is well formed", () => {
  assert.equal(appJson.levels.length, 2, "two levels");
  const lessons = appJson.levels.flatMap((l) => l.lessons);
  assert.equal(lessons.length, 27, "17 level-1 + 10 level-2 lessons");
  for (const lesson of lessons) {
    assert.ok(lesson.items.length >= 1, `${lesson.id} has items`);
    for (const item of lesson.items) {
      if (item.kind === "video" || item.kind === "photo") {
        assert.ok(item.driveId, `${lesson.id}/${item.key} has a Drive id`);
      } else if (item.kind === "url") {
        assert.ok(String(item.url).startsWith("https://docs.google.com/forms/"), `${lesson.id} exam is a Forms link`);
      } else if (item.kind === "text") {
        assert.ok(String(item.text).trim().length > 0, `${lesson.id} exercise text is not empty`);
      } else {
        assert.fail(`${lesson.id} has unknown item kind ${item.kind}`);
      }
    }
  }
  const kinds = lessons.flatMap((l) => l.items.map((i) => i.kind));
  assert.equal(kinds.filter((k) => k === "video").length, 27);
  assert.equal(kinds.filter((k) => k === "photo").length, 23);
  assert.equal(kinds.filter((k) => k === "url").length, 12);
  assert.equal(kinds.filter((k) => k === "text").length, 4);
});

test("learn-app: index.html loads the data and plays video natively", () => {
  assert.ok(appHtml.includes("https://telegram.org/js/telegram-web-app.js"), "Telegram WebApp SDK");
  assert.ok(appHtml.includes('fetch("lessons.json")'), "loads the static lesson data");
  assert.ok(appHtml.includes("<video controls playsinline"), "native video element, no Drive player embed");
  assert.ok(appHtml.includes("drive.usercontent.google.com/download"), "videos stream straight from Google, zero Worker requests");
  assert.ok(appHtml.includes("drive.google.com/file/d/"), "Drive preview iframe as fallback when native video errors");
  assert.ok(appHtml.includes("الامتحان الإلكتروني"), "exam button label");
});

test("learn-app: exams.json covers all 12 forms with submit URLs and code validation", () => {
  assert.equal(examJson.forms.length, 12, "one form per exam link");
  const answerable = examJson.forms.flatMap((f) => f.questions.filter((q) => q.entryId !== null));
  assert.equal(answerable.length, 122, "14 text + 106 MC + 2 dropdown");
  for (const form of examJson.forms) {
    assert.ok(form.submitUrl.endsWith("/formResponse"), `${form.formId} has a submit URL`);
    assert.ok(form.confirmationMessage.length > 0, `${form.formId} has a confirmation message`);
    const code = form.questions.find((q) => q.type === 0);
    assert.ok(code, `${form.formId} has a code question`);
    assert.ok(code.validation && code.validation.kind === "regex", `${form.formId} code question carries the regex`);
    assert.equal(code.validation.errorText, "الرقم الكودي غير صحيح");
    assert.ok(code.validation.pattern.length > 10, `${form.formId} code regex is not empty`);
    // The verbatim pattern must compile and anchor as a full-string match.
    const re = new RegExp(`^(?:${code.validation.pattern})$`);
    assert.equal(typeof re.test, "function");
  }
});

test("learn-app: index.html renders the exam in-app and posts to Google", () => {
  assert.ok(appHtml.includes('fetch("exams.json")'), "exam data loads lazily");
  assert.ok(appHtml.includes("data-exam"), "lesson exam button opens the in-app exam");
  assert.ok(appHtml.includes("إرسال الإجابات"), "exam submit button");
  assert.ok(appHtml.includes('mode: "no-cors"'), "answers POST straight to Google");
  assert.ok(appHtml.includes("هذا السؤال مطلوب."), "required validation like Google Forms");
  assert.ok(appHtml.includes("codeMatches"), "code check with a set fallback if the giant regex cannot compile");
  assert.ok(appHtml.includes("fail closed"), "an unverifiable code blocks the submit instead of passing");
});
