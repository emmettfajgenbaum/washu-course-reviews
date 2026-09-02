import { createClient } from "@/lib/supabase-server";
import { canonicalInstructorName } from "@/lib/instructor-names";
import type { InstructorSummary } from "@/lib/types";
import { currentUser } from "@clerk/nextjs/server";
import CourseSearch from "@/components/CourseSearch";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default async function Home({ searchParams }: { searchParams: Promise<{ department?: string }> }) {
  const supabase = await createClient();

  // Fetch all courses (Supabase defaults to 1000 row limit)
  const allCourses = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from("course_stats")
      .select("*")
      .order("review_count", { ascending: false })
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allCourses.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  // Fetch distinct instructors from reviews and merge into courses.
  // Paginated: Supabase caps a request at 1000 rows, so without this loop only
  // the first 1000 reviews were ever considered and most instructors went
  // missing from course search.
  const reviewInstructors: { course_id: number; instructor: string }[] = [];
  offset = 0;
  while (true) {
    const { data } = await supabase
      .from("reviews")
      .select("course_id, instructor")
      .neq("instructor", "")
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    reviewInstructors.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  const reviewInstructorMap = new Map<number, Set<string>>();
  for (const r of reviewInstructors) {
    if (!reviewInstructorMap.has(r.course_id)) {
      reviewInstructorMap.set(r.course_id, new Set());
    }
    reviewInstructorMap.get(r.course_id)!.add(r.instructor);
  }

  const courses = allCourses.map((c) => {
    const reviewInsts = reviewInstructorMap.get(c.id);
    if (!reviewInsts) return c;
    const merged = new Set([...c.instructors, ...reviewInsts]);
    return { ...c, instructors: Array.from(merged) };
  });

  // --- Professors ---
  // instructor_stats (migration 007) is grouped by the raw instructor string,
  // which is usually a surname. Fold those into full names here, using the same
  // rule the instructor page redirects by, so one professor is one row.
  const rawInstructorStats: {
    name: string;
    review_count: number;
    course_count: number;
    avg_quality: number | null;
    avg_difficulty: number | null;
  }[] = [];
  offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("instructor_stats")
      .select("*")
      .order("review_count", { ascending: false })
      .range(offset, offset + 999);
    // Missing view (migration 007 not yet applied) — degrade to courses only
    // rather than failing the whole page.
    if (error || !data || data.length === 0) break;
    rawInstructorStats.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  const knownFullNames = new Set<string>();
  for (const c of allCourses) {
    for (const i of c.instructors ?? []) if (i) knownFullNames.add(i);
  }

  const byCanonical = new Map<string, InstructorSummary>();
  for (const row of rawInstructorStats) {
    const canonical = canonicalInstructorName(row.name, knownFullNames);
    const key = canonical.toLowerCase();
    const existing = byCanonical.get(key);
    if (!existing) {
      byCanonical.set(key, {
        name: canonical,
        review_count: row.review_count,
        course_count: row.course_count,
        avg_quality: row.avg_quality,
        avg_difficulty: row.avg_difficulty,
        aliases: [row.name],
      });
      continue;
    }
    // Two stored spellings of one professor ("Jager" and "Abigail Jager"):
    // combine, weighting each average by the reviews behind it.
    const total = existing.review_count + row.review_count;
    const blend = (a: number | null, b: number | null) => {
      if (a === null) return b;
      if (b === null) return a;
      return Math.round(((a * existing.review_count + b * row.review_count) / total) * 100) / 100;
    };
    existing.avg_quality = blend(existing.avg_quality, row.avg_quality);
    existing.avg_difficulty = blend(existing.avg_difficulty, row.avg_difficulty);
    existing.review_count = total;
    // course_count can double count a course taught under both spellings; the
    // exact figure would need the course ids, and this is a display hint only.
    existing.course_count = Math.max(existing.course_count, row.course_count);
    existing.aliases.push(row.name);
  }
  const instructors = [...byCanonical.values()].sort(
    (a, b) => b.review_count - a.review_count
  );

  const user = await currentUser();
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? null;

  const { department: initialDepartment } = await searchParams;

  return (
    <div className="flex flex-col min-h-screen">
      <Header userEmail={userEmail} />

      {/* Main content */}
      <main className="flex-1">
        <CourseSearch
          key={initialDepartment || "__all__"}
          courses={courses || []}
          instructors={instructors}
          initialDepartment={initialDepartment || ""}
        />
      </main>

      <Footer />
    </div>
  );
}
