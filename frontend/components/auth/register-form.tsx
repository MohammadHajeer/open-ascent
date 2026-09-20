"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CircleAlert,
  LoaderCircle,
  MoveRight,
  ShieldCheck,
} from "lucide-react";
import { Controller, useForm } from "react-hook-form";

import { PasswordInput } from "@/components/auth/password-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { registerSchema, type RegisterValues } from "@/lib/validations/auth";

type SubmissionState = "idle" | "success" | "error";

export function RegisterForm() {
  const [submissionState, setSubmissionState] =
    useState<SubmissionState>("idle");

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
    mode: "onBlur",
  });

  async function onSubmit(values: RegisterValues) {
    setSubmissionState("idle");
    await new Promise((resolve) => window.setTimeout(resolve, 900));

    if (values.email.toLowerCase() === "coach@error.test") {
      setSubmissionState("error");
      return;
    }

    setSubmissionState("success");
  }

  if (submissionState === "success") {
    return (
      <div
        className="mt-8 rounded-[3px_3px_28px_3px] border border-border bg-card p-6 sm:p-8"
        role="status"
      >
        <span className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </span>
        <span className="mt-7 block font-mono text-[0.57rem] font-semibold tracking-widest text-primary uppercase">
          Registration unavailable
        </span>
        <h2 className="mt-3 text-3xl font-medium tracking-[-0.052em] text-foreground">
          No account was created.
        </h2>
        <p className="mt-4 text-sm leading-6 text-foreground-soft">
          Registration is not connected yet.
        </p>
        <Link
          href="/login"
          className={cn(buttonVariants({ variant: "brand" }), "mt-7 w-full")}
        >
          Continue to sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="mt-8" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup className="gap-4">
        {submissionState === "error" ? (
          <Alert className="mb-5">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>Unable to create the account</AlertTitle>
            <AlertDescription>
              Review your details and try again.
            </AlertDescription>
          </Alert>
        ) : null}

        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>Name</FieldLabel>
              <Input
                {...field}
                id={field.name}
                autoComplete="name"
                placeholder="Your name"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

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

        <Controller
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>Password</FieldLabel>
              <PasswordInput
                {...field}
                id={field.name}
                autoComplete="new-password"
                aria-invalid={fieldState.invalid}
              />
              <FieldDescription>Use at least 8 characters.</FieldDescription>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          control={form.control}
          name="confirmPassword"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>Confirm password</FieldLabel>
              <PasswordInput
                {...field}
                id={field.name}
                autoComplete="new-password"
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
              Creating account…
            </>
          ) : (
            <>
              Create account <MoveRight className="size-4" />
            </>
          )}
        </Button>

        <p className="mt-2 text-center text-sm text-foreground-soft">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-semibold text-foreground hover:text-primary"
          >
            Sign in
          </Link>
        </p>
      </FieldGroup>
    </form>
  );
}
