"use server";

import { currentUser } from "@clerk/nextjs/server";
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

  const user = await currentUser();
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";
  const email = (input.email ?? "").trim() || userEmail;

  const supabase = createAdminClient();
  const { error } = await supabase.from("feedback").insert({
    user_id: user?.id ?? null,
    email,
    message,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
