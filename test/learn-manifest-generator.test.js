import test from "node:test";
import assert from "node:assert/strict";
import {
  LEARN_SHEET_ID,
  learnSheetGvizUrl,
  parseGvizResponse,
  driveIdFromUrl,
  buildLearnLevels,
  countLearnItems,
  renderLearnManifest,
} from "../scripts/generate-learn-manifest.mjs";

// ---------------------------------------------------------------------------
// Learn-manifest generator (auto-sync: the deploy workflow's sync job runs
// it every 30 minutes against the live "learn" tab; a changed manifest is
// committed, deployed, and the Worker's scheduled tick re-imports the
// changed media). The builder is pure: the same Sheet rows always build
// the same levels, so an unchanged Sheet produces a byte-identical file
// and the sync job commits nothing.
// ---------------------------------------------------------------------------

const gviz = (rows) =>
  `/*O_o*/\ngoogle.visualization.Query.setResponse({"version":"0.6","reqId":"0","status":"ok","table":{"cols":[],"rows":${JSON.stringify(
    rows.map((r) => ({ c: r.map((v) => (v === null ? null : { v })) })),
  )}}});`;

test("learn-manifest-generator: gviz url points at the coptic learn tab", () => {
  assert.equal(LEARN_SHEET_ID, "1kZKjF2KDsGT0HslGSenN-pDTzx4FpX0QDPqX0ZOnriY");
  assert.ok(learnSheetGvizUrl().includes(LEARN_SHEET_ID));
  assert.ok(learnSheetGvizUrl().includes("sheet=learn"));
});

test("learn-manifest-generator: drive ids from /d/ links and ?id= links", () => {
  assert.equal(driveIdFromUrl("https://drive.google.com/file/d/ABC123_xyz/view?usp=sharing"), "ABC123_xyz");
  assert.equal(driveIdFromUrl("https://drive.google.com/open?id=ABC123_xyz"), "ABC123_xyz");
  assert.equal(driveIdFromUrl("https://drive.google.com/uc?export=download&id=ABC123_xyz"), "ABC123_xyz");
  assert.equal(driveIdFromUrl("not a link"), "");
  assert.equal(driveIdFromUrl(""), "");
});

test("learn-manifest-generator: parses gviz rows and builds levels in user order", () => {
  const rows = parseGvizResponse(
    gviz([
      ["المستوى", "اسم زر الدرس بداخل المستوى", "وصف الدرس", "رابط الفيديو", "الشفوي", "الامتحان", "الملخص", "الاستثناء"],
      [1, "الدرس الاول", "الدرس الاول", "https://drive.google.com/file/d/VID1/view", "https://drive.google.com/file/d/PHOTO1/view", "https://docs.google.com/forms/d/FORM1/edit", "", "تجاهلني"],
      [2, "الدرس الثاني", "الدرس الثاني", "https://drive.google.com/file/d/VID2/view", "اكتب التمرين هنا", "https://docs.google.com/forms/d/FORM2/edit", "https://drive.google.com/file/d/SUM2/view", ""],
      ["", "", "", "", "", "", "", ""],
    ]),
  );
  assert.equal(rows.length, 4);
  assert.equal(rows[1][0], "1");
  assert.equal(rows[1][4], "https://drive.google.com/file/d/PHOTO1/view");
  const levels = buildLearnLevels(rows);
  assert.equal(levels.length, 2);
  assert.equal(levels[0].id, "m_learn_l1");
  assert.equal(levels[0].lessons.length, 1);
  assert.equal(levels[0].lessons[0].id, "m_learn_l1_01");
  assert.deepEqual(
    levels[0].lessons[0].items.map((i) => i.key),
    ["video", "oral", "exam"],
  );
  assert.equal(levels[0].lessons[0].items[0].driveId, "VID1");
  // Level 2: column E is exercise TEXT (not a photo) and column G is the
  // summary photo; item order is video → summary → exercise → exam.
  const l2 = levels[1].lessons[0];
  assert.deepEqual(
    l2.items.map((i) => i.key),
    ["video", "summary", "exercise", "exam"],
  );
  assert.equal(l2.items.find((i) => i.key === "exercise").kind, "text");
  assert.equal(l2.items.find((i) => i.key === "exercise").text, "اكتب التمرين هنا");
  assert.equal(l2.items.find((i) => i.key === "summary").driveId, "SUM2");
  // Column H is ignored entirely (the "تجاهلني" cell changes nothing).
  assert.deepEqual(countLearnItems(levels), { lessons: 2, videos: 2, photos: 2, forms: 2, texts: 1 });
});

