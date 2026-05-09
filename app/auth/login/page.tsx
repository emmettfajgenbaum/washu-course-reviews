"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!email.endsWith("@wustl.edu")) {
      setError("Please use your @wustl.edu email address.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);

    if (authError) {
      setError(authError.message);
    } else {
      setSent(true);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f5f0] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="block text-center text-sm text-[#2d5234] mb-8 hover:underline"
        >
          &larr; Back to courses
        </Link>
        <div className="bg-white rounded-xl border border-[#e2ddd5] p-8">
          <h1
            className="text-2xl font-semibold text-center mb-2"
            style={{ fontFamily: "'Source Serif 4', serif" }}
          >
            Sign In
          </h1>
          <p className="text-center text-sm text-gray-500 mb-6">
            Use your WashU email to sign in with a magic link.
          </p>

          {sent ? (
            <div className="text-center">
              <div className="text-[#2d5234] font-medium mb-2">
                Check your email!
              </div>
              <p className="text-sm text-gray-500">
                We sent a magic link to <strong>{email}</strong>. Click the link
                in the email to sign in.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="yourname@wustl.edu"
                required
                className="w-full px-3 py-2 border border-[#e2ddd5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5234]/30 focus:border-[#2d5234]"
              />
              {error && (
                <p className="text-red-600 text-sm mt-2">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-4 py-2.5 bg-[#2d5234] text-white rounded-lg text-sm font-medium hover:bg-[#234228] transition-colors disabled:opacity-50"
              >
                {loading ? "Sending..." : "Send Magic Link"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
