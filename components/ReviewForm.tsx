"use client";

import { useState } from "react";
import { submitReview } from "@/app/actions/reviews";
import type { Review } from "@/lib/types";

export default function ReviewForm({
  courseId,
  instructors,
  onSubmit,
  onCancel,
}: {
  courseId: number;
  instructors: string[];
  onSubmit: (review: Review) => void;
  onCancel?: () => void;
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

    // Normalize instructor name: if user typed a partial/last name that matches
    // an existing instructor, use the full name instead
    let finalInstructor = instructor === "__other__" ? customInstructor.trim() : instructor;
    if (finalInstructor && instructors.length > 0) {
      const lower = finalInstructor.toLowerCase();
      const match = instructors.find((i) => {
        const parts = i.toLowerCase().split(" ");
        const lastName = parts[parts.length - 1];
        return lastName === lower || i.toLowerCase() === lower;
      });
      if (match) finalInstructor = match;
    }

    const result = await submitReview({
      courseId,
      quality,
      difficulty,
      instructor: finalInstructor,
      hours_per_week: hours,
      comment,
    });

    setLoading(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    onSubmit(result.review);
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
            ? "bg-primary text-surface-foreground"
            : "bg-background text-muted-strong hover:bg-border"
        }`}
      >
        {n}
      </button>
    ));

  return (
    <form onSubmit={handleSubmit} className="border-t border-border pt-5">
      <h4
        className="text-lg font-semibold mb-4"
        style={{ fontFamily: "'Source Serif 4', serif" }}
      >
        Write a Review
      </h4>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-secondary mb-1.5">
            Quality
          </label>
          <div className="flex gap-2">{ratingButtons(quality, setQuality)}</div>
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary mb-1.5">
            Difficulty
          </label>
          <div className="flex gap-2">
            {ratingButtons(difficulty, setDifficulty)}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary mb-1">
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
                className="w-full px-3 py-2 border border-border rounded-lg text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                  className="w-full mt-2 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              )}
            </>
          ) : (
            <input
              type="text"
              value={instructor}
              onChange={(e) => setInstructor(e.target.value)}
              placeholder="Instructor name"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary mb-1">
            Hours per week (optional)
          </label>
          <input
            type="text"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="e.g. 5-10"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary mb-1">
            Comment
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Write your review (minimum 10 characters)..."
            rows={4}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-2.5 bg-surface border border-border text-secondary rounded-lg text-sm font-medium hover:bg-background transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2.5 bg-primary text-surface-foreground rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {loading ? "Submitting..." : "Submit Review"}
          </button>
        </div>
      </div>
    </form>
  );
}
