"use client";

import { Controller, useFormContext } from "react-hook-form";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { MovementChoice } from "@/components/onboarding/types";
import type { OnboardingValues } from "@/lib/validations/onboarding";

const goals = [
  { value: "strength", label: "Build strength", detail: "Make foundational movements stronger." },
  { value: "skill", label: "Develop a skill", detail: "Work toward a specific progression." },
  { value: "technique", label: "Improve technique", detail: "Move with more control and clarity." },
  { value: "consistency", label: "Train consistently", detail: "Build a reliable practice." },
] as const;

const equipmentChoices = [
  { value: "pull_up_bar", label: "Pull-up bar" },
  { value: "dip_bars", label: "Dip bars" },
  { value: "rings", label: "Rings" },
  { value: "none", label: "None" },
  { value: "unknown", label: "Not sure yet" },
] as const;

function nextEquipment(
  current: OnboardingValues["equipment"],
  value: OnboardingValues["equipment"][number],
): OnboardingValues["equipment"] {
  if (value === "none" || value === "unknown") return [value];
  const specific = current.filter((item) => item !== "none" && item !== "unknown");
  const next = specific.includes(value)
    ? specific.filter((item) => item !== value)
    : [...specific, value];
  return next.length ? next : ["unknown"];
}

export function TrainingContextStep({
  email,
  avoidanceMovements,
}: {
  email: string | null;
  avoidanceMovements: MovementChoice[];
}) {
  const { control } = useFormContext<OnboardingValues>();

  return (
    <FieldGroup className="gap-7">
      {email ? (
        <p className="border-b border-border pb-4 text-xs text-foreground-faint">
          Verified account <span className="ml-2 font-medium text-foreground-mid">{email}</span>
        </p>
      ) : null}

      <Controller
        control={control}
        name="display_name"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>Name</FieldLabel>
            <Input {...field} id={field.name} autoComplete="name" placeholder="Your name" className="h-12" aria-invalid={fieldState.invalid} />
            {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
          </Field>
        )}
      />

      <Controller
        control={control}
        name="primary_goal"
        render={({ field, fieldState }) => (
          <FieldSet>
            <FieldLegend variant="label">Primary goal</FieldLegend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Primary goal" aria-invalid={fieldState.invalid}>
              {goals.map((goal, index) => (
                <label
                  key={goal.value}
                  className="cursor-pointer rounded-xl border border-border bg-background/45 p-4 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary-light/70 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 hover:border-primary/50"
                >
                  <input
                    ref={index === 0 ? field.ref : undefined}
                    type="radio"
                    name={field.name}
                    value={goal.value}
                    checked={field.value === goal.value}
                    onChange={() => field.onChange(goal.value)}
                    onBlur={field.onBlur}
                    className="sr-only"
                  />
                  <span className="block text-sm font-medium text-foreground">{goal.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-foreground-soft">{goal.detail}</span>
                </label>
              ))}
            </div>
            {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
          </FieldSet>
        )}
      />

      <Controller
        control={control}
        name="equipment"
        render={({ field, fieldState }) => (
          <FieldSet>
            <FieldLegend variant="label">Equipment available</FieldLegend>
            <div className="flex flex-wrap gap-2">
              {equipmentChoices.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={field.value.includes(value)}
                  onClick={() => field.onChange(nextEquipment(field.value, value))}
                  className={`min-h-11 rounded-full border px-4 text-xs font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${field.value.includes(value) ? "border-primary bg-primary-light text-primary" : "border-border text-foreground-soft hover:border-primary/50"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
          </FieldSet>
        )}
      />

      <FieldSet>
        <FieldLegend variant="label">Training availability</FieldLegend>
        <FieldDescription>Leave blank if your schedule varies.</FieldDescription>
        <div className="grid gap-4 sm:grid-cols-2">
          {([ ["days_per_week", "Days per week", 1, 7], ["minutes_per_session", "Minutes per session", 15, 180] ] as const).map(([name, label, min, max]) => (
            <Controller
              key={name}
              control={control}
              name={name}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={name}>{label}</FieldLabel>
                  <Input {...field} id={name} type="number" min={min} max={max} className="h-12" placeholder="Not sure" aria-invalid={fieldState.invalid} />
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
          ))}
        </div>
      </FieldSet>

      {avoidanceMovements.length ? (
        <Controller
          control={control}
          name="avoid_movement_ids"
          render={({ field, fieldState }) => (
            <details className="border-t border-border pt-5">
              <summary className="cursor-pointer text-sm font-medium text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
                Movements you currently avoid <span className="font-normal text-foreground-faint">(optional)</span>
              </summary>
              <p className="mt-2 text-xs leading-5 text-foreground-soft">Leave these out of future suggestions. No medical details are needed.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {avoidanceMovements.map((movement) => (
                  <div key={movement.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`avoid-${movement.id}`}
                      checked={field.value.includes(movement.id)}
                      onCheckedChange={(checked) => field.onChange(
                        checked
                          ? [...field.value, movement.id]
                          : field.value.filter((id) => id !== movement.id),
                      )}
                    />
                    <FieldLabel htmlFor={`avoid-${movement.id}`} className="cursor-pointer text-sm font-normal text-foreground-mid">{movement.name}</FieldLabel>
                  </div>
                ))}
              </div>
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </details>
          )}
        />
      ) : null}
    </FieldGroup>
  );
}
