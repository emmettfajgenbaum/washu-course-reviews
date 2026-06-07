"use client";

import { useClerk } from "@clerk/nextjs";

export default function UserMenu({ email }: { email: string }) {
  const { signOut } = useClerk();

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-white/70">{email}</span>
      <button
        onClick={() => signOut({ redirectUrl: "/" })}
        className="text-sm bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg transition-colors"
      >
        Sign Out
      </button>
    </div>
  );
}
