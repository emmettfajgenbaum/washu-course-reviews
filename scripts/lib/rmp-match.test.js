// node --test scripts/lib
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseClassString,
  buildCourseIndex,
  buildInstructorDirectory,
  professorTeaches,
  matchCourse,
  normalizeComment,
  dedupeKeys,
  resolveInstructorName,
  resolveInstructorNameDetailed,
  resolveLegacyName,
  lastNameMatches,
  parseRmpDate,
  decodeEntities,
} = require("./rmp-match.js");

// ---------- parseClassString ----------

const PARSE_CASES = [
  ["CSE131", { subject: "CSE", number: "131", suffix: "" }],
  ["Bio2970", { subject: "BIOL", number: "2970", suffix: "" }],
  ["cwp1508", { subject: "CWP", number: "1508", suffix: "" }],
  ["L59CWP201", { subject: "CWP", number: "201", suffix: "" }],
  ["L974413", { subject: "", number: "4413", suffix: "" }],
  ["2960", { subject: "", number: "2960", suffix: "" }],
  ["MGT200A", { subject: "MGT", number: "200", suffix: "A" }],
  ["CHEM-2652", { subject: "CHEM", number: "2652", suffix: "" }],
  ["MGMT100", { subject: "MGT", number: "100", suffix: "" }],
  ["ORGO261S", { subject: "CHEM", number: "261", suffix: "S" }],
  ["Econ 1011", { subject: "ECON", number: "1011", suffix: "" }],
  ["CHEM261CHEM262", null],
  ["Phonetics", null],
  ["L13", null],
  ["", null],
  [null, null],
  ["29602970", null],
];
for (const [input, expected] of PARSE_CASES) {
  test(`parseClassString(${JSON.stringify(input)})`, () => {
    assert.deepEqual(parseClassString(input), expected);
  });
}

// ---------- buildCourseIndex ----------

const keysFor = (index, id) =>
  [...index.entries()].filter(([, ids]) => ids.has(id)).map(([k]) => k).sort();

test("buildCourseIndex indexes old code and new bulletin code, exact, loose, and number-only", () => {
  const index = buildCourseIndex([{ id: 1, code: "L24 Math 233", bulletin_code: "MATH 2130" }]);
  assert.deepEqual(keysFor(index, 1), ["#2130", "#233", "MATH 2130", "MATH 2130|", "MATH 233", "MATH 233|"]);
});

test("buildCourseIndex indexes every cross-listing; the suffix is part of the exact key", () => {
  const index = buildCourseIndex([{ id: 7, code: "L90 AFAS 3255, L98 AMCS 325A", bulletin_code: "" }]);
  assert.deepEqual(keysFor(index, 7), ["#325", "#3255", "AFAS 3255", "AFAS 3255|", "AMCS 325", "AMCS 325|A"]);
});

test("buildCourseIndex collapses multi-word subjects and skips unparseable parts", () => {
  const index = buildCourseIndex([{ id: 3, code: "L16 Comp Lit 3123, junk", bulletin_code: "COMPLITTHT 3121" }]);
  assert.deepEqual(keysFor(index, 3), ["#3121", "#3123", "COMPLIT 3123", "COMPLIT 3123|", "COMPLITTHT 3121", "COMPLITTHT 3121|"]);
});

// ---------- professorTeaches / matchCourse ----------

const COURSES = [
  { id: 10, code: "L24 Math 100", bulletin_code: "MATH 1010", instructors: ["Jane Roe"] },
  { id: 11, code: "B53 Math 100", bulletin_code: "", instructors: ["Kathy Hafer"] },
  { id: 20, code: "E81 CSE 131", bulletin_code: "CSE 1310", instructors: ["Douglas Shook"] },
  { id: 21, code: "E81 CSE 247", bulletin_code: "CSE 2407", instructors: ["Cynthia Ma"] },
  { id: 22, code: "E81 CSE 247R", bulletin_code: "CSE 2497", instructors: ["Cynthia Ma"] },
  { id: 30, code: "L41 BIOL 2960", bulletin_code: "BIOL 2960", instructors: ["Kathy Hafer"] },
  { id: 31, code: "B99 XYZ 2960", bulletin_code: "", instructors: [] },
];
const REVIEWS_BY_COURSE = new Map([[31, [{ instructor: "Someone Else" }, { instructor: "Chen" }]]]);
const ctx = () => ({
  index: buildCourseIndex(COURSES),
  coursesById: new Map(COURSES.map((c) => [c.id, c])),
  reviewsByCourse: REVIEWS_BY_COURSE,
});

