"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { Review } from "@/lib/types";

export default function ReviewForm({
  courseId,
  instructors,
  onSubmit,
}: {
  courseId: number;
  instructors: string[];
  onSubmit: (review: Review) => void;
}) {
  const [quality, setQuality] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [instructor, setInstructor] = useState("");
  const [customInstructor, setCustomInstructor] = useState("");
  const [hours, setHours] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!quality || !difficulty) {
      setError("Please select quality and difficulty ratings.");
      return;
    }
    if (comment.length < 10) {
      setError("Comment must be at least 10 characters.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("You must be signed in to submit a review.");
      setLoading(false);
      return;
    }

    const { data, error: insertError } = await supabase
      .from("reviews")
      .insert({
        course_id: courseId,
        user_id: user.id,
        quality,
        difficulty,
        instructor: instructor === "__other__" ? customInstructor : instructor,
        hours_per_week: hours,
        comment,
      })
      .select()
      .single();

    setLoading(false);

    if (insertError) {
      if (insertError.code === "23505") {
        setError("You have already reviewed this course.");
      } else {
        setError(insertError.message);
      }
      return;
    }

    onSubmit(data as Review);
    setQuality(null);
    setDifficulty(null);
    setInstructor("");
    setHours("");
    setComment("");
  }

  const ratingButtons = (
    value: number | null,
    setter: (v: number) => void
  ) =>
    [1, 2, 3, 4, 5].map((n) => (
      <button
        key={n}
        type="button"
        onClick={() => setter(n)}
        className={`w-10 h-10 rounded-lg text-sm font-medium transition-colors ${
          value === n
            ? "bg-[#2d5234] text-white"
            : "bg-[#f7f5f0] text-gray-600 hover:bg-[#e2ddd5]"
        }`}
      >
        {n}
      </button>
    ));

  return (
    <form onSubmit={handleSubmit} className="border-t border-[#e2ddd5] pt-5 mt-5">
      <h4
        className="text-lg font-semibold mb-4"
        style={{ fontFamily: "'Source Serif 4', serif" }}
      >
        Write a Review
      </h4>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Quality
          </label>
          <div className="flex gap-2">{ratingButtons(quality, setQuality)}</div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Difficulty
          </label>
          <div className="flex gap-2">
            {ratingButtons(difficulty, setDifficulty)}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Instructor
          </label>
          {instructors.length > 0 ? (
            <>
              <select
                value={instructor === "__other__" ? "__other__" : instructor}
                onChange={(e) => {
                  if (e.target.value === "__other__") {
                    setInstructor("__other__");
                  } else {
                    setInstructor(e.target.value);
                  }
                }}
                className="w-full px-3 py-2 border border-[#e2ddd5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5234]/30"
              >
                <option value="">Select instructor...</option>
                {instructors.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
                <option value="__other__">Other instructor...</option>
              </select>
              {instructor === "__other__" && (
                <input
                  type="text"
                  value={customInstructor}
                  onChange={(e) => setCustomInstructor(e.target.value)}
                  placeholder="Enter instructor name"
                  className="w-full mt-2 px-3 py-2 border border-[#e2ddd5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5234]/30"
                />
              )}
            </>
          ) : (
            <input
              type="text"
              value={instructor}
              onChange={(e) => setInstructor(e.target.value)}
              placeholder="Instructor name"
              className="w-full px-3 py-2 border border-[#e2ddd5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5234]/30"
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Hours per week (optional)
          </label>
          <input
            type="text"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="e.g. 5-10"
            className="w-full px-3 py-2 border border-[#e2ddd5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5234]/30"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Comment
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Write your review (minimum 10 characters)..."
            rows={4}
            className="w-full px-3 py-2 border border-[#e2ddd5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5234]/30 resize-y"
          />
          <p className="text-xs text-gray-400 mt-1">
            {comment.length} / 10 characters minimum
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-[#2d5234] text-white rounded-lg text-sm font-medium hover:bg-[#234228] transition-colors disabled:opacity-50"
        >
          {loading ? "Submitting..." : "Submit Review"}
        </button>
      </div>
    </form>
  );
}
