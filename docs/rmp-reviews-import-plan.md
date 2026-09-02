# RMP Reviews Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import every RateMyProfessors rating the site does not already have as an ordinary review, and remove every RMP surface from the site.

**Architecture:** A pure, unit-tested matching module (`scripts/lib/rmp-match.js`) turns RMP's free-text class field into a `courses` row and resolves instructor names. Two dry-run-by-default scripts use it: a monthly `sync-rmp-reviews.js` that replaces `sync-rmp.js` in the GitHub Actions workflow, and a one-time `fix-review-instructor-names.js`. Migration 006 adds `reviews.source` and `reviews.rmp_rating_id` and drops `rmp_instructors`; the instructor page loses its RMP row.

**Tech Stack:** Node 20 CommonJS scripts, `node --test` (built in, no new dependency), `@supabase/supabase-js`, RMP GraphQL, Next.js 16 App Router.

**Spec:** `docs/rmp-reviews-import-design.md`

## Global Constraints

- Scripts are DRY RUN BY DEFAULT and write only with `--apply` (repo convention, see `scripts/sync-courses.js`).
- Nothing is ever deleted from `reviews` or `courses`. Only `rmp_instructors` is dropped.
- Every write is addressed by `id` or upserted on `rmp_rating_id`; re-running never duplicates.
- Accuracy over coverage: anything ambiguous is skipped and reported, never guessed.
- No new npm dependencies.
- Migration 006 is applied by hand in the Supabase SQL editor; scripts refuse to run without it.
- The scheduled workflow fires 2026-09-03 09:20 UTC and applies. The first large import happens by hand before the branch merges.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/006_rmp_reviews.sql` | Create | `source`, `rmp_rating_id` (+ unique constraint), instructor backup table, drop `rmp_instructors`. |
| `scripts/lib/rmp-match.js` | Create | Pure functions: class parsing, course index, matching, dedupe keys, instructor resolution, date and entity handling. |
| `scripts/lib/rmp-match.test.js` | Create | `node --test` cases for every function. |
| `scripts/lib/env.js` | Create | The `.env.local` loader and Supabase client factory the three sync scripts each copy today; also `fetchAll(table, cols)` pagination and `assertMigration006`. |
| `scripts/sync-rmp-reviews.js` | Create | Monthly import. Owns the RMP GraphQL client (moved from `sync-rmp.js`). |
| `scripts/fix-review-instructor-names.js` | Create | One-time legacy name upgrade. |
| `scripts/sync-rmp.js` | Delete | Superseded. |
| `app/instructor/[name]/page.tsx` | Modify | Remove the RMP query, the RMP row, the "WashU Course Reviews" label, the type import. |
| `lib/types.ts` | Modify | Remove `RmpInstructor`; add `source` and `rmp_rating_id` to `Review`. |
| `.github/workflows/sync-data.yml` | Modify | New step command, new artifact, new title. |
| `.gitignore` | Modify | Two new plan files. |
| `package.json` | Modify | `"test": "node --test scripts/lib"`. |
| `README.md` | Modify | Instructor page row, monthly sync section, scripts table, migration note. |

---

### Task 1: Migration 006 and the shared script helpers

**Files:**
- Create: `supabase/migrations/006_rmp_reviews.sql`
- Create: `scripts/lib/env.js`

**Interfaces:**
- Produces: `loadEnv()`, `createSupabase()` → service-role client (exits 1 when env is missing), `fetchAll(supabase, table, columns, orderBy = "id")` → array of all rows in pages of 1,000, `assertMigration006(supabase)` → resolves or exits 1 with the SQL-editor instruction.

- [ ] **Step 1: Write the migration** exactly as in the spec, with the header comment explaining safety (no deletes except `rmp_instructors`, backup table for instructor names, why a real unique constraint and not a partial index).
- [ ] **Step 2: Write `scripts/lib/env.js`** by lifting `loadEnv` verbatim from `scripts/sync-rmp.js` lines 32-42 and the pagination loop from `scripts/gen-reviews.js` lines 180-190. `assertMigration006` runs `supabase.from("reviews").select("rmp_rating_id").limit(1)` and exits 1 on error with: `Migration 006 has not been applied. Paste supabase/migrations/006_rmp_reviews.sql into the Supabase SQL editor and run it, then re-run this script.`
- [ ] **Step 3: Smoke-test** with `node -e 'const e=require("./scripts/lib/env.js"); e.loadEnv(); const s=e.createSupabase(); e.fetchAll(s,"courses","id").then(r=>console.log(r.length))'` → prints 6831.
- [ ] **Step 4: Commit** `git add supabase/migrations/006_rmp_reviews.sql scripts/lib/env.js`.

---

### Task 2: The matching module, test-first

**Files:**
- Create: `scripts/lib/rmp-match.test.js`
- Create: `scripts/lib/rmp-match.js`
- Modify: `package.json` (add the `test` script)

**Interfaces (Produces):**

```js
parseClassString(s)            // -> { subject, number, suffix } | null   (subject may be "")
buildCourseIndex(courses)      // -> Map<string, Set<number>> keyed "SUBJ NUM SUF", "SUBJ NUM", "#NUM"
professorTeaches(course, lastName, reviewsByCourse) // -> boolean
matchCourse({ index, coursesById, reviewsByCourse }, parsed, lastName)
                               // -> { courseId, rule: "code"|"code+prof"|"number+prof", profOnCourse } | { skipped: reason }
