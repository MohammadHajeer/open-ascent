import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, KeyRound } from "lucide-react";

import { AuthPanel } from "@/components/auth/auth-panel";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Set a new password",
  description: "Set a new password for your Open Ascent account.",
};

export default function ResetPasswordPage() {
  return (
    <AuthPanel
      icon={KeyRound}
      eyebrow="Account recovery"
      title="Set a new password."
      description="Choose a new password for your Open Ascent account."
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
      <ResetPasswordForm />
    </AuthPanel>
  );
}
