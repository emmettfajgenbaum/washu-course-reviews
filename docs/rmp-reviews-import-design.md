# Design: import RateMyProfessors ratings as reviews, and remove RMP from the site

**Date:** 2026-09-02 · **Status:** approved by Emmett in chat, implementation in progress.
Move this file to `docs/archive/` once the work ships; the README then describes the live behaviour.

## Why

Every review on the site today came from RateMyProfessors: the May 2026 xlsx import was a scrape of
RMP ratings. The instructor page's separate "RateMyProfessors" ratings box (migration 005,
`scripts/sync-rmp.js`) is therefore redundant. What the site is missing is the ratings the scrape did
not capture. Measured on 2026-09-02:

| | |
|---|---|
| RMP ratings for WashU | 18,462 across 1,681 professors |
| Reviews on the site | 5,828 |
| Missing, in a 697-rating sample | 408 (197 of them older than 2025) |

The scrape was uneven, not a clean cutoff: whole professors are absent, and the newest sampled rating
already on the site is dated 2024-10-28 while the site holds 83 reviews dated 2025. So "the ones we
don't already have" is defined by content, never by date.

## Decisions (Emmett, 2026-09-02)

1. Import every RMP rating whose comment is not already on the site.
2. Imported reviews carry the professor's full name. Legacy last-name-only rows are upgraded to the
   course's own spelling wherever exactly one listed instructor shares that last name.
3. The import runs monthly inside the existing 3rd-of-month workflow, replacing the professor-ratings
   step. The first, large run happens by hand from the Mac before the branch merges.
4. No "via RateMyProfessors" marker anywhere. Nothing on the site mentions RMP afterward.

## What changes

### Removed

- The RateMyProfessors row on `app/instructor/[name]/page.tsx`, its query, and the
  "WashU Course Reviews" label that existed only to contrast with it.
- `RmpInstructor` in `lib/types.ts`.
- `scripts/sync-rmp.js` (its GraphQL client moves into the new script).
- The `rmp_instructors` table (dropped in migration 006).
- The README's RMP paragraphs.

### Migration `006_rmp_reviews.sql`

```sql
alter table reviews add column source text not null default 'site';
update reviews set source = 'xlsx';              -- every row today is the xlsx import
alter table reviews add column rmp_rating_id bigint;
alter table reviews add constraint reviews_rmp_rating_id_key unique (rmp_rating_id);
create table reviews_instructor_backup_006 as select id, instructor from reviews;
drop table if exists rmp_instructors;
```

`source` mirrors `courses.source` and is the handle for identifying a bad wave of inserts. The unique
constraint (not a partial index) is what lets the import upsert on `rmp_rating_id`; nulls stay
distinct, so site-written reviews are unaffected. The backup table is the recovery record for the
instructor-name upgrade, since the free tier has no point-in-time restore. Nothing is deleted except
the `rmp_instructors` table, which nothing reads once the page changes.

The migration is applied by hand in the Supabase SQL editor (no CLI login or database password is
on this machine). Both scripts below check for the `rmp_rating_id` column first and refuse to run
without it.

### `scripts/lib/rmp-match.js` — pure functions, unit-tested with `node --test`

- `parseClassString(s)` → `{ subject, number, suffix }` or `null`. Uppercases, strips everything but
  letters and digits, drops a leading school prefix (`L59CWP201` → `CWP 201`, `L974413` → `4413`),
  then requires `letters? + 3–4 digits + optional letter`. Subject aliases: `BIO→BIOL`, `CS→CSE`,
  `MGMT→MGT`, `PSY→PSYCH`, `SPANISH→SPAN`, `ORGO/OCHEM→CHEM`. Anything else (`CHEM261CHEM262`,
  `Phonetics`, `L13`) returns `null`.
- `buildCourseIndex(courses)` indexes every comma-separated part of `courses.code` (minus the
  `L24`-style prefix) and `bulletin_code`, under an exact key where the suffix or its absence is
  part of the identity (`CSE 247|` vs `CSE 247|R`), a loose `SUBJECT+NUMBER` key, and `NUMBER`
  alone. Old and new numbering are both covered because both live in those columns. (Added after
  the first dry run: "CSE247" was tying between CSE 247 and its recitation CSE 247R.)
- `matchCourse(index, courses, parsed, professor, existingReviews)`:
  1. Exactly one course under the exact key, else under `SUBJECT+NUMBER` → match.
  2. Several → keep those where the professor's last name is on `course.instructors` or already on a
     review of that course; exactly one survivor → match.
  3. No subject match → `NUMBER` alone, accepted only via step 2's professor test.
  4. Otherwise → skipped, with the class string recorded for the run summary.
  Measured on the sample: 579 of 697 matched, 31 unparseable, 87 skipped; the professor test
  rejected every wrong candidate.
- `normalizeComment(s)` lowercases and strips non-alphanumerics. `dedupeKeys(comment, lastName, day)`
  returns the comment key when the normalized comment is ≥ 20 characters, otherwise
  `comment|lastname|YYYY-MM-DD`. Keys are computed on the raw RMP text and on its entity-decoded
  form, because the legacy import kept `&quot;` verbatim while new rows are decoded. Legacy dates
  match RMP's day in 288 of 289 sampled rows.
