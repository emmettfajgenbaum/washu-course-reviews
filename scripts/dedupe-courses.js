// One-off repair for duplicate course rows left by the original xlsx import.
//
// The importer keyed on the course NAME as it appeared in each term's export,
// so a course whose title was cased differently in two terms ("Jazz Band" in
// SP2025, "JAZZ BAND" in FL2024) landed twice. Both rows carry the same
// registrar code and the same catalog description; the site shows them as two
// listings, and sync-courses.js refuses to attach a bulletin_code to either
// because the pair is ambiguous.
//
// WHAT COUNTS AS A DUPLICATE (all three, no exceptions):
//   * same normalized name, and
//   * at least one department in common, and
//   * byte-identical normalized description, at least 40 chars long.
// A shared name alone is NOT enough — "Special Topics" is a real, distinct
// course in a dozen departments. The description is what makes it conclusive.
//
// MERGE: the survivor is the row with the most reviews (ties broken by richer
// departments, then more registrar codes, then the more recent term, then the
// lower id). Everything from the other row is folded in — departments,
// instructors and registrar codes are unioned, the later last_offered wins,
// and the properly-cased name is kept. Reviews are REPARENTED before the
// duplicate is deleted: reviews.course_id is ON DELETE CASCADE, so deleting
// first would destroy them.
//
// REFUSED, never guessed: a pair where the same user reviewed both rows (the
// unique (course_id, user_id) constraint means one review would have to be
// thrown away), or where the two rows carry different non-empty bulletin_codes
// — that second guard is what keeps the nine distinct "Special Topics in
// Florence" offerings, which share a boilerplate description, from collapsing
// into one row.
//
// SAFETY:
//   * DRY RUN BY DEFAULT. Pass --apply to write.
//   * Every row and review it will touch is written to dedupe-courses-plan.json
//     BEFORE any write. The free Supabase tier has no point-in-time restore,
//     so that file is the only way back.
//
// Usage:
//   node scripts/dedupe-courses.js                    # preview the flagged 12
//   node scripts/dedupe-courses.js --all              # preview every duplicate
//   node scripts/dedupe-courses.js --all --apply      # write
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (from .env.local).

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");
const MIN_DESC = 40;

let supabase;

