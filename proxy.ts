import { clerkMiddleware, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isAllowedEmail } from "@/lib/auth-domains";

const DOMAIN_ERROR_PATH = "/auth/domain-error";

export const proxy = clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();
  if (!userId) return;

  // Avoid a redirect loop on the error page itself.
  if (req.nextUrl.pathname.startsWith(DOMAIN_ERROR_PATH)) return;

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const email = user.primaryEmailAddress?.emailAddress ?? "";

  if (!isAllowedEmail(email)) {
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