- `resolveInstructorName(course, lastName, fallback, { directory, firstName })` → the one
  `course.instructors` entry sharing the last name; else the one name in the whole catalog sharing
  it (`buildInstructorDirectory`), provided the first initial agrees when RMP's first name is known
  ("Steve Cole" for RMP's "Stephen Cole"; a second Chen anywhere means no match); else `fallback`.
  (The catalog tier was added after the first dry run so one professor stays one string; it also
  resolves 76 of the 181 legacy rows the course-only rule left alone, and RMP independently lists
  exactly one professor with each of those surnames.)
- `parseRmpDate("2026-09-01 17:51:56 +0000 UTC")` → ISO string.
- `decodeEntities(s)` handles the numeric and the five named entities.

### `scripts/sync-rmp-reviews.js` — dry-run by default, `--apply` to write

1. Resolve the school id by name, page through every professor (existing code from `sync-rmp.js`),
   keep those with at least one rating. Abort if fewer than 1,000 professors come back.
2. Load all courses and all reviews (paginated, 1,000 per page), build the index, the dedupe-key set,
   and the set of known `rmp_rating_id` values.
3. For each rated professor, fetch ratings 200 at a time (RMP returns everything in one page for
   professors with up to ~120 ratings; paginate on `hasNextPage`), 400 ms apart, with the existing
   retry/backoff. Abort the run if more than 5% of professor fetches fail after retries.
4. Per rating, in order: known `rmp_rating_id` → skip; normalized comment under 10 characters, or a
   placeholder such as "No Comments" → skip; dedupe key present → skip as legacy; no course match →
   skip and tally the class string; else build the row.
5. Row: `course_id`, `user_id` = random UUID (the legacy convention), `quality` = `qualityRating`,
   `difficulty` = `difficultyRating` (both clamped to 1–5 integers), `instructor` via
   `resolveInstructorName` with RMP's `First Last` as fallback, `hours_per_week` = `""`,
   `comment` decoded and trimmed, `created_at` = the RMP date, `source` = `'rmp'`,
   `rmp_rating_id` = RMP's `legacyId`.
6. Write `sync-rmp-reviews-plan.json` (gitignored, uploaded as a workflow artifact): every row to
   insert, every skip with its reason, and the counts. Print the summary and the top unmatched class
   strings with counts, also to `GITHUB_STEP_SUMMARY`.
7. Refuse to insert more than `--max-insert` rows (default 2,000; the first run passes 20,000). New
   ratings arrive at roughly 300 a month, so the default has ample headroom and a matching bug cannot
   mass-insert. With `--apply`, upsert in batches of 200 on `rmp_rating_id` with
   `ignoreDuplicates`, so a re-run or an overlapping run never duplicates.

### `scripts/fix-review-instructor-names.js` — one-time, dry-run by default

For every review whose `instructor` is a single token, find `course.instructors` entries sharing
that last name. Exactly one → set `instructor` to that entry. None → the catalog-wide unique name,
if there is one. Several anywhere → leave it. Measured: 4,906 rows upgrade (4,830 from the course,
76 from the catalog), 105 have no candidate, 121 are ambiguous. Writes
`fix-review-instructor-names-plan.json` with the previous value of every row it touches. Updates are
addressed by `id`.

### Workflow `.github/workflows/sync-data.yml`

The RMP step becomes `node scripts/sync-rmp-reviews.js $APPLY_FLAG`, still running even if the
bulletin step failed, and `sync-rmp-reviews-plan.json` joins the uploaded artifacts. The title becomes
"Sync courses and reviews". Timeout stays 30 minutes; a full pass is about 1,700 requests, roughly 12
minutes at the current delay. Falsifier for the full-refetch choice: if RMP starts throttling at that
volume, switch to fetching only professors whose `numRatings` changed, which needs the per-professor
count kept in a table again.

### Rollout order

1. Merge nothing yet. Apply migration 006 in the SQL editor.
2. On the Mac: `node scripts/fix-review-instructor-names.js`, read the plan, then `--apply`.
3. `node scripts/sync-rmp-reviews.js --max-insert 20000`, read the summary, then `--apply`.
4. Verify on the site: no RMP box on an instructor page, new reviews on a course page, counts.
5. Open the PR and merge. Vercel deploys. The scheduled run on the 3rd then only does the increment.

The scheduled run fires 2026-09-03 at 09:20 UTC and applies. Step 3 must finish before the merge so
the schedule never performs the first large import unattended.

## Error handling

- Missing env, missing migration, an RMP response shape change, or a short professor list all exit
  non-zero before any write.
- A partial batch failure is logged, counted, and makes the exit code non-zero; the run summary and the
  plan file say exactly which `rmp_rating_id` values did not land, and a re-run picks them up.
- Recovery: `delete from reviews where source = 'rmp' and rmp_rating_id in (...)` using the plan
  file; `update reviews r set instructor = b.instructor from reviews_instructor_backup_006 b where
  b.id = r.id` for the name upgrade.

## Testing

- `npm test` runs `node --test scripts/lib`. Cases: every class-string shape seen in the sample,
  alias handling, prefix stripping, old versus new numbering, cross-listings, the professor
  tie-break, number-only acceptance and rejection, short-comment keys, entity decoding, date parsing,
  instructor resolution with zero, one, and several candidates.
- Both scripts are exercised in dry-run against production before any apply, and their summaries
  are quoted in the hand-off.
- `npm run build` and `npm run lint` pass with the RMP code removed.

## Out of scope

Removing deleted or flagged RMP ratings from the site; anything about the review form; the
`hours_per_week` field, which RMP does not have.