test("professorTeaches matches the last token of a listed instructor, case-insensitively", () => {
  assert.equal(professorTeaches(COURSES[1], "HAFER", new Map()), true);
  assert.equal(professorTeaches(COURSES[0], "Hafer", new Map()), false);
});

test("professorTeaches also counts an existing review's instructor", () => {
  const course31 = COURSES.find((c) => c.id === 31);
  assert.equal(professorTeaches(course31, "Chen", REVIEWS_BY_COURSE), true);
  assert.equal(professorTeaches(course31, "Chen", new Map()), false);
});

test("matchCourse: a single course under subject+number matches by code", () => {
  const r = matchCourse(ctx(), parseClassString("CSE131"), "Nobody");
  assert.deepEqual(r, { courseId: 20, rule: "code", profOnCourse: false });
});

test("matchCourse: records when the professor is on a code-matched course", () => {
  const r = matchCourse(ctx(), parseClassString("CSE131"), "Shook");
  assert.deepEqual(r, { courseId: 20, rule: "code", profOnCourse: true });
});

test("matchCourse: several courses under the code, professor on exactly one", () => {
  const r = matchCourse(ctx(), parseClassString("MATH100"), "Hafer");
  assert.deepEqual(r, { courseId: 11, rule: "code+prof", profOnCourse: true });
});

test("matchCourse: several courses under the code, professor on none -> skipped", () => {
  const r = matchCourse(ctx(), parseClassString("MATH100"), "Nobody");
  assert.deepEqual(r, { skipped: "ambiguous: MATH 100 (2 courses, professor on none)" });
});

test("matchCourse: number only, professor on exactly one of the number's courses", () => {
  const r = matchCourse(ctx(), parseClassString("2960"), "Hafer");
  assert.deepEqual(r, { courseId: 30, rule: "number+prof", profOnCourse: true });
});

test("matchCourse: number only via an existing review's instructor", () => {
  const r = matchCourse(ctx(), parseClassString("2960"), "Chen");
  assert.deepEqual(r, { courseId: 31, rule: "number+prof", profOnCourse: true });
});

test("matchCourse: number only, professor on none -> skipped even with one candidate", () => {
  const r = matchCourse(ctx(), parseClassString("L974413"), "Nobody");
  assert.deepEqual(r, { skipped: "no course for 4413" });
  const r2 = matchCourse(ctx(), parseClassString("2960"), "Nobody");
  assert.deepEqual(r2, { skipped: "ambiguous: 2960 (2 courses, professor on none)" });
});

test("matchCourse: unknown subject falls back to the number, still gated by the professor", () => {
  const r = matchCourse(ctx(), parseClassString("CWP2960"), "Hafer");
  assert.deepEqual(r, { courseId: 30, rule: "number+prof", profOnCourse: true });
  const r2 = matchCourse(ctx(), parseClassString("CWP100"), "Nobody");
  assert.deepEqual(r2, { skipped: "no course for CWP 100 (2 courses numbered 100, professor on none)" });
  const r3 = matchCourse(ctx(), parseClassString("CHEM2960"), "Nobody");
  assert.deepEqual(r3, { skipped: "no course for CHEM 2960 (2 courses numbered 2960, professor on none)" });
});

