import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, MailCheck } from "lucide-react";

import { AuthPanel } from "@/components/auth/auth-panel";
import { VerifyEmailStatus } from "@/components/auth/verify-email-status";

export const metadata: Metadata = {
  title: "Verify your email",
  description: "Verify your email to access your Open Ascent account.",
};

export default function VerifyEmailPage() {
  return (
    <AuthPanel
      icon={MailCheck}
      eyebrow="Email verification"
      title="Verify your email."
      description="One quick step before your Open Ascent account is ready."
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
      <VerifyEmailStatus />
    </AuthPanel>
  );
}
