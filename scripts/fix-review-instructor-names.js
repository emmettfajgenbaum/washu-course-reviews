// One-time: upgrade legacy last-name-only review instructors ("Hafer") to the
// catalog's full-name spelling ("Kathleen Hafer"): the one instructor listed
// on that course who shares the last name, or, when the course lists nobody
// by that name, the one name in the whole catalog that does. Several
// candidates, or none anywhere -> the row is left alone.
//
// Why: the xlsx import stored last names only, while reviews imported by
// scripts/sync-rmp-reviews.js carry full names. The course page's instructor
// filter and the instructor page both match the exact string, so "Hafer" and
// "Kathy Hafer" would otherwise be two different people.
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
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Requires migration 006.

const fs = require("fs");
const path = require("path");
const { loadEnv, createSupabase, fetchAll, assertMigration006 } = require("./lib/env.js");
const { lastNameMatches, buildInstructorDirectory, resolveInstructorName } = require("./lib/rmp-match.js");

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
  console.log(`Loaded ${courses.length} courses, ${reviews.length} reviews\n`);

  const counts = { upgraded: 0, via_course: 0, via_catalog: 0, already_full: 0, empty: 0, no_candidate: 0, ambiguous: 0, no_course: 0 };
  const upgrades = [];
  const noCandidate = [];
  const ambiguous = [];

  for (const r of reviews) {
    const current = String(r.instructor || "").trim();
    if (!current) {
      counts.empty++;
      continue;
    }
    if (/\s/.test(current)) {
      counts.already_full++;
      continue;
    }
    const course = coursesById.get(r.course_id);
    if (!course) {
      counts.no_course++;
      continue;
    }
    const hits = (course.instructors || []).filter((name) => lastNameMatches(name, current));
    if (hits.length > 1) {
      counts.ambiguous++;
      ambiguous.push({ id: r.id, course_id: r.course_id, instructor: current, candidates: hits });
      continue;
    }
    const resolved = resolveInstructorName(course, current, null, { directory });
    if (!resolved) {
      counts.no_candidate++;
      noCandidate.push({ id: r.id, course_id: r.course_id, instructor: current });
    } else if (resolved === current) {
      counts.already_full++;
    } else {
      const via = hits.length === 1 ? "course" : "catalog";
      upgrades.push({ id: r.id, course_id: r.course_id, from: r.instructor, to: resolved, via });
      counts.upgraded++;
      counts[`via_${via}`]++;
    }
  }

  fs.writeFileSync(
    PLAN_PATH,
    JSON.stringify({ generated_at: new Date().toISOString(), apply: APPLY, counts, upgrades, no_candidate: noCandidate, ambiguous }, null, 1)
  );

  console.log("===== Summary =====");
  console.log(`To upgrade: ${counts.upgraded} (${counts.via_course} from the course's own instructor list, ${counts.via_catalog} from a catalog-wide unique last name)`);
  console.log(`Left alone: ${counts.already_full} already full names, ${counts.empty} empty, ${counts.no_candidate} with no listed instructor sharing the last name, ${counts.ambiguous} ambiguous (several share it), ${counts.no_course} whose course is missing`);
  console.log("Sample:");
  for (const u of upgrades.slice(0, 8)) console.log(`  review ${u.id}: "${u.from}" -> "${u.to}"`);
  console.log(`\nPlan written to ${PLAN_PATH}`);

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
