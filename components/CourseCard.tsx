import Link from "next/link";
import { CourseWithStats } from "@/lib/types";

function ratingColor(value: number | null, invert = false) {
  if (value === null) return "text-gray-400";
  if (invert) {
    if (value < 3) return "text-green-600";
    if (value < 4) return "text-yellow-600";
    return "text-red-600";
  }
  if (value >= 4) return "text-green-600";
  if (value >= 3) return "text-yellow-600";
  return "text-red-600";
}

export default function CourseCard({
  course,
}: {
  course: CourseWithStats;
}) {
  return (
    <Link
      href={`/course/${course.id}`}
      className="block w-full text-left bg-white rounded-xl border border-[#e2ddd5] p-5 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[#2d5234] tracking-wide uppercase">
            {course.code}
          </p>
          <h3
            className="text-base font-semibold text-gray-900 mt-0.5 leading-snug"
            style={{ fontFamily: "'Source Serif 4', serif" }}
          >
            {course.name}
          </h3>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {course.departments.map((dept) => (
              <span
                key={dept}
                className="text-xs bg-[#f7f5f0] text-gray-600 px-2 py-0.5 rounded-full border border-[#e2ddd5]"
              >
                {dept}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-end shrink-0 gap-1">
          {course.review_count > 0 ? (
            <>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-400">Quality</span>
                <span className={`font-semibold ${ratingColor(course.avg_quality)}`}>
                  {course.avg_quality?.toFixed(1)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-400">Difficulty</span>
                <span className={`font-semibold ${ratingColor(course.avg_difficulty, true)}`}>
                  {course.avg_difficulty?.toFixed(1)}
                </span>
              </div>
            </>
          ) : null}
          <span className="text-xs text-gray-400 mt-1">
            {course.review_count} review{course.review_count !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </Link>
  );
}
