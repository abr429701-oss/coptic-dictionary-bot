// scripts/generate-learn-app-data.mjs — builds public/learn-app/lessons.json
// from the frozen learn manifest (src/learn-manifest.js) into the tracked
// source learn-app/lessons.json. The web app is fully static: it loads this
// JSON and renders the lessons, so the lesson list costs no Worker requests
// at all. Videos/photos play from their public Drive links; the exam link
// is the same Google Forms URL the bot sends. The build step
// (npm run build:learn-app, run by pretest) copies learn-app/ into
// public/learn-app/ for wrangler; public/learn-app/ itself is build output
// (gitignored, like public/search-index/). Re-run after any manifest change;
// test/learn-app.test.js pins the JSON to the manifest so drift fails.
import { writeFileSync, mkdirSync } from "node:fs";
import { LEARN_LEVELS } from "../src/learn-manifest.js";

const data = {
  version: 1,
  levels: LEARN_LEVELS.map((level) => ({
    id: level.id,
    title: level.title,
    lessons: level.lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      items: lesson.items.map((item) => ({
        key: item.key,
        kind: item.kind,
        label: item.label,
        ...(item.driveId ? { driveId: item.driveId } : {}),
        ...(item.url ? { url: item.url } : {}),
        ...(item.text ? { text: item.text } : {}),
      })),
    })),
  })),
};

mkdirSync(new URL("../learn-app/", import.meta.url), { recursive: true });
const out = new URL("../learn-app/lessons.json", import.meta.url);
writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
const lessons = data.levels.reduce((n, l) => n + l.lessons.length, 0);
console.log(`wrote ${out.pathname}: ${data.levels.length} levels, ${lessons} lessons`);