test("matchCourse: an unsuffixed class string prefers the unsuffixed course over its R/S variant", () => {
  assert.deepEqual(matchCourse(ctx(), parseClassString("CSE247"), "Ma"), { courseId: 21, rule: "code", profOnCourse: true });
  assert.deepEqual(matchCourse(ctx(), parseClassString("CSE247R"), "Ma"), { courseId: 22, rule: "code", profOnCourse: true });
});

test("matchCourse: nothing under the number at all", () => {
  const r = matchCourse(ctx(), parseClassString("CWP999"), "Hafer");
  assert.deepEqual(r, { skipped: "no course for CWP 999" });
});

test("matchCourse: suffix narrows when present, falls back to the unsuffixed key", () => {
  const c = ctx();
  assert.deepEqual(matchCourse(c, parseClassString("CSE131A"), "Nobody"), {
    courseId: 20,
    rule: "code",
    profOnCourse: false,
  });
});

test("matchCourse: null parse -> skipped as unparseable", () => {
  assert.deepEqual(matchCourse(ctx(), null, "Hafer"), { skipped: "unparseable class" });
});

// ---------- comments ----------

test("normalizeComment keeps lowercase alphanumerics only", () => {
  assert.equal(normalizeComment('I read &quot;The Jungle&quot; — twice!'), "ireadquotthejunglequottwice");
  assert.equal(normalizeComment(null), "");
});

test("dedupeKeys: a long comment keys on the comment alone, raw and decoded", () => {
  const keys = dedupeKeys("I read &quot;The Jungle&quot; in high school", "2024-05-01");
  assert.deepEqual(keys, ["ireadquotthejunglequotinhighschool", "ireadthejungleinhighschool"]);
});

test("dedupeKeys: identical raw and decoded forms collapse to one key", () => {
  assert.deepEqual(dedupeKeys("A perfectly ordinary comment here", "2024-05-01"), ["aperfectlyordinarycommenthere"]);
});

test("dedupeKeys: a short comment is scoped by day only, never by how the instructor was spelled", () => {
  assert.deepEqual(dedupeKeys("Great class!", "2024-05-01"), ["greatclass|2024-05-01"]);
  assert.deepEqual(dedupeKeys("She is amazing", "2023-04-09"), ["sheisamazing|2023-04-09"]);
});

test("decodeEntities handles numeric and the common named entities", () => {
  assert.equal(decodeEntities("hard&#8212;it &quot;is&quot; &amp; &#39;ok&#39; &lt;3&gt;"), "hard—it \"is\" & 'ok' <3>");
  assert.equal(decodeEntities("plain"), "plain");
});

// ---------- instructor names ----------

test("resolveInstructorName picks the one listed instructor sharing the last name", () => {
  assert.equal(resolveInstructorName({ instructors: ["Kathy Hafer", "Rong Chen"] }, "hafer", "K Hafer"), "Kathy Hafer");
  assert.equal(resolveInstructorName({ instructors: ["El Hadji Samba DIALLO"] }, "Diallo", "x"), "El Hadji Samba DIALLO");
});

test("resolveInstructorName falls back when there are zero or several candidates", () => {
  assert.equal(resolveInstructorName({ instructors: ["A Smith", "B Smith"] }, "Smith", "C Smith"), "C Smith");
  assert.equal(resolveInstructorName({ instructors: [] }, "Smith", "C Smith"), "C Smith");
  assert.equal(resolveInstructorName(undefined, "Smith", null), null);
});

const DIRECTORY = buildInstructorDirectory([
  { instructors: ["Steve Cole", "Rong Chen", "Kristin Van Engen"] },
  { instructors: ["Jiayi Chen", "Steve Cole"] },
]);

test("buildInstructorDirectory keys every name by its last one, two, and three tokens", () => {
  assert.deepEqual([...DIRECTORY.get("cole")], ["Steve Cole"]);
  assert.deepEqual([...DIRECTORY.get("chen")].sort(), ["Jiayi Chen", "Rong Chen"]);
  assert.deepEqual([...DIRECTORY.get("vanengen")], ["Kristin Van Engen"]);
  assert.deepEqual([...DIRECTORY.get("engen")], ["Kristin Van Engen"]);
});

