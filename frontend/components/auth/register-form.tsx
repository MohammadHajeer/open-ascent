"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, LoaderCircle, MoveRight } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { PasswordInput } from "@/components/auth/password-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { registerSchema, type RegisterValues } from "@/lib/validations/auth";

export function RegisterForm() {
  const router = useRouter();
  const [authError, setAuthError] = useState<string | null>(null);

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
    setAuthError(null);

    const supabase = createClient();
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=/onboarding`;

    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        emailRedirectTo,
        data: {
          name: values.name.trim(),
        },
      },
    });

    if (error) {
      const message =
        error.message || "We could not create your account. Please try again.";

      setAuthError(message);
      toast.error(message);
      return;
    }

    // Some development Supabase projects disable email confirmation. In that
    // case signUp immediately returns a session and verification is unnecessary.
    if (data.session) {
      toast.success("Your Open Ascent account is ready.");
      router.replace("/onboarding");
      router.refresh();
      return;
    }

    toast.success("Check your inbox to verify your email.");
    router.push(`/verify-email?email=${encodeURIComponent(values.email)}`);
  }

  return (
    <form className="mt-7" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup className="gap-5">
        {authError ? (
          <Alert className="mb-1">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>Unable to create the account</AlertTitle>
            <AlertDescription>{authError}</AlertDescription>
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
          className="mt-3 h-13 w-full font-semibold tracking-[-0.01em]"
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
