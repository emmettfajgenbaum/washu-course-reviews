-- Distinct instructor full names, for disambiguating an instructor page.
--
-- Why this exists: reviews.instructor holds a SURNAME ONLY ("Jager", and
-- sometimes "Petersen, D."), while courses.instructors holds the full name
-- ("Abigail Jager"). The instructor page is reached by full name but finds its
-- reviews by surname fallback, which pools every professor sharing that
-- surname. Before showing a RateMyProfessors score above those pooled reviews,
-- the page checks here that exactly ONE known instructor carries the surname —
-- otherwise the ratings could belong to a different person than the reviews.
--
-- SAFETY: read-only view over courses. No table is altered, nothing is written.
-- security_invoker keeps the caller's RLS in force; courses is already
-- "viewable by everyone", so this exposes nothing new.

create view instructor_names with (security_invoker = on) as
select distinct unnest(instructors) as name
from courses
where instructors is not null
  and instructors <> '{}';
