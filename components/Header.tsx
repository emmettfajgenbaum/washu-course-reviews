import Link from "next/link";
import UserMenu from "@/components/UserMenu";

export default function Header({ userEmail }: { userEmail: string | null }) {
  return (
    <header className="bg-[#2d5234] text-white px-4 py-5">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <Link
          href="/"
          className="truncate font-serif text-xl font-semibold tracking-tight sm:text-3xl"
          style={{ transform: "scaleY(1.18)", transformOrigin: "left center" }}
        >
          WashU Course Reviews
        </Link>
        {userEmail ? (
          <UserMenu email={userEmail} />
        ) : (
          <Link
            href="/auth/login"
            className="text-sm bg-white/15 hover:bg-white/25 px-4 py-1.5 rounded-lg transition-colors"
          >
            Sign In
          </Link>
        )}
      </div>
    </header>
  );
}
