// Upload the learn app's lesson media (videos/photos/exam images) from
// Google Drive to the public R2 bucket "coptic-lessons", so the web app
// can serve them straight from R2 at ZERO Worker requests (the Worker's
// /media/<id> proxy costs one Worker request per Range fetch).
//
// Source of truth for the ids: src/lesson-media.json (86 ids: 27 videos +
// 23 photos + 36 exam images). Each file is downloaded from Drive's public
// URL, its content-type is taken from the response headers (video/mp4 ->
// .mp4, image/jpeg -> .jpg, image/png -> .png), and uploaded with
// `wrangler r2 object put` as "<driveId>.<ext>".
//
// Idempotent: when R2_PUBLIC_BASE is set (the bucket's public URL, from
// `wrangler r2 bucket dev-url get coptic-lessons`), an object is skipped
// when a HEAD on its public URL returns the same Content-Length as the
// fresh download. Without the base (first run, before the public URL is
// enabled) every downloadable file is uploaded; `wrangler r2 object put`
// overwrites, so re-runs stay safe.
//
// Writes learn-app/r2-media.json: { base: "<public R2 URL>", keys: { "<driveId>": "<key>" } }
// — the app reads the base from the map, so no URL has to be pasted into
// index.html by hand (R2_PUBLIC_BASE there is only a fallback). Ids that fail
// to download (not publicly downloadable from Drive) are NOT mapped — the app
// falls back to the Worker /media/<id> proxy for them. NOTE (verified 2026-11-14): all 36
// exam image ids 404 on Drive's public download URL, and the live Worker
// proxy 502s for them too — they are already broken in the live app, and
// this script cannot fix them; only the 50 lesson video/photo ids upload.
//
// Usage (GitHub Actions, see .github/workflows/r2-media.yml):
//   R2_PUBLIC_BASE="https://pub-xxxx.r2.dev" node scripts/upload-media-to-r2.mjs
// Check-only (no upload, no creds needed — downloads and verifies only):
//   node scripts/upload-media-to-r2.mjs --check-only
// --allow-partial: exit 0 when at least one id succeeded (the known-dead
// exam images fail every run; the workflow uses this so the mapping for
// the good ids still gets committed).
//
// Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the
// environment (already present in Actions as a secret and a var).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUCKET = process.env.R2_BUCKET || "coptic-lessons";
const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE || "").replace(/\/+$/, "");
const CHECK_ONLY = process.argv.includes("--check-only");
const ALLOW_PARTIAL = process.argv.includes("--allow-partial");
const CONCURRENCY = 3;
const DOWNLOAD_TIMEOUT_MS = 300000;
const HEAD_TIMEOUT_MS = 15000;
const DRIVE_URL = (id) => `https://drive.google.com/uc?export=download&id=${id}`;

const EXT_BY_TYPE = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function fail(message) {
  console.error(`upload-media-to-r2: ${message}`);
  process.exit(1);
}

if (!CHECK_ONLY && (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID)) {
  fail("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set in the environment.");
}

const { ids } = JSON.parse(readFileSync(resolve(root, "src", "lesson-media.json"), "utf8"));
if (!Array.isArray(ids) || ids.length === 0) fail("src/lesson-media.json has no ids.");

