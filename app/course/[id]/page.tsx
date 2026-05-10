import { createClient } from "@/lib/supabase-server";
import { notFound } from "next/navigation";
import CourseDetail from "@/components/CourseDetail";
import UserMenu from "@/components/UserMenu";
import Link from "next/link";

export default async function CoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: course } = await supabase
    .from("course_stats")
    .select("*")
    .eq("id", id)
    .single();

  if (!course) notFound();

  const { data: reviews } = await supabase
    .from("reviews")
    .select("*")
    .eq("course_id", course.id)
    .order("created_at", { ascending: false });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-col min-h-screen">
      <header className="bg-[#2d5234] text-white px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link
            href="/"
            className="text-xl font-bold hover:text-white/90 transition-colors"
            style={{ fontFamily: "'Source Serif 4', serif" }}
          >
            WashU Course Reviews
          </Link>
          {user ? (
            <UserMenu email={user.email!} />
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

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        <Link
          href="/"
          className="text-sm text-[#2d5234] hover:underline mb-4 inline-block"
        >
          &larr; Back to courses
        </Link>
        <CourseDetail
          course={course}
          initialReviews={reviews || []}
          userId={user?.id || null}
        />
      </main>
    </div>
  );
}
