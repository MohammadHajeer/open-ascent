import { authApiFetch } from "@/lib/auth-api";

export type Page<T> = { as_of: string; page: number; page_size: number; total: number; items: T[] };
export type Worker = { id: string; worker_type: string; state: "idle" | "busy" | "failed" | "stopped"; health: "healthy" | "stale" | "failed" | "stopped"; current_job_id: string | null; started_at: string; last_seen_at: string };
export type Job = { id: string; kind: "analysis" | "explanation"; status: string; owner_kind: string; queued_at: string; lease_expires_at: string | null; failed_at: string | null; attempts: number; max_attempts: number; stale: boolean; failure_code: string | null; failure_detail: string | null; retry_available: boolean };
export type Overview = { as_of: string; users: { total: number; athletes: number }; analyses: Record<string, number>; explanations: Record<string, number>; queue_depth: number; stale_jobs: number; failed_jobs: number; worker_health: Record<string, number>; throughput_24h: { completed: number; failed: number }; throughput_daily: { date: string; completed: number; failed: number }[]; thresholds: { heartbeat_seconds: number; stale_after_seconds: number; failed_after_seconds: number; queue_stale_minutes: number } };

export const fetchOverview = () => authApiFetch<Overview>("/admin/operations/overview");
export const fetchWorkers = (page: number) => authApiFetch<Page<Worker>>(`/admin/operations/workers?page=${page}&page_size=10`);
export const fetchJobs = (page: number, failures: boolean) => authApiFetch<Page<Job>>(`/admin/operations/${failures ? "failures" : "jobs"}?page=${page}&page_size=10`);
export const retryJob = (job: Job) => authApiFetch<{ status: string }>(`/admin/operations/jobs/${job.kind}/${encodeURIComponent(job.id)}/retry`, { method: "POST" });
