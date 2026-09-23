"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Search, Users } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { ThemedAsset } from "@/components/shared/themed-asset";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAdminErrorMessage } from "@/features/admin/errors";
import { fetchOverview } from "@/features/admin/operations/api";
import { assets } from "@/lib/assets";
import {
  getAnalysis, getManagementSummary, getPlan, getUser,
  listAnalyses, listPlans, listUsage, listUsers,
  type ManagementSummary, type UsageTotals,
} from "./api";

const date = (value: string | null) => value ? new Date(value).toLocaleString() : "—";
const shortId = (value: string) => value.slice(0, 8);
const featureLabel = (value: string) => value.replaceAll("_", " ");
const number = (value: number | undefined) => value === undefined ? "—" : value.toLocaleString();

function useSummary() {
  return useQuery({ queryKey: ["admin", "management", "summary"], queryFn: getManagementSummary });
}

function State({ pending, error, empty, title, description, visual, icon, children }: {
  pending: boolean; error: unknown; empty: boolean; title: string; description: string;
  visual?: React.ReactNode; icon?: React.ReactNode; children: React.ReactNode;
}) {
  if (pending) return <div className="space-y-3 py-5" aria-label="Loading records">{[0, 1, 2, 3].map(index => <div key={index} className="h-16 animate-pulse rounded-lg bg-muted" />)}</div>;
  if (error) return <p role="alert" className="rounded-lg border border-destructive/30 p-5 text-sm text-destructive">{getAdminErrorMessage(error)}</p>;
  if (empty) return <DashboardEmptyState title={title} description={description} visual={visual} icon={icon} />;
  return <>{children}</>;
}

function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (value: number) => void }) {
  const last = Math.max(1, Math.ceil(total / size));
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-foreground-soft">
    <span>Page {page} of {last} · {total.toLocaleString()} records</span>
    <div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= last} onClick={() => onPage(page + 1)}>Next</Button></div>
  </div>;
}

function MetricStrip({ items, asOf }: { items: { label: string; value: number | undefined; detail?: string }[]; asOf?: string }) {
  return <div><div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">{items.map(item => <div key={item.label} className="min-h-25 bg-card px-5 py-4">
    <p className="text-xs text-foreground-soft">{item.label}</p><p className="mt-2 text-2xl font-medium tabular-nums">{number(item.value)}</p>{item.detail ? <p className="mt-1 text-xs text-foreground-soft">{item.detail}</p> : null}
  </div>)}</div>{asOf ? <p className="mt-2 text-xs text-foreground-soft">Snapshot {date(asOf)}</p> : null}</div>;
}

function SummaryError({ summary }: { summary: ReturnType<typeof useSummary> }) {
  return summary.isError ? <p role="alert" className="text-sm text-destructive">Summary unavailable: {getAdminErrorMessage(summary.error)}</p> : null;
}

function DirectoryRow({ href, title, subtitle, badges, meta }: { href: string; title: string; subtitle: string; badges?: React.ReactNode; meta?: string }) {
  return <Link href={href} className="group grid gap-2 border-b border-border py-4 last:border-b-0 focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-primary sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
    <span className="min-w-0"><span className="block truncate text-sm font-medium group-hover:text-primary">{title}</span><span className="mt-1 block text-xs leading-5 text-foreground-soft">{subtitle}</span></span>
    <span className="flex flex-wrap items-center gap-2 sm:justify-end">{meta ? <span className="text-xs tabular-nums text-foreground-soft">{meta}</span> : null}{badges}</span>
  </Link>;
}

function UsageSummary({ usage }: { usage: UsageTotals }) {
  const entries = Object.entries(usage).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? <div className="grid gap-2 sm:grid-cols-3">{entries.map(([feature, totals]) => <div key={feature} className="rounded-lg border border-border bg-muted/20 p-3">
    <p className="text-xs capitalize text-foreground-soft">{featureLabel(feature)}</p><p className="mt-1 text-sm font-medium tabular-nums">{totals.consumed} consumed</p><p className="text-xs tabular-nums text-foreground-soft">{totals.reserved} reserved</p>
  </div>)}</div> : <p className="text-sm text-foreground-soft">No usage recorded in this UTC month.</p>;
}

