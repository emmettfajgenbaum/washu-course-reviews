"use server";

import { currentUser } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { isAllowedEmail } from "@/lib/auth-domains";
import type { Review } from "@/lib/types";

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

  const email = user.primaryEmailAddress?.emailAddress ?? "";
  if (!isAllowedEmail(email)) {
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