normalizeComment(s)            // -> lowercase alphanumerics
dedupeKeys(comment, lastName, isoDay) // -> string[] (raw and decoded variants, deduped)
resolveInstructorName(course, lastName, fallback) // -> string
parseRmpDate(s)                // -> ISO string | null
decodeEntities(s)              // -> string
```

- [ ] **Step 1: Write the failing tests.** Cases, one `test()` each:

```js
// parseClassString
["CSE131", {subject:"CSE", number:"131", suffix:""}]
["Bio2970", {subject:"BIOL", number:"2970", suffix:""}]        // alias
["cwp1508", {subject:"CWP", number:"1508", suffix:""}]
["L59CWP201", {subject:"CWP", number:"201", suffix:""}]        // school prefix
["L974413", {subject:"", number:"4413", suffix:""}]            // prefix + number only
["2960", {subject:"", number:"2960", suffix:""}]
["MGT200A", {subject:"MGT", number:"200", suffix:"A"}]
["CHEM-2652", {subject:"CHEM", number:"2652", suffix:""}]
["MGMT100", {subject:"MGT", number:"100", suffix:""}]
["ORGO261S", {subject:"CHEM", number:"261", suffix:"S"}]
["CHEM261CHEM262", null] ["Phonetics", null] ["L13", null] ["", null] ["29602970", null]
// buildCourseIndex: course {id:1, code:"L24 Math 233", bulletin_code:"MATH 2130"} yields
//   "MATH 233", "#233", "MATH 2130", "#2130"; cross-listed "L90 AFAS 3255, L98 AMCS 325A" yields
//   "AFAS 3255", "AMCS 325 A", "AMCS 325", "#325", "#3255"
// matchCourse
//   one course under "CSE 131" -> {courseId, rule:"code"}
//   two courses under "MATH 100" (different schools), professor listed on one -> "code+prof"
//   two courses, professor on neither -> skipped "ambiguous: MATH 100 (2 courses, professor on none)"
//   number-only "2960", professor on exactly one of two "#2960" courses -> "number+prof"
//   number-only, professor on none -> skipped
//   professor found through an existing review's instructor (last token match) counts as teaching
//   unknown code -> skipped "no course for CWP 100"
// normalizeComment("I read &quot;The Jungle&quot;") === "ireadquotthejunglequot"
// dedupeKeys: long comment -> [normalized raw, normalized decoded] (deduped when equal);
//   "Great class!" with lastName "Hafer" and "2024-05-01" -> ["greatclass|hafer|2024-05-01"]
// resolveInstructorName: ["Kathy Hafer"], "hafer" -> "Kathy Hafer"; ["A Smith","B Smith"] -> fallback;
//   [] -> fallback; "El Hadji Samba DIALLO" matches "Diallo"
// parseRmpDate("2026-09-01 17:51:56 +0000 UTC") === "2026-09-01T17:51:56.000Z"; garbage -> null
// decodeEntities("hard&#8212;it &quot;is&quot; &amp; &#39;ok&#39;") === "hard—it \"is\" & 'ok'"
```

- [ ] **Step 2: Run** `npm test` → fails with "Cannot find module".
- [ ] **Step 3: Implement `rmp-match.js`.** Key pieces:

```js
const ALIASES = { BIO: "BIOL", CS: "CSE", MGMT: "MGT", PSY: "PSYCH", SPANISH: "SPAN", ORGO: "CHEM", OCHEM: "CHEM" };
function parseClassString(s) {
  let t = String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  t = t.replace(/^[A-Z]\d{2}(?=[A-Z]{2,}\d|\d{3,4}$)/, "");   // L59CWP201, L974413
  const m = t.match(/^([A-Z]*?)(\d{3,4})([A-Z]?)$/);
  if (!m) return null;
  const subject = ALIASES[m[1]] || m[1];
  return { subject, number: m[2], suffix: m[3] };
}
function codeParts(course) {
  const parts = String(course.code || "").split(",").map((p) => p.trim()).filter(Boolean);
  if (course.bulletin_code) parts.push(course.bulletin_code);
  return parts.map((p) => p.replace(/^[A-Z]\d{2}\s+/, ""))
    .map((p) => p.toUpperCase().match(/^([A-Z][A-Z ]*?)\s*(\d{3,4})([A-Z]?)$/))
    .filter(Boolean)
    .map((m) => ({ subject: m[1].replace(/\s+/g, ""), number: m[2], suffix: m[3] }));
}
```

  Index keys: `${subject} ${number} ${suffix}` (when suffix), `${subject} ${number}`, `#${number}`.
  `matchCourse` tries subject+number+suffix, then subject+number, then `#number` (the last only
  accepted through the professor test). `professorTeaches` = last token of any `course.instructors`
  entry equals `lastName` (case-insensitive), or any review on that course whose `instructor`'s last
  token equals it.

