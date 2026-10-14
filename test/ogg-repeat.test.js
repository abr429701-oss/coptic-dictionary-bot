import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { oggCrc, parseOggPages, repeatSingleWordOgg } from "../src/ogg-repeat.js";

let hasFfmpeg = true;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { hasFfmpeg = false; }

function makeOpus(extraArgs) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "ogg-")), "one.ogg");
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.2",
    "-ac", "1", "-ar", "24000", "-c:a", "libopus", "-b:a", "32k", ...extraArgs, file]);
  const buffer = readFileSync(file);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
}

test("a marked single-word file is repeated inside one valid Ogg Opus stream", { skip: !hasFfmpeg }, () => {
  const source = makeOpus(["-metadata", "comment=once-v1"]);
  const out = repeatSingleWordOgg(source, { times: 3, pauseMs: 700 });
  assert.ok(out.byteLength > source.byteLength * 2.5);
  const bytes = new Uint8Array(out);
  const pages = parseOggPages(bytes);
  let offset = 0;
  pages.forEach((page, index) => {
    const length = 27 + page.lacing.length + page.data.length;
    const copy = bytes.slice(offset, offset + length);
    const stored = new DataView(copy.buffer).getUint32(22, true);
    new DataView(copy.buffer).setUint32(22, 0, true);
    assert.equal(oggCrc(copy), stored, `page ${index} checksum`);
    assert.equal(new DataView(bytes.buffer, offset, 27).getUint32(18, true), index, "sequence numbers are continuous");
    assert.equal((page.type & 4) !== 0, index === pages.length - 1, "only the last page ends the stream");
    offset += length;
  });
  const granules = pages.map((page) => page.granule).filter((value) => value >= 0);
  assert.deepEqual(granules, [...granules].sort((a, b) => a - b));
});

test("files without the single-word marker or non-Ogg input are not touched", { skip: !hasFfmpeg }, () => {
  const source = makeOpus([]);
  assert.equal(repeatSingleWordOgg(source, { times: 3 }), source);
  const marked = makeOpus(["-metadata", "comment=once-v1"]);
  assert.equal(repeatSingleWordOgg(marked, { times: 1 }), marked);
  assert.throws(() => repeatSingleWordOgg(new Uint8Array([1, 2, 3, 4, 5, 6]).buffer, { times: 3 }));
});
