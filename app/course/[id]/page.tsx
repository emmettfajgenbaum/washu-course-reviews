import { createClient } from "@/lib/supabase-server";
import { currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import CourseDetail from "@/components/CourseDetail";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
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

  const user = await currentUser();
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? null;

  return (
    <div className="flex flex-col min-h-screen">
      <Header userEmail={userEmail} />

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        <Link
          href="/"
          className="group inline-flex items-center gap-2 mb-5 text-base font-medium text-primary hover:text-primary-hover transition-colors"
        >
          <span
            aria-hidden="true"
            className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-surface-foreground text-sm transition-transform group-hover:-translate-x-0.5"
          >
            &larr;
          </span>
          Back to courses
        </Link>
        <CourseDetail
          course={course}
          initialReviews={reviews || []}
          userId={user?.id ?? null}
        />
      </main>

      <Footer />
    </div>
  );
}
