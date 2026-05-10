"use client";

import { useState, useCallback, useMemo } from "react";
import type { CourseWithStats, Review } from "@/lib/types";
import ReviewForm from "./ReviewForm";
import Link from "next/link";

const REVIEWS_PER_PAGE = 20;

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

export default function CourseDetail({
  course,
  initialReviews,
  userId,
}: {
  course: CourseWithStats;
  initialReviews: Review[];
  userId: string | null;
}) {
  const [reviews, setReviews] = useState<Review[]>(initialReviews);
  const [showForm, setShowForm] = useState(false);
  const [instructor, setInstructor] = useState("");
  const [visibleCount, setVisibleCount] = useState(REVIEWS_PER_PAGE);

  const handleNewReview = useCallback((review: Review) => {
    setReviews((prev) => [review, ...prev]);
    setShowForm(false);
  }, []);

  // Collect all unique instructors from reviews and course data
  const reviewInstructors = useMemo(() => {
    const set = new Set<string>();
    reviews.forEach((r) => {
      if (r.instructor) set.add(r.instructor);
    });
    return Array.from(set).sort();
  }, [reviews]);

  const allInstructors = useMemo(() => {
    const set = new Set<string>();
    course.instructors.forEach((i) => set.add(i));
    reviews.forEach((r) => {
      if (r.instructor) set.add(r.instructor);
    });
    return Array.from(set).sort();
  }, [course.instructors, reviews]);

  // Filter reviews by selected instructor
  const filteredReviews = useMemo(() => {
    if (!instructor) return reviews;
    return reviews.filter((r) => r.instructor === instructor);
  }, [reviews, instructor]);

  // Compute stats from filtered reviews
  const stats = useMemo(() => {
    const source = filteredReviews.length > 0 ? filteredReviews : reviews;
    if (source.length === 0) {
      return { count: course.review_count, quality: course.avg_quality, difficulty: course.avg_difficulty };
    }
    const count = source.length;
    const quality = source.reduce((s, r) => s + r.quality, 0) / count;
    const difficulty = source.reduce((s, r) => s + r.difficulty, 0) / count;
    return { count, quality: Math.round(quality * 100) / 100, difficulty: Math.round(difficulty * 100) / 100 };
  }, [filteredReviews, reviews, course.review_count, course.avg_quality, course.avg_difficulty]);

  const visible = filteredReviews.slice(0, visibleCount);
  const hasMore = visibleCount < filteredReviews.length;

  return (
    <div className="space-y-6">
      {/* Course header */}
      <div>
        <p className="text-xs font-medium text-[#2d5234] tracking-wide uppercase">
          {course.bulletin_code || course.code.replace(/[A-Z]\d+\s+/g, "")}
        </p>
        <h1
          className="text-2xl font-semibold text-gray-900 mt-1"
          style={{ fontFamily: "'Source Serif 4', serif" }}
        >
          {course.name}
        </h1>
        <div className="flex flex-wrap gap-1.5 mt-3">
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

      {course.description && (
        <p className="text-sm text-gray-700 leading-relaxed">
          {course.description}
        </p>
      )}

      {allInstructors.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-500 mb-1">
            Instructors
          </h4>
          <p className="text-sm text-gray-700">
            {allInstructors.map((inst, i) => (
              <span key={inst}>
                {i > 0 && ", "}
                <Link
                  href={`/instructor/${encodeURIComponent(inst)}`}
                  className="text-[#2d5234] hover:underline"
                >
                  {inst}
                </Link>
              </span>
            ))}
          </p>
        </div>
      )}

      {/* Aggregate stats */}
      {stats.count > 0 && (
        <div className="flex gap-6 py-3 px-4 bg-[#f7f5f0] rounded-lg">
          <div className="text-center">
            <div className={`text-2xl font-bold ${ratingColor(stats.quality)}`}>
              {stats.quality?.toFixed(1)}
            </div>
            <div className="text-xs text-gray-500">Quality</div>
          </div>
          <div className="text-center">
            <div className={`text-2xl font-bold ${ratingColor(stats.difficulty, true)}`}>
              {stats.difficulty?.toFixed(1)}
            </div>
            <div className="text-xs text-gray-500">Difficulty</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-700">
              {stats.count}
            </div>
            <div className="text-xs text-gray-500">
              Reviews
            </div>
          </div>
        </div>
      )}

      {/* Top review button */}
      {!showForm && (
        userId ? (
          <button
            onClick={() => setShowForm(true)}
            className="w-full py-2.5 bg-[#2d5234] text-white rounded-lg text-sm font-medium hover:bg-[#234228] transition-colors"
          >
            Write a Review
          </button>
        ) : (
          <Link
            href="/auth/login"
            className="block w-full py-2.5 bg-[#2d5234] text-white rounded-lg text-sm font-medium hover:bg-[#234228] transition-colors text-center"
          >
            Sign in to Review
          </Link>
        )
      )}

      {/* Reviews section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3
            className="text-lg font-semibold"
            style={{ fontFamily: "'Source Serif 4', serif" }}
          >
            Reviews
          </h3>
          {reviewInstructors.length > 1 && (
            <select
              value={instructor}
              onChange={(e) => {
                setInstructor(e.target.value);
                setVisibleCount(REVIEWS_PER_PAGE);
              }}
              className="px-3 py-1.5 bg-white border border-[#e2ddd5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5234]/30"
            >
              <option value="">All Instructors</option>
              {reviewInstructors.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          )}
        </div>

        {reviews.length === 0 ? (
          <p className="text-sm text-gray-400">
            No reviews yet. Be the first!
          </p>
        ) : filteredReviews.length === 0 ? (
          <p className="text-sm text-gray-400">
            No reviews for this instructor.
          </p>
        ) : (
          <div className="space-y-4">
            {visible.map((review) => (
              <div
                key={review.id}
                className="border border-[#e2ddd5] rounded-lg p-4"
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
                  {review.instructor && (
                    <Link
                      href={`/instructor/${encodeURIComponent(review.instructor)}`}
                      className="text-[#2d5234] hover:underline"
                    >
                      {review.instructor}
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
            ))}

            {hasMore && (
              <button
                onClick={() => setVisibleCount((v) => v + REVIEWS_PER_PAGE)}
                className="w-full py-2.5 bg-white border border-[#e2ddd5] rounded-lg text-sm font-medium text-gray-600 hover:bg-[#f7f5f0] transition-colors"
              >
                Show More ({filteredReviews.length - visibleCount} remaining)
              </button>
            )}
          </div>
        )}
      </div>

      {/* Review form or bottom button (only show if 10+ reviews) */}
      {reviews.length >= 10 && (
        showForm ? (
          <ReviewForm
            courseId={course.id}
            instructors={course.instructors}
            onSubmit={handleNewReview}
          />
        ) : userId ? (
          <button
            onClick={() => setShowForm(true)}
            className="w-full py-2.5 bg-[#2d5234] text-white rounded-lg text-sm font-medium hover:bg-[#234228] transition-colors"
          >
            Write a Review
          </button>
        ) : (
          <Link
            href="/auth/login"
            className="block w-full py-2.5 bg-[#2d5234] text-white rounded-lg text-sm font-medium hover:bg-[#234228] transition-colors text-center"
          >
            Sign in to Review
          </Link>
        )
      )}
    </div>
  );
}