- [ ] **Step 4: Run** `npm test` → all pass.
- [ ] **Step 5: Commit** `git add scripts/lib/rmp-match.js scripts/lib/rmp-match.test.js package.json`.

---

### Task 3: `scripts/sync-rmp-reviews.js`

**Files:**
- Create: `scripts/sync-rmp-reviews.js`
- Delete: `scripts/sync-rmp.js`
- Modify: `.gitignore` (add `sync-rmp-reviews-plan.json`, `fix-review-instructor-names-plan.json`)

**Interfaces:**
- Consumes: everything from Task 1 and Task 2.
- CLI: `--apply`, `--max-insert N` (default 2000), `--limit-professors N` (dev aid: only the first N rated professors).

- [ ] **Step 1: Move the GraphQL client** (`rmpQuery`, `findSchool`, `fetchAllTeachers`, constants) from `sync-rmp.js` unchanged, then add:

```js
async function fetchRatings(teacherId) {
  const out = []; let cursor = null;
  for (;;) {
    const data = await rmpQuery(`query($id: ID!, $count: Int!, $cursor: String) {
      node(id: $id) { ... on Teacher { ratings(first: $count, after: $cursor) {
        edges { node { legacyId class comment date qualityRating difficultyRating } }
        pageInfo { hasNextPage endCursor } } } } }`, { id: teacherId, count: 200, cursor });
    const conn = data?.node?.ratings;
    if (!conn) throw new Error("Unexpected ratings response shape");
    for (const e of conn.edges || []) if (e?.node?.legacyId) out.push(e.node);
    if (!conn.pageInfo?.hasNextPage) return out;
    cursor = conn.pageInfo.endCursor;
    await sleep(REQUEST_DELAY_MS);
  }
}
```

  Teachers need their GraphQL `id` too, so add `id` to the teacher query's selection.

- [ ] **Step 2: Write `main()`** following the spec's numbered flow. Outcome tallies: `insert`, `known_id`, `legacy_comment`, `short_or_placeholder`, `no_match`, `ambiguous`. Placeholder test: `/^no comments?\.?$/i` on the trimmed comment. Row assembly per spec §5. Plan file shape: `{ generated_at, apply, counts, unmatched_classes: [[class, n]...], inserts: [...rows], skipped: [{ rmp_rating_id, professor, class, reason }] }`.
- [ ] **Step 3: Guards.** Exit 1 before writing when: teachers < 1000; fetch failures > 5% of rated professors; `inserts.length > maxInsert`. Print the `--max-insert` hint in that last message.
- [ ] **Step 4: Apply path.** `supabase.from("reviews").upsert(batch, { onConflict: "rmp_rating_id", ignoreDuplicates: true })` in batches of 200; count successes; non-zero exit if any batch fails, listing the failed batch's `rmp_rating_id` range.
- [ ] **Step 5: Dry-run against production** with `--limit-professors 30` and read the summary: counts add up to ratings fetched, the unmatched list looks like the sample's, no row has an empty `instructor` or `course_id`.
- [ ] **Step 6: Commit** `git add scripts/sync-rmp-reviews.js .gitignore; git rm scripts/sync-rmp.js`.

