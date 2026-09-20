"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, LoaderCircle, MailCheck, MoveRight } from "lucide-react";
import { Controller, useForm } from "react-hook-form";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
} from "@/lib/validations/auth";

export function ForgotPasswordForm() {
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
    mode: "onBlur",
  });

  async function onSubmit() {
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div
        className="mt-8 rounded-[3px_3px_28px_3px] border border-border bg-card p-6 sm:p-8"
        role="status"
      >
        <span className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground">
          <MailCheck className="size-5" aria-hidden="true" />
        </span>
        <span className="mt-7 block font-mono text-[0.57rem] font-semibold tracking-widest text-primary uppercase">
          Reset unavailable
        </span>
        <h2 className="mt-3 text-3xl font-medium tracking-[-0.052em] text-foreground">
          No email was sent.
        </h2>
        <p className="mt-4 text-sm leading-6 text-foreground-soft">
          Password reset is not connected yet.
        </p>
        <div className="mt-7 grid gap-3">
          <Link
            href="/login"
            className={cn(buttonVariants({ variant: "brand" }), "w-full")}
          >
            Back to sign in <MoveRight className="size-4" />
          </Link>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setSubmitted(false);
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
      <FieldGroup className="gap-4">
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
          className="mt-3 w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? (
            <>
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              Preparing instructions…
            </>
          ) : (
            <>
              Send reset instructions <MoveRight className="size-4" />
            </>
          )}
        </Button>

        <Link
          href="/login"
          className="mt-2 flex items-center justify-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" /> Back to sign in
        </Link>
      </FieldGroup>
    </form>
  );
}
