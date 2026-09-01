// Instructor names arrive in two shapes and have to be reconciled.
//
//   courses.instructors   full names   "Abigail Jager", "Judi McLean Parks"
//   reviews.instructor    surnames     "Jager", "McLean Parks", "Petersen, D."
//
// Left alone that produces two pages for the same professor — the surname one
// (which is what a course page links to) and the full-name one — and only the
// full-name page can match RateMyProfessors, which needs a first name.
//
// These helpers pick the canonical full name for a surname, but ONLY when the
// surname identifies exactly one person. "Johnson" stays "Johnson", because
// folding it into some particular Johnson would attach one professor's reviews
// and ratings to another's page.

/** Collapse whitespace; leaves case and punctuation alone. */
export function tidy(name: string): string {
  return (name || "").trim().replace(/\s+/g, " ");
}

/**
 * The surname portion of a review-style name.
 * "Petersen, D." -> "Petersen" (registrar "Last, F." form)
 * "Jager"        -> "Jager"
 * "McLean Parks" -> "McLean Parks" (a two-word surname, not first + last)
 */
export function surnamePart(name: string): string {
  const n = tidy(name);
  const comma = n.indexOf(",");
  return comma === -1 ? n : tidy(n.slice(0, comma));
}

/**
 * The surname to look a person up by, for a name in EITHER shape.
 *
 *   "Abigail Jager"     -> "Jager"        (full name: the last word)
 *   "Judi McLean Parks" -> "Parks"
 *   "Jager"             -> "Jager"        (review name: itself)
 *   "Petersen, D."      -> "Petersen"     ("Last, F." form)
 *
 * Distinct from `surnamePart`, which treats an un-punctuated string as being
 * entirely a surname — right for a review name, wrong for a full name, where
 * it would ask how many instructors are surnamed "Abigail Jager" and find none.
 */
export function lookupSurname(name: string): string {
  const n = tidy(name);
  if (!n) return n;
  const comma = n.indexOf(",");
  if (comma !== -1) return tidy(n.slice(0, comma));
  const parts = n.split(" ");
  return parts[parts.length - 1];
}

/**
 * The first initial in a "Last, F." name, lowercased; null when there isn't one.
 * This is extra evidence: "Petersen, D." should only fold into a Petersen whose
 * first name actually starts with D.
 */
export function firstInitial(name: string): string | null {
  const m = tidy(name).match(/,\s*([A-Za-z])/);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Resolve `name` to a full name drawn from `knownFullNames`, or return it
 * unchanged when that cannot be done unambiguously.
 *
 * A candidate matches when the known full name ends with the surname on a word
 * boundary ("Abigail Jager" ends with "Jager"; "Bajager" does not). Exactly one
 * candidate must survive — zero or several means we do not know who this is,
 * and the name is returned untouched.
 */
export function canonicalInstructorName(
  name: string,
  knownFullNames: Iterable<string>
): string {
  const original = tidy(name);
  if (!original) return original;

  const known = [...knownFullNames].map(tidy).filter(Boolean);

  // Already a name we know verbatim — nothing to resolve.
  if (known.some((k) => k.toLowerCase() === original.toLowerCase())) return original;

  const candidates = fullNamesWithSurname(
    surnamePart(original),
    known,
    firstInitial(original)
  );
  return candidates.length === 1 ? candidates[0] : original;
}

/**
 * The distinct full names carrying this surname, matched on a word boundary so
 * the surname "Jager" never picks up "Bajager". `initial`, when given, further
 * requires the first name to start with it ("Petersen, D." -> Dana Petersen).
 *
 * A result of exactly one means the surname identifies a single person — which
 * is what both the canonical redirect and the RateMyProfessors row require.
 */
export function fullNamesWithSurname(
  surname: string,
  knownFullNames: Iterable<string>,
  initial?: string | null
): string[] {
  const target = tidy(surname).toLowerCase();
  if (!target) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of knownFullNames) {
    const k = tidy(raw);
    const lower = k.toLowerCase();
    if (lower === target) continue; // the bare surname itself is not a full name
    if (!lower.endsWith(target)) continue;
    if (lower[lower.length - target.length - 1] !== " ") continue;
    if (initial && !lower.startsWith(initial)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(k);
  }
  return out;
}

/**
 * Collapse a mixed list of full names and surnames down to one entry per
 * person, preferring the full name. Order of first appearance is preserved.
 */
export function dedupeInstructorNames(
  names: Iterable<string>,
  knownFullNames: Iterable<string>
): string[] {
  const known = [...knownFullNames];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const canonical = canonicalInstructorName(raw, known);
    const key = canonical.toLowerCase();
    if (!canonical || seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }
  return out;
}
