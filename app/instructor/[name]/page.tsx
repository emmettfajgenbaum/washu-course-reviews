import { createClient } from "@/lib/supabase-server";
import { currentUser } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import {
  canonicalInstructorName,
  surnamePart,
  fullNamesWithSurname,
} from "@/lib/instructor-names";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Link from "next/link";
import type { RmpInstructor } from "@/lib/types";

function ratingColor(value: number, invert = false) {
  if (invert) {
    if (value < 3) return "text-green-600";
    if (value < 4) return "text-yellow-600";
    return "text-red-600";
  }
  if (value >= 4) return "text-green-600";
  if (value >= 3) return "text-yellow-600";
  return "text-red-600";
}

export default async function InstructorPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const requestedName = decodeURIComponent(name);
  const supabase = await createClient();

  // One professor, one page. Course pages link instructors by the surname their
  // reviews carry ("Jager"), while courses.instructors knows the full name
  // ("Abigail Jager") — so the same person had two pages, and only the
  // full-name one could match RateMyProfessors. Send the surname to the full
  // name whenever the surname identifies exactly one instructor. Ambiguous
  // surnames ("Johnson") keep their own page, since folding them would put one
  // professor's reviews under another's name.
  const surname = surnamePart(requestedName);
  const { data: sameSurname } = await supabase
    .from("instructor_names")
    .select("name")
    .ilike("name", `%${surname.replace(/[\\%_]/g, "\\$&")}`);
  const canonicalName = canonicalInstructorName(
    requestedName,
    (sameSurname ?? []).map((r: { name: string }) => r.name)
  );
  if (canonicalName.toLowerCase() !== requestedName.toLowerCase()) {
    redirect(`/instructor/${encodeURIComponent(canonicalName)}`);
  }
  const instructorName = requestedName;

  // Get all reviews for this instructor (exact match or last name match)
  const { data: exactReviews } = await supabase
    .from("reviews")
    .select("*")
    .eq("instructor", instructorName)
    .order("created_at", { ascending: false });

  // If no exact match, try matching by last name
  const lastName = instructorName.split(" ").pop() || instructorName;
  const { data: lastNameReviews } = await supabase
    .from("reviews")
    .select("*")
    .eq("instructor", lastName)
    .order("created_at", { ascending: false });

  const hasExactReviews = !!(exactReviews && exactReviews.length > 0);
  const reviews = hasExactReviews ? exactReviews : lastNameReviews;

  if (!reviews || reviews.length === 0) notFound();

  // Get all courses this instructor teaches
  const courseIds = [...new Set(reviews.map((r) => r.course_id))];
  const { data: courses } = await supabase
    .from("course_stats")
    .select("*")
    .in("id", courseIds);

  const courseMap = new Map((courses || []).map((c) => [c.id, c]));

  // Compute aggregate stats
  const avgQuality = reviews.reduce((s, r) => s + r.quality, 0) / reviews.length;
  const avgDifficulty = reviews.reduce((s, r) => s + r.difficulty, 0) / reviews.length;

  // RateMyProfessors match — only shown when the page's first AND last name
  // both match exactly ONE RMP professor (case-insensitive; two RMP professors
  // sharing a name means we cannot tell which this is, so neither is shown).
  //
  // The reviews themselves carry only a SURNAME ("Jager"), while this page is
  // reached by the full name from courses.instructors ("Abigail Jager"), so
  // nearly every page finds its reviews through the last-name fallback. That
  // fallback pools everyone sharing the surname, so before putting one
  // professor's ratings above those reviews we require the surname to identify
  // exactly one instructor — checked against the instructor_names view
  // (migration 006). If that check cannot be made, no RMP row is shown.
  const nameParts = instructorName.trim().split(/\s+/);
  // Reuse the surname lookup already made for the canonical redirect above:
  // exactly one full name carrying this surname means the pooled reviews below
  // belong to one person, so a rating can sit above them.
  const surnameIsUnambiguous =
    hasExactReviews ||
    fullNamesWithSurname(surname, (sameSurname ?? []).map((r) => r.name)).length === 1;

  let rmp: RmpInstructor | null = null;
  if (surnameIsUnambiguous && nameParts.length >= 2) {
    // ilike without wildcards = case-insensitive equality; escape the ilike
    // metacharacters so a stray % or _ in a name can't widen the match.
    const escape = (s: string) => s.replace(/[\\%_]/g, "\\$&");
    const { data: rmpMatches } = await supabase
      .from("rmp_instructors")
      .select("*")
      .ilike("first_name", escape(nameParts[0]))
      .ilike("last_name", escape(nameParts[nameParts.length - 1]))
      .gt("num_ratings", 0)
      .limit(2);
    rmp = rmpMatches?.length === 1 ? rmpMatches[0] : null;
  }

  const user = await currentUser();
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? null;

  return (
    <div className="flex flex-col min-h-screen">
      <Header userEmail={userEmail} />

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        <Link
          href="/"
          className="group inline-flex items-center gap-2 mb-5 text-base font-medium text-[#2d5234] hover:text-[#234228] transition-colors"
        >
          <span
            aria-hidden="true"
            className="flex items-center justify-center w-8 h-8 rounded-full bg-[#2d5234] text-white text-sm transition-transform group-hover:-translate-x-0.5"
          >
            &larr;
          </span>
          Back to courses
        </Link>

        <div className="space-y-6">
          <div>
            <h1
              className="text-2xl font-semibold text-gray-900"
              style={{ fontFamily: "'Source Serif 4', serif" }}
            >
              {instructorName}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {courseIds.length} course{courseIds.length !== 1 ? "s" : ""} &middot; {reviews.length} review{reviews.length !== 1 ? "s" : ""}
            </p>
          </div>

          {/* Aggregate stats — our reviews first, then RateMyProfessors when
              first and last name both match an RMP professor exactly */}
          <div className="bg-[#f7f5f0] rounded-lg divide-y divide-[#e2ddd5]">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 px-4">
              <div className="w-36 shrink-0 text-xs font-medium text-gray-500">
                WashU Course Reviews
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold ${ratingColor(avgQuality)}`}>
                  {avgQuality.toFixed(1)}
                </div>
                <div className="text-xs text-gray-500">Quality</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold ${ratingColor(avgDifficulty, true)}`}>
                  {avgDifficulty.toFixed(1)}
                </div>
                <div className="text-xs text-gray-500">Difficulty</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-700">
                  {reviews.length}
                </div>
                <div className="text-xs text-gray-500">Reviews</div>
              </div>
            </div>
            {rmp && rmp.quality !== null && rmp.difficulty !== null && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 px-4">
                <div className="w-36 shrink-0">
                  <div className="text-xs font-medium text-gray-500">
                    RateMyProfessors
                  </div>
                  <a
                    href={`https://www.ratemyprofessors.com/professor/${rmp.legacy_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#2d5234] hover:underline"
                  >
                    View profile &#8599;
                  </a>
                </div>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${ratingColor(rmp.quality)}`}>
                    {rmp.quality.toFixed(1)}
                  </div>
                  <div className="text-xs text-gray-500">Quality</div>
                </div>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${ratingColor(rmp.difficulty, true)}`}>
                    {rmp.difficulty.toFixed(1)}
                  </div>
                  <div className="text-xs text-gray-500">Difficulty</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-700">
                    {rmp.num_ratings}
                  </div>
                  <div className="text-xs text-gray-500">Ratings</div>
                </div>
              </div>
            )}
          </div>

          {/* Courses taught */}
          <div>
            <h3
              className="text-lg font-semibold mb-3"
              style={{ fontFamily: "'Source Serif 4', serif" }}
            >
              Courses
            </h3>
            <div className="space-y-2">
              {courses?.sort((a, b) => b.review_count - a.review_count).map((course) => {
                const courseReviews = reviews.filter((r) => r.course_id === course.id);
                const cAvg = courseReviews.reduce((s, r) => s + r.quality, 0) / courseReviews.length;
                return (
                  <Link
                    key={course.id}
                    href={`/course/${course.id}`}
                    className="block p-3 border border-[#e2ddd5] rounded-lg hover:bg-[#f7f5f0] transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-[#2d5234] uppercase">
                          {course.bulletin_code || course.code.replace(/[A-Z]\d+\s+/g, "")}
                        </p>
                        <p className="text-sm font-medium text-gray-900">{course.name}</p>
                      </div>
                      <div className="text-right">
                        <span className={`text-sm font-semibold ${ratingColor(cAvg)}`}>
                          {cAvg.toFixed(1)}
                        </span>
                        <p className="text-xs text-gray-400">{courseReviews.length} reviews</p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* All reviews */}
          <div>
            <h3
              className="text-lg font-semibold mb-3"
              style={{ fontFamily: "'Source Serif 4', serif" }}
            >
              All Reviews
            </h3>
            <div className="space-y-4">
              {reviews.map((review) => {
                const course = courseMap.get(review.course_id);
                return (
                  <div
                    key={review.id}
                    className="bg-white border border-[#e2ddd5] rounded-lg p-4"
                  >
                    <div className="flex items-center gap-4 text-sm mb-2">
                      <span>
                        Quality:{" "}
                        <span className={`font-semibold ${ratingColor(review.quality)}`}>
                          {review.quality}
                        </span>
                      </span>
                      <span>
                        Difficulty:{" "}
                        <span className={`font-semibold ${ratingColor(review.difficulty, true)}`}>
                          {review.difficulty}
                        </span>
                      </span>
                      {course && (
                        <Link
                          href={`/course/${course.id}`}
                          className="text-[#2d5234] hover:underline"
                        >
                          {course.bulletin_code || course.code.replace(/[A-Z]\d+\s+/g, "")}
                        </Link>
                      )}
                    </div>
                    {review.hours_per_week && (
                      <p className="text-xs text-gray-400 mb-1">
                        {review.hours_per_week} hrs/week
                      </p>
                    )}
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">
                      {review.comment}
                    </p>
                    <p className="text-xs text-gray-400 mt-2">
                      {new Date(review.created_at).toLocaleDateString()}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
