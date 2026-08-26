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
| `app/instructor/[name]` | One instructor across courses — includes RateMyProfessors ratings when confident (see below) |
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
either order works, but everything numbered `004_` and later assumes both have run.

## The monthly data sync

`.github/workflows/sync-data.yml` runs on the 3rd of every month (and on demand via
*Run workflow*, which has a dry-run option). It runs two scripts, both of which are
**dry-run by default** and only write when passed `--apply`:

- **`scripts/sync-courses.js`** crawls every program page under
  `bulletin.wustl.edu/undergrad/` (discovered by following links — no hardcoded page list) and
  reconciles the course blocks against the `courses` table. Accuracy over coverage: a scraped
  course is matched by `bulletin_code` first, then by name **only** when exactly one existing
  course shares the name and a department; anything ambiguous is skipped and listed in the run
  summary instead of guessed at. New courses are inserted; nothing is ever deleted, and a unique
  index on `bulletin_code` (migration 005) means a matching bug fails loudly instead of creating
  a duplicate listing. It supersedes `scripts/update-descriptions.js`, whose name-only matching
  polluted `bulletin_code` — migration 005 also cleans that up.
- **`scripts/sync-rmp.js`** pulls every WashU professor's quality/difficulty ratings from
  RateMyProfessors' GraphQL endpoint into `rmp_instructors`, upserted on RMP's professor id.
  The instructor page shows the RMP row **only when the instructor's first and last name both
  match exactly** (no fuzzy matching), with a link to the RMP profile as the citation. Note:
  RMP's terms of use restrict automated access; this is a deliberate, low-volume monthly batch.

The workflow needs two repository secrets mirroring the Vercel production values
(`docs/washu-prod-env-vars.md`): `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
Without them every run fails at the env check. Both scripts also run locally against
`.env.local`, dry-run unless `--apply`.

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
