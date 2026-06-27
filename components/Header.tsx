import Link from "next/link";
import Image from "next/image";
import UserMenu from "@/components/UserMenu";

export default function Header({ userEmail }: { userEmail: string | null }) {
  return (
    <header className="border-b border-border bg-cream text-slate">
      <div className="h-2 w-full bg-primary" />
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6 sm:py-6">
        <Link
          href="/"
          className="group flex min-w-0 items-center gap-2 sm:gap-3"
        >
          <Image
            src="/washu-circle-logo.png"
            alt="WashU"
            width={44}
            height={44}
            priority
            className="h-9 w-9 shrink-0 rounded-full sm:h-11 sm:w-11"
          />
          <span
            className="truncate font-serif text-xl font-semibold tracking-tight text-slate sm:text-3xl"
            style={{ transform: "scaleY(1.18)", transformOrigin: "left center" }}
          >
            WashU Course Reviews
          </span>
        </Link>
        {userEmail ? (
          <UserMenu email={userEmail} />
        ) : (
          <Link
            href="/auth/login"
            className="shrink-0 rounded-lg bg-primary px-4 py-1.5 text-sm text-white transition-colors hover:bg-primary-hover"
          >
            Sign In
          </Link>
        )}
      </div>
    </header>
  );
}
