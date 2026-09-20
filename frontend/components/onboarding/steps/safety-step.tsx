"use client";

import { Controller, useFormContext } from "react-hook-form";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import type { OnboardingConfig } from "@/components/onboarding/types";
import type { OnboardingValues } from "@/lib/validations/onboarding";

export function SafetyStep({ config }: { config: OnboardingConfig }) {
  const { control } = useFormContext<OnboardingValues>();

  return (
    <div className="space-y-7">
      <div className="border-l-2 border-primary/60 bg-background-alt/40 py-1 pr-4 pl-5 sm:pr-6">
        <span className="font-mono text-[0.58rem] font-semibold tracking-widest text-primary uppercase">
          Global fitness guidance · {config.safety_version}
        </span>
        <div className="mt-4 space-y-3 text-sm leading-6 text-foreground-mid">
          {config.safety_guidance.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </div>
      <Controller
        control={control}
        name="acknowledged"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <div className="flex items-start gap-3">
              <Checkbox
                id={field.name}
                ref={field.ref}
                checked={field.value}
                onCheckedChange={field.onChange}
                onBlur={field.onBlur}
                aria-invalid={fieldState.invalid}
                className="mt-1 size-5"
              />
              <FieldLabel
                htmlFor={field.name}
                className="cursor-pointer text-sm leading-6 font-normal text-foreground"
              >
                I have read this guidance. I understand this records receipt,
                not medical clearance.
              </FieldLabel>
            </div>
            {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
          </Field>
        )}
      />
    </div>
  );
}
