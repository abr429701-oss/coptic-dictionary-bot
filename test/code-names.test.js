import test from "node:test";
import assert from "node:assert/strict";
import { parseCodeCsv, namesFromRows } from "../scripts/generate-code-names.mjs";

test("code names: CSV parser handles quoted fields and junk rows", () => {
  const csv = `"الرقم الكودي","الاسم ثلاثي","رقم الموبايل"\r\n"3442935","هيلانة ادورد حنا ","1202208368"\r\n"1","2","2"\r\n"999","اسم, فيه فاصلة","123"\r\n`;
  const names = namesFromRows(parseCodeCsv(csv));
  assert.equal(names["3442935"], "هيلانة ادورد حنا");
  assert.equal(names["999"], "اسم, فيه فاصلة");
  assert.ok(!("1" in names), "numeric junk name is skipped");
  assert.ok(!("الرقم الكودي" in names), "header row is skipped");
});
