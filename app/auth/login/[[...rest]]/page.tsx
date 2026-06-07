import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#f7f5f0] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="block text-center text-sm text-[#2d5234] mb-8 hover:underline"
        >
          &larr; Back to courses
        </Link>
        <div className="flex justify-center">
          <SignIn
            routing="path"
            path="/auth/login"
            signUpUrl="/auth/login"
            appearance={{
              variables: {
                colorPrimary: "#2d5234",
                fontFamily: "'DM Sans', system-ui, sans-serif",
                borderRadius: "0.5rem",
              },
              elements: {
                card: "shadow-none border border-[#e2ddd5] rounded-xl",
                headerTitle: "font-semibold",
              },
            }}
          />
        </div>
        <p className="text-center text-xs text-gray-500 mt-4">
          Sign in with your @wustl.edu or @washu.edu email.
        </p>
      </div>
    </div>
  );
}
