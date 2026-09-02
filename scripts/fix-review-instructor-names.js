// One-time: rewrite the legacy review instructor values to the catalog's
// full-name spelling, so one professor is one string across every review.
//
// The xlsx import spelled instructors every which way — "Hafer", "Petersen, D.",
// "Daschbach Eckhardt", "McLean Parks", "M Tabakhi" — while reviews imported by
// scripts/sync-rmp-reviews.js carry the catalog's full name ("Kathleen Hafer").
// The course page's instructor filter and the instructor page both match the
// exact string, so without this the same professor is two people.
//
// Resolution (scripts/lib/rmp-match.js resolveLegacyName): a value that already
// is a catalog string is left alone; otherwise the whole value, the part before
// a comma (with the initial after it), the last token, and the first token are
// each tried as the surname against the course's own instructor list, then the
// full names already on that course's reviews, then the whole catalog when the
// surname is unique there. Two different people sharing the surname on the
// course, or nothing anywhere, leaves the row as it is.
//
// SAFETY:
//   * DRY RUN BY DEFAULT. It only previews changes unless you pass --apply.
//   * Only reviews.instructor is written, addressed row by row by id.
//   * Every previous value is in fix-review-instructor-names-plan.json
//     (gitignored) and in reviews_instructor_backup_006 (migration 006):
//       update reviews r set instructor = b.instructor
//       from reviews_instructor_backup_006 b where b.id = r.id;
//
// Usage:
//   node scripts/fix-review-instructor-names.js            # preview only
//   node scripts/fix-review-instructor-names.js --apply    # write
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Writing requires migration 006.

const fs = require("fs");
const path = require("path");
const { loadEnv, createSupabase, fetchAll, assertMigration006 } = require("./lib/env.js");
const { buildInstructorDirectory, resolveLegacyName } = require("./lib/rmp-match.js");

loadEnv();

const APPLY = process.argv.includes("--apply");
const PLAN_PATH = path.resolve(__dirname, "..", "fix-review-instructor-names-plan.json");
const CONCURRENCY = 50;

async function main() {
  const supabase = createSupabase();
  // The backup table this script relies on is created by migration 006, so
  // writes are refused until it is applied. Previewing is fine without it.
  if (APPLY) await assertMigration006(supabase);

  console.log(`Project: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(APPLY ? "MODE: APPLY (will write changes)\n" : "MODE: DRY RUN (no writes)\n");

  const courses = await fetchAll(supabase, "courses", "id, instructors");
  const reviews = await fetchAll(supabase, "reviews", "id, course_id, instructor");
  const coursesById = new Map(courses.map((c) => [c.id, c]));
  const directory = buildInstructorDirectory(courses);
  // Full names already used by reviews on each course (multi-token values
  // only; bare surnames are what we are trying to replace).
  const namesByCourse = new Map();
  for (const r of reviews) {
    const v = String(r.instructor || "").trim();
    if (!v || !/\s/.test(v)) continue;
    if (!namesByCourse.has(r.course_id)) namesByCourse.set(r.course_id, new Set());
    namesByCourse.get(r.course_id).add(v);
  }
  console.log(`Loaded ${courses.length} courses, ${reviews.length} reviews\n`);

  const counts = { upgraded: 0, via_course: 0, via_reviews: 0, via_catalog: 0, already_catalog: 0, empty: 0, unresolved: 0, ambiguous: 0 };
  const upgrades = [];
  const unresolved = [];
  const ambiguous = [];
  const spellings = new Map(); // "from -> to" tallies, for eyeballing the plan

  for (const r of reviews) {
    const current = String(r.instructor || "").trim();
    if (!current) {
      counts.empty++;
      continue;
    }
    const course = coursesById.get(r.course_id);
    const existingNames = [...(namesByCourse.get(r.course_id) || [])].filter((n) => n !== current);
    const res = resolveLegacyName(current, course, { directory, existingNames });
    if (res.via === "exact") {
      counts.already_catalog++;
    } else if (res.name) {
      upgrades.push({ id: r.id, course_id: r.course_id, from: r.instructor, to: res.name, via: res.via });
      counts.upgraded++;
      counts[`via_${res.via}`]++;
      const key = `${current} -> ${res.name}`;
      spellings.set(key, (spellings.get(key) || 0) + 1);
    } else if (res.ambiguous) {
      counts.ambiguous++;
      ambiguous.push({ id: r.id, course_id: r.course_id, instructor: current, candidates: res.ambiguous });
    } else {
      counts.unresolved++;
      unresolved.push({ id: r.id, course_id: r.course_id, instructor: current });
    }
  }

  const spellingList = [...spellings.entries()].sort((a, b) => b[1] - a[1]);
  fs.writeFileSync(
    PLAN_PATH,
    JSON.stringify(
      { generated_at: new Date().toISOString(), apply: APPLY, counts, spellings: spellingList, upgrades, unresolved, ambiguous },
      null,
      1
    )
  );

  console.log("===== Summary =====");
  console.log(
    `To upgrade: ${counts.upgraded} (${counts.via_course} from the course's own instructor list, ${counts.via_reviews} from full names already on the course's reviews, ${counts.via_catalog} from a catalog-wide unique surname)`
  );
  console.log(
    `Left alone: ${counts.already_catalog} already a catalog spelling, ${counts.empty} empty, ${counts.unresolved} unresolved (no listed instructor shares the surname), ${counts.ambiguous} ambiguous (two different people share it)`
  );
  console.log("Most common rewrites:");
  for (const [k, n] of spellingList.slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log(`\nPlan written to ${PLAN_PATH} (every rewrite, with its previous value)`);

  if (!APPLY) {
    console.log("\nDRY RUN complete. Re-run with --apply to write these rows.");
    return;
  }

  console.log("\nUpdating reviews.instructor...");
  let ok = 0;
  const failed = [];
  for (let i = 0; i < upgrades.length; i += CONCURRENCY) {
    const group = upgrades.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      group.map((u) =>
        supabase.from("reviews").update({ instructor: u.to }).eq("id", u.id).then(({ error }) => ({ u, error }))
      )
    );
    for (const { u, error } of results) {
      if (error) failed.push({ id: u.id, error: error.message });
      else ok++;
    }
    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, upgrades.length)}/${upgrades.length}`);
  }
  console.log(`\nUpdated ${ok}/${upgrades.length} rows.`);
  if (failed.length) {
    console.error(`${failed.length} updates failed:`, failed.slice(0, 10));
    process.exitCode = 1;
  }
  console.log("Done.");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