async function download(id, attempt = 0) {
  let res;
  try {
    res = await fetch(DRIVE_URL(id), { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (error) {
    if (attempt === 0) return download(id, 1);
    throw new Error(`fetch failed: ${error.message}`);
  }
  if (!res.ok) {
    // Drive 5xx/429 is usually transient — one retry before giving up.
    if (attempt === 0 && (res.status >= 500 || res.status === 429)) {
      await new Promise((r) => setTimeout(r, 5000));
      return download(id, 1);
    }
    throw new Error(`Drive HTTP ${res.status}`);
  }
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = EXT_BY_TYPE[type];
  if (!ext) throw new Error(`unexpected content-type ${type || "(none)"} (not a video/image — likely a Drive error page)`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new Error("empty download");
  return { buffer, type, ext, size: buffer.length };
}

async function existsOnR2(key, size) {
  if (!PUBLIC_BASE || PUBLIC_BASE.includes("PLACEHOLDER")) return false;
  try {
    const res = await fetch(`${PUBLIC_BASE}/${key}`, {
      method: "HEAD",
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    return Number(res.headers.get("content-length")) === size;
  } catch {
    return false;
  }
}

function upload(key, file, type) {
  try {
    execFileSync(
      "npx",
      ["wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--content-type", type, "--remote"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message).trim().split("\n").slice(-3).join(" ");
    throw new Error(`wrangler r2 object put failed: ${detail}`);
  }
}

async function processOne(id, tmpDir) {
  const downloaded = await download(id);
  const key = `${id}.${downloaded.ext}`;
  if (CHECK_ONLY) return { status: "ok", key, type: downloaded.type, size: downloaded.size };
  if (await existsOnR2(key, downloaded.size)) return { status: "skipped", key, type: downloaded.type, size: downloaded.size };
  const tmpFile = join(tmpDir, key);
  writeFileSync(tmpFile, downloaded.buffer);
  try {
    upload(key, tmpFile, downloaded.type);
  } finally {
    rmSync(tmpFile, { force: true });
  }
  return { status: "uploaded", key, type: downloaded.type, size: downloaded.size };
}

async function main() {
  const tmpDir = CHECK_ONLY ? null : mkdtempSync(join(tmpdir(), "r2-media-"));
  const results = new Map(); // id -> {status, ...} | {status: "failed", error}
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        results.set(id, await processOne(id, tmpDir));
      } catch (error) {
        results.set(id, { status: "failed", error: error.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, () => worker()));
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });

  let uploaded = 0;
  let skipped = 0;
  let failed = [];
  for (const [id, r] of results) {
    if (r.status === "uploaded") { uploaded++; console.log(`uploaded ${id} -> ${r.key} (${r.type}, ${r.size} bytes)`); }
    else if (r.status === "skipped") { skipped++; console.log(`skipped ${id} (already on R2, ${r.size} bytes)`); }
    else if (r.status === "ok") { console.log(`ok ${id} (${r.type}, ${r.size} bytes)`); }
    else { failed.push(id); console.log(`FAILED ${id}: ${r.error}`); }
  }

  if (!CHECK_ONLY) {
    // Merge into the existing map (an id that failed this run but uploaded
    // before stays mapped — the object is still in R2). Old flat maps
    // ({id: key}) are read as keys.
    const outPath = resolve(root, "learn-app", "r2-media.json");
    let prev = {};
    if (existsSync(outPath)) {
      try { prev = JSON.parse(readFileSync(outPath, "utf8")); } catch { prev = {}; }
    }
    const keys = { ...(prev.keys ?? prev) };
    for (const [id, r] of results) {
      if (r.status === "uploaded" || r.status === "skipped") keys[id] = r.key;
    }
    const mapping = { base: PUBLIC_BASE || prev.base || "", keys };
    writeFileSync(outPath, JSON.stringify(mapping, null, 2) + "\n", "utf8");
    console.log(`r2-media.json: ${Object.keys(keys).length} ids mapped`);
  }

  console.log(`done: ${uploaded} uploaded, ${skipped} skipped, ${failed.length} failed (of ${ids.length})`);
  if (failed.length > 0) {
    console.log(`failed ids (stay on the /media fallback): ${failed.join(", ")}`);
    // Strict by default; --allow-partial still exits 0 when at least one
    // id succeeded (the 36 exam images are known-dead on Drive — they
    // 404 publicly and the live /media proxy 502s for them today).
    const succeeded = uploaded + skipped + (CHECK_ONLY ? ids.length - failed.length : 0);
    if (!ALLOW_PARTIAL || succeeded === 0) process.exit(1);
  }
}

main().catch((error) => fail(error.message));
