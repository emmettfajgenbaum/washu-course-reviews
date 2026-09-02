// Monthly RateMyProfessors import: every WashU rating the site does not already
// have becomes an ordinary review (source = 'rmp'). Supersedes sync-rmp.js,
// which only kept professor-level averages for a box the site no longer shows.
//
// Talks to RMP's own GraphQL endpoint (the one their site runs on, with the
// public "test:test" basic-auth constant that all the open-source wrappers
// use). The school id is resolved by name at runtime — nothing hardcoded — and
// the script fails loudly if a response shape changes.
//
// Per rating, in order:
//   1. rmp_rating_id already in `reviews`                  -> skip (known)
//   2. comment under 10 characters or a placeholder        -> skip
//   3. comment text already on the site (the xlsx import
//      never stored rating ids, so text is the bridge)     -> skip (legacy)
//   4. class string -> course via scripts/lib/rmp-match.js -> insert, or skip
//      and report when ambiguous. Accuracy over coverage: nothing is guessed.
//
// SAFETY:
//   * DRY RUN BY DEFAULT. It only previews changes unless you pass --apply.
//   * Writes are upserts on rmp_rating_id with duplicates ignored, so a re-run
//     or an overlapping run can never insert a rating twice. Nothing is deleted.
//   * Refuses to insert more than --max-insert rows (default 2,000). New
//     ratings arrive at roughly 300 a month; the first, large import passes
//     --max-insert 20000 on purpose.
//   * Aborts before writing if the professor list looks truncated or more than
//     5% of per-professor fetches failed.
//   * Every run writes sync-rmp-reviews-plan.json (gitignored; uploaded as a
//     workflow artifact): every row it would insert, every skip with its
//     reason, and the counts. It is the recovery record — a bad wave can be
//     removed with `delete from reviews where source = 'rmp' and rmp_rating_id
//     in (...)`.
//
// Usage:
//   node scripts/sync-rmp-reviews.js                          # preview only
//   node scripts/sync-rmp-reviews.js --apply                  # write
//   node scripts/sync-rmp-reviews.js --max-insert 20000       # first run
//   node scripts/sync-rmp-reviews.js --limit-professors 30    # dev aid
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (read from
// .env.local when present, e.g. locally; from the environment in CI).
// Requires migration 006.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { loadEnv, createSupabase, fetchAll, hasMigration006, MIGRATION_006_MESSAGE } = require("./lib/env.js");
const M = require("./lib/rmp-match.js");

loadEnv();

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const flagValue = (name, fallback) => {
  const i = argv.indexOf(name);
  if (i === -1 || !argv[i + 1]) return fallback;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`${name} needs a non-negative integer`);
    process.exit(1);
  }
  return n;
};
const MAX_INSERT = flagValue("--max-insert", 2000);
const LIMIT_PROFESSORS = flagValue("--limit-professors", 0);

const RMP_GRAPHQL = "https://www.ratemyprofessors.com/graphql";
const SCHOOL_NAME = "Washington University in St. Louis";
const PAGE_SIZE = 100;
const RATINGS_PAGE_SIZE = 200;
const MAX_TEACHERS = 20000; // hard cap; WashU is a few thousand
const MIN_EXPECTED_TEACHERS = 1000; // fewer means a truncated or reshaped response
const MAX_FETCH_FAILURE_RATE = 0.05;
const REQUEST_DELAY_MS = 400;
const PLAN_PATH = path.resolve(__dirname, "..", "sync-rmp-reviews-plan.json");
const PLACEHOLDER_COMMENT = /^no comments?\.?$/i;
const MIN_COMMENT_CHARS = 10; // the reviews.comment check constraint

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- RMP client ----------

