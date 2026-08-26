-- 005: make bulletin_code a real course identity, and add RateMyProfessors data.
--
-- Part 1 — bulletin_code cleanup + uniqueness.
--
-- scripts/update-descriptions.js matched bulletin courses to DB rows by
-- normalized *name* and stamped the same bulletin_code onto every row sharing
-- that name. Generic titles ("Independent Study", "Senior Thesis") therefore
-- ended up with one bulletin_code spread across many distinct courses. Those
-- codes cannot be trusted as identity, so:
--   * every bulletin_code held by more than one row is cleared (all copies are
--     suspect — there is no way to tell which row it really belongs to), and
--   * a partial unique index then guarantees one row per bulletin code going
--     forward. scripts/sync-courses.js re-assigns codes with stricter matching.
--
-- SAFETY:
--   * No rows are deleted. Only the bulletin_code column is updated, and only
--     on rows whose code is duplicated.
--   * Reviews are untouched.

update courses
set bulletin_code = ''
where bulletin_code <> ''
  and bulletin_code in (
    select bulletin_code
    from courses
    where bulletin_code <> ''
    group by bulletin_code
    having count(*) > 1
  );

create unique index courses_bulletin_code_key
  on courses (bulletin_code)
  where bulletin_code <> '';

-- Part 2 — RateMyProfessors instructor ratings.
--
-- Populated monthly by scripts/sync-rmp.js (service role). legacy_id is RMP's
-- numeric professor id; the public profile URL is derived from it as
-- https://www.ratemyprofessors.com/professor/<legacy_id>, so it is not stored.
-- The UI only surfaces a row when an instructor's first AND last name both
-- match — no fuzzy matching.

create table rmp_instructors (
  id bigint generated always as identity primary key,
  legacy_id bigint not null unique,
  first_name text not null,
  last_name text not null,
  quality numeric,
  difficulty numeric,
  would_take_again numeric,
  num_ratings int not null default 0,
  department text default '',
  synced_at timestamptz default now()
);

-- The instructor page looks professors up by exact (case-insensitive) name.
create index rmp_instructors_name_idx
  on rmp_instructors (lower(last_name), lower(first_name));

alter table rmp_instructors enable row level security;

-- Readable by everyone, like courses and reviews. No insert/update/delete
-- policies: writes only happen through the service role, which bypasses RLS.
create policy "RMP instructors are viewable by everyone"
  on rmp_instructors for select
  using (true);
