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
either order works, but everything numbered `004_` and later assumes both have run.

## Scripts — one-time imports, not part of the app

Nothing under `scripts/` runs in production. They were used to populate the database once and are kept
so the import is repeatable.

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
| `update-descriptions.js` | no | Refreshes course descriptions |

`scripts/seed-reviews.sql` is generated output (~2 MB) and is gitignored.

`xlsx` and `cheerio` sit in `dependencies` but are used only by these scripts, so Vercel installs them
into every production build. `xlsx@0.18.5` carries two high-severity advisories with no fixed version on
npm — SheetJS stopped publishing there. Moving both to `devDependencies` would take them out of the
production build.

## Gotcha

`.remember` is a symlink to the shared Claude Code history pool above this directory. It **must** stay
gitignored: Tailwind v4 source-detection follows it out of the project root and Turbopack then 500s every
`next dev` request, while `next build` keeps passing.
