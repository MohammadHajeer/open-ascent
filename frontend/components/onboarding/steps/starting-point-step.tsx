"use client";

import { Controller, useFormContext, useWatch } from "react-hook-form";

import { OnboardingSelect } from "@/components/onboarding/onboarding-select";
import type { MovementChoice } from "@/components/onboarding/types";
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
import type { OnboardingValues } from "@/lib/validations/onboarding";

const stages = [
  { value: "unknown", label: "Not sure yet" },
  { value: "new", label: "Starting" },
  { value: "building", label: "Building" },
  { value: "established", label: "Established" },
];

export function StartingPointStep({ skillMovements }: { skillMovements: MovementChoice[] }) {
  const { control } = useFormContext<OnboardingValues>();
  const skillMovementId = useWatch({ control, name: "skill_movement_id" });

  return (
    <FieldGroup className="gap-7">
      <OnboardingSelect
        name="training_experience"
        label="Overall training experience"
        options={[
          { value: "unknown", label: "Not sure yet" },
          { value: "new", label: "New to calisthenics" },
          { value: "some", label: "Some regular practice" },
          { value: "regular", label: "Regular experience" },
        ]}
      />

      <FieldSet>
        <FieldLegend variant="label">Best clean reps you can report</FieldLegend>
        <FieldDescription>
          Leave blank if you are not sure. Enter 0 if you have tried and cannot
          complete one. These are self-reported, not measured results.
        </FieldDescription>
        <div className="grid gap-4 sm:grid-cols-3">
          {([ ["pull_up", "Pull-ups"], ["push_up", "Push-ups"], ["dips", "Dips"] ] as const).map(([name, label]) => (
            <Controller
              key={name}
              control={control}
              name={name}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={name}>{label}</FieldLabel>
                  <Input {...field} id={name} type="number" min={0} max={500} className="h-12" placeholder="Not sure" aria-invalid={fieldState.invalid} />
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
          ))}
        </div>
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">Current stage by training dimension</FieldLegend>
        <FieldDescription>A quick self-description. Choose “Not sure yet” wherever it fits.</FieldDescription>
        <div className="grid gap-4 sm:grid-cols-2">
          {([ ["pulling", "Pulling"], ["pushing", "Pushing"], ["core", "Core"], ["balance", "Balance"], ["statics", "Static holds"] ] as const).map(([name, label]) => (
            <OnboardingSelect key={name} name={name} label={label} options={stages} />
          ))}
        </div>
      </FieldSet>

      {skillMovements.length ? (
        <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
          <OnboardingSelect
            name="skill_movement_id"
            label="Skill progression (optional)"
            emptyLabel="None selected"
            options={skillMovements.map((movement) => ({ value: movement.id, label: movement.name }))}
          />
          {skillMovementId ? (
            <OnboardingSelect
              name="skill_stage"
              label="Current stage"
              options={[
                { value: "unknown", label: "Not sure yet" },
                { value: "not_started", label: "Not started" },
                { value: "practicing", label: "Practicing" },
                { value: "achieved", label: "Achieved, self-reported" },
              ]}
            />
          ) : null}
        </div>
      ) : null}

      <p className="rounded-xl bg-primary-light px-4 py-3 text-xs leading-5 text-foreground-mid">
        Your profile is provisional. It does not determine movement readiness or
        replace current safety guidance.
      </p>
    </FieldGroup>
  );
}
