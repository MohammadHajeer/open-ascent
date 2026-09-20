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
        className="mt-8 rounded-[3px_3px_26px_3px] border border-border bg-muted/40 p-5 sm:p-6"
        role="status"
      >
        <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground">
          <ShieldCheck className="size-4.5" aria-hidden="true" />
        </span>

        <span className="mt-5 block font-mono text-[0.55rem] font-semibold tracking-[0.17em] text-primary uppercase">
          Registration unavailable
        </span>

        <h2 className="mt-2.5 text-xl font-medium tracking-[-0.035em] text-foreground">
          No account was created.
        </h2>

        <p className="mt-2 text-sm leading-6 text-foreground-soft">
          Registration is not connected yet.
        </p>

        <Link
          href="/login"
          className={cn(
            buttonVariants({ variant: "brand" }),
            "mt-6 h-12 w-full",
          )}
        >
          Continue to sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="mt-8" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup className="gap-5">
        {submissionState === "error" ? (
          <Alert className="mb-1">
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
                className="h-12"
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
                className="h-12"
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
                className="h-12"
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
              Creating account…
            </>
          ) : (
            <>
              Create account <MoveRight className="size-4" />
            </>
          )}
        </Button>
      </FieldGroup>
    </form>
  );
}
