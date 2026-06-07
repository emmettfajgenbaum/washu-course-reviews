"use server";

import { currentUser } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase-admin";
import type { Review } from "@/lib/types";

// Allowed sign-in domains. Enforced in two places (defense in depth):
//   1. proxy.ts — redirects wrong-domain users away from every page.
//   2. Here — server-side write rejection if a wrong-domain user reaches
//      this action anyway (e.g. via a direct fetch).
// Keep both lists in sync.
const ALLOWED_DOMAINS = ["wustl.edu", "washu.edu"];

export type SubmitReviewInput = {
  courseId: number;
  quality: number;
  difficulty: number;
  instructor: string;
  hours_per_week: string;
  comment: string;
};

export type SubmitReviewResult =
  | { ok: true; review: Review }
  | { ok: false; error: string };

export async function submitReview(input: SubmitReviewInput): Promise<SubmitReviewResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "You must be signed in to submit a review." };

  const email = user.primaryEmailAddress?.emailAddress?.toLowerCase() ?? "";
  const domain = email.split("@")[1] ?? "";
  if (!ALLOWED_DOMAINS.includes(domain)) {
    return { ok: false, error: "Reviews are restricted to @wustl.edu and @washu.edu accounts." };
  }

  if (input.quality < 1 || input.quality > 5 || input.difficulty < 1 || input.difficulty > 5) {
    return { ok: false, error: "Quality and difficulty must be between 1 and 5." };
  }
  if (input.comment.trim().length < 10) {
    return { ok: false, error: "Comment must be at least 10 characters." };
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("reviews")
    .insert({
      course_id: input.courseId,
      user_id: user.id,
      quality: input.quality,
      difficulty: input.difficulty,
      instructor: input.instructor,
      hours_per_week: input.hours_per_week,
      comment: input.comment,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "You have already reviewed this course." };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true, review: data as Review };
}
