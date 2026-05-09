"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { CourseWithStats, Review } from "@/lib/types";
import ReviewForm from "./ReviewForm";
import Link from "next/link";

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
  onClose,
}: {
  course: CourseWithStats;
  onClose: () => void;
}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      const [{ data: reviewData }, { data: userData }] = await Promise.all([
        supabase
          .from("reviews")
          .select("*")
          .eq("course_id", course.id)
          .order("created_at", { ascending: false }),
        supabase.auth.getUser(),
      ]);

      setReviews(reviewData || []);
      setUser(userData?.user || null);
      setLoading(false);
    }

    load();
  }, [course.id]);

  const handleNewReview = useCallback((review: Review) => {
    setReviews((prev) => [review, ...prev]);
    setShowForm(false);
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-8 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl border border-[#e2ddd5] w-full max-w-2xl shadow-xl">
        <div className="sticky top-0 bg-white rounded-t-xl border-b border-[#e2ddd5] px-6 py-4 flex items-start justify-between z-10">
          <div>
            <p className="text-xs font-medium text-[#2d5234] tracking-wide uppercase">
              {course.code}
            </p>
            <h2
              className="text-xl font-semibold text-gray-900 mt-0.5"
              style={{ fontFamily: "'Source Serif 4', serif" }}
            >
              {course.name}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none p-1"
          >
            &times;
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Meta info */}
          <div className="flex flex-wrap gap-1.5">
            {course.departments.map((dept) => (
              <span
                key={dept}
                className="text-xs bg-[#f7f5f0] text-gray-600 px-2 py-0.5 rounded-full border border-[#e2ddd5]"
              >
                {dept}
              </span>
            ))}
          </div>

          {course.description && (
            <p className="text-sm text-gray-700 leading-relaxed">
              {course.description}
            </p>
          )}

          {course.instructors.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-500 mb-1">
                Instructors
              </h4>
              <p className="text-sm text-gray-700">
                {course.instructors.join(", ")}
              </p>
            </div>
          )}

          {false && course.last_offered && (
            <p className="text-xs text-gray-400">
              Last offered: {course.last_offered}
            </p>
          )}

          {/* Aggregate stats */}
          {course.review_count > 0 && (
            <div className="flex gap-6 py-3 px-4 bg-[#f7f5f0] rounded-lg">
              <div className="text-center">
                <div
                  className={`text-2xl font-bold ${ratingColor(
                    course.avg_quality
                  )}`}
                >
                  {course.avg_quality?.toFixed(1)}
                </div>
                <div className="text-xs text-gray-500">Quality</div>
              </div>
              <div className="text-center">
                <div
                  className={`text-2xl font-bold ${ratingColor(
                    course.avg_difficulty,
                    true
                  )}`}
                >
                  {course.avg_difficulty?.toFixed(1)}
                </div>
                <div className="text-xs text-gray-500">Difficulty</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-700">
                  {course.review_count}
                </div>
                <div className="text-xs text-gray-500">Reviews</div>
              </div>
            </div>
          )}

          {/* Reviews */}
          <div>
            <h3
              className="text-lg font-semibold mb-3"
              style={{ fontFamily: "'Source Serif 4', serif" }}
            >
              Reviews
            </h3>

            {loading ? (
              <p className="text-sm text-gray-400">Loading reviews...</p>
            ) : reviews.length === 0 ? (
              <p className="text-sm text-gray-400">
                No reviews yet. Be the first!
              </p>
            ) : (
              <div className="space-y-4">
                {reviews.map((review) => (
                  <div
                    key={review.id}
                    className="border border-[#e2ddd5] rounded-lg p-4"
                  >
                    <div className="flex items-center gap-4 text-sm mb-2">
                      <span>
                        Quality:{" "}
                        <span
                          className={`font-semibold ${ratingColor(
                            review.quality
                          )}`}
                        >
                          {review.quality}
                        </span>
                      </span>
                      <span>
                        Difficulty:{" "}
                        <span
                          className={`font-semibold ${ratingColor(
                            review.difficulty,
                            true
                          )}`}
                        >
                          {review.difficulty}
                        </span>
                      </span>
                      {review.instructor && (
                        <span className="text-gray-500">
                          {review.instructor}
                        </span>
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
              </div>
            )}
          </div>

          {/* Review form or sign in prompt */}
          {user ? (
            showForm ? (
              <ReviewForm
                courseId={course.id}
                instructors={course.instructors}
                onSubmit={handleNewReview}
              />
            ) : (
              <button
                onClick={() => setShowForm(true)}
                className="w-full py-2.5 bg-[#2d5234] text-white rounded-lg text-sm font-medium hover:bg-[#234228] transition-colors"
              >
                Write a Review
              </button>
            )
          ) : (
            <Link
              href="/auth/login"
              className="block w-full py-2.5 bg-[#2d5234] text-white rounded-lg text-sm font-medium hover:bg-[#234228] transition-colors text-center"
            >
              Sign in to Review
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