test("resolveInstructorName: the catalog's unique spelling wins over RMP's, gated by first initial", () => {
  const opts = { directory: DIRECTORY, firstName: "Stephen" };
  assert.equal(resolveInstructorName({ instructors: [] }, "Cole", "Stephen Cole", opts), "Steve Cole");
  assert.equal(resolveInstructorName({ instructors: [] }, "Cole", "Nate Cole", { directory: DIRECTORY, firstName: "Nate" }), "Nate Cole");
  assert.equal(resolveInstructorName({ instructors: [] }, "Van Engen", "K Van Engen", { directory: DIRECTORY, firstName: "Kristin" }), "Kristin Van Engen");
});

test("resolveInstructorName: several catalog names sharing the last name -> fallback, even with an initial", () => {
  assert.equal(resolveInstructorName({ instructors: [] }, "Chen", "J Chen", { directory: DIRECTORY, firstName: "Jane" }), "J Chen");
  assert.equal(resolveInstructorName({ instructors: [] }, "Chen", null, { directory: DIRECTORY }), null);
});

test("resolveInstructorName: without a first name, a catalog-unique last name still resolves", () => {
  assert.equal(resolveInstructorName({ instructors: [] }, "Cole", null, { directory: DIRECTORY }), "Steve Cole");
});

test("resolveInstructorName: the course's own listing beats the directory", () => {
  assert.equal(resolveInstructorName({ instructors: ["Stephen Cole"] }, "Cole", "x", { directory: DIRECTORY, firstName: "Stephen" }), "Stephen Cole");
});

test("resolveInstructorName: a listed instructor with a different first initial is not this professor", () => {
  const course = { instructors: ["Kathy Hafer"] };
  assert.equal(resolveInstructorName(course, "Hafer", "Gail Hafer", { firstName: "Gail" }), "Gail Hafer");
  assert.equal(resolveInstructorName(course, "Hafer", "x", { firstName: "Kathleen" }), "Kathy Hafer");
});

test("resolveInstructorName: a course listing the same person twice is one candidate, not two", () => {
  const course = { instructors: ["Heather Barton", "Someone Else", "Heather Barton"] };
  assert.deepEqual(resolveInstructorNameDetailed(course, "Barton"), { name: "Heather Barton", via: "course" });
});

test("resolveInstructorName: two different people on the course -> ambiguous, no directory fallback", () => {
  const course = { instructors: ["Brian Garnett", "Roman Garnett"] };
  const r = resolveInstructorNameDetailed(course, "Garnett", { directory: buildInstructorDirectory([course]) });
  assert.equal(r.name, null);
  assert.deepEqual(r.ambiguous, ["Brian Garnett", "Roman Garnett"]);
});

test("resolveInstructorName: a catalog full name already on the course's reviews beats a catalog-wide tie", () => {
  const directory = buildInstructorDirectory([{ instructors: ["Kathleen Hafer"] }, { instructors: ["Kathy Hafer"] }]);
  const r = resolveInstructorNameDetailed({ instructors: [] }, "Hafer", {
    directory,
    existingNames: ["Hafer", "Kathy Hafer", "Hafer"],
    firstName: "Kathleen",
  });
  assert.deepEqual(r, { name: "Kathy Hafer", via: "reviews" });
});

test("resolveInstructorName: a non-catalog spelling on the course's reviews is ignored", () => {
  const directory = buildInstructorDirectory([{ instructors: ["Kathleen Hafer"] }]);
  const r = resolveInstructorNameDetailed({ instructors: [] }, "Hafer", {
    directory,
    existingNames: ["Kathy Hafer"],
    firstName: "Kathleen",
  });
  assert.deepEqual(r, { name: "Kathleen Hafer", via: "catalog" });
});

test("resolveInstructorName: bare surnames on existing reviews are not full names", () => {
  const r = resolveInstructorNameDetailed({ instructors: [] }, "Hafer", { existingNames: ["Hafer", "HAFER"] });
  assert.deepEqual(r, { name: null, via: null });
});

