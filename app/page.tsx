import { createClient } from "@/lib/supabase-server";
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

  // Fetch distinct instructors from reviews and merge into courses
  const { data: reviewInstructors } = await supabase
    .from("reviews")
    .select("course_id, instructor")
    .neq("instructor", "");

  const reviewInstructorMap = new Map<number, Set<string>>();
  if (reviewInstructors) {
    for (const r of reviewInstructors) {
      if (!reviewInstructorMap.has(r.course_id)) {
        reviewInstructorMap.set(r.course_id, new Set());
      }
      reviewInstructorMap.get(r.course_id)!.add(r.instructor);
    }
  }

  const courses = allCourses.map((c) => {
    const reviewInsts = reviewInstructorMap.get(c.id);
    if (!reviewInsts) return c;
    const merged = new Set([...c.instructors, ...reviewInsts]);
    return { ...c, instructors: Array.from(merged) };
  });

  const user = await currentUser();
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? null;

  const { department: initialDepartment } = await searchParams;

  return (
    <div className="flex flex-col min-h-screen">
      <Header userEmail={userEmail} />

      {/* Main content */}
      <main className="flex-1">
        <CourseSearch key={initialDepartment || "__all__"} courses={courses || []} initialDepartment={initialDepartment || ""} />
      </main>

      <Footer />
    </div>
  );
}
