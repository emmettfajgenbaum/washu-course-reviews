# Production env vars live in Vercel — plus two copies in GitHub Actions

> **Update (2026-08):** two of the values below are now ALSO stored as GitHub repository secrets
> (`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`), because the monthly data sync
> (`.github/workflows/sync-data.yml`) runs on GitHub Actions, not Vercel. **When rotating the
> service-role key, update it in BOTH places** — Vercel Production *and* GitHub → Settings →
> Secrets and variables → Actions — or the monthly sync keeps running with the old key (or fails
> silently every month with the revoked one). Everything else below still holds.

> **Moved out of the Claude memory pool on 2026-08-14.** It was a fact about this project living in
> `claude-home/memory/`, where only Claude Code sessions on Emmett's Mac would ever see it. It belongs
> here, next to the code it describes. Emmett approved the move.

washucoursereviews.org (repo: `washu-course-reviews`, local clone `~/my-claude-projects/washu-course-reviews`, Vercel project `prj_ANqAxfjC5vD1VzoYmiapXyMN7ZoX`) is Next.js 16 + Supabase + Clerk, deployed on Vercel Hobby via the git integration. Its production env vars live **only in Vercel**, not in the repo — `.env.local.example` lists the names but the values aren't committed.

Required in Vercel **Production**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (review/feedback submission via `createAdminClient` needs it), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and the four `NEXT_PUBLIC_CLERK_*_URL` vars.

**Why this matters:** the Clerk auth merge (June 2026) shipped without its keys in Vercel, so `clerkMiddleware` threw "Missing publishableKey" on every request and the site returned 500 to all visitors for ~16 days (and the DB auto-paused because no request ever reached a query). Fixed by adding the Clerk + service-role vars and redeploying. `NEXT_PUBLIC_*` vars are build-inlined, so changing them needs a fresh deploy. Keys come from the owner's Clerk dashboard — they aren't on disk, and currently the app uses Clerk **test** keys (`pk_test`/`sk_test`), not a production instance.

**Preview deployments fail by design.** Every Vercel *preview* build (each push to a PR branch) errors with `supabaseUrl is required` while prerendering `/`, because these vars are scoped to Production only and no Preview-scoped copies exist. The PR check therefore always shows a red Vercel deployment; production still builds and deploys on every merge to `main`. Verified 2026-09-02 across PRs #1–#6. To make previews green, add Preview-scoped copies in Vercel → Settings → Environment Variables (they would point at the production database, so this has deliberately not been done).

**How to apply:** when adding an env-dependent integration here, set the vars in Vercel Production and redeploy before assuming it works; check `vercel env ls production`. A daily cron `/api/keep-alive` (CRON_SECRET-gated, anon `select id from courses limit 1`) now keeps the free Supabase project awake, which is why Supabase Pro was judged unnecessary. Collaborator Henry Cordes can't access the Vercel screens (single-member team).
