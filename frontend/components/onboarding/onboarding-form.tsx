"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle } from "lucide-react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";

import { OnboardingProgress, onboardingSteps } from "@/components/onboarding/onboarding-progress";
import { SafetyStep } from "@/components/onboarding/steps/safety-step";
import { StartingPointStep } from "@/components/onboarding/steps/starting-point-step";
import { TrainingContextStep } from "@/components/onboarding/steps/training-context-step";
import type { OnboardingConfig } from "@/components/onboarding/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { authApiFetch } from "@/lib/auth-api";
import { completeOnboardingFlow } from "@/lib/onboarding-completion";
import { createClient } from "@/lib/supabase/client";
import {
  onboardingPayload,
  onboardingSchema,
  type OnboardingValues,
} from "@/lib/validations/onboarding";

const defaults: OnboardingValues = {
  acknowledged: false,
  display_name: "",
  primary_goal: "strength",
  equipment: ["unknown"],
  days_per_week: "",
  minutes_per_session: "",
  avoid_movement_ids: [],
  training_experience: "unknown",
  pull_up: "",
  push_up: "",
  dips: "",
  pulling: "unknown",
  pushing: "unknown",
  core: "unknown",
  balance: "unknown",
  statics: "unknown",
  skill_movement_id: "",
  skill_stage: "unknown",
};

export function OnboardingForm() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<OnboardingConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [email, setEmail] = useState<string | null>(null);

  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: defaults,
    mode: "onBlur",
    shouldUnregister: false,
  });
  const { getValues, setValue } = form;

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [nextConfig, session] = await Promise.all([
          authApiFetch<OnboardingConfig>("/profiles/onboarding/config", {
            cache: "no-store",
          }),
          createClient().auth.getSession(),
        ]);
        if (!active) return;
        setConfig(nextConfig);
        setConfigError(null);
        setEmail(session.data.session?.user.email ?? null);
        const name = session.data.session?.user.user_metadata?.name;
        if (typeof name === "string" && !getValues("display_name")) {
          setValue("display_name", name.trim());
        }
      } catch (error) {
        if (active) {
          setConfigError(
            error instanceof Error
              ? error.message
              : "Could not load onboarding. Try again.",
          );
        }
      }
    }
    void load();
    return () => { active = false; };
  }, [getValues, loadAttempt, setValue]);

  async function nextStep() {
    const valid = step === 0
      ? await form.trigger("acknowledged")
      : await form.trigger([
          "display_name",
          "primary_goal",
          "equipment",
          "days_per_week",
          "minutes_per_session",
          "avoid_movement_ids",
        ]);
    if (valid) {
      setSubmitError(null);
      setStep(step + 1);
    }
  }

  async function onSubmit(values: OnboardingValues) {
    if (!config) return;
    setSubmitError(null);
    const supabase = createClient();
    try {
      await completeOnboardingFlow({
        submit: async () => {
          await authApiFetch("/profiles/onboarding", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(onboardingPayload(values, config.safety_version)),
          });
        },
        refreshSession: async () => {
          const { data, error } = await supabase.auth.refreshSession();
          if (error) {
            throw new Error(
              "Your profile was saved, but the session could not refresh. Try again.",
            );
          }
          return data.session?.access_token ?? null;
        },
        replace: (path) => router.replace(path),
        refreshRouter: () => router.refresh(),
      });
      toast.success("Your athlete profile is ready.");
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Onboarding could not be completed. Try again.";
      setSubmitError(message);
      toast.error(message);
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        message.includes("Safety guidance")
      ) {
        setConfig(null);
        setStep(0);
        setValue("acknowledged", false);
        setLoadAttempt((value) => value + 1);
      }
    }
  }

  const current = onboardingSteps[step];
  const Icon = current.icon;

  return (
    <div className="mx-auto max-w-3xl">
      <OnboardingProgress step={step} />
      <section className="relative overflow-hidden rounded-[4px_4px_34px_4px] border border-border bg-card p-6 shadow-sm sm:p-9">
        <div className="cv-grid cv-grid-radial pointer-events-none absolute inset-0 opacity-[0.14]" aria-hidden="true" />
        <div className="relative">
          <span className="inline-flex size-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary-light text-primary">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-[clamp(2rem,5vw,2.8rem)] leading-[0.98] font-medium tracking-[-0.055em]">
            {current.title}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-foreground-soft">
            {current.description}
          </p>

          {configError ? (
            <Alert variant="destructive" className="mt-7">
              <CircleAlert />
              <AlertTitle>Unable to load your profile setup</AlertTitle>
              <AlertDescription>{configError}</AlertDescription>
              <Button type="button" variant="outline" className="mt-2" onClick={() => setLoadAttempt((value) => value + 1)}>
                Try again
              </Button>
            </Alert>
          ) : !config ? (
            <div className="mt-9 flex items-center gap-3 text-sm text-foreground-soft">
              <LoaderCircle className="size-4 animate-spin" /> Loading your setup…
            </div>
          ) : (
            <FormProvider {...form}>
              <form
                className="mt-8"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  if (step < 2) void nextStep();
                  else void form.handleSubmit(onSubmit)(event);
                }}
              >
                {submitError ? (
                  <Alert variant="destructive" className="mb-6">
                    <CircleAlert />
                    <AlertTitle>Could not finish onboarding</AlertTitle>
                    <AlertDescription>{submitError}</AlertDescription>
                  </Alert>
                ) : null}

                {step === 0 ? <SafetyStep config={config} /> : null}
                {step === 1 ? (
                  <TrainingContextStep email={email} avoidanceMovements={config.avoidance_movements} />
                ) : null}
                {step === 2 ? <StartingPointStep skillMovements={config.skill_movements} /> : null}

                <div className="mt-9 flex items-center justify-between gap-3 border-t border-border pt-6">
                  {step > 0 ? (
                    <Button type="button" variant="ghost" className="h-12 px-4" onClick={() => { setSubmitError(null); setStep(step - 1); }}>
                      <ArrowLeft className="size-4" /> Back
                    </Button>
                  ) : <span />}
                  <Button type="submit" variant="brand" className="h-12 min-w-40 px-5" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? (
                      <><LoaderCircle className="size-4 animate-spin" /> Completing…</>
                    ) : step === 2 ? (
                      <>Complete profile <ArrowRight className="size-4" /></>
                    ) : (
                      <>Continue <ArrowRight className="size-4" /></>
                    )}
                  </Button>
                </div>
              </form>
            </FormProvider>
          )}
        </div>
      </section>
    </div>
  );
}
