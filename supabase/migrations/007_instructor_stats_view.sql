-- Per-instructor review aggregates, so professors can be searched and ranked
-- without the homepage reading every review row.
--
-- Grouped by the instructor string exactly as reviews store it — mostly a
-- surname ("Jager"), sometimes "Petersen, D.". Folding those into full names
-- needs the courses.instructors vocabulary and the "surname must identify one
-- person" rule, which already lives in lib/instructor-names.ts; doing it again
-- in SQL would be a second copy of that rule, free to drift. So this view stays
-- literal and the app canonicalizes the (few thousand) rows it returns.
--
-- SAFETY: read-only view over reviews. No table altered, nothing written.
-- security_invoker keeps the caller's RLS in force; reviews is already
-- "viewable by everyone", so this exposes nothing new.

create view instructor_stats with (security_invoker = on) as
select
  r.instructor                                   as name,
  count(*)::int                                  as review_count,
  count(distinct r.course_id)::int               as course_count,
  round(avg(r.quality)::numeric, 2)::float       as avg_quality,
  round(avg(r.difficulty)::numeric, 2)::float    as avg_difficulty
from reviews r
where r.instructor is not null
  and r.instructor <> ''
group by r.instructor;
