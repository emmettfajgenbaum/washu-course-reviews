import { clerkMiddleware, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Allowed sign-in domains. Enforced in two places (defense in depth):
//   1. Here — signed-in users with a wrong-domain email are redirected to
//      /auth/domain-error before any page renders.
//   2. app/actions/reviews.ts (submitReview) — server-side write rejection.
// Keep both lists in sync.
const ALLOWED_DOMAINS = ["wustl.edu", "washu.edu"];
const DOMAIN_ERROR_PATH = "/auth/domain-error";

export const proxy = clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();
  if (!userId) return;

  // Avoid a redirect loop on the error page itself.
  if (req.nextUrl.pathname.startsWith(DOMAIN_ERROR_PATH)) return;

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const email = user.primaryEmailAddress?.emailAddress?.toLowerCase() ?? "";
  const domain = email.split("@")[1] ?? "";

  if (!ALLOWED_DOMAINS.includes(domain)) {
    const url = req.nextUrl.clone();
    url.pathname = DOMAIN_ERROR_PATH;
    url.search = "";
    return NextResponse.redirect(url);
  }
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    "/(api|trpc)(.*)",
  ],
};
