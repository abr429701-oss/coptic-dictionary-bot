// Build-time allow-list for the Worker's lesson-media proxy (/media/<id>).
// Collects every Drive file id the learn app may ask the Worker to serve:
// lesson videos + photos (learn-app/lessons.json) and exam question images
// (learn-app/exams.json). The proxy serves only these ids (closed set, not
// an open proxy) and only image/* or video/* upstreams. Run after the
// lessons + exams data exist (pretest/predeploy run it last).
import { writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(root, "src", "lesson-media.json");

function main() {
  const lessons = JSON.parse(readFileSync(resolve(root, "learn-app", "lessons.json"), "utf8"));
  const exams = JSON.parse(readFileSync(resolve(root, "learn-app", "exams.json"), "utf8"));
  const ids = new Set();
  for (const level of lessons.levels || []) {
    for (const lesson of level.lessons || []) {
      for (const item of lesson.items || []) {
        if ((item.kind === "video" || item.kind === "photo") && item.driveId) ids.add(item.driveId);
      }
    }
  }
  for (const form of exams.forms || []) {
    for (const q of form.questions || []) {
      if (q.imageId) ids.add(q.imageId);
    }
  }
  const data = { version: 1, generatedAt: new Date().toISOString(), ids: [...ids].sort() };
  writeFileSync(OUT, JSON.stringify(data, null, 1) + "\n", "utf8");
  console.log(`media-ids: wrote ${data.ids.length} lesson media ids`);
}

main();
