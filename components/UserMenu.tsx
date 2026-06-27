"use client";

import { useClerk } from "@clerk/nextjs";

export default function UserMenu({ email }: { email: string }) {
  const { signOut } = useClerk();

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-slate/60 sm:inline">{email}</span>
      <button
        onClick={() => signOut({ redirectUrl: "/" })}
        className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-slate transition-colors hover:bg-border"
      >
        Sign Out
      </button>
    </div>
  );
}
