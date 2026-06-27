"use client";

import { SignOutButton, useUser } from "@clerk/nextjs";
import Link from "next/link";

export default function DomainErrorPage() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress;

  return (
    <div className="min-h-screen bg-[#f7f5f0] flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-xl border border-[#e2ddd5] p-8 text-center">
        <h1
          className="text-2xl font-semibold mb-3"
          style={{ fontFamily: "'Source Serif 4', serif" }}
        >
          WashU email required
        </h1>
        <p className="text-sm text-gray-600 mb-2">
          This site is only available to Washington University in St. Louis
          students. Please sign in with an{" "}
          <span className="font-medium">@wustl.edu</span> or{" "}
          <span className="font-medium">@washu.edu</span> address.
        </p>
        {email && (
          <p className="text-xs text-gray-400 mb-6">
            You&apos;re signed in as <span className="font-mono">{email}</span>.
          </p>
        )}
        <SignOutButton redirectUrl="/">
          <button className="w-full py-2.5 bg-[#2d5234] text-white rounded-lg text-sm font-medium hover:bg-[#234228] transition-colors">
            Sign out
          </button>
        </SignOutButton>
        <Link
          href="/"
          className="block text-xs text-gray-500 hover:underline mt-4"
        >
          Back to courses
        </Link>
      </div>
    </div>
  );
}