const normalize = (s) =>
  (s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

const isAllCaps = (s) => !!s && s === s.toUpperCase() && /[A-Z]/.test(s);

// "SP2025" sorts after "FL2024"; unparseable terms sort last.
function termKey(t) {
  const m = (t || "").match(/^(SP|SU|FL|WI)(\d{4})$/i);
  if (!m) return -1;
  const season = { SP: 0, SU: 1, FL: 2, WI: 3 }[m[1].toUpperCase()] ?? 0;
  return Number(m[2]) * 10 + season;
}

const splitCodes = (c) => (c || "").split(",").map((x) => x.trim()).filter(Boolean);

function union(a, b) {
  const out = [];
  const seen = new Set();
  for (const x of [...(a || []), ...(b || [])]) {
    const k = normalize(x);
    if (x && !seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}

async function fetchAll(table, select) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + 999);
    if (error) { console.error(`Error reading ${table}: ${error.message}`); process.exit(1); }
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

// Pure: group rows into duplicate pairs under the three-part rule above.
function findDuplicatePairs(rows) {
  const byName = new Map();
  for (const r of rows) {
    const k = normalize(r.name);
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(r);
  }
  const pairs = [];
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const da = normalize(a.description), db = normalize(b.description);
        if (da.length < MIN_DESC || da !== db) continue;
        const bDepts = (b.departments || []).map(normalize);
        if (!(a.departments || []).some((d) => bDepts.includes(normalize(d)))) continue;
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

function pickKeeper(a, b, reviewCount) {
  const score = (r) => [
    reviewCount[r.id] || 0,
    (r.departments || []).length,
    splitCodes(r.code).length,
    termKey(r.last_offered),
    -r.id, // lower id wins the final tie
  ];
  const sa = score(a), sb = score(b);
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return sa[i] > sb[i] ? [a, b] : [b, a];
  }
  return [a, b];
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  console.log(`Project: ${SUPABASE_URL}`);
  console.log(APPLY ? "MODE: APPLY (will write changes)" : "MODE: DRY RUN (no writes)");
  console.log(ALL ? "SCOPE: every duplicate in the table\n" : "SCOPE: only the pairs sync-courses.js flagged as ambiguous\n");

  const courses = await fetchAll("courses", "id,code,name,departments,instructors,description,last_offered,bulletin_code,source");
  const reviews = await fetchAll("reviews", "id,course_id,user_id");
  console.log(`Read ${courses.length} courses and ${reviews.length} reviews.`);

  const reviewCount = {};
  const reviewUsers = {};
  for (const r of reviews) {
    reviewCount[r.course_id] = (reviewCount[r.course_id] || 0) + 1;
    (reviewUsers[r.course_id] ||= new Set()).add(r.user_id);
  }

  let pairs = findDuplicatePairs(courses);

  // Default scope: only the pairs sync-courses.js reported as ambiguous.
  if (!ALL) {
    const planPath = path.resolve(__dirname, "..", "sync-courses-plan.json");
    if (!fs.existsSync(planPath)) {
      console.error("sync-courses-plan.json not found — run sync-courses.js first, or pass --all.");
      process.exit(1);
    }
    const flagged = new Set();
    for (const s of require(planPath).skipped) {
      const m = s.reason.match(/^ambiguous: \d+ existing courses share this name and department \(ids ([0-9, ]+)\)/);
      if (m) for (const id of m[1].split(",")) flagged.add(Number(id.trim()));
    }
    pairs = pairs.filter(([a, b]) => flagged.has(a.id) && flagged.has(b.id));
  }

  const merges = [];
  const refused = [];
  const claimed = new Set(); // a row may only take part in one merge per run

  for (const [a, b] of pairs) {
    if (claimed.has(a.id) || claimed.has(b.id)) {
      refused.push({ ids: [a.id, b.id], name: a.name, reason: "a row in this pair is already merging with another row this run" });
      continue;
    }
    const [keep, drop] = pickKeeper(a, b, reviewCount);

    const ka = reviewUsers[keep.id] || new Set();
    const overlap = [...(reviewUsers[drop.id] || new Set())].filter((u) => ka.has(u));
    if (overlap.length > 0) {
      refused.push({ ids: [keep.id, drop.id], name: keep.name, reason: `${overlap.length} user(s) reviewed both rows — unique (course_id, user_id) would drop a review` });
      continue;
    }
    if (keep.bulletin_code && drop.bulletin_code && keep.bulletin_code !== drop.bulletin_code) {
      refused.push({ ids: [keep.id, drop.id], name: keep.name, reason: `different bulletin_codes ("${keep.bulletin_code}" vs "${drop.bulletin_code}")` });
      continue;
    }

    const name = isAllCaps(keep.name) && !isAllCaps(drop.name) ? drop.name : keep.name;
    const fields = {};
    if (name !== keep.name) fields.name = name;
    const depts = union(keep.departments, drop.departments);
    if (depts.length !== (keep.departments || []).length) fields.departments = depts;
    const instr = union(keep.instructors, drop.instructors);
    if (instr.length !== (keep.instructors || []).length) fields.instructors = instr;
    const codes = union(splitCodes(keep.code), splitCodes(drop.code)).join(", ");
    if (codes !== keep.code) fields.code = codes;
    if (termKey(drop.last_offered) > termKey(keep.last_offered)) fields.last_offered = drop.last_offered;
    if (!keep.bulletin_code && drop.bulletin_code) fields.bulletin_code = drop.bulletin_code;
    if ((drop.description || "").length > (keep.description || "").length) fields.description = drop.description;

    const prev = {};
    for (const k of Object.keys(fields)) prev[k] = keep[k];

    claimed.add(keep.id); claimed.add(drop.id);
    merges.push({
      keepId: keep.id,
      dropId: drop.id,
      name: keep.name,
      fields,
      prev,
      reviewsMoved: reviewCount[drop.id] || 0,
      keepRow: keep,
      dropRow: drop,
      dropReviews: reviews.filter((r) => r.course_id === drop.id).map((r) => r.id),
    });
  }

  console.log(`\n===== Summary =====`);
  console.log(`Duplicate pairs in scope: ${pairs.length}`);
  console.log(`Merges planned:           ${merges.length}`);
  console.log(`Rows to be deleted:       ${merges.length}`);
  console.log(`Reviews to be reparented: ${merges.reduce((n, m) => n + m.reviewsMoved, 0)}`);
  console.log(`Refused (never guessed):  ${refused.length}`);

  if (refused.length > 0) {
    console.log(`\nRefused:`);
    for (const r of refused) console.log(`  ids ${r.ids.join(" + ")} "${r.name}" — ${r.reason}`);
  }
  if (merges.length > 0) {
    console.log(`\nMerges (keep <- drop):`);
    for (const m of merges) {
      const changed = Object.keys(m.fields);
      console.log(`  ${m.keepId} <- ${m.dropId}  "${m.name}"${m.reviewsMoved ? `  [${m.reviewsMoved} review(s) move]` : ""}${changed.length ? `  merges: ${changed.join(", ")}` : "  (no field changes)"}`);
    }
  }

  const planPath = path.resolve(process.cwd(), "dedupe-courses-plan.json");
  fs.writeFileSync(planPath, JSON.stringify({ ranAt: new Date().toISOString(), mode: APPLY ? "apply" : "dry-run", scope: ALL ? "all" : "flagged", merges, refused }, null, 2));
  console.log(`\nFull plan, with every row and review it touches, written to ${planPath}`);

  if (!APPLY) {
    console.log("\nDRY RUN complete. Re-run with --apply to write these changes.");
    return;
  }

  console.log("\nApplying...");
  let merged = 0, movedReviews = 0, deleted = 0;
  // Order matters, and both halves of it are load-bearing:
  //   reviews before the delete, because reviews.course_id is ON DELETE CASCADE;
  //   the delete before the keeper update, because a merge can carry the
  //   duplicate's bulletin_code onto the survivor, and courses_bulletin_code_key
  //   is unique where bulletin_code <> '' — updating first would put the same
  //   code on two live rows and the write would be rejected.
  for (const m of merges) {
    if (m.reviewsMoved > 0) {
      const { error } = await supabase.from("reviews").update({ course_id: m.keepId }).eq("course_id", m.dropId);
      if (error) { console.error(`  FAILED moving reviews ${m.dropId} -> ${m.keepId}: ${error.message}`); continue; }
      movedReviews += m.reviewsMoved;
    }
    const { error: delErr } = await supabase.from("courses").delete().eq("id", m.dropId);
    if (delErr) { console.error(`  FAILED deleting ${m.dropId}: ${delErr.message}`); continue; }
    deleted++;
    if (Object.keys(m.fields).length > 0) {
      const { error } = await supabase.from("courses").update(m.fields).eq("id", m.keepId);
      if (error) {
        console.error(`  FAILED folding ${m.dropId} into ${m.keepId}: ${error.message} — the duplicate is already gone; restore its fields from the plan file.`);
        continue;
      }
    }
    merged++;
  }
  console.log(`Merged ${merged}/${merges.length}; moved ${movedReviews} review(s); deleted ${deleted} duplicate row(s).`);

  // Verify: no review may point at a course that no longer exists.
  const after = await fetchAll("courses", "id");
  const liveIds = new Set(after.map((r) => r.id));
  const afterReviews = await fetchAll("reviews", "id,course_id");
  const orphans = afterReviews.filter((r) => !liveIds.has(r.course_id));
  console.log(`\nVerify: ${after.length} courses, ${afterReviews.length} reviews, ${orphans.length} orphaned review(s).`);
  if (orphans.length > 0 || deleted < merges.length) process.exitCode = 1;
  console.log("Done.");
}

module.exports = { normalize, isAllCaps, termKey, union, findDuplicatePairs, pickKeeper };

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
