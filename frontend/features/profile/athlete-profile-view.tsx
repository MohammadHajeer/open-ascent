"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Dumbbell, Target, UserRound } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { authApiFetch } from "@/lib/auth-api";
import { cn } from "@/lib/utils";

import {
  confidenceLevel,
  initials,
  label,
  NOT_PROVIDED,
  startingValue,
  trainingDays,
} from "./presentation";
import type { AthleteProfile, Capability } from "./types";

const fetchProfile = () =>
  authApiFetch<AthleteProfile>("/athlete-profile/me", { cache: "no-store" });

const rowPadding = "px-5 sm:px-7";

function Stat({ label: name, value, unit }: { label: string; value: string | number | null; unit?: string }) {
  return (
    <div className="rounded-xl border border-border/75 bg-background/45 px-4 py-3">
      <dt className="font-mono text-[0.56rem] font-semibold tracking-[0.12em] text-foreground-faint uppercase">{name}</dt>
      <dd className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl leading-none font-medium tracking-[-0.04em] tabular-nums">{value ?? "—"}</span>
        {unit && value !== null ? <span className="text-xs text-foreground-soft">{unit}</span> : null}
      </dd>
    </div>
  );
}

function Missing({ children = NOT_PROVIDED }: { children?: React.ReactNode }) {
  return <span className="text-foreground-faint">{children}</span>;
}

function ConfidenceMeter({ level, text }: { level: 1 | 2 | 3 | null; text: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-foreground-soft">
      {level ? (
        <span className="flex items-end gap-0.5" aria-hidden="true">
          {[1, 2, 3].map((bar) => (
            <span
              key={bar}
              className={cn("w-1 rounded-full", bar === 1 ? "h-2" : bar === 2 ? "h-3" : "h-4", bar <= level ? "bg-primary" : "bg-border")}
            />
          ))}
        </span>
      ) : null}
      {text}
    </span>
  );
}

function WeekStrip({ days }: { days: number }) {
  return (
    <span className="flex gap-1" role="img" aria-label={`${days} of 7 days each week`}>
      {Array.from({ length: 7 }, (_, index) => (
        <span key={index} className={cn("h-1.5 w-6 rounded-full", index < days ? "bg-primary" : "bg-border")} />
      ))}
    </span>
  );
}

function ContextRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid gap-1.5 py-4 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4", rowPadding)}>
      <dt className="text-xs font-medium text-foreground-soft sm:pt-0.5">{term}</dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  );
}

function CapabilityRow({ item, baseline }: { item: Capability; baseline?: Record<string, number> }) {
  const started = startingValue(item.movement_slug, baseline);
  const level = confidenceLevel(item.confidence);
  return (
    <li className={cn("flex items-center gap-4 py-4", rowPadding)}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label(item.movement_slug, "Movement")}</p>
        <p className="mt-1 text-xs leading-5 text-foreground-soft">
          {label(item.source, "Source not recorded")}
          {started !== undefined ? ` · started at ${started}` : ""}
        </p>
      </div>
      <div className="hidden sm:block">
        <ConfidenceMeter level={level} text={`${label(item.confidence, "Unrated")} confidence`} />
      </div>
      <div className="shrink-0 text-right">
        <span className="text-2xl leading-none font-medium tracking-[-0.04em] tabular-nums">{item.value ?? "—"}</span>
        <span className="ml-1 text-xs text-foreground-soft">reps</span>
        <div className="mt-1 sm:hidden">
          <ConfidenceMeter level={level} text={label(item.confidence, "Unrated")} />
        </div>
      </div>
    </li>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading your profile">
      <Skeleton className="h-52 rounded-[1.6rem]" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="space-y-5">
          <Skeleton className="h-72 rounded-[1.6rem]" />
          <Skeleton className="h-48 rounded-[1.6rem]" />
        </div>
        <Skeleton className="h-96 rounded-[1.6rem]" />
      </div>
    </div>
  );
}

