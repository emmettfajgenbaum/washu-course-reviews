"use client";

import { useState } from "react";
import { submitFeedback } from "@/app/actions/feedback";

export default function Footer() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setError("");
    const res = await submitFeedback({ message, email: email || undefined });
    if (res.ok) {
      setStatus("success");
      setMessage("");
      setEmail("");
    } else {
      setStatus("error");
      setError(res.error);
    }
  }

  return (
    <footer className="border-t border-[#e2ddd5] bg-[#f7f5f0] mt-8">
      <div className="max-w-4xl mx-auto w-full px-4 py-6">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2 text-sm font-medium text-[#2d5234] hover:underline"
        >
          <span>{open ? "–" : "+"}</span>
          Send feedback or a feature request
        </button>

        {open && (
          <div className="mt-4">
            {status === "success" ? (
              <div className="text-sm text-[#2d5234] bg-white border border-[#e2ddd5] rounded-lg p-4">
                Thanks! Your feedback has been recorded.
                <button
                  type="button"
                  className="ml-3 text-xs text-gray-500 hover:underline"
                  onClick={() => setStatus("idle")}
                >
                  Send another
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What could we improve? Any features you'd like to see?"
                  required
                  minLength={5}
                  maxLength={5000}
                  rows={4}
                  className="w-full px-3 py-2 border border-[#e2ddd5] rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5234]/40 resize-y"
                />
                <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email (optional, for replies)"
                    className="flex-1 px-3 py-2 border border-[#e2ddd5] rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5234]/40"
                  />
                  <button
                    type="submit"
                    disabled={status === "submitting" || message.trim().length < 5}
                    className="px-4 py-2 bg-[#2d5234] text-white text-sm font-medium rounded-lg hover:bg-[#244226] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {status === "submitting" ? "Sending…" : "Send feedback"}
                  </button>
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
              </form>
            )}
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">
          Not affiliated with Washington University in St. Louis.
        </p>
      </div>
    </footer>
  );
}
