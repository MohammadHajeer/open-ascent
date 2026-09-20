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
import { createClient } from "@/lib/supabase/client";
import {
  resetPasswordSchema,
  type ResetPasswordValues,
} from "@/lib/validations/auth";

export function ResetPasswordForm() {
  const router = useRouter();
  const [authError, setAuthError] = useState<string | null>(null);

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
    mode: "onBlur",
  });

  async function onSubmit(values: ResetPasswordValues) {
    setAuthError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({
      password: values.password,
    });

    if (error) {
      const message =
        error.message.toLowerCase().includes("session") ||
        error.message.toLowerCase().includes("jwt")
          ? "Your recovery link is invalid or has expired. Request a new one."
          : "We could not update your password. Please try again.";

      setAuthError(message);
      toast.error(message);
      return;
    }

    // Recovery establishes a temporary authenticated session. End it so the
    // user explicitly signs in again using the new password.
    await supabase.auth.signOut();

    toast.success("Password updated. Sign in with your new password.");
    router.replace("/login");
    router.refresh();
  }

  return (
    <form className="mt-8" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup className="gap-5">
        {authError ? (
          <Alert className="mb-1">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>Unable to reset password</AlertTitle>
            <AlertDescription>{authError}</AlertDescription>
          </Alert>
        ) : null}

        <Controller
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>New password</FieldLabel>
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
              <FieldLabel htmlFor={field.name}>Confirm new password</FieldLabel>
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
              Updating password…
            </>
          ) : (
            <>
              Update password <MoveRight className="size-4" />
            </>
          )}
        </Button>
      </FieldGroup>
    </form>
  );
}
