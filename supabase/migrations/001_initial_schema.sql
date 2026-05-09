-- Courses table
create table courses (
  id bigint generated always as identity primary key,
  code text not null,
  name text not null,
  departments text[] default '{}',
  instructors text[] default '{}',
  description text default '',
  last_offered text default '',
  created_at timestamptz default now()
);

-- Reviews table
create table reviews (
  id bigint generated always as identity primary key,
  course_id bigint not null references courses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  quality smallint not null check (quality between 1 and 5),
  difficulty smallint not null check (difficulty between 1 and 5),
  instructor text default '',
  hours_per_week text default '',
  comment text not null check (char_length(comment) >= 10),
  created_at timestamptz default now(),
  unique (course_id, user_id)
);

-- Review flags table
create table review_flags (
  id bigint generated always as identity primary key,
  review_id bigint not null references reviews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  created_at timestamptz default now()
);

-- Course stats view
create or replace view course_stats as
select
  c.*,
  coalesce(r.review_count, 0)::int as review_count,
  round(r.avg_quality::numeric, 2)::float as avg_quality,
  round(r.avg_difficulty::numeric, 2)::float as avg_difficulty
from courses c
left join (
  select
    course_id,
    count(*)::int as review_count,
    avg(quality) as avg_quality,
    avg(difficulty) as avg_difficulty
  from reviews
  group by course_id
) r on r.course_id = c.id;

-- Full-text search index
alter table courses add column fts tsvector
  generated always as (
    to_tsvector('english', coalesce(code, '') || ' ' || coalesce(name, '') || ' ' || coalesce(description, ''))
  ) stored;

create index courses_fts_idx on courses using gin(fts);

-- Row-level security
alter table courses enable row level security;
alter table reviews enable row level security;
alter table review_flags enable row level security;

-- Courses: readable by everyone
create policy "Courses are viewable by everyone"
  on courses for select
  using (true);

-- Reviews: readable by everyone
create policy "Reviews are viewable by everyone"
  on reviews for select
  using (true);

-- Reviews: insertable by the review's own user
create policy "Users can insert their own reviews"
  on reviews for insert
  with check (auth.uid() = user_id);

-- Reviews: updatable by the review's own user
create policy "Users can update their own reviews"
  on reviews for update
  using (auth.uid() = user_id);

-- Reviews: deletable by the review's own user
create policy "Users can delete their own reviews"
  on reviews for delete
  using (auth.uid() = user_id);

-- Flags: insertable by authenticated users
create policy "Authenticated users can insert flags"
  on review_flags for insert
  with check (auth.uid() = user_id);

-- Flags: readable by the flagger
create policy "Users can view their own flags"
  on review_flags for select
  using (auth.uid() = user_id);
