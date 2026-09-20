import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, KeyRound } from "lucide-react";

import { AuthPanel } from "@/components/auth/auth-panel";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Reset your Open Ascent account password.",
};

export default function ForgotPasswordPage() {
  return (
    <AuthPanel
      icon={KeyRound}
      eyebrow="Account recovery"
      title="Reset your password."
      description="We’ll send recovery instructions to your email."
      footer={
        <Link
          href="/login"
          className="inline-flex items-center gap-2 font-semibold text-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthPanel>
  );
}
