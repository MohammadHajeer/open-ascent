"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAdminErrorMessage } from "@/features/admin/errors";
import { getAnalysis, getPlan, getUser, listAnalyses, listPlans, listUsage, listUsers, type UsageTotals } from "./api";

const date = (value: string | null) => value ? new Date(value).toLocaleString() : "—";
const shortId = (value: string) => value.slice(0, 8);
const featureLabel = (value: string) => value.replaceAll("_", " ");

function State({ pending, error, empty, children }: { pending: boolean; error: unknown; empty: boolean; children: React.ReactNode }) {
  if (pending) return <p className="py-10 text-sm text-foreground-soft">Loading records…</p>;
  if (error) return <p role="alert" className="py-10 text-sm text-destructive">{getAdminErrorMessage(error)}</p>;
  if (empty) return <p className="py-10 text-sm text-foreground-soft">No records match this view.</p>;
  return <>{children}</>;
}

function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (value: number) => void }) {
  const last = Math.max(1, Math.ceil(total / size));
  return <div className="flex items-center justify-between gap-3 border-t border-border pt-4 text-xs text-foreground-soft"><span>Page {page} of {last} · {total} records</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= last} onClick={() => onPage(page + 1)}>Next</Button></div></div>;
}

function Item({ href, title, subtitle, status }: { href: string; title: string; subtitle: string; status?: string }) {
  return <Link href={href} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4 last:border-b-0 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"><span className="min-w-0"><span className="block truncate text-sm font-medium">{title}</span><span className="mt-1 block text-xs text-foreground-soft">{subtitle}</span></span>{status ? <Badge variant="outline">{status}</Badge> : null}</Link>;
}

function UsageSummary({ usage }: { usage: UsageTotals }) {
  const entries = Object.entries(usage);
  return entries.length ? <div className="grid gap-3 sm:grid-cols-3">{entries.map(([feature, totals]) => <div key={feature} className="rounded-xl border border-border p-3"><p className="text-xs capitalize text-foreground-soft">{featureLabel(feature)}</p><p className="mt-1 text-sm font-medium tabular-nums">{totals.consumed} used · {totals.reserved} reserved</p></div>)}</div> : <p className="text-sm text-foreground-soft">No usage recorded this month.</p>;
}

export function UsersDirectory() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const query = useQuery({ queryKey: ["admin", "management", "users", page, q, role], queryFn: () => listUsers(page, q, role) });
  return <div className="space-y-6"><DashboardPageHeader eyebrow="Admin / People" title="Users and athletes" description="Account directory with server-side search and pagination." /><Card><CardHeader><CardTitle>Accounts</CardTitle><CardDescription>Profile summaries only</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap gap-3"><Input aria-label="Search account names" placeholder="Search names" value={q} onChange={event => { setQ(event.target.value); setPage(1); }} className="max-w-xs" maxLength={80} /><Select value={role} onValueChange={value => { setRole(value ?? "all"); setPage(1); }}><SelectTrigger aria-label="Filter role"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All roles</SelectItem><SelectItem value="athlete">Athletes</SelectItem><SelectItem value="admin">Admins</SelectItem></SelectContent></Select></div><State pending={query.isPending} error={query.error} empty={!query.data?.items.length}>{query.data?.items.map(user => <Item key={user.id} href={`/admin/users/${user.id}`} title={user.display_name} subtitle={`${user.role} · Joined ${date(user.created_at)} · ${user.analysis_count} analyses · ${user.onboarding_complete ? "Onboarded" : "Not onboarded"}`} />)}</State>{query.data ? <Pager page={page} total={query.data.total} size={query.data.page_size} onPage={setPage} /> : null}</CardContent></Card></div>;
}

