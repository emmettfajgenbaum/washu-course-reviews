-- Move from Supabase Auth to Clerk.
-- user_id becomes a text column holding Clerk user IDs (e.g. "user_2abc...").
-- Writes are gated server-side via Clerk + service-role; RLS allows public read only.

-- Drop policies that depend on auth.uid()
drop policy if exists "Users can insert their own reviews" on reviews;
drop policy if exists "Users can update their own reviews" on reviews;
drop policy if exists "Users can delete their own reviews" on reviews;
drop policy if exists "Authenticated users can insert flags" on review_flags;
drop policy if exists "Users can view their own flags" on review_flags;

-- Drop FKs to auth.users so we can retype the column
alter table reviews drop constraint if exists reviews_user_id_fkey;
alter table review_flags drop constraint if exists review_flags_user_id_fkey;

-- Retype user_id columns to text (Clerk user ID format)
alter table reviews alter column user_id type text using user_id::text;
alter table review_flags alter column user_id type text using user_id::text;

-- review_flags: keep flags readable to nobody publicly (writes via service role only).
-- No new policies = with RLS enabled, anon/authenticated cannot select/insert,
-- but service role bypasses RLS.
