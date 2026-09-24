"use client";

import { useQuery } from "@tanstack/react-query";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { Button } from "@/components/ui/button";
import { authApiFetch } from "@/lib/auth-api";

type Capability = { movement_slug?: string; value?: number; source?: string; confidence?: string };
type Profile = {
  display_name: string;
  context: {
    athlete_reported_profile?: {
      primary_goal?: string;
      equipment?: string[];
      availability?: { days_per_week?: number; minutes_per_session?: number };
      starting_training_experience?: string;
      starting_self_reported_clean_rep_max?: Record<string, number>;
    };
    athlete_state?: { overall_level?: string; overall_source?: string; current_capabilities?: Capability[] };
  };
};

const label = (value?: string) => value ? value.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase()) : "Not provided";

export default function ProfilePage() {
  const query = useQuery({ queryKey: ["athlete-profile", "me"], queryFn: () => authApiFetch<Profile>("/athlete-profile/me", { cache: "no-store" }) });
  const profile = query.data;
  const reported = profile?.context.athlete_reported_profile;
  const state = profile?.context.athlete_state;
  return (
    <div className="space-y-8">
      <DashboardPageHeader eyebrow="Athlete profile" title="Your training context." description="Your starting point and current evidence, with self reports clearly labeled." />
      {query.isPending ? <p className="text-sm text-foreground-soft">Loading your profile…</p> : null}
      {query.isError ? <div className="space-y-3 text-sm text-foreground-soft"><p>Could not load your profile.</p><Button variant="outline" onClick={() => void query.refetch()}>Try again</Button></div> : null}
      {profile ? <div className="grid gap-5 lg:grid-cols-2">
        <DashboardSection eyebrow="Identity" title={profile.display_name}><p className="px-5 pb-6 text-sm text-foreground-soft sm:px-7">Your athlete workspace profile.</p></DashboardSection>
        <DashboardSection eyebrow="Training" title="Goals and availability"><div className="space-y-2 px-5 pb-6 text-sm text-foreground-soft sm:px-7"><p>Primary goal: {label(reported?.primary_goal)}</p><p>Experience: {label(reported?.starting_training_experience)}</p><p>Availability: {reported?.availability?.days_per_week ?? "—"} days a week · {reported?.availability?.minutes_per_session ?? "—"} minutes per session</p><p>Equipment: {reported?.equipment?.length ? reported.equipment.map(label).join(", ") : "Not provided"}</p></div></DashboardSection>
        <DashboardSection eyebrow="Starting point" title="Self reported baseline"><div className="space-y-2 px-5 pb-6 text-sm text-foreground-soft sm:px-7">{Object.entries(reported?.starting_self_reported_clean_rep_max ?? {}).length ? Object.entries(reported?.starting_self_reported_clean_rep_max ?? {}).map(([movement, reps]) => <p key={movement}>{label(movement)}: {reps} clean reps</p>) : <p>No starting rep estimate recorded.</p>}</div></DashboardSection>
        <DashboardSection eyebrow="Current direction" title="Athlete state"><div className="space-y-2 px-5 pb-6 text-sm text-foreground-soft sm:px-7"><p>Overall level: {label(state?.overall_level)} ({label(state?.overall_source)})</p>{state?.current_capabilities?.length ? state.current_capabilities.map((item) => <p key={item.movement_slug}>{label(item.movement_slug)}: {item.value ?? "—"} reps · {label(item.source)} · {label(item.confidence)}</p>) : <p>No current capability estimate recorded.</p>}</div></DashboardSection>
      </div> : null}
    </div>
  );
}