export function UserAccount({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["admin", "management", "user", id], queryFn: () => getUser(id) });
  const user = query.data;
  return <div className="space-y-6"><DashboardPageHeader eyebrow="Admin / Account" title={user?.display_name ?? "Account"} description="Read-only account, entitlement, and usage summary." /><State pending={query.isPending} error={query.error} empty={!user}>{user ? <><Card><CardHeader><CardTitle>Account</CardTitle></CardHeader><CardContent className="grid gap-4 text-sm sm:grid-cols-2"><p>Role: <strong>{user.role}</strong></p><p>Current tier: <strong className="capitalize">{user.effective_plan}</strong></p><p>Joined: {date(user.created_at)}</p><p>Onboarded: {date(user.onboarding_completed_at)}</p><p className="font-mono text-xs text-foreground-soft sm:col-span-2">ID: {user.id}</p></CardContent></Card><Card><CardHeader><CardTitle>Current month usage</CardTitle><CardDescription>{date(user.usage_window.start)} to {date(user.usage_window.end)}</CardDescription></CardHeader><CardContent><UsageSummary usage={user.usage} /></CardContent></Card><Card><CardHeader><CardTitle>Entitlements</CardTitle></CardHeader><CardContent className="space-y-2">{user.entitlements.map(item => <div key={item.feature_key} className="flex flex-wrap justify-between gap-2 border-b border-border py-2 text-sm"><span className="capitalize">{featureLabel(item.feature_key)}</span><span className="text-foreground-soft">{item.enabled ? item.type === "metered" ? `${item.allowance_units ?? "Unconfigured"} per month` : item.type : "Disabled"}</span></div>)}</CardContent></Card></> : null}</State></div>;
}

export function AnalysesDirectory() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [owner, setOwner] = useState("all");
  const query = useQuery({ queryKey: ["admin", "management", "analyses", page, status, owner], queryFn: () => listAnalyses(page, status, owner) });
  return <div className="space-y-6"><DashboardPageHeader eyebrow="Admin / Analyses" title="Analysis oversight" description="Cross-user status and outcome review without media or credentials." /><Card><CardHeader><CardTitle>Analyses</CardTitle><CardDescription>Newest first</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap gap-3"><Select value={status} onValueChange={value => { setStatus(value ?? "all"); setPage(1); }}><SelectTrigger aria-label="Filter analysis status"><SelectValue /></SelectTrigger><SelectContent>{["all", "reserved", "queued", "running", "completed", "failed", "expired"].map(value => <SelectItem key={value} value={value}>{value === "all" ? "All statuses" : value}</SelectItem>)}</SelectContent></Select><Select value={owner} onValueChange={value => { setOwner(value ?? "all"); setPage(1); }}><SelectTrigger aria-label="Filter owner"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All owners</SelectItem><SelectItem value="authenticated">Athletes</SelectItem><SelectItem value="guest">Guests</SelectItem></SelectContent></Select></div><State pending={query.isPending} error={query.error} empty={!query.data?.items.length}>{query.data?.items.map(item => <Item key={item.id} href={`/admin/analyses/${item.id}`} title={`${item.movement_name ?? "Vertical pull"} · ${shortId(item.id)}`} subtitle={`${item.owner_name ?? item.owner_kind} · ${date(item.created_at)} · attempt ${item.attempts}`} status={item.status} />)}</State>{query.data ? <Pager page={page} total={query.data.total} size={query.data.page_size} onPage={setPage} /> : null}</CardContent></Card></div>;
}

export function AnalysisInspection({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["admin", "management", "analysis", id], queryFn: () => getAnalysis(id) });
  const item = query.data;
  return <div className="space-y-6"><DashboardPageHeader eyebrow="Admin / Analysis" title={item?.movement_name ?? "Analysis"} description="Operational inspection with sensitive media and queue data excluded." /><State pending={query.isPending} error={query.error} empty={!item}>{item ? <Card><CardHeader><CardTitle>Analysis {shortId(item.id)}</CardTitle><CardDescription>{item.owner_name ?? item.owner_kind}{item.user_id ? <> · <Link className="text-primary hover:underline" href={`/admin/users/${item.user_id}`}>Account</Link></> : null}</CardDescription></CardHeader><CardContent className="grid gap-4 text-sm sm:grid-cols-2"><p>Status: <Badge variant={item.status === "failed" ? "destructive" : "outline"}>{item.status}</Badge></p><p>Stage: {item.stage}</p><p>Created: {date(item.created_at)}</p><p>Completed: {date(item.completed_at)}</p><p>Failed: {date(item.failed_at)}</p><p>Attempts: {item.attempts}</p><p>Outcome: {item.terminal_outcome ?? "—"}</p><p>Explanation: {item.explanation_status}</p><p>Reps: {item.valid_rep_count ?? 0} valid · {item.partial_rep_count ?? 0} partial · {item.uncertain_rep_count ?? 0} uncertain</p>{item.failure_detail ? <p className="text-destructive sm:col-span-2">{item.failure_detail}</p> : null}</CardContent></Card> : null}</State></div>;
}

