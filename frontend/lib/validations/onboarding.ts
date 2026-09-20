import { z } from "zod";

const optionalNumber = (min: number, max: number) =>
  z.string().refine(
    (value) =>
      value === "" ||
      (/^\d+$/.test(value) && Number(value) >= min && Number(value) <= max),
    `Enter a number from ${min} to ${max}, or leave blank if you're not sure yet.`,
  );

export const onboardingSchema = z.object({
  acknowledged: z.boolean().refine((value) => value, "Acknowledge the guidance to continue."),
  display_name: z.string().trim().min(2, "Enter your name.").max(80),
  primary_goal: z.enum(["strength", "skill", "technique", "consistency"]),
  equipment: z.array(z.enum(["pull_up_bar", "dip_bars", "rings", "none", "unknown"])).min(1, "Choose your available equipment."),
  days_per_week: optionalNumber(1, 7),
  minutes_per_session: optionalNumber(15, 180),
  avoid_movement_ids: z.array(z.uuid()),
  training_experience: z.enum(["new", "some", "regular", "unknown"]),
  pull_up: optionalNumber(0, 500),
  push_up: optionalNumber(0, 500),
  dips: optionalNumber(0, 500),
  pulling: z.enum(["new", "building", "established", "unknown"]),
  pushing: z.enum(["new", "building", "established", "unknown"]),
  core: z.enum(["new", "building", "established", "unknown"]),
  balance: z.enum(["new", "building", "established", "unknown"]),
  statics: z.enum(["new", "building", "established", "unknown"]),
  skill_movement_id: z.string(),
  skill_stage: z.enum(["not_started", "practicing", "achieved", "unknown"]),
});

export type OnboardingValues = z.infer<typeof onboardingSchema>;

export function onboardingPayload(values: OnboardingValues, safetyVersion: string) {
  const count = (value: string) => value === "" ? null : Number(value);
  return {
    display_name: values.display_name.trim(),
    coaching_context: {
      primary_goal: values.primary_goal,
      equipment: values.equipment,
      availability: {
        days_per_week: count(values.days_per_week),
        minutes_per_session: count(values.minutes_per_session),
      },
      avoid_movement_ids: values.avoid_movement_ids,
    },
    assessment: {
      training_experience: values.training_experience,
      max_clean_reps: {
        pull_up: count(values.pull_up),
        push_up: count(values.push_up),
        dips: count(values.dips),
      },
      dimension_stage: {
        pulling: values.pulling,
        pushing: values.pushing,
        core: values.core,
        balance: values.balance,
        statics: values.statics,
      },
      skill_progression: values.skill_movement_id
        ? { movement_id: values.skill_movement_id, stage: values.skill_stage }
        : null,
    },
    safety: { version: safetyVersion, acknowledged: true as const },
  };
}
