"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { loginSchema, type LoginValues } from "@/lib/validations/auth";

function getSafeNextPath() {
  const next = new URLSearchParams(window.location.search).get("next");

  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/dashboard";
  }

  return next;
}

export function LoginForm() {
  const router = useRouter();
  const [authError, setAuthError] = useState<string | null>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onBlur",
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    const callbackError = url.searchParams.get("auth_error");

    if (!callbackError) {
      return;
    }

    const message =
      "That authentication link is invalid or has expired. Please try again.";

    requestAnimationFrame(() => setAuthError(message));
    toast.error(message);

    url.searchParams.delete("auth_error");
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  async function onSubmit(values: LoginValues) {
    setAuthError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });

    if (error) {
      const message = error.message
        .toLowerCase()
        .includes("email not confirmed")
        ? "Verify your email before signing in."
        : "Check your email and password, then try again.";

      setAuthError(message);
      toast.error(message);
      return;
    }

    toast.success("Signed in to Open Ascent.");
    router.replace(getSafeNextPath());
    router.refresh();
  }

  return (
    <form className="mt-7" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup className="gap-5">
        {authError ? (
          <Alert className="mb-1">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>Unable to sign in</AlertTitle>
            <AlertDescription>{authError}</AlertDescription>
          </Alert>
        ) : null}

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
              <div className="flex items-center justify-between gap-4">
                <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                <Link
                  href="/forgot-password"
                  className="text-xs font-medium text-primary transition-opacity hover:opacity-75"
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                {...field}
                id={field.name}
                autoComplete="current-password"
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
              Signing in…
            </>
          ) : (
            <>
              Sign in <MoveRight className="size-4" />
            </>
          )}
        </Button>
      </FieldGroup>
    </form>
  );
}