---

### Task 4: `scripts/fix-review-instructor-names.js`

**Files:**
- Create: `scripts/fix-review-instructor-names.js`

**Interfaces:**
- Consumes: `resolveInstructorName` from Task 2; `fetchAll`, `assertMigration006` from Task 1.

- [ ] **Step 1: Write it.** Load courses and reviews; for reviews whose trimmed `instructor` has no whitespace, call `resolveInstructorName(course, instructor, null)`; a non-null, different result becomes `{ id, from, to }`. Tally `upgraded`, `no_candidate`, `ambiguous`, `already_full`. Write `fix-review-instructor-names-plan.json` with all three lists. Apply: `update reviews set instructor = to where id = id`, one request per row is fine for 4,830 rows, but batch as 50 concurrent `Promise.all` groups to keep it under a minute.
- [ ] **Step 2: Dry-run against production.** Expected counts (from the 2026-09-02 probe): upgraded ≈ 4,830, no_candidate ≈ 181, ambiguous ≈ 121. Spot-check five rows in the plan file.
- [ ] **Step 3: Commit.**

---

### Task 5: Remove RMP from the site

**Files:**
- Modify: `app/instructor/[name]/page.tsx:7,64-84,136-172`
- Modify: `lib/types.ts:15-25,40-51`

- [ ] **Step 1: `lib/types.ts`.** Delete `RmpInstructor`. Add to `Review`: `source: string; rmp_rating_id: number | null;`.
- [ ] **Step 2: Instructor page.** Delete the `RmpInstructor` import, the `let rmp` block, the RMP `<div>` inside the stats card, and the `w-36` "WashU Course Reviews" label div. Collapse the stats card to a single row (`bg-[#f7f5f0] rounded-lg` with the three stats; drop `divide-y`). Update the comment above it.
- [ ] **Step 3: Grep** `grep -rni "rmp\|ratemyprof" app components lib` → no hits.
- [ ] **Step 4: `npm run build && npm run lint`** → pass.
- [ ] **Step 5: Commit.**

---

### Task 6: Workflow, README, gitignore

**Files:**
- Modify: `.github/workflows/sync-data.yml:1-3,18,60-72`
- Modify: `README.md:32,72-96,98-115`

- [ ] **Step 1: Workflow.** Header comment and `name:` → "Sync courses and reviews". Step name "Import new RateMyProfessors ratings as reviews", `run: node scripts/sync-rmp-reviews.js $APPLY_FLAG`, keep `if: ${{ !cancelled() }}`. Add a second `upload-artifact` for `sync-rmp-reviews-plan.json` (name `sync-rmp-reviews-plan`, 90 days).
- [ ] **Step 2: README.** Instructor page row loses the RMP clause. Replace the `sync-rmp.js` bullet with `sync-rmp-reviews.js`: what it fetches, the matching rules in four lines, the dedupe rule, `--max-insert`, the plan artifact. Scripts table: add `fix-review-instructor-names.js` (no workbook, one-time, done 2026-09-02). Migration note: 006 is hand-applied and both scripts check for it. Keep the RMP terms-of-use sentence.
- [ ] **Step 3: Commit.**

---

### Task 7: Rollout (by hand, in order)

- [ ] **Step 1: Pre-mortem.** Invoke the `pre-mortem` skill once over Tasks 1-4 before any write.
- [ ] **Step 2: Migration.** Emmett pastes `supabase/migrations/006_rmp_reviews.sql` into Supabase → SQL Editor → New query → Run. Verify: `node scripts/fix-review-instructor-names.js` no longer exits with the migration message.
- [ ] **Step 3: Name upgrade.** Dry-run, read plan, `--apply`. Verify: re-run dry-run reports 0 to upgrade.
- [ ] **Step 4: Import.** `node scripts/sync-rmp-reviews.js --max-insert 20000` (about 12 minutes), read the summary and the unmatched list, then `--apply`. Verify: re-run dry-run reports `insert: 0`, `known_id` ≈ the number inserted.
- [ ] **Step 5: Site check.** `/instructor/Kathy%20Hafer` shows no RMP box and more reviews than before; `/course/2338` (BIOL 2960) count rose; `select count(*) from reviews where source='rmp'` matches the run.
- [ ] **Step 6: PR and merge.** Move `docs/rmp-reviews-import-design.md` and this plan to `docs/archive/`.
