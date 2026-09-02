// Pure functions for turning a RateMyProfessors rating into a review row:
// parsing RMP's free-text class field, matching it to a `courses` row,
// deciding whether a rating is already on the site, and resolving the
// instructor's name. No I/O — everything here is unit-tested in
// rmp-match.test.js (`npm test`).
//
// Matching philosophy (same as scripts/sync-courses.js): accuracy over
// coverage. A rating whose class string is ambiguous is skipped and reported,
// never guessed at.

// Subject spellings students type on RMP that differ from the catalog's.
const ALIASES = {
  BIO: "BIOL",
  CS: "CSE",
  MGMT: "MGT",
  PSY: "PSYCH",
  SPANISH: "SPAN",
  ORGO: "CHEM",
  OCHEM: "CHEM",
};

const canonSubject = (s) => ALIASES[s] || s;

// "CSE131", "Bio2970", "L59CWP201", "CHEM-2652", "2960" -> { subject, number, suffix }.
// subject is "" when the student typed only a number. Anything that is not
// `letters? + 3–4 digits + optional letter` after cleanup returns null
// ("CHEM261CHEM262", "Phonetics", "29602970").
function parseClassString(s) {
  let t = String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  // Drop a WashU school prefix a student copied from their schedule
  // ("L59CWP201" -> "CWP201", "L974413" -> "4413").
  t = t.replace(/^[A-Z]\d{2}(?=[A-Z]{2,}\d|\d{3,4}$)/, "");
  const m = t.match(/^([A-Z]*?)(\d{3,4})([A-Z]?)$/);
  if (!m) return null;
  return { subject: canonSubject(m[1]), number: m[2], suffix: m[3] };
}