function usageTotals(summary: ManagementSummary | undefined) {
  return Object.values(summary?.usage ?? {}).reduce((result, item) => ({ consumed: result.consumed + item.consumed, reserved: result.reserved + item.reserved }), { consumed: 0, reserved: 0 });
}

export function UsersDirectory() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const summary = useSummary();
  const query = useQuery({ queryKey: ["admin", "management", "users", page, q, role], queryFn: () => listUsers(page, q, role) });
  const users = summary.data?.users;
  return <div className="space-y-6">
    <DashboardPageHeader eyebrow="Admin / People" title="Users and athletes" description="Account directory with server-side search and pagination." />
    <MetricStrip asOf={summary.data?.as_of} items={[{ label: "Total accounts", value: users?.total }, { label: "Athletes", value: users?.athletes }, { label: "Admins", value: users?.admins }, { label: "Onboarded athletes", value: users?.onboarded_athletes, detail: users ? `${Math.max(0, users.athletes - users.onboarded_athletes)} remaining` : undefined }]} />
    <SummaryError summary={summary} />
    <Card><CardHeader><CardTitle>Account directory</CardTitle><CardDescription>{query.data ? `${query.data.total.toLocaleString()} matching accounts` : "Profile summaries only"}</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 border-b border-border pb-4"><div className="relative w-full sm:max-w-xs"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-soft" /><Input aria-label="Search account names" placeholder="Search names" value={q} onChange={event => { setQ(event.target.value); setPage(1); }} className="pl-9" maxLength={80} /></div><Select value={role} onValueChange={value => { setRole(value ?? "all"); setPage(1); }}><SelectTrigger aria-label="Filter role" className="w-full sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All roles</SelectItem><SelectItem value="athlete">Athletes</SelectItem><SelectItem value="admin">Admins</SelectItem></SelectContent></Select></div>
      <State pending={query.isPending} error={query.error} empty={!query.data?.items.length} title={q || role !== "all" ? "No matching accounts" : "No accounts yet"} description={q || role !== "all" ? "Try a different name or role filter." : "Accounts will appear here when profiles are created."} icon={<Users className="size-6" />}>
        {query.data?.items.map(user => <DirectoryRow key={user.id} href={`/admin/users/${user.id}`} title={user.display_name} subtitle={`Joined ${date(user.created_at)} · ${user.analysis_count} analyses`} badges={<><Badge variant="outline" className="capitalize">{user.role}</Badge><Badge variant={user.onboarding_complete ? "secondary" : "outline"}>{user.onboarding_complete ? "Onboarded" : "Not onboarded"}</Badge></>} />)}
      </State>{query.data ? <Pager page={page} total={query.data.total} size={query.data.page_size} onPage={setPage} /> : null}
    </CardContent></Card>
  </div>;
}

export function UserAccount({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["admin", "management", "user", id], queryFn: () => getUser(id) });
  const user = query.data;
  return <div className="space-y-6"><DashboardPageHeader eyebrow="Admin / Account" title={user?.display_name ?? "Account"} description="Read-only account, entitlement, and usage summary." />
    <State pending={query.isPending} error={query.error} empty={!user} title="Account unavailable" description="This account could not be found.">{user ? <>
      <Card><CardHeader><CardTitle>Account</CardTitle></CardHeader><CardContent className="grid gap-4 text-sm sm:grid-cols-2"><p>Role: <strong className="capitalize">{user.role}</strong></p><p>Current tier: <Badge variant="secondary" className="capitalize">{user.effective_plan}</Badge></p><p>Joined: {date(user.created_at)}</p><p>Onboarded: {date(user.onboarding_completed_at)}</p><p className="font-mono text-xs text-foreground-soft sm:col-span-2">ID: {user.id}</p></CardContent></Card>
      <Card><CardHeader><CardTitle>Current month usage</CardTitle><CardDescription>{date(user.usage_window.start)} to {date(user.usage_window.end)}</CardDescription></CardHeader><CardContent><UsageSummary usage={user.usage} /></CardContent></Card>
      <Card><CardHeader><CardTitle>Entitlements</CardTitle></CardHeader><CardContent>{user.entitlements.map(item => <div key={item.feature_key} className="flex flex-wrap justify-between gap-2 border-b border-border py-3 text-sm last:border-b-0"><span className="capitalize">{featureLabel(item.feature_key)}</span><span className="text-foreground-soft">{item.enabled ? item.type === "metered" ? `${item.allowance_units ?? "Unconfigured"} per month` : item.type : "Disabled"}</span></div>)}</CardContent></Card>
    </> : null}</State>
  </div>;
}