function ProfileContent({ profile }: { profile: AthleteProfile }) {
  const reported = profile.context.athlete_reported_profile;
  const state = profile.context.athlete_state;
  const capabilities = state?.current_capabilities ?? [];
  const baseline = reported?.starting_self_reported_clean_rep_max;
  const baselineEntries = Object.entries(baseline ?? {});
  const equipment = reported?.equipment ?? [];
  const days = trainingDays(reported?.availability?.days_per_week);
  const minutes = reported?.availability?.minutes_per_session;

  return (
    <div className="space-y-5">
      <section
        aria-labelledby="athlete-identity"
        className="relative overflow-hidden rounded-[1.6rem] border border-primary/20 bg-card/80"
      >
        <div className="cv-grid cv-grid-radial pointer-events-none absolute inset-0 opacity-[0.16]" aria-hidden="true" />
        <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-center">
          <div className="flex min-w-0 items-center gap-5">
            <Avatar className="size-16 sm:size-20">
              <AvatarFallback className="bg-primary-light font-mono text-lg font-semibold tracking-[0.04em] text-primary sm:text-xl">
                {initials(profile.display_name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="font-mono text-[0.58rem] font-semibold tracking-[0.14em] text-primary uppercase">Athlete</p>
              <h2 id="athlete-identity" className="mt-1.5 text-3xl leading-tight font-medium tracking-[-0.045em] [overflow-wrap:anywhere] sm:text-4xl">
                {profile.display_name}
              </h2>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {reported?.primary_goal ? (
                  <Badge variant="default" className="h-6 gap-1.5 px-2.5"><Target aria-hidden="true" />{label(reported.primary_goal)}</Badge>
                ) : null}
                {state?.overall_level ? (
                  <Badge variant="outline" className="h-6 px-2.5">{label(state.overall_level)} level</Badge>
                ) : reported?.starting_training_experience ? (
                  <Badge variant="outline" className="h-6 px-2.5">{label(reported.starting_training_experience)}</Badge>
                ) : null}
              </div>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Days / week" value={days} />
            <Stat label="Session" value={typeof minutes === "number" ? minutes : null} unit="min" />
            <Stat label="Equipment" value={equipment.length} unit={equipment.length === 1 ? "item" : "items"} />
            <Stat label="Tracked" value={capabilities.length} unit={capabilities.length === 1 ? "movement" : "movements"} />
          </dl>
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="space-y-5">
          <DashboardSection
            eyebrow="Current direction"
            title="Where you are now"
            description="Capability estimates from your training evidence. Each shows where it came from."
            aside={<Dumbbell className="size-5 text-foreground-faint" aria-hidden="true" />}
          >
            <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-border/75 bg-background-alt/35 py-4", rowPadding)}>
              <div>
                <p className="text-xs text-foreground-soft">Overall level</p>
                <p className="mt-1 text-lg font-medium tracking-[-0.03em]">{label(state?.overall_level)}</p>
              </div>
              {state?.overall_source ? <Badge variant="outline">{label(state.overall_source)}</Badge> : null}
            </div>
            {capabilities.length ? (
              <ul className="divide-y divide-border/75">
                {capabilities.map((item, index) => (
                  <CapabilityRow key={item.movement_slug ?? index} item={item} baseline={baseline} />
                ))}
              </ul>
            ) : (
              <p className={cn("py-6 text-sm leading-6 text-foreground-soft", rowPadding)}>
                No current capability estimate yet. Log workouts or analyze a movement and it will appear here.
              </p>
            )}
          </DashboardSection>
        </div>

        <div className="space-y-5">
          <DashboardSection
            eyebrow="Training context"
            title="Goals and setup"
            aside={<CalendarDays className="size-5 text-foreground-faint" aria-hidden="true" />}
          >
            <dl className="divide-y divide-border/75">
              <ContextRow term="Primary goal">
                {reported?.primary_goal ? <span className="font-medium">{label(reported.primary_goal)}</span> : <Missing />}
              </ContextRow>
              <ContextRow term="Experience">
                {reported?.starting_training_experience ? label(reported.starting_training_experience) : <Missing />}
              </ContextRow>
              <ContextRow term="Availability">
                {days !== null || typeof minutes === "number" ? (
                  <div className="space-y-2.5">
                    {days !== null ? <WeekStrip days={days} /> : null}
                    <p className="text-foreground-soft">
                      {days !== null ? `${days} ${days === 1 ? "day" : "days"} a week` : "Days not provided"}
                      {" · "}
                      {typeof minutes === "number" ? `${minutes} minutes per session` : "Session length not provided"}
                    </p>
                  </div>
                ) : (
                  <Missing />
                )}
              </ContextRow>
              <ContextRow term="Equipment">
                {equipment.length ? (
                  <ul className="flex flex-wrap gap-1.5" aria-label="Equipment">
                    {equipment.map((item) => (
                      <li key={item}><Badge variant="outline" className="h-6 px-2.5">{label(item)}</Badge></li>
                    ))}
                  </ul>
                ) : (
                  <Missing />
                )}
              </ContextRow>
            </dl>
          </DashboardSection>

          <DashboardSection
            eyebrow="Starting point"
            title="Self-reported baseline"
            description="What you told Open Ascent when you began. It stays as your reference."
          >
            {baselineEntries.length ? (
              <ul className="divide-y divide-border/75">
                {baselineEntries.map(([movement, reps]) => (
                  <li key={movement} className={cn("flex items-center justify-between gap-4 py-4", rowPadding)}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{label(movement)}</p>
                      <Badge variant="secondary" className="mt-1.5">Self reported</Badge>
                    </div>
                    <p className="shrink-0 text-right">
                      <span className="text-2xl leading-none font-medium tracking-[-0.04em] tabular-nums">{reps}</span>
                      <span className="ml-1 text-xs text-foreground-soft">clean reps</span>
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={cn("py-6 text-sm leading-6 text-foreground-soft", rowPadding)}>No starting rep estimate recorded.</p>
            )}
          </DashboardSection>
        </div>
      </div>
    </div>
  );
}

export function AthleteProfileView() {
  const query = useQuery({ queryKey: ["athlete-profile", "me"], queryFn: fetchProfile });

  return (
    <div className="space-y-6 sm:space-y-8">
      <DashboardPageHeader
        eyebrow="Athlete profile"
        title="Your training context."
        description="Your starting point and current evidence, with self reports clearly labeled."
      />
      {query.isPending ? <ProfileSkeleton /> : null}
      {query.isError ? (
        <div className="overflow-hidden rounded-[1.6rem] border border-border/80 bg-card/65">
          <DashboardEmptyState
            icon={<UserRound className="size-5" aria-hidden="true" />}
            title="Your profile could not be loaded."
            description="Check your connection and try again."
            action={<Button variant="outline" onClick={() => void query.refetch()}>Try again</Button>}
          />
        </div>
      ) : null}
      {query.data ? <ProfileContent profile={query.data} /> : null}
    </div>
  );
}
