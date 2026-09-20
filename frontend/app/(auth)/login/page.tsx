import type { Metadata } from "next";
import { LockKeyhole } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to Open Ascent for movement analysis and training progress.",
};

export default function LoginPage() {
  return (
    <div className="w-full max-w-115">
      <Badge variant="secondary">
        <LockKeyhole aria-hidden="true" /> Athlete access
      </Badge>
      <h1 className="mt-5 text-[clamp(3.2rem,7vw,5.6rem)] leading-[0.88] font-medium tracking-[-0.07em] text-foreground">
        Welcome back.
      </h1>
      <p className="mt-5 max-w-md text-sm leading-6 text-foreground-soft sm:text-base sm:leading-7">
        Sign in to access Live Coach, saved analyses, and your training
        progress.
      </p>
      <LoginForm />
    </div>
  );
}
