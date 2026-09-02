import Link from "next/link";
import type { InstructorSummary } from "@/lib/types";

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

export default function InstructorCard({
  instructor,
}: {
  instructor: InstructorSummary;
}) {
  return (
    <Link
      href={`/instructor/${encodeURIComponent(instructor.name)}`}
      className="block bg-white border border-[#e2ddd5] rounded-lg p-4 hover:bg-[#f7f5f0] transition-colors"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p
            className="text-base font-medium text-gray-900 truncate"
            style={{ fontFamily: "'Source Serif 4', serif" }}
          >
            {instructor.name}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {instructor.course_count} course
            {instructor.course_count !== 1 ? "s" : ""} &middot;{" "}
            {instructor.review_count} review
            {instructor.review_count !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex gap-5 shrink-0 text-center">
          <div>
            <div className={`text-lg font-bold ${ratingColor(instructor.avg_quality)}`}>
              {instructor.avg_quality?.toFixed(1) ?? "—"}
            </div>
            <div className="text-[11px] text-gray-500">Quality</div>
          </div>
          <div>
            <div
              className={`text-lg font-bold ${ratingColor(instructor.avg_difficulty, true)}`}
            >
              {instructor.avg_difficulty?.toFixed(1) ?? "—"}
            </div>
            <div className="text-[11px] text-gray-500">Difficulty</div>
          </div>
        </div>
      </div>
    </Link>
  );
}