export function AnalysesDirectory() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [owner, setOwner] = useState("all");
  const overview = useQuery({ queryKey: ["admin", "operations", "overview"], queryFn: fetchOverview });
  const query = useQuery({ queryKey: ["admin", "management", "analyses", page, status, owner], queryFn: () => listAnalyses(page, status, owner) });
  const counts = overview.data?.analyses;
  return <div className="space-y-6"><DashboardPageHeader eyebrow="Admin / Analyses" title="Analysis oversight" description="Cross-user status and outcome review without media or credentials." />
    <MetricStrip asOf={overview.data?.as_of} items={[{ label: "Completed", value: counts?.completed }, { label: "Queued", value: counts?.queued }, { label: "Running", value: counts?.running }, { label: "Failed", value: counts?.failed }]} />
    {overview.isError ? <p role="alert" className="text-sm text-destructive">Status summary unavailable: {getAdminErrorMessage(overview.error)}</p> : null}
    <Card><CardHeader><CardTitle>Analysis records</CardTitle><CardDescription>{query.data ? `${query.data.total.toLocaleString()} matching analyses · newest first` : "Newest first"}</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap gap-3 border-b border-border pb-4"><Select value={status} onValueChange={value => { setStatus(value ?? "all"); setPage(1); }}><SelectTrigger aria-label="Filter analysis status" className="w-full sm:w-48"><SelectValue /></SelectTrigger><SelectContent>{["all", "reserved", "queued", "running", "completed", "failed", "expired"].map(value => <SelectItem key={value} value={value}>{value === "all" ? "All statuses" : value}</SelectItem>)}</SelectContent></Select><Select value={owner} onValueChange={value => { setOwner(value ?? "all"); setPage(1); }}><SelectTrigger aria-label="Filter owner" className="w-full sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All owners</SelectItem><SelectItem value="authenticated">Athletes</SelectItem><SelectItem value="guest">Guests</SelectItem></SelectContent></Select></div>
      <State pending={query.isPending} error={query.error} empty={!query.data?.items.length} title={status !== "all" || owner !== "all" ? "No matching analyses" : "No analyses yet"} description={status !== "all" || owner !== "all" ? "Try another status or owner filter." : "New analyses will appear here as athletes submit them."} visual={<ThemedAsset asset={assets.emptyStates.noAnalyses} alt="" width={160} />}>
        {query.data?.items.map(item => <DirectoryRow key={item.id} href={`/admin/analyses/${item.id}`} title={item.movement_name ?? `Analysis ${shortId(item.id)}`} subtitle={`${item.owner_name ?? (item.owner_kind === "guest" ? "Guest" : "Athlete")} · Created ${date(item.created_at)} · Attempt ${item.attempts}`} meta={item.terminal_outcome ?? undefined} badges={<Badge variant={item.status === "failed" ? "destructive" : item.status === "completed" ? "secondary" : "outline"} className="capitalize">{item.status}</Badge>} />)}
      </State>{query.data ? <Pager page={page} total={query.data.total} size={query.data.page_size} onPage={setPage} /> : null}
    </CardContent></Card>
  </div>;
}