test("learn-manifest-generator: gviz rows have no header — the first lesson is kept", () => {
  // Regression test for 2026-11-13: gviz returns data rows only (the labels
  // live in table.cols), so a blind slice(1) dropped the first lesson —
  // the L1 intro video "فيديو تعريفي عن اللغة القبطية" — and the manifest
  // shipped with 26 lessons instead of 27. buildLearnLevels must detect
  // the header instead of assuming it is there.
  const levels = buildLearnLevels([
    [1, "فيديو تعريفي عن اللغة القبطية", "فيديو تعريفي عن اللغة القبطية", "https://drive.google.com/file/d/VID0/view", "", "", "", ""],
    [1, "مقدمة عن حروف اللغة القبطية", "مقدمة عن حروف اللغة القبطية", "https://drive.google.com/file/d/VID1/view", "", "", "", ""],
    [2, "الدرس الاول", "الدرس الاول", "https://drive.google.com/file/d/VID2/view", "", "", "", ""],
  ]);
  assert.equal(levels[0].lessons.length, 2);
  assert.equal(levels[0].lessons[0].id, "m_learn_l1_01");
  assert.equal(levels[0].lessons[0].title, "فيديو تعريفي عن اللغة القبطية");
  assert.equal(levels[0].lessons[1].id, "m_learn_l1_02");
  assert.equal(levels[1].lessons.length, 1);
  assert.equal(levels[1].lessons[0].id, "m_learn_l2_01");
});

test("learn-manifest-generator: rejects bad rows instead of writing a broken manifest", () => {
  const header = ["المستوى", "الاسم", "الوصف", "الفيديو", "الشفوي", "الامتحان", "الملخص", "H"];
  assert.throws(() => buildLearnLevels([header, [1, "", "", "https://drive.google.com/file/d/V/view", "", "", "", ""]]), /no lesson name/);
  assert.throws(
    () => buildLearnLevels([header, [1, "x".repeat(41), "", "https://drive.google.com/file/d/V/view", "", "", "", ""]]),
    /over 40 chars/,
  );
  assert.throws(() => buildLearnLevels([header, [1, "درس بلا محتوى", "", "", "", "", "", ""]]), /no items/);
  assert.throws(
    () => buildLearnLevels([header, [1, "درس", "", "https://drive.google.com/file/d/V/view", "", "not-a-url", "", ""]]),
    /Bad Forms URL/,
  );
});

test("learn-manifest-generator: gviz errors and malformed bodies throw", () => {
  assert.throws(() => parseGvizResponse("not json at all"), /no JSON body/);
  assert.throws(
    () =>
      parseGvizResponse(
        `google.visualization.Query.setResponse({"version":"0.6","status":"error","errors":[{"detailed_message":"Access denied"}]});`,
      ),
    /Access denied/,
  );
});

test("learn-manifest-generator: rendering is deterministic", () => {
  const levels = buildLearnLevels([
    ["h", "h", "h", "h", "h", "h", "h", "h"],
    [1, "درس", "درس", "https://drive.google.com/file/d/V1/view", "", "https://docs.google.com/forms/d/F1/edit", "", ""],
  ]);
  assert.equal(renderLearnManifest(levels), renderLearnManifest(levels));
  assert.ok(renderLearnManifest(levels).includes("export const LEARN_MANIFEST_VERSION = 1;"));
  assert.ok(renderLearnManifest(levels).includes('"id": "m_learn_l1_01"'));
});
