"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, MailCheck, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function VerifyEmailStatus() {
  const [email, setEmail] = useState("");
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("email");
    requestAnimationFrame(() => setEmail(value?.trim() ?? ""));
  }, []);

  async function resendVerification() {
    if (!email) {
      toast.error("Return to sign up and enter your email again.");
      return;
    }

    setResending(true);

    try {
      const supabase = createClient();
      const emailRedirectTo = `${window.location.origin}/auth/callback?next=/onboarding`;
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo },
      });

      if (error) {
        toast.error(
          "We could not resend the verification email. Try again shortly.",
        );
        return;
      }

      toast.success("Verification email sent again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="mt-8 rounded-[3px_3px_26px_3px] border border-border bg-muted/40 p-5 sm:p-6">
      <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground">
        <MailCheck className="size-4.5" aria-hidden="true" />
      </span>

      <h2 className="mt-5 text-xl font-medium tracking-[-0.035em] text-foreground">
        Check your inbox.
      </h2>

      <p className="mt-2 text-sm leading-6 text-foreground-soft">
        {email ? (
          <>
            We sent a verification link to <strong>{email}</strong>. Open it to
            verify your account and continue to Open Ascent.
          </>
        ) : (
          "Open the verification link in your email to verify your account and continue to Open Ascent."
        )}
      </p>

      <p className="mt-3 text-xs leading-5 text-foreground-faint">
        You can close this page after opening the verification link.
      </p>

      {email ? (
        <Button
          type="button"
          variant="outline"
          className="mt-6 h-12 w-full"
          disabled={resending}
          onClick={resendVerification}
        >
          {resending ? (
            <>
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              Resending…
            </>
          ) : (
            <>
              <RotateCcw className="size-4" />
              Resend verification email
            </>
          )}
        </Button>
      ) : null}
    </div>
  );
}
