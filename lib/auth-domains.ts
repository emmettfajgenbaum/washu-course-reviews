// Allowed sign-in domains. Enforced in several places (defense in depth):
//   1. app/auth/login — the email-link request form refuses to send a magic
//      link to any address outside these domains (blocks up front).
//   2. proxy.ts — signed-in users with a wrong-domain email are redirected to
//      /auth/domain-error before any page renders.
//   3. app/actions/reviews.ts (submitReview) — server-side write rejection.
// This module is the single source of truth; keep all call sites importing it.
export const ALLOWED_DOMAINS = ["wustl.edu", "washu.edu"] as const;

/** Returns the lowercased domain portion of an email, or "" if malformed. */
export function emailDomain(email: string): string {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

/** True only for non-empty @wustl.edu / @washu.edu addresses. */
export function isAllowedEmail(email: string): boolean {
  return (ALLOWED_DOMAINS as readonly string[]).includes(emailDomain(email));
}