test("lastNameMatches folds accents", () => {
  assert.equal(lastNameMatches("Lionel Cuille", "Cuillé"), true);
  assert.equal(lastNameMatches("Ignacio Sánchez Prado", "Sanchez Prado"), true);
});

const LEGACY_COURSES = [
  { id: 1, instructors: ["Megan Daschbach", "Dorothy Petersen", "Judi McLean Parks", "Kristin Van Engen", "Athena MTabakhi", "Ann Mohr"] },
  { id: 2, instructors: ["Wei Wang", "Wen Wang"] },
  { id: 3, instructors: ["Lionel Cuille"] },
  { id: 4, instructors: [] },
];
const LEGACY_DIR = buildInstructorDirectory(LEGACY_COURSES);
const legacy = (value, course = LEGACY_COURSES[0], existingNames = []) =>
  resolveLegacyName(value, course, { directory: LEGACY_DIR, existingNames });

test("resolveLegacyName: a value that is already a catalog string is left as it is", () => {
  assert.deepEqual(legacy("Megan Daschbach"), { name: "Megan Daschbach", via: "exact" });
});

test("resolveLegacyName: bare surname, multi-word surname, and 'Last, Initial' forms", () => {
  assert.equal(legacy("Petersen").name, "Dorothy Petersen");
  assert.equal(legacy("McLean Parks").name, "Judi McLean Parks");
  assert.equal(legacy("Van Engen").name, "Kristin Van Engen");
  assert.equal(legacy("Petersen, D.").name, "Dorothy Petersen");
  assert.equal(legacy("M Tabakhi").name, "Athena MTabakhi");
  assert.equal(legacy("Ann Marie Mohr").name, "Ann Mohr");
});

test("resolveLegacyName: an initial plus surname resolves catalog-wide when the initial agrees", () => {
  assert.deepEqual(legacy("L. Cuillé", LEGACY_COURSES[3]), { name: "Lionel Cuille", via: "catalog" });
  assert.equal(legacy("Boon Cuillé", LEGACY_COURSES[3]).name, null);
});

test("resolveLegacyName: the reviews tier only accepts catalog spellings", () => {
  assert.equal(legacy("L. Cuillé", LEGACY_COURSES[3], ["Boon Cuillé"]).name, "Lionel Cuille");
  assert.equal(legacy("Cuillé", LEGACY_COURSES[3], ["Boon Cuillé", "Lionel Cuille"]).name, "Lionel Cuille");
});

test("resolveLegacyName: a double surname resolves only from the course, never catalog-wide", () => {
  assert.equal(legacy("Daschbach Eckhardt", LEGACY_COURSES[3]).name, null);
});

test("resolveLegacyName: a double surname the catalog shortens resolves through its first token", () => {
  assert.deepEqual(legacy("Daschbach Eckhardt"), { name: "Megan Daschbach", via: "course" });
});

test("resolveLegacyName: 'Last, Initial' with a wrong initial does not resolve", () => {
  assert.equal(legacy("Petersen, X.").name, null);
});

test("resolveLegacyName: two people sharing the surname on the course stays ambiguous", () => {
  const r = legacy("Wang, W", LEGACY_COURSES[1]);
  assert.equal(r.name, null);
  assert.deepEqual(r.ambiguous, ["Wei Wang", "Wen Wang"]);
});

test("resolveLegacyName: empty and unknown values resolve to nothing", () => {
  assert.equal(legacy("").name, null);
  assert.equal(legacy("Nobody").name, null);
});

// ---------- dates ----------

test("parseRmpDate turns RMP's format into ISO, and rejects garbage", () => {
  assert.equal(parseRmpDate("2026-09-01 17:51:56 +0000 UTC"), "2026-09-01T17:51:56.000Z");
  assert.equal(parseRmpDate("not a date"), null);
  assert.equal(parseRmpDate(""), null);
});