// Every code a course row carries: each comma-separated cross-listing in
// `code` (minus the "L24 " school prefix) plus `bulletin_code`. Old and new
// numbering both live in those two columns, so both are indexed.
function courseCodes(course) {
  const parts = String(course.code || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (course.bulletin_code) parts.push(course.bulletin_code);
  const out = [];
  for (const raw of parts) {
    const m = raw
      .replace(/^[A-Z]\d{2}\s+/, "")
      .toUpperCase()
      .match(/^([A-Z][A-Z ]*?)\s*(\d{3,4})([A-Z]?)$/);
    if (!m) continue;
    out.push({ subject: canonSubject(m[1].replace(/\s+/g, "")), number: m[2], suffix: m[3] });
  }
  return out;
}

const keySubjectNumberSuffix = (p) => `${p.subject} ${p.number} ${p.suffix}`;
const keySubjectNumber = (p) => `${p.subject} ${p.number}`;
const keyNumber = (p) => `#${p.number}`;

// Map<key, Set<courseId>> under "SUBJ NUM SUF" (when suffixed), "SUBJ NUM", and "#NUM".
function buildCourseIndex(courses) {
  const index = new Map();
  const add = (key, id) => {
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(id);
  };
  for (const course of courses) {
    for (const p of courseCodes(course)) {
      if (p.suffix) add(keySubjectNumberSuffix(p), course.id);
      add(keySubjectNumber(p), course.id);
      add(keyNumber(p), course.id);
    }
  }
  return index;
}

const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Does `lastName` end this full name at a word boundary? Handles multi-word
// surnames ("Kristin Van Engen" / "Van Engen"), hyphens, and all-caps
// ("El Hadji Samba DIALLO" / "Diallo"), without letting "Li" match
// "Bernardelli".
function lastNameMatches(fullName, lastName) {
  const want = squash(lastName);
  if (!want) return false;
  const tokens = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (let k = 1; k <= Math.min(3, tokens.length); k++) {
    if (squash(tokens.slice(-k).join("")) === want) return true;
  }
  return false;
}

// The professor is on the course's instructor list, or already on one of its reviews.
function professorTeaches(course, lastName, reviewsByCourse) {
  if (!course) return false;
  if ((course.instructors || []).some((name) => lastNameMatches(name, lastName))) return true;
  const reviews = (reviewsByCourse && reviewsByCourse.get(course.id)) || [];
  return reviews.some((r) => lastNameMatches(r.instructor, lastName));
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Resolve a parsed class string to one course, or explain why not.
//   1. Exactly one course under subject+number(+suffix)        -> rule "code"
//   2. Several, and the professor is on exactly one of them     -> rule "code+prof"
//   3. No subject match: courses under the number alone, and the
//      professor is on exactly one of them                      -> rule "number+prof"
//   4. Anything else                                            -> { skipped: reason }
function matchCourse({ index, coursesById, reviewsByCourse }, parsed, lastName) {
  if (!parsed) return { skipped: "unparseable class" };
  const label = `${parsed.subject} ${parsed.number}`.trim();
  const teaches = (id) => professorTeaches(coursesById.get(id), lastName, reviewsByCourse);

  let ids = null;
  if (parsed.subject) {
    if (parsed.suffix) ids = index.get(keySubjectNumberSuffix(parsed));
    if (!ids || ids.size === 0) ids = index.get(keySubjectNumber(parsed));
  }
  if (ids && ids.size > 0) {
    if (ids.size === 1) {
      const courseId = [...ids][0];
      return { courseId, rule: "code", profOnCourse: teaches(courseId) };
    }
    const taught = [...ids].filter(teaches);
    if (taught.length === 1) return { courseId: taught[0], rule: "code+prof", profOnCourse: true };
    return {
      skipped: `ambiguous: ${label} (${plural(ids.size, "course")}, professor on ${taught.length === 0 ? "none" : taught.length})`,
    };
  }

  const byNumber = index.get(keyNumber(parsed));
  if (!byNumber || byNumber.size === 0) return { skipped: `no course for ${label}` };
  const taught = [...byNumber].filter(teaches);
  if (taught.length === 1) return { courseId: taught[0], rule: "number+prof", profOnCourse: true };
  return {
    skipped: `ambiguous: ${label} (${plural(byNumber.size, "course")}, professor on ${taught.length === 0 ? "none" : taught.length})`,
  };
}

// ---------- comments ----------

const NAMED_ENTITIES = { quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(quot|apos|lt|gt|nbsp);/g, (_, name) => NAMED_ENTITIES[name])
    .replace(/&amp;/g, "&");
}

// Lowercase alphanumerics only, so punctuation, whitespace, and entity
// wrappers cannot make the same text look different.
const normalizeComment = (s) => squash(s);

// Keys under which "is this rating already on the site?" is answered. A long
// comment identifies itself. A short one ("Great class!") is scoped by the
// professor and the day it was posted. Both the raw and the entity-decoded
// form are returned, because the xlsx import stored RMP's `&quot;` verbatim
// while new rows are decoded.
const LONG_COMMENT = 20;
function dedupeKeys(comment, lastName, isoDay) {
  const raw = normalizeComment(comment);
  const decoded = normalizeComment(decodeEntities(comment));
  const forms = raw === decoded ? [raw] : [raw, decoded];
  if (raw.length >= LONG_COMMENT) return forms;
  const scope = `|${squash(lastName)}|${isoDay}`;
  return forms.map((f) => f + scope);
}

// ---------- instructor names ----------

// The course's own spelling of this professor's name when exactly one listed
// instructor shares the last name; otherwise `fallback`.
function resolveInstructorName(course, lastName, fallback) {
  const hits = ((course && course.instructors) || []).filter((name) => lastNameMatches(name, lastName));
  return hits.length === 1 ? hits[0] : fallback;
}

// ---------- dates ----------

// "2026-09-01 17:51:56 +0000 UTC" -> "2026-09-01T17:51:56.000Z"; null when unparseable.
function parseRmpDate(s) {
  const m = String(s || "").match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2}) UTC$/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}${m[3]}:${m[4]}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

module.exports = {
  ALIASES,
  parseClassString,
  courseCodes,
  buildCourseIndex,
  lastNameMatches,
  professorTeaches,
  matchCourse,
  decodeEntities,
  normalizeComment,
  dedupeKeys,
  resolveInstructorName,
  parseRmpDate,
};
