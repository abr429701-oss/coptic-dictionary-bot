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
  // Native <video>, no playsinline: the video opens fullscreen automatically
  // (iPhone does it natively on play; other phones via requestFullscreen).
  assert.ok(appHtml.includes("<video controls"), "native video element, no Drive player embed");
  assert.ok(!appHtml.includes("playsinline"), "no playsinline — the video is allowed to go fullscreen");
  assert.ok(appHtml.includes("openCinema"), "cinema-mode fullscreen");
  assert.ok(appHtml.includes("cinemaOverlay"), "cinema overlay element");
  assert.ok(appHtml.includes("tg.requestFullscreen"), "Telegram fullscreen for the web app itself");
  // Video and photos go through the Worker's /media/<id> proxy
  // (user-approved small request cost, 2026-11-13): clean media headers,
  // native playback, no player. The direct Drive links are gone — Drive's
  // attachment header breaks inline playback and <img> rendering on the
  // user's phone.
  assert.ok(appHtml.includes('"/media/"'), "videos and photos go through the Worker proxy");
  assert.ok(!appHtml.includes("drive.usercontent.google.com/download"), "no direct usercontent media URL");
  assert.ok(!appHtml.includes("uc?export=download"), "no direct Drive download URL");
  assert.ok(!appHtml.includes("/preview"), "no Drive preview player iframe");
  assert.ok(!appHtml.includes("الفيديو ما اشتغلش"), "no video fallback phrase (removed 2026-11-13)");
  assert.ok(!appHtml.includes("أو افتح الامتحان في Google Forms"), "no Google Forms fallback phrase (removed 2026-11-13)");
  assert.ok(appHtml.includes("الامتحان الإلكتروني"), "exam button label");
});

