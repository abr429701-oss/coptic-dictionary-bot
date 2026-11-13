import test from "node:test";
import assert from "node:assert/strict";
import { extractCodePattern } from "../src/exam-pattern.js";

// A minimal viewform page: one code question with a regex validation,
// plus a plain question without one.
const codeQ = [1, "الرقم الكودي", "", 0, [[123, null, 1, null, [[4, 301, ["(54917515|6043415)"], "الرقم الكودي غير صحيح"]]]], null, null, null, null, null, null, [null, ""]];
const plainQ = [2, "اسمك", "", 0, [[124, null, 1, null, null]], null, null, null, null, null, null, [null, ""]];
const page = `<html><head><script>FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, ["label", [codeQ, plainQ], [], null, null, null, null, [0, ""], "title"]])};</script></head></html>`;

test("exam-pattern: extracts the code question regex from a viewform page", () => {
  const found = extractCodePattern(page);
  assert.ok(found);
  assert.equal(found.pattern, "(54917515|6043415)");
  assert.equal(found.errorText, "الرقم الكودي غير صحيح");
});

test("exam-pattern: returns null when the page has no load data or no code question", () => {
  assert.equal(extractCodePattern("<html>no data here</html>"), null);
  assert.equal(extractCodePattern("FB_PUBLIC_LOAD_DATA_ = [1,2,3];</script>"), null);
});
