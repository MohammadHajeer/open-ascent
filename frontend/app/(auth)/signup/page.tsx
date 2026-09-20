import type { Metadata } from "next";
import Link from "next/link";
import { UserRoundPlus } from "lucide-react";

import { AuthPanel } from "@/components/auth/auth-panel";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = {
  title: "Create account",
  description:
    "Create your Open Ascent account for movement analysis and training progress.",
};

export default function SignupPage() {
  return (
    <AuthPanel
      icon={UserRoundPlus}
      eyebrow="Athlete account"
      title="Create your account."
      description="Build your training history."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-semibold text-foreground transition-colors hover:text-primary"
          >
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthPanel>
  );
}