test("learn-app: home shows both levels as cards, lessons open per level", () => {
  // Home (2026-11-13): the two levels sit on the home screen as big cards
  // (one tap to a level's lessons) instead of both full lesson lists
  // stacked — reaching level 2 used to mean scrolling past all 17
  // level-1 lessons.
  assert.ok(appHtml.includes("showLevel"), "level view function");
  assert.ok(appHtml.includes("levelCard"), "level cards on the home screen");
  assert.ok(appHtml.includes("data-level"), "level cards are wired by level index");
  assert.ok(appHtml.includes("اضغط لعرض الدروس"), "level card invites the tap");
  // Back from a lesson returns to its level list; back from a level
  // returns home.
  assert.ok(appHtml.includes("currentLevel"), "the lesson remembers its level for Back");
  assert.ok(appHtml.includes("showLevel(currentLevel)"), "Back from a lesson opens its level list");
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
  // Code gate (2026-11-13): the exam does not open until the correct code
  // is typed — the gate screen, its entry button, and the verified code
  // submitted as the code question's answer.
  assert.ok(appHtml.includes("showCodeGate"), "code gate before the exam");
  assert.ok(appHtml.includes("أدخل الرقم الكودي"), "gate title");
  assert.ok(appHtml.includes("دخول الامتحان"), "gate entry button");
  assert.ok(appHtml.includes("examCodeEntryId"), "verified code submitted as its answer");
  // Name greeting (2026-11-13): after a correct code the student is
  // greeted by the name attached to that code, then headed into the exam.
  assert.ok(appHtml.includes("enterWithGreeting"), "greeting step after a correct code");
  assert.ok(appHtml.includes("جاري توجيهك للامتحان"), "greeting message");
  assert.ok(appHtml.includes('fetch("codes.json")'), "code -> name map loads lazily at the gate");
  // Fullscreen (2026-11-13): Telegram's webview plays videos inline, so
  // fullscreen is requested from a real tap — the lesson-open tap and a
  // dedicated button under the video — not only from the play event.
  assert.ok(appHtml.includes("ملء الشاشة"), "fullscreen button under the lesson video");
  assert.ok(appHtml.includes("data-fs"), "fullscreen button is wired");
  // The button sits UNDER the video frame (outside .videoWrap): the
  // video is absolutely positioned and covers the whole wrap, so a
  // button inside it is painted over and can never be tapped — after
  // closing cinema there was no way back in (2026-11-13).
  assert.ok(appHtml.includes("</video></div>"), "videoWrap closes before the fullscreen button");
  // Cinema bottom bar (2026-11-13): the phone's own bottom buttons and
  // the video's native bottom controls are unreachable while the
  // overlay is open, so the bar — inside the overlay, above the
  // phone's button area — carries back-to-lesson and play/pause.
  assert.ok(appHtml.includes("cinemaBar"), "cinema bottom control bar");
  assert.ok(appHtml.includes("رجوع للدرس"), "cinema bar back button");
  assert.ok(!appHtml.includes("cinemaHint"), "the floating hint is gone — the bar replaces it");
  // Certificate in the app (2026-11-13): pick the level, type the code,
  // the Worker looks it up and returns the certificate image.
  assert.ok(appHtml.includes("showCert"), "certificate screen in the app");
  assert.ok(appHtml.includes("الحصول على الشهادة"), "certificate entry point");
  assert.ok(appHtml.includes('"/cert?code="'), "certificate lookup goes through the Worker");
  // Downloading from Telegram's webview (2026-11-13): the download
  // attribute on a blob link does nothing there, so the share sheet is
  // the primary save path and the direct /cert link is the fallback.
  assert.ok(appHtml.includes("navigator.share"), "certificate is saved through the native share sheet");
  assert.ok(appHtml.includes("مشاركة / حفظ الشهادة"), "share/save button");
  // Live exam pattern (2026-11-13): the teacher's sequencing lives in the
  // Forms themselves — each form's code question only allows the codes of
  // students eligible for THAT exam — so a code the baked pattern does
  // not know is checked against the form's CURRENT pattern, not against
  // the registration sheet (which would let a student skip ahead). The
  // sheet only supplies the name for the greeting.
  assert.ok(appHtml.includes('"/exam-pattern?formId="'), "gate falls back to the form's live pattern");
  assert.ok(appHtml.includes("جارٍ التحقق من الرقم الكودي"), "checking state while the live check runs");
  assert.ok(appHtml.includes('"/checkcode?code="'), "name for the greeting comes from the live sheet when not baked");
  // Get-code inside the app (2026-11-13): name + phone -> the Worker asks
  // the registration macro and returns the code.
  assert.ok(appHtml.includes("showGetCode"), "get-code screen in the app");
  assert.ok(appHtml.includes("الحصول على الرقم الكودي"), "get-code entry point");
  assert.ok(appHtml.includes('fetch("/getcode"'), "code lookup goes through the Worker");
});

test("learn-app: media allow-list covers every lesson photo/video and exam image", () => {
  const mediaJson = JSON.parse(readFileSync(resolve(testRoot, "src", "lesson-media.json"), "utf8"));
  const ids = new Set(mediaJson.ids);
  const lessonIds = appJson.levels.flatMap((l) => l.lessons).flatMap((lesson) => lesson.items)
    .filter((i) => (i.kind === "video" || i.kind === "photo") && i.driveId)
    .map((i) => i.driveId);
  const examImageIds = examJson.forms.flatMap((f) => f.questions).filter((q) => q.imageId).map((q) => q.imageId);
  assert.equal(ids.size, 86, "27 videos + 23 photos + 36 exam images");
  for (const id of [...lessonIds, ...examImageIds]) {
    assert.ok(ids.has(id), `${id} is in the media allow-list`);
  }
});

test("learn-app: codes.json maps codes to real student names", () => {
  const codesJson = JSON.parse(readFileSync(resolve(testRoot, "public", "learn-app", "codes.json"), "utf8"));
  const names = codesJson.names;
  const keys = Object.keys(names);
  assert.ok(keys.length > 1900, `${keys.length} codes with names`);
  assert.equal(names["3442935"].trim(), "هيلانة ادورد حنا");
  assert.ok(!("1" in names), "junk code 1 has no name");
  for (const key of keys) {
    assert.ok(/[\p{L}]/u.test(names[key]), `${key} maps to a real name, not a number`);
  }
  assert.ok(!("phone" in codesJson) && !JSON.stringify(codesJson).includes("1202208368"), "no phone numbers in the app data");
});
