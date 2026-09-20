"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, MailCheck, MoveRight } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
} from "@/lib/validations/auth";

export function ForgotPasswordForm() {
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
    mode: "onBlur",
  });

  async function onSubmit(values: ForgotPasswordValues) {
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo,
    });

    if (error) {
      toast.error("We could not send the recovery email. Please try again.");
      return;
    }

    setSubmittedEmail(values.email);
    toast.success("Recovery instructions sent.");
  }

  if (submittedEmail) {
    return (
      <div
        className="mt-8 rounded-[3px_3px_26px_3px] border border-border bg-muted/40 p-5 sm:p-6"
        role="status"
      >
        <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground">
          <MailCheck className="size-4.5" aria-hidden="true" />
        </span>

        <span className="mt-5 block font-mono text-[0.55rem] font-semibold tracking-[0.17em] text-primary uppercase">
          Recovery email sent
        </span>

        <h2 className="mt-2.5 text-xl font-medium tracking-[-0.035em] text-foreground">
          Check your inbox.
        </h2>

        <p className="mt-2 text-sm leading-6 text-foreground-soft">
          If an Open Ascent account exists for {submittedEmail}, you’ll receive
          a password recovery link shortly.
        </p>

        <div className="mt-6 grid gap-3">
          <Link
            href="/login"
            className={cn(buttonVariants({ variant: "brand" }), "h-12 w-full")}
          >
            Back to sign in <MoveRight className="size-4" />
          </Link>

          <Button
            type="button"
            variant="ghost"
            className="h-12 w-full"
            onClick={() => {
              setSubmittedEmail(null);
              form.reset();
            }}
          >
            Use another email
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className="mt-8" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup className="gap-5">
        <Controller
          control={form.control}
          name="email"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>Email</FieldLabel>
              <Input
                {...field}
                id={field.name}
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                className="h-12"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Button
          type="submit"
          variant="brand"
          size="lg"
          className="mt-2 h-12 w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? (
            <>
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              Sending instructions…
            </>
          ) : (
            <>
              Send recovery instructions <MoveRight className="size-4" />
            </>
          )}
        </Button>
      </FieldGroup>
    </form>
  );
}
