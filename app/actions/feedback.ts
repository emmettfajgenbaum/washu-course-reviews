"use server";

import { createAdminClient } from "@/lib/supabase-admin";

export type SubmitFeedbackInput = {
  message: string;
  email?: string;
};

export type SubmitFeedbackResult =
  | { ok: true }
  | { ok: false; error: string };

export async function submitFeedback(input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> {
  const message = input.message.trim();
  if (message.length < 5) {
    return { ok: false, error: "Feedback must be at least 5 characters." };
  }
  if (message.length > 5000) {
    return { ok: false, error: "Feedback must be 5000 characters or less." };
  }

  // Only store the email the user explicitly typed. Do NOT fall back to the
  // signed-in account's email — users must be able to submit anonymously.
  const email = (input.email ?? "").trim();

  const supabase = createAdminClient();
  const { error } = await supabase.from("feedback").insert({
    email,
    message,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