export function AnalysisInspection({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["admin", "management", "analysis", id], queryFn: () => getAnalysis(id) });
  const item = query.data;
  return <div className="space-y-6"><DashboardPageHeader eyebrow="Admin / Analysis" title={item?.movement_name ?? "Analysis"} description="Operational inspection with sensitive media and queue data excluded." />
    <State pending={query.isPending} error={query.error} empty={!item} title="Analysis unavailable" description="This analysis could not be found.">{item ? <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>Analysis {shortId(item.id)}</CardTitle><CardDescription>{item.owner_name ?? item.owner_kind}{item.user_id ? <> · <Link className="text-primary hover:underline" href={`/admin/users/${item.user_id}`}>Account</Link></> : null}</CardDescription></div><Badge variant={item.status === "failed" ? "destructive" : item.status === "completed" ? "secondary" : "outline"}>{item.status}</Badge></div></CardHeader><CardContent className="grid gap-4 text-sm sm:grid-cols-2"><p>Stage: {item.stage}</p><p>Attempts: {item.attempts}</p><p>Created: {date(item.created_at)}</p><p>Completed: {date(item.completed_at)}</p><p>Failed: {date(item.failed_at)}</p><p>Outcome: {item.terminal_outcome ?? "—"}</p><p>Explanation: {item.explanation_status}</p><p>Reps: {item.valid_rep_count ?? 0} valid · {item.partial_rep_count ?? 0} partial · {item.uncertain_rep_count ?? 0} uncertain</p>{item.failure_detail ? <p className="rounded-lg border border-destructive/30 p-3 text-destructive sm:col-span-2">{item.failure_detail}</p> : null}</CardContent></Card> : null}</State>
  </div>;
}

export function UsageDirectory() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const summary = useSummary();
  const query = useQuery({ queryKey: ["admin", "management", "usage", page, q], queryFn: () => listUsage(page, q) });
  const totals = usageTotals(summary.data);
  return <div className="space-y-6"><DashboardPageHeader eyebrow="Admin / Usage" title="Subscription and usage" description="Effective tiers and current UTC month consumption for athletes." />
    <MetricStrip asOf={summary.data?.as_of} items={[{ label: "Free athletes", value: summary.data?.tiers.free_athletes }, { label: "Pro athletes", value: summary.data?.tiers.pro_athletes }, { label: "Consumed units", value: summary.data ? totals.consumed : undefined, detail: "Current UTC month" }, { label: "Reserved units", value: summary.data ? totals.reserved : undefined, detail: "Current UTC month" }]} />
    <SummaryError summary={summary} />
    <Card><CardHeader><CardTitle>Usage by feature</CardTitle><CardDescription>{summary.data ? `${date(summary.data.usage_window.start)} to ${date(summary.data.usage_window.end)}` : "Current UTC month"}</CardDescription></CardHeader><CardContent>{summary.isPending ? <div className="h-20 animate-pulse rounded-lg bg-muted" aria-label="Loading usage summary" /> : summary.isError ? <p className="text-sm text-foreground-soft">Feature totals are unavailable.</p> : <UsageSummary usage={summary.data?.usage ?? {}} />}</CardContent></Card>
    <Card><CardHeader><CardTitle>Athlete usage</CardTitle><CardDescription>{query.data ? `${query.data.total.toLocaleString()} matching athletes` : "Current period, newest accounts first"}</CardDescription></CardHeader><CardContent className="space-y-4"><div className="border-b border-border pb-4"><div className="relative w-full sm:max-w-xs"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-soft" /><Input aria-label="Search athlete names" placeholder="Search athletes" value={q} onChange={event => { setQ(event.target.value); setPage(1); }} className="pl-9" maxLength={80} /></div></div>
      <State pending={query.isPending} error={query.error} empty={!query.data?.items.length} title={q ? "No matching athletes" : "No athletes yet"} description={q ? "Try another name." : "Athlete usage will appear here after accounts are created."} icon={<Activity className="size-6" />}>
        {query.data?.items.map(item => <div key={item.user_id} className="space-y-3 border-b border-border py-4 last:border-b-0"><div className="flex flex-wrap items-center justify-between gap-2"><Link className="text-sm font-medium text-primary hover:underline" href={`/admin/users/${item.user_id}`}>{item.display_name}</Link><Badge variant={item.effective_plan === "pro" ? "secondary" : "outline"} className="capitalize">{item.effective_plan}</Badge></div><UsageSummary usage={item.usage} /></div>)}
      </State>{query.data ? <Pager page={page} total={query.data.total} size={query.data.page_size} onPage={setPage} /> : null}</CardContent></Card>
  </div>;
}

