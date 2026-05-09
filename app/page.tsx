import { createClient } from "@/lib/supabase-server";
import CourseSearch from "@/components/CourseSearch";
import Link from "next/link";

export default async function Home() {
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
  const courses = allCourses;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="bg-[#2d5234] text-white px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1
            className="text-xl font-bold"
            style={{ fontFamily: "'Source Serif 4', serif" }}
          >
            WashU Course Reviews
          </h1>
          {user ? (
            <span className="text-sm text-white/70">{user.email}</span>
          ) : (
            <Link
              href="/auth/login"
              className="text-sm bg-white/15 hover:bg-white/25 px-4 py-1.5 rounded-lg transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        <CourseSearch courses={courses || []} />
      </main>
    </div>
  );
}
