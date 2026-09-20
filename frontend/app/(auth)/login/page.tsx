import type { Metadata } from "next";
import Link from "next/link";
import { LockKeyhole } from "lucide-react";

import { AuthPanel } from "@/components/auth/auth-panel";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to Open Ascent for movement analysis and training progress.",
};

export default function LoginPage() {
  return (
    <AuthPanel
      icon={LockKeyhole}
      eyebrow="Athlete access"
      title="Welcome back."
      description="Continue your training."
      footer={
        <>
          New to Open Ascent?{" "}
          <Link
            href="/signup"
            className="font-semibold text-foreground transition-colors hover:text-primary"
          >
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthPanel>
  );
}