async function rmpQuery(query, variables) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(RMP_GRAPHQL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Public constant baked into RMP's own frontend bundle.
          Authorization: "Basic dGVzdDp0ZXN0",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Origin: "https://www.ratemyprofessors.com",
          Referer: "https://www.ratemyprofessors.com/search/professors",
        },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`);
      return json.data;
    } catch (e) {
      if (attempt === 4) throw e;
      console.warn(`  RMP request failed (${e.message}); retrying in ${2 ** attempt}s...`);
      await sleep(2 ** attempt * 1000);
    }
  }
}

async function findSchool() {
  const data = await rmpQuery(
    `query SchoolSearch($query: SchoolSearchQuery!) {
      newSearch {
        schools(query: $query) {
          edges { node { id legacyId name city state } }
        }
      }
    }`,
    { query: { text: SCHOOL_NAME } }
  );
  const edges = data?.newSearch?.schools?.edges || [];
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = edges.find(
    (e) => norm(e.node.name) === norm(SCHOOL_NAME) && (e.node.state || "").toUpperCase() === "MO"
  );
  if (!match) {
    console.error(`Could not find an exact match for "${SCHOOL_NAME}" (MO). Results were:`);
    for (const e of edges) console.error(`  ${e.node.name} — ${e.node.city}, ${e.node.state}`);
    process.exit(1);
  }
  return match.node;
}

async function fetchAllTeachers(schoolId) {
  const teachers = [];
  let cursor = "";
  for (;;) {
    const data = await rmpQuery(
      `query TeacherSearchPaginationQuery($count: Int!, $cursor: String, $query: TeacherSearchQuery!) {
        search: newSearch {
          teachers(query: $query, first: $count, after: $cursor) {
            edges { node { id legacyId firstName lastName department numRatings } }
            pageInfo { hasNextPage endCursor }
            resultCount
          }
        }
      }`,
      { count: PAGE_SIZE, cursor, query: { text: "", schoolID: schoolId, fallback: false } }
    );
    const conn = data?.search?.teachers;
    if (!conn) throw new Error("Unexpected teacher search response shape");
    for (const edge of conn.edges || []) {
      const n = edge.node;
      if (!n || !n.id || !n.legacyId || !n.lastName) continue;
      teachers.push({
        id: n.id,
        legacy_id: n.legacyId,
        first_name: (n.firstName || "").trim(),
        last_name: (n.lastName || "").trim(),
        department: n.department || "",
        num_ratings: n.numRatings || 0,
      });
    }
    process.stdout.write(`\r  Fetched ${teachers.length}/${conn.resultCount ?? "?"} professors...`);
    if (!conn.pageInfo?.hasNextPage || teachers.length >= MAX_TEACHERS) break;
    cursor = conn.pageInfo.endCursor;
    await sleep(REQUEST_DELAY_MS);
  }
  console.log("");
  // Dedupe by legacy_id defensively (pagination can overlap).
  const byLegacyId = new Map();
  for (const t of teachers) byLegacyId.set(t.legacy_id, t);
  return [...byLegacyId.values()];
}

async function fetchRatings(teacherId) {
  const ratings = [];
  let cursor = null;
  for (;;) {
    const data = await rmpQuery(
      `query TeacherRatings($id: ID!, $count: Int!, $cursor: String) {
        node(id: $id) {
          ... on Teacher {
            ratings(first: $count, after: $cursor) {
              edges {
                node {
                  legacyId class comment date
                  qualityRating helpfulRating clarityRating difficultyRating
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }`,
      { id: teacherId, count: RATINGS_PAGE_SIZE, cursor }
    );
    const conn = data?.node?.ratings;
    if (!conn) throw new Error("Unexpected ratings response shape");
    for (const edge of conn.edges || []) if (edge?.node?.legacyId) ratings.push(edge.node);
    if (!conn.pageInfo?.hasNextPage) return ratings;
    cursor = conn.pageInfo.endCursor;
    await sleep(REQUEST_DELAY_MS);
  }
}

// ---------- row building ----------

const lastToken = (name) => String(name || "").trim().split(/\s+/).pop() || "";

function toScore(primary, ...fallbacks) {
  let v = typeof primary === "number" ? primary : null;
  if (v === null) {
    const nums = fallbacks.filter((x) => typeof x === "number");
    if (nums.length) v = nums.reduce((s, x) => s + x, 0) / nums.length;
  }
  if (v === null) return null;
  const n = Math.round(v);
  return n >= 1 && n <= 5 ? n : null;
}

// ---------- main ----------

async function main() {
  const supabase = createSupabase();
  const has006 = await hasMigration006(supabase);
  if (!has006 && APPLY) {
    console.error(MIGRATION_006_MESSAGE);
    process.exit(1);
  }

  console.log(`Project: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(APPLY ? "MODE: APPLY (will write changes)\n" : "MODE: DRY RUN (no writes)\n");
  if (!has006) {
    console.warn("WARNING: migration 006 is not applied. Previewing without stored rating ids; --apply will refuse until it is.\n");
  }

  console.log(`Looking up "${SCHOOL_NAME}" on RateMyProfessors...`);
  const school = await findSchool();
  console.log(`Found: ${school.name} (${school.city}, ${school.state}) — id ${school.id}, legacy ${school.legacyId}\n`);

  console.log("Fetching professors...");
  const teachers = await fetchAllTeachers(school.id);
  if (teachers.length < MIN_EXPECTED_TEACHERS) {
    console.error(
      `Only ${teachers.length} professors came back (expected at least ${MIN_EXPECTED_TEACHERS}) — RMP response may have changed. Aborting.`
    );
    process.exit(1);
  }
  let rated = teachers.filter((t) => t.num_ratings > 0);
  if (LIMIT_PROFESSORS) rated = rated.slice(0, LIMIT_PROFESSORS);
  console.log(`Professors: ${teachers.length}, with ratings: ${rated.length}${LIMIT_PROFESSORS ? ` (limited to ${LIMIT_PROFESSORS})` : ""}\n`);

  console.log("Loading courses and reviews...");
  const courses = await fetchAll(supabase, "courses", "id, code, bulletin_code, name, instructors");
  const reviews = await fetchAll(
    supabase,
    "reviews",
    has006
      ? "id, course_id, instructor, comment, created_at, rmp_rating_id"
      : "id, course_id, instructor, comment, created_at"
  );
  console.log(`  ${courses.length} courses, ${reviews.length} reviews\n`);

  const coursesById = new Map(courses.map((c) => [c.id, c]));
  const reviewsByCourse = new Map();
  for (const r of reviews) {
    if (!reviewsByCourse.has(r.course_id)) reviewsByCourse.set(r.course_id, []);
    reviewsByCourse.get(r.course_id).push({ instructor: r.instructor });
  }
  const ctx = { index: M.buildCourseIndex(courses), coursesById, reviewsByCourse };
  const directory = M.buildInstructorDirectory(courses);

  const knownIds = new Set(reviews.map((r) => r.rmp_rating_id).filter((x) => x != null));
  const seenKeys = new Set();
  for (const r of reviews) {
    for (const k of M.dedupeKeys(r.comment, lastToken(r.instructor), String(r.created_at).slice(0, 10))) {
      seenKeys.add(k);
    }
  }

  const counts = {
    ratings_fetched: 0,
    insert: 0,
    known_id: 0,
    legacy_comment: 0,
    duplicate_in_run: 0,
    short_or_placeholder: 0,
    no_rating: 0,
    date_fallback: 0,
    unparseable: 0,
    no_match: 0,
    ambiguous: 0,
    fetch_failures: 0,
  };
  const inserts = [];
  const skipped = [];
  const unmatchedClasses = new Map();
  const fetchFailures = [];
  const rules = { code: 0, "code+prof": 0, "number+prof": 0 };
  const now = new Date().toISOString();

  console.log("Fetching ratings...");
  for (let i = 0; i < rated.length; i++) {
    const t = rated[i];
    const professor = `${t.first_name} ${t.last_name}`.trim();
    let ratings;
    try {
      ratings = await fetchRatings(t.id);
    } catch (e) {
      counts.fetch_failures++;
      fetchFailures.push({ professor, legacy_id: t.legacy_id, error: e.message });
      continue;
    }
    counts.ratings_fetched += ratings.length;

    for (const rating of ratings) {
      const id = rating.legacyId;
      if (knownIds.has(id)) {
        counts.known_id++;
        continue;
      }
      const rawComment = String(rating.comment || "");
      const comment = M.decodeEntities(rawComment).trim();
      if (comment.length < MIN_COMMENT_CHARS || PLACEHOLDER_COMMENT.test(comment)) {
        counts.short_or_placeholder++;
        continue;
      }
      let createdAt = M.parseRmpDate(rating.date);
      if (!createdAt) {
        counts.date_fallback++;
        createdAt = now;
      }
      const keys = M.dedupeKeys(rawComment, t.last_name, createdAt.slice(0, 10));
      if (keys.some((k) => seenKeys.has(k))) {
        // Already on the site (xlsx import) or already queued this run.
        if (inserts.some((row) => row.rmp_rating_id === id)) counts.duplicate_in_run++;
        else counts.legacy_comment++;
        continue;
      }
      const quality = toScore(rating.qualityRating, rating.helpfulRating, rating.clarityRating);
      const difficulty = toScore(rating.difficultyRating);
      if (quality === null || difficulty === null) {
        counts.no_rating++;
        skipped.push({ rmp_rating_id: id, professor, class: rating.class, reason: "no usable quality/difficulty" });
        continue;
      }

      const parsed = M.parseClassString(rating.class);
      const match = M.matchCourse(ctx, parsed, t.last_name);
      if (match.skipped) {
        if (match.skipped.startsWith("unparseable")) counts.unparseable++;
        else if (match.skipped.startsWith("ambiguous")) counts.ambiguous++;
        else counts.no_match++;
        const cls = String(rating.class || "").trim() || "(empty)";
        unmatchedClasses.set(cls, (unmatchedClasses.get(cls) || 0) + 1);
        skipped.push({ rmp_rating_id: id, professor, class: rating.class, reason: match.skipped });
        continue;
      }

      const course = coursesById.get(match.courseId);
      const row = {
        course_id: match.courseId,
        user_id: crypto.randomUUID(),
        quality,
        difficulty,
        instructor: M.resolveInstructorName(course, t.last_name, professor, { directory, firstName: t.first_name }),
        hours_per_week: "",
        comment,
        created_at: createdAt,
        source: "rmp",
        rmp_rating_id: id,
      };
      inserts.push(row);
      rules[match.rule]++;
      counts.insert++;
      knownIds.add(id);
      for (const k of keys) seenKeys.add(k);
      // A newly queued row also counts as "on the course" for later ratings.
      if (!reviewsByCourse.has(course.id)) reviewsByCourse.set(course.id, []);
      reviewsByCourse.get(course.id).push({ instructor: row.instructor });
    }

    process.stdout.write(`\r  ${i + 1}/${rated.length} professors — ${counts.insert} to insert so far`);
    await sleep(REQUEST_DELAY_MS);
  }
  console.log("\n");

  const topUnmatched = [...unmatchedClasses.entries()].sort((a, b) => b[1] - a[1]);
  const plan = {
    generated_at: now,
    apply: APPLY,
    max_insert: MAX_INSERT,
    limit_professors: LIMIT_PROFESSORS || null,
    counts,
    rules,
    unmatched_classes: topUnmatched,
    fetch_failures: fetchFailures,
    inserts,
    skipped,
  };
  fs.writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 1));

  const summaryLines = [
    `Ratings fetched: ${counts.ratings_fetched} from ${rated.length - counts.fetch_failures} professors (${counts.fetch_failures} fetch failures)`,
    `To insert: ${counts.insert}  (matched by code ${rules.code}, code+professor ${rules["code+prof"]}, number+professor ${rules["number+prof"]})`,
    `Already on the site: ${counts.known_id} by rating id, ${counts.legacy_comment} by comment text, ${counts.duplicate_in_run} duplicates within this run`,
    `Skipped: ${counts.short_or_placeholder} short/placeholder comments, ${counts.no_rating} without usable scores, ${counts.unparseable} unparseable class strings, ${counts.no_match} with no such course, ${counts.ambiguous} ambiguous`,
    `Dates that could not be parsed (stamped with the run time): ${counts.date_fallback}`,
  ];
  console.log("===== Summary =====");
  for (const l of summaryLines) console.log(l);
  console.log(`\nTop unmatched class strings:`);
  for (const [cls, n] of topUnmatched.slice(0, 30)) console.log(`  ${String(n).padStart(4)}  ${cls}`);
  console.log(`\nPlan written to ${PLAN_PATH}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      `## RMP reviews import ${APPLY ? "(applied)" : "(dry run)"}`,
      "",
      ...summaryLines.map((l) => `- ${l}`),
      "",
      "Top unmatched class strings:",
      "",
      "| n | class |",
      "|---:|---|",
      ...topUnmatched.slice(0, 30).map(([cls, n]) => `| ${n} | ${cls.replace(/\|/g, "\\|")} |`),
      "",
    ];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n") + "\n");
  }

  const failureRate = rated.length ? counts.fetch_failures / rated.length : 0;
  if (failureRate > MAX_FETCH_FAILURE_RATE) {
    console.error(
      `\n${counts.fetch_failures} of ${rated.length} professor fetches failed (${(failureRate * 100).toFixed(1)}%, limit ${MAX_FETCH_FAILURE_RATE * 100}%). Nothing written.`
    );
    process.exit(1);
  }
  if (inserts.length > MAX_INSERT) {
    console.error(
      `\n${inserts.length} rows to insert exceeds --max-insert ${MAX_INSERT}. Nothing written. Read the plan file; if the rows look right, re-run with --max-insert ${inserts.length}.`
    );
    process.exit(1);
  }

  if (!APPLY) {
    console.log("\nDRY RUN complete. Re-run with --apply to insert these rows.");
    return;
  }

  console.log("\nInserting into reviews...");
  const BATCH = 200;
  let ok = 0;
  const failedBatches = [];
  for (let i = 0; i < inserts.length; i += BATCH) {
    const batch = inserts.slice(i, i + BATCH);
    const { error } = await supabase
      .from("reviews")
      .upsert(batch, { onConflict: "rmp_rating_id", ignoreDuplicates: true });
    if (error) {
      const ids = batch.map((r) => r.rmp_rating_id);
      failedBatches.push({ from: ids[0], to: ids[ids.length - 1], error: error.message });
      console.error(`  FAILED batch ${i / BATCH + 1} (rmp_rating_id ${ids[0]}..${ids[ids.length - 1]}): ${error.message}`);
    } else {
      ok += batch.length;
    }
    process.stdout.write(`\r  ${Math.min(i + BATCH, inserts.length)}/${inserts.length}`);
  }
  console.log(`\nInserted ${ok}/${inserts.length} reviews.`);
  if (failedBatches.length) {
    plan.failed_batches = failedBatches;
    fs.writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 1));
    console.error(`${failedBatches.length} batch(es) failed; see failed_batches in the plan file. A re-run picks them up.`);
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
