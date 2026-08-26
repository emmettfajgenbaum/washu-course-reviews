// Monthly WashU undergrad catalog sync from bulletin.wustl.edu.
//
// Discovers every program page under https://bulletin.wustl.edu/undergrad/ (no
// hardcoded page list), parses each page's course blocks, and reconciles them
// against the `courses` table. Supersedes scripts/update-descriptions.js, whose
// name-only matching stamped one bulletin_code onto every course sharing a
// generic title; migration 005 cleans that up and adds a unique index so this
// script can treat bulletin_code as identity.
//
// Accuracy rules (in order, per scraped course):
//   1. A row with the same bulletin_code       -> update it in place.
//   2. Exactly one row with the same normalized
//      name AND an overlapping department      -> attach the code, update it.
//   3. No matching row                          -> insert a new course.
//   4. Anything ambiguous or conflicting        -> skip it and report it.
// Courses are never deleted (rows keep their reviews even if the bulletin
// drops the course) and reviews/instructors are never touched.
//
// SAFETY:
//   * DRY RUN BY DEFAULT. It only previews changes unless you pass --apply.
//   * Writes are addressed individually by id; inserts go through the unique
//     bulletin_code index, so a matching bug fails loudly instead of creating
//     a duplicate listing.
//
// Usage:
//   node scripts/sync-courses.js            # preview only (no writes)
//   node scripts/sync-courses.js --apply    # actually write
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (read from
// .env.local when present, e.g. locally; from the environment in CI).

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
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
let supabase; // created in main(), so requiring this file for its pure functions needs no env

const BASE_URL = "https://bulletin.wustl.edu";
const SEED_PATH = "/undergrad/";
const CRAWL_DELAY_MS = 500;
const MAX_PAGES = 400;
// The real undergrad catalog is thousands of courses. A crawl that comes back
// with fewer than this has almost certainly hit a redesign or an outage, and
// writing its output would mass-corrupt descriptions — abort instead.
const MIN_EXPECTED_COURSES = 500;
const MAX_DEPTH = 3; // /undergrad/ -> school -> program (bulletin nests at most this deep)
const USER_AGENT =
  "washucoursereviews-sync/1.0 (+https://washucoursereviews.org; monthly catalog refresh)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Normalize a course or department name for matching (same rules as the old
// update-descriptions.js so behavior stays comparable).
function normalize(name) {
  return (name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(pagePath) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${pagePath}`, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt === 3) {
        console.warn(`  Error fetching ${pagePath}: ${e.message}`);
        return null;
      }
      await sleep(1000 * attempt);
    }
  }
  return null;
}

// Collect same-site links that stay under /undergrad/.
function extractUndergradLinks($) {
  const links = new Set();
  $("a[href]").each((_, a) => {
    let href = ($(a).attr("href") || "").trim();
    if (!href) return;
    if (href.startsWith(BASE_URL)) href = href.slice(BASE_URL.length);
    if (!href.startsWith("/undergrad/")) return;
    // Strip query/fragment, require a directory-style path.
    href = href.split("#")[0].split("?")[0];
    if (!href.endsWith("/")) return;
    links.add(href);
  });
  return links;
}

// Parse course blocks from a bulletin page. Same selectors and title regex as
// the old update-descriptions.js.
function parseCourses($) {
  const courses = [];
  $(".courseblock").each((_, block) => {
    const titleText = $(block)
      .find(".courseblocktitle")
      .text()
      .replace(/ /g, " ")
      .trim();
    const desc = $(block).find(".courseblockdesc").text().trim();
    const match = titleText.match(/^([A-Z]+)\s+(\d+[A-Z]*)\s+(.+)$/);
    if (match && desc.length > 10) {
      courses.push({
        code: `${match[1]} ${match[2]}`,
        name: match[3].trim(),
        description: desc,
      });
    }
  });
  return courses;
}

// The page's program title, styled like the existing xlsx-sourced department
// values ("MATHEMATICS AND STATISTICS").
function pageDepartment($) {
  const title = $("h1").first().text().replace(/ /g, " ").trim();
  return title.replace(/&/g, "AND").replace(/\s+/g, " ").trim().toUpperCase();
}

async function crawl() {
  const queue = [{ path: SEED_PATH, depth: 0 }];
  const visited = new Set([SEED_PATH]);
  // bulletin code -> { code, name, description, departments:Set, pages:[], nameConflicts:Set }
  const byCode = new Map();
  let pagesWithCourses = 0;

  while (queue.length > 0) {
    if (visited.size > MAX_PAGES) {
      console.warn(`Page cap of ${MAX_PAGES} reached; stopping crawl. Remaining queue: ${queue.length}`);
      break;
    }
    const { path: pagePath, depth } = queue.shift();
    const html = await fetchPage(pagePath);
    await sleep(CRAWL_DELAY_MS);
    if (!html) continue;

    const $ = cheerio.load(html);

    if (depth < MAX_DEPTH) {
      for (const link of extractUndergradLinks($)) {
        if (!visited.has(link) && visited.size < MAX_PAGES) {
          visited.add(link);
          queue.push({ path: link, depth: depth + 1 });
        }
      }
    }

    const courses = parseCourses($);
    if (courses.length === 0) continue;
    pagesWithCourses++;

    const dept = pageDepartment($);
    console.log(`  ${pagePath} — ${courses.length} courses (${dept || "no title"})`);

    for (const c of courses) {
      let entry = byCode.get(c.code);
      if (!entry) {
        entry = {
          code: c.code,
          name: c.name,
          description: c.description,
          departments: new Set(),
          pages: [],
          nameConflicts: new Set(),
        };
        byCode.set(c.code, entry);
      } else {
        // Cross-listed: same code on several department pages. Merge; keep the
        // longest description and flag genuinely different titles.
        if (normalize(c.name) !== normalize(entry.name)) entry.nameConflicts.add(c.name);
        if (c.description.length > entry.description.length) entry.description = c.description;
      }
      if (dept) entry.departments.add(dept);
      entry.pages.push(pagePath);
    }
  }

  return { byCode, pagesVisited: visited.size, pagesWithCourses };
}

async function fetchDbCourses() {
  const rows = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("courses")
      .select("id, code, name, description, bulletin_code, departments")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("Error fetching courses:", error.message);
      process.exit(1);
    }
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// Order-preserving union.
function mergeDepartments(existing, incoming) {
  const out = [];
  const seen = new Set();
  for (const d of [...existing, ...incoming]) {
    if (d && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

// Pure reconciliation of scraped courses against DB rows. Returns the write
// plan without touching the network, so the accuracy rules are testable.
function reconcile(byCode, dbCourses) {
  // Existing department vocabulary, so scraped names reuse the exact strings
  // already driving the homepage department filter instead of adding variants.
  const deptVocab = new Map(); // normalized -> canonical existing string
  for (const row of dbCourses) {
    for (const d of row.departments || []) {
      const key = normalize(d);
      if (key && !deptVocab.has(key)) deptVocab.set(key, d);
    }
  }
  const newDeptStrings = new Set();
  const canonicalDept = (dept) => {
    const existing = deptVocab.get(normalize(dept));
    if (existing) return existing;
    newDeptStrings.add(dept);
    return dept;
  };

  const byBulletinCode = new Map();
  const byName = new Map(); // normalized name -> rows
  for (const row of dbCourses) {
    if (row.bulletin_code) {
      if (byBulletinCode.has(row.bulletin_code)) {
        // Migration 005 should have cleared these; refuse to guess.
        throw new Error(`DB has duplicate bulletin_code "${row.bulletin_code}" — run migration 005 first.`);
      }
      byBulletinCode.set(row.bulletin_code, row);
    }
    const key = normalize(row.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  }

  const updates = []; // { id, fields, prev, why }
  const inserts = []; // course rows
  const skipped = []; // { code, name, reason }
  const nameConflicts = [];
  // Codes claimed this run (existing + planned), so two scraped courses can
  // never be pointed at, or inserted as, the same identity.
  const claimedCodes = new Set(byBulletinCode.keys());
  // DB rows claimed this run, so two scraped courses sharing a name (e.g. a
  // cross-listing under two codes) can never both attach to the same row.
  const claimedRowIds = new Set();
  // Prior values of every field an update changes, kept in the plan so a bad
  // run is reversible from the uploaded artifact.
  const prevOf = (row, fields) => {
    const prev = {};
    for (const key of Object.keys(fields)) prev[key] = row[key];
    return prev;
  };

  for (const entry of byCode.values()) {
    const departments = Array.from(entry.departments, canonicalDept);
    if (entry.nameConflicts.size > 0) {
      nameConflicts.push(
        `${entry.code}: "${entry.name}" vs ${[...entry.nameConflicts].map((n) => `"${n}"`).join(", ")}`
      );
    }

    // 1. Identity match on bulletin_code.
    const codeMatch = byBulletinCode.get(entry.code);
    if (codeMatch) {
      const fields = {};
      if (
        entry.description.length > 20 &&
        normalize(entry.description) !== normalize(codeMatch.description || "")
      ) {
        fields.description = entry.description;
      }
      if (normalize(entry.name) !== normalize(codeMatch.name)) fields.name = entry.name;
      const mergedDepts = mergeDepartments(codeMatch.departments || [], departments);
      if (mergedDepts.length !== (codeMatch.departments || []).length) fields.departments = mergedDepts;
      claimedRowIds.add(codeMatch.id);
      if (Object.keys(fields).length > 0) {
        updates.push({
          id: codeMatch.id,
          code: entry.code,
          name: entry.name,
          fields,
          prev: prevOf(codeMatch, fields),
          why: "code match",
        });
      }
      continue;
    }

    // 2. Name match, restricted to rows with a department in common and with
    //    no competing bulletin_code, and only when it is unambiguous.
    const nameKey = normalize(entry.name);
    const deptKeys = new Set(departments.map(normalize));
    const sameName = byName.get(nameKey) || [];
    const candidates = sameName.filter((row) =>
      (row.departments || []).some((d) => deptKeys.has(normalize(d)))
    );

    if (candidates.length === 1) {
      const row = candidates[0];
      if (row.bulletin_code && row.bulletin_code !== entry.code) {
        skipped.push({
          code: entry.code,
          name: entry.name,
          reason: `name-matched course ${row.id} already carries bulletin_code "${row.bulletin_code}"`,
        });
        continue;
      }
      if (claimedRowIds.has(row.id)) {
        // A cross-listing already attached another code to this row this run;
        // attaching a second one would silently collapse two codes onto it.
        skipped.push({
          code: entry.code,
          name: entry.name,
          reason: `existing course ${row.id} was already matched by another bulletin code this run`,
        });
        continue;
      }
      if (claimedCodes.has(entry.code)) {
        skipped.push({ code: entry.code, name: entry.name, reason: "code already claimed this run" });
        continue;
      }
      claimedCodes.add(entry.code);
      claimedRowIds.add(row.id);
      const fields = { bulletin_code: entry.code };
      if (
        entry.description.length > 20 &&
        normalize(entry.description) !== normalize(row.description || "")
      ) {
        fields.description = entry.description;
      }
      const mergedDepts = mergeDepartments(row.departments || [], departments);
      if (mergedDepts.length !== (row.departments || []).length) fields.departments = mergedDepts;
      updates.push({
        id: row.id,
        code: entry.code,
        name: entry.name,
        fields,
        prev: prevOf(row, fields),
        why: "unique name+dept match",
      });
      continue;
    }

    if (candidates.length > 1) {
      skipped.push({
        code: entry.code,
        name: entry.name,
        reason: `ambiguous: ${candidates.length} existing courses share this name and department (ids ${candidates
          .map((c) => c.id)
          .join(", ")})`,
      });
      continue;
    }

    // The name exists in the DB but only under other departments. That is
    // either a genuinely distinct course or a department-vocabulary mismatch
    // (xlsx strings vs bulletin page titles) — inserting on a guess is exactly
    // how a duplicate listing happens, so it goes to the hand-review queue.
    if (sameName.length > 0) {
      skipped.push({
        code: entry.code,
        name: entry.name,
        reason: `name already exists under other department(s) (ids ${sameName
          .map((c) => c.id)
          .join(", ")}) — distinct course or department-vocabulary mismatch; review by hand`,
      });
      continue;
    }

    // 3. Genuinely new course: the name appears nowhere in the DB.
    if (claimedCodes.has(entry.code)) {
      skipped.push({ code: entry.code, name: entry.name, reason: "code already claimed this run" });
      continue;
    }
    claimedCodes.add(entry.code);
    inserts.push({
      code: entry.code,
      bulletin_code: entry.code,
      name: entry.name,
      departments,
      instructors: [],
      description: entry.description,
      last_offered: "",
      source: "bulletin",
    });
  }

  return { updates, inserts, skipped, nameConflicts, newDeptStrings };
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  console.log(`Project: ${SUPABASE_URL}`);
  console.log(APPLY ? "MODE: APPLY (will write changes)\n" : "MODE: DRY RUN (no writes)\n");

  console.log("Crawling bulletin.wustl.edu/undergrad/ ...");
  const { byCode, pagesVisited, pagesWithCourses } = await crawl();
  console.log(`\nCrawled ${pagesVisited} pages (${pagesWithCourses} with courses); found ${byCode.size} unique course codes.`);

  if (byCode.size < MIN_EXPECTED_COURSES) {
    console.error(
      `Only ${byCode.size} courses scraped (expected at least ${MIN_EXPECTED_COURSES}) — the bulletin's markup or availability has likely changed. Aborting before touching the DB.`
    );
    process.exit(1);
  }

  const dbCourses = await fetchDbCourses();
  console.log(`Fetched ${dbCourses.length} courses from the database.\n`);

  const { updates, inserts, skipped, nameConflicts, newDeptStrings } = reconcile(byCode, dbCourses);

  // --- Report ---
  const lines = [];
  lines.push(`Pages crawled: ${pagesVisited} (${pagesWithCourses} with courses)`);
  lines.push(`Unique bulletin courses: ${byCode.size}`);
  lines.push(`Updates: ${updates.length}`);
  lines.push(`Inserts (new courses): ${inserts.length}`);
  lines.push(`Skipped (ambiguous/conflicting): ${skipped.length}`);
  lines.push(`New department strings introduced: ${newDeptStrings.size}`);

  console.log("\n===== Summary =====");
  for (const l of lines) console.log(l);

  if (newDeptStrings.size > 0) {
    console.log("\nNew department strings (check these against the homepage filter):");
    for (const d of newDeptStrings) console.log(`  ${d}`);
  }
  if (nameConflicts.length > 0) {
    console.log("\nCross-listed title mismatches (kept the first title seen):");
    for (const c of nameConflicts.slice(0, 30)) console.log(`  ${c}`);
    if (nameConflicts.length > 30) console.log(`  ... and ${nameConflicts.length - 30} more`);
  }
  if (skipped.length > 0) {
    console.log("\nSkipped — review these by hand, nothing was guessed:");
    for (const s of skipped) console.log(`  ${s.code} "${s.name}" — ${s.reason}`);
  }
  if (inserts.length > 0) {
    console.log("\nSample inserts (first 10):");
    for (const i of inserts.slice(0, 10)) console.log(`  ${i.code} — ${i.name} [${i.departments.join(", ")}]`);
  }
  if (updates.length > 0) {
    console.log("\nSample updates (first 10):");
    for (const u of updates.slice(0, 10)) {
      console.log(`  ${u.code} — ${u.name} (${u.why}): ${Object.keys(u.fields).join(", ")}`);
    }
  }

  // Surface the summary in the Actions run page.
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      `## Course sync ${APPLY ? "(applied)" : "(dry run)"}`,
      "",
      ...lines.map((l) => `- ${l}`),
      "",
      skipped.length > 0
        ? ["### Skipped", "", ...skipped.map((s) => `- \`${s.code}\` ${s.name} — ${s.reason}`)].join("\n")
        : "",
      newDeptStrings.size > 0
        ? ["### New department strings", "", ...[...newDeptStrings].map((d) => `- ${d}`)].join("\n")
        : "",
    ].join("\n");
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  }

  // Full change plan, including the previous value of every field an update
  // touches. In CI this is uploaded as an artifact — it is the record that
  // makes a bad run reversible (the free Supabase tier has no point-in-time
  // restore), so it is written before any write happens.
  const planPath = path.resolve(process.cwd(), "sync-courses-plan.json");
  fs.writeFileSync(
    planPath,
    JSON.stringify(
      { ranAt: new Date().toISOString(), mode: APPLY ? "apply" : "dry-run", updates, inserts, skipped },
      null,
      2
    )
  );
  console.log(`\nFull change plan (with previous values) written to ${planPath}`);

  if (!APPLY) {
    console.log("\nDRY RUN complete. Re-run with --apply to write these changes.");
    return;
  }

  // --- Apply ---
  console.log("\nApplying updates...");
  let updateOk = 0;
  for (const u of updates) {
    const { error } = await supabase.from("courses").update(u.fields).eq("id", u.id);
    if (error) {
      console.error(`  FAILED update ${u.code} (id ${u.id}): ${error.message}`);
    } else {
      updateOk++;
    }
  }
  console.log(`Updated ${updateOk}/${updates.length} courses.`);

  console.log("Applying inserts...");
  let insertOk = 0;
  const BATCH = 100;
  for (let i = 0; i < inserts.length; i += BATCH) {
    const batch = inserts.slice(i, i + BATCH);
    const { error } = await supabase.from("courses").insert(batch);
    if (!error) {
      insertOk += batch.length;
      continue;
    }
    // Isolate the failing row(s) so one bad record doesn't sink the batch.
    console.warn(`  Batch at ${i} failed (${error.message}); retrying rows individually.`);
    for (const row of batch) {
      const { error: rowError } = await supabase.from("courses").insert(row);
      if (rowError) {
        console.error(`  FAILED insert ${row.code} "${row.name}": ${rowError.message}`);
      } else {
        insertOk++;
      }
    }
  }
  console.log(`Inserted ${insertOk}/${inserts.length} courses.`);

  if (updateOk < updates.length || insertOk < inserts.length) process.exitCode = 1;
  console.log("\nDone.");
}

module.exports = { normalize, parseCourses, extractUndergradLinks, pageDepartment, reconcile, mergeDepartments };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
