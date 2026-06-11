-- Dedupe duplicate values inside courses.departments arrays.
--
-- Some course rows have the same department listed more than once in the
-- departments text[] column (e.g. {MANAGEMENT, MANAGEMENT}). This caused
-- duplicate React keys when rendering department badges. The render layer was
-- also hardened, but this cleans the underlying data.
--
-- SAFETY:
--   * No rows are deleted. This is an in-place UPDATE of a single column.
--   * Only rows whose array actually contains duplicates are touched
--     (the WHERE filter compares total length vs. distinct count).
--   * NULL and empty arrays are excluded by that filter and left untouched.
--   * Dedupe preserves first-occurrence order of departments.

update courses c
set departments = (
  select array_agg(dept order by min_ord)
  from (
    select dept, min(ord) as min_ord
    from unnest(c.departments) with ordinality as t(dept, ord)
    group by dept
  ) deduped
)
where array_length(c.departments, 1)
      <> cardinality(array(select distinct unnest(c.departments)));
