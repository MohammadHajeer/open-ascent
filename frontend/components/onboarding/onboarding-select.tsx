"use client";

import { Controller, useFormContext } from "react-hook-form";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OnboardingValues } from "@/lib/validations/onboarding";

type SelectName =
  | "training_experience"
  | "pulling"
  | "pushing"
  | "core"
  | "balance"
  | "statics"
  | "skill_movement_id"
  | "skill_stage";

type Option = { value: string; label: string };
const NO_SELECTION = "__none_selected__";

export function OnboardingSelect({
  name,
  label,
  description,
  options,
  emptyLabel,
}: {
  name: SelectName;
  label: string;
  description?: string;
  options: Option[];
  emptyLabel?: string;
}) {
  const { control } = useFormContext<OnboardingValues>();

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <Select
            value={field.value || NO_SELECTION}
            onValueChange={(value) =>
              field.onChange(value === NO_SELECTION ? "" : value ?? "")
            }
          >
            <SelectTrigger
              id={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              aria-invalid={fieldState.invalid}
              className="w-full bg-background/55 px-3 text-sm hover:border-primary/50 data-[size=default]:h-12 dark:bg-input/20"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {emptyLabel ? (
                <SelectItem value={NO_SELECTION} className="min-h-10">
                  {emptyLabel}
                </SelectItem>
              ) : null}
              {options.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="min-h-10"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}
