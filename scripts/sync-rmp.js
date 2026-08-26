// Monthly RateMyProfessors sync: pull every WashU professor's quality and
// difficulty ratings into the rmp_instructors table (migration 005).
//
// Talks to RMP's own GraphQL endpoint (the one their site runs on, with the
// public "test:test" basic-auth constant that all the open-source wrappers
// use). The school id is resolved by name at runtime — nothing hardcoded — and
// the script fails loudly if the response shape changes.
//
// The site only ever *displays* a professor when an instructor's first AND
// last name both match exactly (see app/instructor/[name]/page.tsx); this
// script just keeps the local copy fresh.
//
// SAFETY:
//   * DRY RUN BY DEFAULT. It only previews changes unless you pass --apply.
//   * Writes are upserts keyed on RMP's legacy_id — re-running never
//     duplicates rows. Nothing is deleted.
//
// Usage:
//   node scripts/sync-rmp.js            # preview only (no writes)
//   node scripts/sync-rmp.js --apply    # actually write
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (read from
// .env.local when present, e.g. locally; from the environment in CI).

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// --- Minimal .env.local loader (no dotenv dependency) ---
function loadEnv() {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const val = m[2].trim().replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const APPLY = process.argv.includes("--apply");
let supabase; // created in main()

const RMP_GRAPHQL = "https://www.ratemyprofessors.com/graphql";
const SCHOOL_NAME = "Washington University in St. Louis";
const PAGE_SIZE = 100;
const MAX_TEACHERS = 20000; // hard cap; WashU is a few thousand
const REQUEST_DELAY_MS = 400;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
          Referer: `https://www.ratemyprofessors.com/search/professors`,
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
            edges {
              node {
                legacyId
                firstName
                lastName
                department
                avgRating
                avgDifficulty
                numRatings
                wouldTakeAgainPercent
              }
            }
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
      if (!n || !n.legacyId || !n.lastName) continue;
      teachers.push({
        legacy_id: n.legacyId,
        first_name: (n.firstName || "").trim(),
        last_name: (n.lastName || "").trim(),
        quality: typeof n.avgRating === "number" ? n.avgRating : null,
        difficulty: typeof n.avgDifficulty === "number" ? n.avgDifficulty : null,
        // RMP reports -1 when there is no would-take-again data.
        would_take_again:
          typeof n.wouldTakeAgainPercent === "number" && n.wouldTakeAgainPercent >= 0
            ? n.wouldTakeAgainPercent
            : null,
        num_ratings: n.numRatings || 0,
        department: n.department || "",
        synced_at: new Date().toISOString(),
      });
    }
    process.stdout.write(`\r  Fetched ${teachers.length}/${conn.resultCount ?? "?"} professors...`);
    if (!conn.pageInfo?.hasNextPage || teachers.length >= MAX_TEACHERS) break;
    cursor = conn.pageInfo.endCursor;
    await sleep(REQUEST_DELAY_MS);
  }
  console.log("");
  return teachers;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  console.log(`Project: ${SUPABASE_URL}`);
  console.log(APPLY ? "MODE: APPLY (will write changes)\n" : "MODE: DRY RUN (no writes)\n");

  console.log(`Looking up "${SCHOOL_NAME}" on RateMyProfessors...`);
  const school = await findSchool();
  console.log(`Found: ${school.name} (${school.city}, ${school.state}) — id ${school.id}, legacy ${school.legacyId}\n`);

  console.log("Fetching professors...");
  const teachers = await fetchAllTeachers(school.id);

  // Dedupe by legacy_id defensively (pagination can overlap).
  const byLegacyId = new Map();
  for (const t of teachers) byLegacyId.set(t.legacy_id, t);
  const rows = [...byLegacyId.values()];
  const rated = rows.filter((t) => t.num_ratings > 0);

  console.log(`\n===== Summary =====`);
  console.log(`Professors fetched: ${rows.length}`);
  console.log(`With at least one rating: ${rated.length} (the UI only shows these)`);
  console.log(`Sample:`);
  for (const t of rated.slice(0, 5)) {
    console.log(
      `  ${t.first_name} ${t.last_name} (${t.department}) — quality ${t.quality}, difficulty ${t.difficulty}, ${t.num_ratings} ratings`
    );
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## RMP sync ${APPLY ? "(applied)" : "(dry run)"}\n\n- Professors fetched: ${rows.length}\n- With ratings: ${rated.length}\n`
    );
  }

  if (rows.length === 0) {
    console.error("No professors fetched — RMP response shape may have changed. Aborting.");
    process.exit(1);
  }

  if (!APPLY) {
    console.log("\nDRY RUN complete. Re-run with --apply to write these rows.");
    return;
  }

  console.log("\nUpserting into rmp_instructors...");
  let ok = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("rmp_instructors")
      .upsert(batch, { onConflict: "legacy_id" });
    if (error) {
      console.error(`  FAILED batch at ${i}: ${error.message}`);
    } else {
      ok += batch.length;
    }
  }
  console.log(`Upserted ${ok}/${rows.length} professors.`);
  if (ok < rows.length) process.exitCode = 1;
  console.log("Done.");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