export function PlansDirectory() {
  const [page, setPage] = useState(1);
  const summary = useSummary();
  const query = useQuery({ queryKey: ["admin", "management", "plans", page], queryFn: () => listPlans(page) });
  return <div className="space-y-6"><DashboardPageHeader eyebrow="Admin / Plans" title="Saved training plans" description="Read-only inspection of plans saved across athletes." />
    <MetricStrip asOf={summary.data?.as_of} items={[{ label: "Saved plans", value: summary.data?.plans.total }, { label: "Saved in 30 days", value: summary.data?.plans.saved_30d }]} />
    <SummaryError summary={summary} />
    <Card><CardHeader><CardTitle>Plan library</CardTitle><CardDescription>{query.data ? `${query.data.total.toLocaleString()} plans · newest saved first` : "Newest saved first"}</CardDescription></CardHeader><CardContent className="space-y-4">
      <State pending={query.isPending} error={query.error} empty={!query.data?.items.length} title="No saved plans yet" description="Plans saved by athletes will appear here for read-only review." visual={<ThemedAsset asset={assets.emptyStates.noTrainingPlan} alt="" width={160} />}>
        {query.data?.items.map(item => <DirectoryRow key={item.id} href={`/admin/plans/${item.id}`} title={item.title} subtitle={`Owner: ${item.owner_name}`} meta={`Saved ${date(item.saved_at)}`} badges={<Badge variant="outline">Saved</Badge>} />)}
      </State>{query.data ? <Pager page={page} total={query.data.total} size={query.data.page_size} onPage={setPage} /> : null}</CardContent></Card>
  </div>;
}

export function PlanInspection({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["admin", "management", "plan", id], queryFn: () => getPlan(id) });
  const item = query.data;
  const days = item?.plan_document?.days ?? [];
  const exercises = days.reduce((sum, day) => sum + day.exercises.length, 0);
  return <div className="space-y-6"><DashboardPageHeader eyebrow="Admin / Plan" title={item?.title ?? "Training plan"} description="Saved plan inspection. Editing remains with the athlete." />
    <State pending={query.isPending} error={query.error} empty={!item} title="Plan unavailable" description="This plan could not be found.">{item ? <><MetricStrip items={[{ label: "Training days", value: item.plan_document ? days.length : undefined }, { label: "Exercises", value: item.plan_document ? exercises : undefined }]} />
      <Card><CardHeader><CardTitle>{item.title}</CardTitle><CardDescription>Saved {date(item.saved_at)} by <Link className="text-primary hover:underline" href={`/admin/users/${item.user_id}`}>{item.owner_name}</Link></CardDescription></CardHeader><CardContent className="text-sm text-foreground-soft">{item.plan_document?.summary ?? "No summary."}</CardContent></Card>
      {item.document_status === "invalid" ? <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">The saved plan document does not match the current structure.</p> : days.map(day => <Card key={day.day_index}><CardHeader><CardTitle>Day {day.day_index}{day.label ? ` · ${day.label}` : ""}</CardTitle></CardHeader><CardContent>{day.exercises.map((exercise, index) => <div key={`${exercise.movement_id}-${index}`} className="border-b border-border py-3 text-sm first:pt-0 last:border-b-0 last:pb-0"><p className="font-mono text-xs text-foreground-soft">Movement {shortId(exercise.movement_id)}</p><p className="mt-1">{exercise.sets} sets · {exercise.reps ? `${exercise.reps} reps` : `${exercise.hold_seconds} sec hold`} · {exercise.rest_seconds} sec rest</p>{exercise.notes ? <p className="mt-1 text-foreground-soft">{exercise.notes}</p> : null}</div>)}</CardContent></Card>)}</> : null}</State>
  </div>;
}
