// The code question's regex validation, extracted live from a Google Form's
// public viewform page — the same FB_PUBLIC_LOAD_DATA_ blob the build-time
// exam generator parses (scripts/generate-exam-data.mjs).
//
// Why live: the teacher's sequencing lives in the Forms themselves — each
// form's code question only allows the codes of students eligible for THAT
// exam (a student cannot enter exam 2 before exam 1), and the teacher
// updates those lists. The app's baked exams.json goes stale between
// deploys, so the gate asks the Worker for the form's CURRENT pattern
// when the baked check fails. The registration sheet must NOT decide
// eligibility — it holds every registered student, so it would let a
// student skip ahead to an exam they have not earned yet.
export function extractCodePattern(html) {
  const m = String(html ?? "").match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);\s*<\/script>/su);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch { return null; }
  const f = data?.[1];
  if (!Array.isArray(f) || !Array.isArray(f[1])) return null;
  for (const q of f[1]) {
    const g = Array.isArray(q?.[4]) ? q[4][0] : null;
    const v = Array.isArray(g?.[4]) ? g[4][0] : null;
    const pattern = Array.isArray(v?.[2]) ? v[2][0] : null;
    if (typeof pattern === "string") {
      return { pattern, errorText: typeof v[3] === "string" ? v[3] : "" };
    }
  }
  return null;
}
