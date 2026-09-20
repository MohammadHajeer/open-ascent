import type { Metadata } from "next";
import { UserRoundPlus } from "lucide-react";

import { RegisterForm } from "@/components/auth/register-form";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Create account",
  description:
    "Create your Open Ascent account for movement analysis and training progress.",
};

export default function SignupPage() {
  return (
    <div className="w-full max-w-125 self-start">
      <Badge variant="secondary">
        <UserRoundPlus aria-hidden="true" /> Athlete account
      </Badge>
      <h1 className="mt-5 text-[clamp(3rem,7vw,5.2rem)] leading-[0.88] font-medium tracking-[-0.07em] text-foreground">
        Your training, remembered.
      </h1>
      <p className="mt-5 max-w-md text-sm leading-6 text-foreground-soft sm:text-base sm:leading-7">
        Build your training record with saved analyses and progress over time.
      </p>
      <RegisterForm />
    </div>
  );
}
