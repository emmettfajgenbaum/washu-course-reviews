"use client";

import { useState, useCallback, useMemo } from "react";
import type { CourseWithStats, Review } from "@/lib/types";
import ReviewForm from "./ReviewForm";
import Link from "next/link";

const REVIEWS_PER_PAGE = 20;

function ratingColor(value: number | null, invert = false) {
  if (value === null) return "text-muted";
  if (invert) {
    if (value < 3) return "text-success";
    if (value < 4) return "text-warning";
    return "text-danger";
  }
  if (value >= 4) return "text-success";
  if (value >= 3) return "text-warning";
  return "text-danger";
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
      {/* Course info card */}
      <div className="bg-surface rounded-xl border border-border p-5 sm:p-6 space-y-5">
        {/* Course header */}
        <div>
          <p className="text-xs font-medium text-primary tracking-wide uppercase">
            {course.bulletin_code || course.code.replace(/[A-Z]\d+\s+/g, "")}
          </p>
          <h1
            className="text-2xl font-semibold text-foreground mt-1"
            style={{ fontFamily: "'Source Serif 4', serif" }}
          >
            {course.name}
          </h1>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {[...new Set(course.departments)].map((dept) => (
              <span
                key={dept}
                className="text-xs bg-background text-muted-strong px-2 py-0.5 rounded-full border border-border"
              >
                {dept}
              </span>
            ))}
          </div>
        </div>

        {course.description && (
          <p className="text-sm text-secondary leading-relaxed">
            {course.description}
          </p>
        )}

        {allInstructors.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-muted-strong mb-1">
              Instructors
            </h4>
            <p className="text-sm text-secondary">
              {allInstructors.map((inst, i) => (
                <span key={inst}>
                  {i > 0 && ", "}
                  <Link
                    href={`/instructor/${encodeURIComponent(inst)}`}
                    className="text-primary hover:underline"
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
          <div className="flex gap-6 py-3 px-4">
            <div className="text-center">
              <div className={`text-2xl font-bold ${ratingColor(stats.quality)}`}>
                {stats.quality?.toFixed(1)}
              </div>
              <div className="text-xs text-muted-strong">Quality</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${ratingColor(stats.difficulty, true)}`}>
                {stats.difficulty?.toFixed(1)}
              </div>
              <div className="text-xs text-muted-strong">Difficulty</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-secondary">
                {stats.count}
              </div>
              <div className="text-xs text-muted-strong">
                Reviews
              </div>
            </div>
          </div>
        )}

        {/* Top review button / inline form */}
        {showForm ? (
          <ReviewForm
            courseId={course.id}
            instructors={allInstructors}
            onSubmit={handleNewReview}
            onCancel={() => setShowForm(false)}
          />
        ) : userId ? (
          <button
            onClick={() => setShowForm(true)}
            className="w-full py-2.5 bg-primary text-surface-foreground rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors"
          >
            Write a Review
          </button>
        ) : (
          <Link
            href="/auth/login"
            className="block w-full py-2.5 bg-primary text-surface-foreground rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors text-center"
          >
            Sign in to Review
          </Link>
        )}
      </div>

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
              className="px-3 py-1.5 bg-surface border border-border rounded-lg text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30"
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
          <p className="text-sm text-muted">
            No reviews yet. Be the first!
          </p>
        ) : filteredReviews.length === 0 ? (
          <p className="text-sm text-muted">
            No reviews for this instructor.
          </p>
        ) : (
          <div className="space-y-4">
            {visible.map((review) => (
              <div
                key={review.id}
                className="bg-surface border border-border rounded-lg p-4"
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
                      className="text-primary hover:underline"
                    >
                      {review.instructor}
                    </Link>
                  )}
                </div>
                {review.hours_per_week && (
                  <p className="text-xs text-muted mb-1">
                    {review.hours_per_week} hrs/week
                  </p>
                )}
                <p className="text-sm text-secondary whitespace-pre-wrap">
                  {review.comment}
                </p>
                <p className="text-xs text-muted mt-2">
                  {new Date(review.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}

            {hasMore && (
              <button
                onClick={() => setVisibleCount((v) => v + REVIEWS_PER_PAGE)}
                className="w-full py-2.5 bg-surface border border-border rounded-lg text-sm font-medium text-muted-strong hover:bg-background transition-colors"
              >
                Show More ({filteredReviews.length - visibleCount} remaining)
              </button>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
