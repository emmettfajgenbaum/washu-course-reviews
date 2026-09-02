# washu-course-reviews

Anonymous course and instructor reviews for Washington University students, live at
**[washucoursereviews.org](https://washucoursereviews.org)**. Shipped and quiet — it runs itself.

Only students can get in. Only students can post.

## Stack

- **Next.js 16**, App Router, TypeScript, Tailwind
- **Supabase** (Postgres) for courses, instructors, and reviews
- **Clerk** for auth, email magic-link only
- **Vercel** for hosting and the daily cron

## The @wustl.edu gate

Sign-in is restricted to `wustl.edu` and `washu.edu`. That rule lives in exactly one place —
[`lib/auth-domains.ts`](lib/auth-domains.ts) — and is enforced in three, deliberately:

1. `app/auth/login` refuses to send a magic link to an outside address.
2. `proxy.ts` redirects an already-signed-in wrong-domain user to `/auth/domain-error` before any page renders.
3. `app/actions/reviews.ts` rejects the write server-side.

Add a domain in `auth-domains.ts` and all three follow. Never hardcode a domain at a call site.

## Pages

| Route | What it is |
|---|---|
| `app/page.tsx` | Search and browse |
| `app/course/[id]` | One course, its reviews, its instructors |
| `app/instructor/[name]` | One instructor across courses |
| `app/auth/login` | Magic-link request |
| `app/auth/domain-error` | The "you're not a WashU address" wall |
| `app/api/keep-alive` | Cron target — see below |

## The daily cron, and why it exists

`vercel.json` hits `/api/keep-alive` at 08:00 UTC every day. **The free Supabase tier auto-pauses a
project after a week without activity**, and a paused database takes the site down. This request exists
only to keep it awake.

That route fails closed on `CRON_SECRET`: Vercel Cron sends it as `Authorization: Bearer <value>`, and a
missing or mismatched value returns 401. **If `CRON_SECRET` is not set in the Vercel project env, the
cron 401s silently and the database eventually pauses.** It is listed in `.env.local.example` for that reason.

## Local setup

```bash
npm install
cp .env.local.example .env.local   # then fill in Supabase + Clerk values
npm run dev
```

Apply `supabase/migrations/*.sql` **in filename order** against a fresh database. Note that two files
share the `003_` prefix (`003_add_feedback.sql` and `003_clerk_auth.sql`); they are independent and
either order works, but everything numbered `004_` and later assumes both have run. Migrations are
applied by hand in the Supabase SQL editor; there is no CLI link or database password on any machine.

## The monthly data sync

`.github/workflows/sync-data.yml` runs on the 3rd of every month. Scheduled runs write;
**a manual *Run workflow* is a preview unless the "Write changes" box is checked**, so a stray
click can never touch production. Every run uploads two artifacts (kept 90 days):
`sync-courses-plan.json`, the full change plan including the previous value of every field an
update touches, and `sync-rmp-reviews-plan.json`, every review inserted and every rating skipped
with its reason. They are the recovery record if a run ever writes garbage (the free Supabase
tier has no point-in-time restore). The workflow also re-enables itself on every run so GitHub's
60-day inactivity rule can't silently kill the schedule on a quiet repo.

It runs two scripts, both **dry-run by default** and only writing when passed `--apply`:

- **`scripts/sync-courses.js`** crawls every program page under
  `bulletin.wustl.edu/undergrad/` (discovered by following links — no hardcoded page list) and
  reconciles the course blocks against the `courses` table. Accuracy over coverage: a scraped
  course is matched by `bulletin_code` first, then by name **only** when exactly one existing
  course shares the name and a department; anything ambiguous is skipped and listed in the run
  summary instead of guessed at. Per-student registration shells ("Independent Study" and its
  variants — see `EXCLUDED_GENERIC_TITLES` in the script) are excluded entirely, per Emmett.
  New courses are inserted; nothing is ever deleted, and a unique
  index on `bulletin_code` (migration 005) means a matching bug fails loudly instead of creating
  a duplicate listing. It supersedes `scripts/update-descriptions.js`, whose name-only matching
  polluted `bulletin_code` — migration 005 also cleans that up.
- **`scripts/sync-rmp-reviews.js`** imports every RateMyProfessors rating for WashU that the site
  does not already have as an ordinary review (`reviews.source = 'rmp'`). Every review on the site
  came from RMP in the first place — the May 2026 xlsx import was a scrape of it — so there is no
  separate RMP surface on the site any more; the ratings simply become reviews, undated by nothing
  but RMP's own posting date, with no marker. Per rating: skip it when its `rmp_rating_id` is already
  in `reviews`; skip it when the comment is under 10 characters or a "No Comments" placeholder; skip
  it when the comment text is already on the site (the xlsx import never stored rating ids, so text
  is the bridge to the legacy rows); otherwise map RMP's free-text class field to a course. That
  field is whatever a student typed — `CSE131`, `Bio2970`, `cwp1508`, `L59CWP201`, sometimes just
  `2960` — so `scripts/lib/rmp-match.js` (unit-tested, `npm test`) parses it and matches, in order:
  exactly one course under subject + number across old codes, bulletin codes, and cross-listings;
  several courses but the professor is listed on (or already reviewed on) exactly one; the number
  alone, accepted only through that professor test. Anything else is skipped and tallied in the
  run summary by class string. Imported reviews carry the professor's full name in the course's own
  spelling when it lists them. `--max-insert` (default 2,000; new ratings run about 300 a month)
  stops a matching bug from mass-inserting; writes are upserts on `rmp_rating_id` with duplicates
  ignored, so a re-run never doubles a rating. Requires migration 006; a dry run works without it,
  `--apply` refuses. Note: RMP's terms of use restrict automated access; this is a deliberate,
  low-volume monthly batch, roughly one request per rated professor.

The workflow needs two repository secrets mirroring the Vercel production values
(`docs/washu-prod-env-vars.md`, which documents the rotate-in-both-places rule):
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Without them every run fails at
the env check. Both scripts also run locally against `.env.local`, dry-run unless `--apply`.

**First-run order matters:** add the two secrets, apply migration 005, then immediately
trigger the workflow manually — first as a preview, and once the summary looks right, again
with "Write changes" checked. Migration 005 clears the `bulletin_code` values the old script
had stamped onto multiple rows, and search matches on that column, so the gap between
migrating and the first applied sync should be minutes, not until the 3rd of the month.
Courses whose codes stay ambiguous land in the run summary's "Skipped" list for hand review;
`bulletin_code_backup_005` (created by the migration) holds every cleared value.

**Migration 006 and the first review import, in order:** apply `006_rmp_reviews.sql` in the SQL
editor (it adds `reviews.source` and `reviews.rmp_rating_id`, snapshots every instructor value into
`reviews_instructor_backup_006`, and drops the old `rmp_instructors` table); run
`scripts/fix-review-instructor-names.js`, preview then `--apply`, which rewrites the legacy
instructor spellings ("Hafer", "Petersen, D.", "Daschbach Eckhardt") to the catalog's full names
wherever exactly one person can be meant; then `scripts/sync-rmp-reviews.js --max-insert 20000`,
preview then `--apply`, for the first, large import — by hand, before the branch merges, so the
schedule only ever imports the monthly increment. The design and rollout record is
`docs/archive/rmp-reviews-import-design.md`. Both plan files and the `.applied-<timestamp>` copy the
import writes are the recovery record for that wave (`delete from reviews where source = 'rmp' and
rmp_rating_id in (...)`; `update reviews r set instructor = b.instructor from
reviews_instructor_backup_006 b where b.id = r.id`).

That rollout ran on 2026-09-02. The name fix rewrote 5,402 of 5,828 rows (115 left with a surname
the catalog does not carry, 6 where two people share it). The import fetched 18,637 ratings from
1,681 professors, recognised 4,728 as already on the site by text, and inserted 7,268; it skipped
499 short or placeholder comments, 2,405 class strings it could not parse, 3,141 naming a course
the catalog does not have (mostly pre-renumbering codes such as `CHEM105`, `PHYS197`), and 596 it
could not disambiguate. Reviews went from 5,828 to 13,096. The applied plan for that wave is
`sync-rmp-reviews-plan.applied-20260902T190613.json` on Emmett's Mac.

## Scripts — one-time imports, not part of the app

Everything below was used to populate the database once and is kept so the import is repeatable;
only the two `sync-*.js` scripts above run on a schedule.

**Four of them read `Course_Reviews.xlsx` from the repo root, and that file is not in the repo.**
Emmett supplies it; it is gitignored on purpose so course data never lands in a public repo. Drop it at
the repo root before running any of these or they throw on `XLSX.readFile`:

| Script | Needs the workbook | What it does |
|---|:--:|---|
| `seed-courses.js` | yes | First load of the course catalog |
| `gen-reviews.js` | yes | Builds the review rows |
| `fix-reviews.js` | yes | Repairs rows from an earlier import |
| `seed-reviews-api.js` | yes | Writes reviews through the API rather than direct SQL |
| `dedupe-departments.js` | no | Removes duplicate values inside `courses.departments` |
| `fix-review-instructor-names.js` | no | Rewrites the legacy instructor spellings to the catalog's full names; one-time, dry-run by default |
| `update-descriptions.js` | no | Refreshed course descriptions — **superseded by `sync-courses.js`**, do not run |

`scripts/seed-reviews.sql` is generated output (~2 MB) and is gitignored.

`xlsx` and `cheerio` sit in `dependencies` but are used only by these scripts, so Vercel installs them
into every production build. `xlsx@0.18.5` carries two high-severity advisories with no fixed version on
npm — SheetJS stopped publishing there. Moving both to `devDependencies` would take them out of the
production build.

## Gotcha

`.remember` is a symlink to the shared Claude Code history pool above this directory. It **must** stay
gitignored: Tailwind v4 source-detection follows it out of the project root and Turbopack then 500s every
`next dev` request, while `next build` keeps passing.
