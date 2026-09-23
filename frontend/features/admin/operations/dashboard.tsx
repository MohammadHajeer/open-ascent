"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminErrorMessage } from "@/features/admin/errors";
import { fetchJobs, fetchOverview, fetchWorkers, retryJob, type Job } from "./api";

const shownTime = (value: string | null) => value ? new Date(value).toLocaleString() : "—";
const count = (value: Record<string, number> | undefined, key: string) => value?.[key] ?? 0;
const shortId = (value: string) => value.slice(0, 8);

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

    <section className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>System totals</CardTitle><CardDescription>Database aggregates at the snapshot time</CardDescription></CardHeader><CardContent className="grid grid-cols-2 gap-4 text-sm">
        <div><span className="text-foreground-soft">Users</span><p className="mt-1 text-xl tabular-nums">{overview.data?.users.total ?? "—"}</p></div>
        <div><span className="text-foreground-soft">Athletes</span><p className="mt-1 text-xl tabular-nums">{overview.data?.users.athletes ?? "—"}</p></div>
        <div><span className="text-foreground-soft">Analyses queued / running / failed</span><p className="mt-1 tabular-nums">{count(overview.data?.analyses, "queued")} / {count(overview.data?.analyses, "running")} / {count(overview.data?.analyses, "failed")}</p></div>
        <div><span className="text-foreground-soft">Explanations pending / running / failed</span><p className="mt-1 tabular-nums">{count(overview.data?.explanations, "pending")} / {count(overview.data?.explanations, "running")} / {count(overview.data?.explanations, "failed")}</p></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Worker health</CardTitle><CardDescription>Independent heartbeats; job leases do not establish liveness</CardDescription></CardHeader><CardContent className="space-y-2 text-sm">
        <p>Healthy {count(overview.data?.worker_health, "healthy")} · Stale {count(overview.data?.worker_health, "stale")} · Failed {count(overview.data?.worker_health, "failed")} · Stopped {count(overview.data?.worker_health, "stopped")}</p>
        <p className="text-xs text-foreground-soft">Heartbeat every {overview.data?.thresholds.heartbeat_seconds ?? "—"}s · stale after {overview.data?.thresholds.stale_after_seconds ?? "—"}s · failed after {overview.data?.thresholds.failed_after_seconds ?? "—"}s. Counts cover instances seen in the last 24 hours.</p>
      </CardContent></Card>
    </section>

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
