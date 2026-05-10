"use client";

import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

export default function UserMenu({ email }: { email: string }) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-white/70">{email}</span>
      <button
        onClick={handleSignOut}
        className="text-sm bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg transition-colors"
      >
        Sign Out
      </button>
    </div>
  );
}