export function UsageDirectory() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const query = useQuery({ queryKey: ["admin", "management", "usage", page, q], queryFn: () => listUsage(page, q) });
  return <div className="space-y-6"><DashboardPageHeader eyebrow="Admin / Usage" title="Subscription and usage" description="Effective tiers and current UTC month consumption for athletes." /><Card><CardHeader><CardTitle>Monthly usage</CardTitle><CardDescription>{query.data ? `${date(query.data.usage_window.start)} to ${date(query.data.usage_window.end)}` : "Current UTC month"}</CardDescription></CardHeader><CardContent className="space-y-4"><Input aria-label="Search athlete names" placeholder="Search athletes" value={q} onChange={event => { setQ(event.target.value); setPage(1); }} className="max-w-xs" maxLength={80} /><State pending={query.isPending} error={query.error} empty={!query.data?.items.length}>{query.data?.items.map(item => <div key={item.user_id} className="space-y-2 border-b border-border py-4 last:border-b-0"><div className="flex justify-between gap-3"><Link className="font-medium text-primary hover:underline" href={`/admin/users/${item.user_id}`}>{item.display_name}</Link><Badge variant="outline">{item.effective_plan}</Badge></div><UsageSummary usage={item.usage} /></div>)}</State>{query.data ? <Pager page={page} total={query.data.total} size={query.data.page_size} onPage={setPage} /> : null}</CardContent></Card></div>;
}

export function PlansDirectory() {
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["admin", "management", "plans", page], queryFn: () => listPlans(page) });
  return <div className="space-y-6"><DashboardPageHeader eyebrow="Admin / Plans" title="Saved training plans" description="Read-only inspection of plans saved across athletes." /><Card><CardHeader><CardTitle>Plans</CardTitle><CardDescription>Newest saved first</CardDescription></CardHeader><CardContent><State pending={query.isPending} error={query.error} empty={!query.data?.items.length}>{query.data?.items.map(item => <Item key={item.id} href={`/admin/plans/${item.id}`} title={item.title} subtitle={`${item.owner_name} · Saved ${date(item.saved_at)}`} status="saved" />)}</State>{query.data ? <Pager page={page} total={query.data.total} size={query.data.page_size} onPage={setPage} /> : null}</CardContent></Card></div>;
}

export function PlanInspection({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["admin", "management", "plan", id], queryFn: () => getPlan(id) });
  const item = query.data;
  return <div className="space-y-6"><DashboardPageHeader eyebrow="Admin / Plan" title={item?.title ?? "Training plan"} description="Saved plan inspection. Editing remains with the athlete." /><State pending={query.isPending} error={query.error} empty={!item}>{item ? <><Card><CardHeader><CardTitle>{item.title}</CardTitle><CardDescription>Saved {date(item.saved_at)} by <Link className="text-primary hover:underline" href={`/admin/users/${item.user_id}`}>{item.owner_name}</Link></CardDescription></CardHeader><CardContent className="text-sm text-foreground-soft">{item.plan_document?.summary ?? "No summary."}</CardContent></Card>{item.document_status === "invalid" ? <p role="alert" className="text-sm text-destructive">The saved plan document does not match the current structure.</p> : item.plan_document?.days.map(day => <Card key={day.day_index}><CardHeader><CardTitle>Day {day.day_index}{day.label ? ` · ${day.label}` : ""}</CardTitle></CardHeader><CardContent className="space-y-3">{day.exercises.map((exercise, index) => <div key={`${exercise.movement_id}-${index}`} className="border-b border-border pb-3 text-sm last:border-b-0"><p className="font-mono text-xs text-foreground-soft">Movement {shortId(exercise.movement_id)}</p><p>{exercise.sets} sets · {exercise.reps ? `${exercise.reps} reps` : `${exercise.hold_seconds} sec hold`} · {exercise.rest_seconds} sec rest</p>{exercise.notes ? <p className="text-foreground-soft">{exercise.notes}</p> : null}</div>)}</CardContent></Card>)}</> : null}</State></div>;
}
