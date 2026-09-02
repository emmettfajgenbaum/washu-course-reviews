-- 006: reviews carry their source and their RateMyProfessors rating id;
--      the separate RMP ratings table goes away.
--
-- Every review on the site came from RateMyProfessors: the xlsx import was a
-- scrape of RMP ratings. The instructor page's separate RMP box was therefore
-- redundant, and what the site was missing were the ratings that scrape did not
-- capture. scripts/sync-rmp-reviews.js now imports those as ordinary reviews,
-- monthly, and needs two columns to do it safely:
--
--   * source        — 'xlsx' for the original import (every row existing before
--                     this migration), 'rmp' for rows the sync inserts, 'site'
--                     for reviews written through the site. Mirrors
--                     courses.source; it is the handle for identifying, and if
--                     ever necessary deleting, a bad wave of inserts.
--   * rmp_rating_id — RMP's numeric rating id. A real UNIQUE constraint (not a
--                     partial index) so the sync can upsert on it; NULLs are
--                     distinct, so site-written reviews are unaffected and a
--                     re-run can never duplicate a rating.
--
-- scripts/fix-review-instructor-names.js (one-time) upgrades legacy last-name-
-- only instructor values to the course's own full-name spelling. The free tier
-- has no point-in-time restore, so the previous values are snapshotted first:
--   update reviews r set instructor = b.instructor
--   from reviews_instructor_backup_006 b where b.id = r.id;
--
-- SAFETY:
--   * No review or course rows are deleted or changed here beyond the two new
--     columns (and source = 'xlsx' on every existing row).
--   * The only drop is rmp_instructors, which nothing reads once the instructor
--     page change in the same branch is deployed.
--
-- Applied by hand in the Supabase SQL editor. Both scripts above check for the
-- rmp_rating_id column and refuse to run until this has been applied.

alter table reviews add column source text not null default 'site';
update reviews set source = 'xlsx';

alter table reviews add column rmp_rating_id bigint;
alter table reviews add constraint reviews_rmp_rating_id_key unique (rmp_rating_id);

create table reviews_instructor_backup_006 as
select id, instructor from reviews;

drop table if exists rmp_instructors;
