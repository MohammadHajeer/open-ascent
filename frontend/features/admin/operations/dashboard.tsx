"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { getAdminErrorMessage } from "@/features/admin/errors";
import { fetchJobs, fetchOverview, fetchWorkers, retryJob, type Job } from "./api";

const shownTime = (value: string | null) => value ? new Date(value).toLocaleString() : "—";
const count = (value: Record<string, number> | undefined, key: string) => value?.[key] ?? 0;
const shortId = (value: string) => value.slice(0, 8);
const statusKeys = ["completed", "queued", "running", "failed", "reserved", "expired"];

function Distribution({ values, keys }: { values: Record<string, number>; keys: string[] }) {
  const total = keys.reduce((sum, key) => sum + (values[key] ?? 0), 0);
  return <div className="space-y-3">
    {keys.map(key => <div key={key} className="grid grid-cols-[5.5rem_minmax(0,1fr)_2rem] items-center gap-3 text-xs sm:grid-cols-[6.5rem_minmax(0,1fr)_2rem]">
      <span className="capitalize text-foreground-soft">{key}</span>
      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${key === "failed" || key === "stale" ? "bg-destructive" : key === "completed" || key === "healthy" ? "bg-primary" : "bg-foreground/35"}`} style={{ width: `${total ? (values[key] ?? 0) / total * 100 : 0}%` }} /></div>
      <strong className="text-right font-mono tabular-nums">{values[key] ?? 0}</strong>
    </div>)}
  </div>;
}

function PageControls({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (page: number) => void }) {
  const last = Math.max(1, Math.ceil(total / size));
  return <div className="flex items-center justify-between gap-3 border-t border-border pt-4 text-xs text-foreground-soft">
    <span>Page {page} of {last} · {total} total</span>
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <Button variant="outline" size="sm" disabled={page >= last} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  </div>;
}

function JobItem({ job, onRetry, retrying }: { job: Job; onRetry: (job: Job) => void; retrying: boolean }) {
  return <div className="grid gap-3 border-b border-border py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-foreground">{job.kind} {shortId(job.id)}</span>
        <Badge variant={job.status === "failed" || job.stale ? "destructive" : "secondary"}>{job.stale ? `stale ${job.status}` : job.status}</Badge>
        <span className="text-xs text-foreground-soft">attempt {job.attempts}/{job.max_attempts}</span>
      </div>
      <p className="mt-1 text-xs text-foreground-soft">Queued {shownTime(job.queued_at)}{job.lease_expires_at ? ` · Lease expires ${shownTime(job.lease_expires_at)}` : ""}</p>
      {job.failure_detail ? <p className="mt-2 text-sm text-foreground-soft">{job.failure_code ? `${job.failure_code}: ` : ""}{job.failure_detail}</p> : null}
    </div>
    {job.retry_available ? <Button variant="outline" size="sm" disabled={retrying} onClick={() => onRetry(job)}>Retry {job.kind}</Button> : null}
  </div>;
}

export function AdminOperationsDashboard() {
  const queryClient = useQueryClient();
  const [workerPage, setWorkerPage] = useState(1);
  const [jobPage, setJobPage] = useState(1);
  const [failures, setFailures] = useState(false);
  const overview = useQuery({ queryKey: ["admin", "operations", "overview"], queryFn: fetchOverview });
  const workers = useQuery({ queryKey: ["admin", "operations", "workers", workerPage], queryFn: () => fetchWorkers(workerPage) });
  const jobs = useQuery({ queryKey: ["admin", "operations", failures ? "failures" : "jobs", jobPage], queryFn: () => fetchJobs(jobPage, failures) });
  const retry = useMutation({
    mutationFn: retryJob,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["admin", "operations"] }); toast.success("Job queued for retry"); },
    onError: (error) => toast.error(getAdminErrorMessage(error)),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin", "operations"] });
  const snapshot = overview.data?.as_of;

  return <div className="space-y-7">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <DashboardPageHeader eyebrow="Admin console / Operations" title="Operations overview" description="Worker heartbeat, queue, and failure data from the server." />
      <Button variant="outline" onClick={refresh} disabled={overview.isFetching || workers.isFetching || jobs.isFetching}><RefreshCw className="size-4" /> Refresh</Button>
    </div>
    <p className="text-xs text-foreground-soft">{snapshot ? `Overview snapshot: ${shownTime(snapshot)}. Refresh to check current state.` : "Loading operational snapshot…"}</p>
    {overview.isError || workers.isError || jobs.isError ? <Card className="border-destructive/30"><CardContent className="text-sm text-destructive">{getAdminErrorMessage(overview.error ?? workers.error ?? jobs.error)}</CardContent></Card> : null}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Operations statistics">
      {[
        ["Queue depth", overview.data?.queue_depth, "Analyses and explanations waiting"],
        ["Stale jobs", overview.data?.stale_jobs, "Expired leases or long queue waits"],
        ["Failed jobs", overview.data?.failed_jobs, "Current terminal failures"],
        ["Healthy workers", count(overview.data?.worker_health, "healthy"), "Seen within heartbeat threshold"],
        ["Completed, 24h", overview.data?.throughput_24h.completed, "Analysis throughput"],
      ].map(([label, value, help]) => <Card key={String(label)}><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="text-3xl tabular-nums">{value ?? "—"}</CardTitle></CardHeader><CardContent className="text-xs text-foreground-soft">{help}</CardContent></Card>)}
    </section>

    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]" aria-label="Operational trends">
      <Card><CardHeader><CardTitle>Analysis outcomes</CardTitle><CardDescription>Completed and failed per UTC day · last seven days</CardDescription></CardHeader><CardContent>
        {overview.isPending ? <div className="h-64 animate-pulse rounded-xl bg-muted" aria-label="Loading throughput chart" /> : overview.data ? <>
          <ChartContainer config={{ completed: { label: "Completed", color: "var(--primary)" }, failed: { label: "Failed", color: "var(--destructive)" } }} className="h-64 w-full aspect-auto">
            <BarChart accessibilityLayer data={overview.data.throughput_daily.map(point => ({ ...point, label: point.date.slice(5) }))} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="completed" fill="var(--color-completed)" radius={[3, 3, 0, 0]} /><Bar dataKey="failed" fill="var(--color-failed)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
          <p className="mt-3 text-xs text-foreground-soft">{overview.data.throughput_24h.completed} completed · {overview.data.throughput_24h.failed} failed in the last 24 hours</p>
        </> : null}
      </CardContent></Card>
      <div className="grid gap-4">
        <Card><CardHeader><CardTitle>Analysis status</CardTitle><CardDescription>All analyses at snapshot time</CardDescription></CardHeader><CardContent>{overview.data ? <Distribution values={overview.data.analyses} keys={statusKeys} /> : <p className="text-sm text-foreground-soft">{overview.isPending ? "Loading statuses…" : "Status data unavailable."}</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Worker health</CardTitle><CardDescription>Heartbeats from instances seen in the last 24 hours</CardDescription></CardHeader><CardContent className="space-y-4">
          {overview.data ? <Distribution values={overview.data.worker_health} keys={["healthy", "stale", "failed", "stopped"]} /> : <p className="text-sm text-foreground-soft">{overview.isPending ? "Loading worker health…" : "Health data unavailable."}</p>}
          <p className="text-xs leading-5 text-foreground-soft">Heartbeat every {overview.data?.thresholds.heartbeat_seconds ?? "—"}s · stale after {overview.data?.thresholds.stale_after_seconds ?? "—"}s · failed after {overview.data?.thresholds.failed_after_seconds ?? "—"}s. Job leases do not establish liveness.</p>
        </CardContent></Card>
      </div>
    </section>

    <Card><CardHeader><CardTitle>System totals</CardTitle><CardDescription>Counts from the same snapshot</CardDescription></CardHeader><CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div><span className="text-foreground-soft">Accounts</span><p className="mt-1 text-2xl tabular-nums">{overview.data?.users.total ?? "—"}</p></div>
      <div><span className="text-foreground-soft">Athletes</span><p className="mt-1 text-2xl tabular-nums">{overview.data?.users.athletes ?? "—"}</p></div>
      <div><span className="text-foreground-soft">Explanations pending</span><p className="mt-1 text-2xl tabular-nums">{overview.data ? count(overview.data.explanations, "pending") : "—"}</p></div>
      <div><span className="text-foreground-soft">Explanations failed</span><p className="mt-1 text-2xl tabular-nums">{overview.data ? count(overview.data.explanations, "failed") : "—"}</p></div>
    </CardContent></Card>

    <Card id="workers"><CardHeader><CardTitle>Workers</CardTitle><CardDescription>Last seen and current assignment for each recorded instance</CardDescription></CardHeader><CardContent className="space-y-2">
      {workers.data?.items.length ? workers.data.items.map(worker => <div key={worker.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-b-0 text-sm"><div><p className="font-medium">{worker.worker_type} <span className="font-mono text-xs text-foreground-soft">{shortId(worker.id)}</span></p><p className="mt-1 text-xs text-foreground-soft">Last seen {shownTime(worker.last_seen_at)} · Started {shownTime(worker.started_at)}{worker.current_job_id ? ` · Job ${shortId(worker.current_job_id)}` : ""}</p></div><div className="flex gap-2"><Badge variant={worker.health === "healthy" ? "secondary" : "destructive"}>{worker.health}</Badge><Badge variant="outline">{worker.state}</Badge></div></div>) : <p className="py-4 text-sm text-foreground-soft">{workers.isPending ? "Loading workers…" : workers.isError ? "Workers are unavailable." : "No worker instances recorded."}</p>}
      {workers.data ? <PageControls page={workerPage} total={workers.data.total} size={workers.data.page_size} onPage={setWorkerPage} /> : null}
    </CardContent></Card>

    <Card id="jobs"><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>Jobs and failures</CardTitle><CardDescription>Bounded queue view with safe failure summaries</CardDescription></div><div className="flex gap-2"><Button variant={failures ? "outline" : "secondary"} size="sm" onClick={() => { setFailures(false); setJobPage(1); }}>Queue</Button><Button variant={failures ? "secondary" : "outline"} size="sm" onClick={() => { setFailures(true); setJobPage(1); }}>Failures</Button></div></div></CardHeader><CardContent>
      {jobs.data?.items.length ? jobs.data.items.map(job => <JobItem key={`${job.kind}-${job.id}`} job={job} onRetry={retry.mutate} retrying={retry.isPending} />) : <p className="py-4 text-sm text-foreground-soft">{jobs.isPending ? "Loading jobs…" : jobs.isError ? "Jobs are unavailable." : "No jobs in this view."}</p>}
      {jobs.data ? <PageControls page={jobPage} total={jobs.data.total} size={jobs.data.page_size} onPage={setJobPage} /> : null}
    </CardContent></Card>

    <div className="flex flex-wrap gap-4 text-sm">{[["Users", "/admin/users"], ["Analyses", "/admin/analyses"], ["Usage", "/admin/usage"], ["Plans", "/admin/plans"], ["Movements", "/admin/movements"], ["Documentation", "/admin/documentation"]].map(([label, href]) => <Link key={href} href={href} className="text-primary hover:underline">{label} ↗</Link>)}</div>
  </div>;
}
