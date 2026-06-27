"use client";

import { SignOutButton, useUser } from "@clerk/nextjs";
import Link from "next/link";

export default function DomainErrorPage() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-surface rounded-xl border border-border p-8 text-center">
        <h1
          className="text-2xl font-semibold mb-3"
          style={{ fontFamily: "'Source Serif 4', serif" }}
        >
          WashU email required
        </h1>
        <p className="text-sm text-muted-strong mb-2">
          This site is only available to Washington University in St. Louis
          students. Please sign in with an{" "}
          <span className="font-medium">@wustl.edu</span> or{" "}
          <span className="font-medium">@washu.edu</span> address.
        </p>
        {email && (
          <p className="text-xs text-muted mb-6">
            You&apos;re signed in as <span className="font-mono">{email}</span>.
          </p>
        )}
        <SignOutButton redirectUrl="/">
          <button className="w-full py-2.5 bg-primary text-surface-foreground rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors">
            Sign out
          </button>
        </SignOutButton>
        <Link
          href="/"
          className="block text-xs text-muted-strong hover:underline mt-4"
        >
          Back to courses
        </Link>
      </div>
    </div>
  );
}
