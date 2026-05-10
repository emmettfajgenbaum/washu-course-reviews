"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { CourseWithStats } from "@/lib/types";
import CourseCard from "./CourseCard";

const PAGE_SIZE = 30;

export default function CourseSearch({
  courses,
  initialDepartment = "",
}: {
  courses: CourseWithStats[];
  initialDepartment?: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState(initialDepartment);
  const [reviewFilter, setReviewFilter] = useState<"all" | "has-reviews">(
    "has-reviews"
  );
  const [sortBy, setSortBy] = useState<"reviews" | "quality" | "difficulty" | "recent">("reviews");
  const [minQuality, setMinQuality] = useState(1);
  const [maxDifficulty, setMaxDifficulty] = useState(5);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const departments = useMemo(() => {
    const set = new Set<string>();
    courses.forEach((c) => c.departments.forEach((d) => set.add(d)));
    return Array.from(set).sort();
  }, [courses]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const result = courses.filter((c) => {
      if (q) {
        const matchesSearch =
          c.code.toLowerCase().includes(q) ||
          (c.bulletin_code && c.bulletin_code.toLowerCase().includes(q)) ||
          c.name.toLowerCase().includes(q) ||
          c.departments.some((d) => d.toLowerCase().includes(q)) ||
          c.instructors.some((i) => i.toLowerCase().includes(q));
        if (!matchesSearch) return false;
      }
      if (department && !c.departments.includes(department)) return false;
      if (reviewFilter === "has-reviews" && c.review_count === 0) return false;
      if (c.avg_quality !== null && c.avg_quality < minQuality) return false;
      if (c.avg_difficulty !== null && c.avg_difficulty > maxDifficulty)
        return false;
      return true;
    });

    result.sort((a, b) => {
      switch (sortBy) {
        case "quality":
          return (b.avg_quality ?? 0) - (a.avg_quality ?? 0);
        case "difficulty":
          return (a.avg_difficulty ?? 5) - (b.avg_difficulty ?? 5);
        case "recent":
          return b.created_at.localeCompare(a.created_at);
        case "reviews":
        default:
          return b.review_count - a.review_count;
      }
    });

    return result;
  }, [courses, search, department, reviewFilter, minQuality, maxDifficulty, sortBy]);

  const visible = filtered.slice(0, visibleCount);

  return (
    <>
      {/* Sticky search/filter bar */}
      <div className="sticky top-0 z-40 bg-[#f7f5f0] border-b border-[#e2ddd5] py-4">
        <div className="max-w-4xl mx-auto px-4 space-y-3">
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
            placeholder="Search courses, departments, instructors..."
            className="w-full px-4 py-2.5 bg-white border border-[#e2ddd5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5234]/30 focus:border-[#2d5234]"
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 items-end">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs text-gray-500 mb-1">
                Department
              </label>
              <select
                value={department}
                onChange={(e) => {
                  const val = e.target.value;
                  setDepartment(val);
                  setVisibleCount(PAGE_SIZE);
                  if (val) {
                    router.push(`/?department=${encodeURIComponent(val)}`, { scroll: false });
                  } else {
                    router.push("/", { scroll: false });
                  }
                }}
                className="w-full px-3 py-2 bg-white border border-[#e2ddd5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5234]/30"
              >
                <option value="">All Departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Reviews
              </label>
              <select
                value={reviewFilter}
                onChange={(e) => {
                  setReviewFilter(e.target.value as "all" | "has-reviews");
                  setVisibleCount(PAGE_SIZE);
                }}
                className="w-full px-3 py-2 bg-white border border-[#e2ddd5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5234]/30"
              >
                <option value="all">All Courses</option>
                <option value="has-reviews">Has Reviews</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Sort By
              </label>
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value as typeof sortBy);
                  setVisibleCount(PAGE_SIZE);
                }}
                className="w-full px-3 py-2 bg-white border border-[#e2ddd5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5234]/30"
              >
                <option value="reviews">Most Reviews</option>
                <option value="quality">Highest Quality</option>
                <option value="difficulty">Lowest Difficulty</option>
                <option value="recent">Most Recent</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Min Quality: {minQuality.toFixed(1)}
              </label>
              <input
                type="range"
                min={1}
                max={5}
                step={0.5}
                value={minQuality}
                onChange={(e) => {
                  setMinQuality(parseFloat(e.target.value));
                  setVisibleCount(PAGE_SIZE);
                }}
                className="w-full accent-[#2d5234]"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Max Difficulty: {maxDifficulty.toFixed(1)}
              </label>
              <input
                type="range"
                min={1}
                max={5}
                step={0.5}
                value={maxDifficulty}
                onChange={(e) => {
                  setMaxDifficulty(parseFloat(e.target.value));
                  setVisibleCount(PAGE_SIZE);
                }}
                className="w-full accent-[#2d5234]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        <p className="text-sm text-gray-500 mb-4">
          {filtered.length} course{filtered.length !== 1 ? "s" : ""} found
        </p>

        <div className="space-y-3">
          {visible.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
            />
          ))}
        </div>

        {visibleCount < filtered.length && (
          <button
            onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
            className="w-full mt-6 py-2.5 bg-white border border-[#e2ddd5] rounded-lg text-sm font-medium text-gray-600 hover:bg-[#f7f5f0] transition-colors"
          >
            Show More ({filtered.length - visibleCount} remaining)
          </button>
        )}
      </div>

    </>
  );
}
