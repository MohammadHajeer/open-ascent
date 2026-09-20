"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, MailCheck, MoveRight } from "lucide-react";
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
        className="mt-8 rounded-[3px_3px_26px_3px] border border-border bg-muted/40 p-5 sm:p-6"
        role="status"
      >
        <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground">
          <MailCheck className="size-4.5" aria-hidden="true" />
        </span>

        <span className="mt-5 block font-mono text-[0.55rem] font-semibold tracking-[0.17em] text-primary uppercase">
          Reset unavailable
        </span>

        <h2 className="mt-2.5 text-xl font-medium tracking-[-0.035em] text-foreground">
          No email was sent.
        </h2>

        <p className="mt-2 text-sm leading-6 text-foreground-soft">
          Password reset is not connected yet.
        </p>

        <div className="mt-6 grid gap-3">
          <Link
            href="/login"
            className={cn(buttonVariants({ variant: "brand" }), "h-12 w-full")}
          >
            Back to sign in <MoveRight className="size-4" />
          </Link>

          <Button
            variant="ghost"
            className="h-12 w-full"
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
              Preparing instructions…
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
