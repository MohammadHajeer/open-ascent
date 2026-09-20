import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Reset password",
  description:
    "Reset your Open Ascent account password.",
};

export default function ForgotPasswordPage() {
  return (
    <div className="w-full max-w-115">
      <Badge variant="secondary">
        <KeyRound aria-hidden="true" /> Account recovery
      </Badge>
      <h1 className="mt-5 text-[clamp(3.1rem,7vw,5.4rem)] leading-[0.88] font-medium tracking-[-0.07em] text-foreground">
        Reset your password.
      </h1>
      <p className="mt-5 max-w-md text-sm leading-6 text-foreground-soft sm:text-base sm:leading-7">
        Enter your account email to reset your password.
      </p>
      <ForgotPasswordForm />
    </div>
  );
}
