"use client";

import { useState } from "react";
import Link from "next/link";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";
import { isAllowedEmail, ALLOWED_DOMAINS } from "@/lib/auth-domains";

const DOMAIN_HINT = ALLOWED_DOMAINS.map((d) => `@${d}`).join(" or ");

type Step = "email" | "code";
// Which Clerk flow the emailed code belongs to — a returning user verifies a
// sign-in factor, a brand-new user verifies their sign-up email.
type Mode = "signIn" | "signUp";

export default function LoginPage() {
  const { isLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { signUp, setActive: setSignUpActive } = useSignUp();

  const [step, setStep] = useState<Step>("email");
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const address = email.trim().toLowerCase();

    // Block non-WashU addresses up front — no code is ever sent.
    if (!isAllowedEmail(address)) {
      setError(`Please use your ${DOMAIN_HINT} email address.`);
      return;
    }
    if (!isLoaded || !signIn || !signUp) return;

    setLoading(true);
    try {
      // Returning user: send a code to verify their existing account.
      const si = await signIn.create({ identifier: address });
      const factor = si.supportedFirstFactors?.find(
        (f) => f.strategy === "email_code"
      );
      const emailAddressId =
        factor && "emailAddressId" in factor ? factor.emailAddressId : undefined;
      if (!emailAddressId) {
        throw new Error("Email code sign-in is not enabled for this account.");
      }
      await signIn.prepareFirstFactor({
        strategy: "email_code",
        emailAddressId,
      });
      setMode("signIn");
      setStep("code");
    } catch (err: unknown) {
      // New user (no account yet): create one and send a sign-up code.
      if (isIdentifierNotFound(err)) {
        try {
          await signUp.create({ emailAddress: address });
          await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
          setMode("signUp");
          setStep("code");
        } catch (signUpErr: unknown) {
          setError(clerkMessage(signUpErr));
        }
      } else {
        setError(clerkMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!isLoaded || !signIn || !signUp) return;

    const trimmed = code.trim();
    if (trimmed.length === 0) {
      setError("Enter the code from your email.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "signIn") {
        const res = await signIn.attemptFirstFactor({
          strategy: "email_code",
          code: trimmed,
        });
        if (res.status === "complete") {
          await setSignInActive({ session: res.createdSessionId });
          window.location.href = "/";
          return;
        }
        setError("That code didn't complete sign-in. Please try again.");
      } else {
        const res = await signUp.attemptEmailAddressVerification({
          code: trimmed,
        });
        if (res.status === "complete") {
          await setSignUpActive({ session: res.createdSessionId });
          window.location.href = "/";
          return;
        }
        setError("That code didn't complete sign-in. Please try again.");
      }
    } catch (err: unknown) {
      setError(clerkMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function resetToEmail() {
    setStep("email");
    setCode("");
    setError("");
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="block text-center text-sm text-primary mb-8 hover:underline"
        >
          &larr; Back to courses
        </Link>

        <div className="bg-surface rounded-xl border border-border p-8">
          {step === "email" ? (
            <form onSubmit={handleSendCode}>
              <h1
                className="text-2xl font-semibold mb-2 text-center"
                style={{ fontFamily: "'Source Serif 4', serif" }}
              >
                Sign in
              </h1>
              <p className="text-sm text-muted-strong mb-6 text-center">
                Enter your WashU email and we&apos;ll send you a verification
                code — no password needed.
              </p>

              <label
                htmlFor="email"
                className="block text-sm font-medium text-secondary mb-1.5"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`you${DOMAIN_HINT.split(" ")[0]}`}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                required
              />

              {error && <p className="text-sm text-danger mt-3">{error}</p>}

              <button
                type="submit"
                disabled={loading || !isLoaded}
                className="w-full mt-5 py-2.5 bg-primary text-surface-foreground rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                {loading ? "Sending code..." : "Send code"}
              </button>

              <p className="text-center text-xs text-muted-strong mt-4">
                Only {DOMAIN_HINT} addresses can sign in.
              </p>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode}>
              <h1
                className="text-2xl font-semibold mb-2 text-center"
                style={{ fontFamily: "'Source Serif 4', serif" }}
              >
                Enter your code
              </h1>
              <p className="text-sm text-muted-strong mb-6 text-center">
                We sent a verification code to{" "}
                <span className="font-medium">{email.trim().toLowerCase()}</span>.
              </p>

              <label
                htmlFor="code"
                className="block text-sm font-medium text-secondary mb-1.5"
              >
                Verification code
              </label>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                autoFocus
                className="w-full px-3 py-2 border border-border rounded-lg text-sm tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-primary/30"
                required
              />

              {error && <p className="text-sm text-danger mt-3">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-5 py-2.5 bg-primary text-surface-foreground rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Verify & continue"}
              </button>

              <button
                type="button"
                onClick={resetToEmail}
                className="w-full mt-3 text-center text-xs text-muted-strong hover:underline"
              >
                Use a different email
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// Clerk throws a structured error when the identifier has no existing account.
function isIdentifierNotFound(err: unknown): boolean {
  return clerkErrorCode(err) === "form_identifier_not_found";
}

function clerkErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "errors" in err) {
    const errors = (err as { errors?: Array<{ code?: string }> }).errors;
    return errors?.[0]?.code;
  }
  return undefined;
}

function clerkMessage(err: unknown): string {
  if (err && typeof err === "object" && "errors" in err) {
    const errors = (err as { errors?: Array<{ message?: string }> }).errors;
    if (errors?.[0]?.message) return errors[0].message;
  }
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Please try again.";
}
