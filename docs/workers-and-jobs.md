# Workers and jobs

The local entry point `pnpm dev:worker` (or `cd backend; uv run python -m scripts.run_analysis_worker`) starts the analysis loop plus explanation and cleanup loops in the same process. Keep it running alongside FastAPI for uploaded analysis. `pnpm dev` includes it.

## Processing

| Worker | Work |
| --- | --- |
| `analysis` | Claims a queued uploaded video, runs Vertical Pull processing, saves deterministic findings and progress events |
| `explanation` | Claims a completed analysis needing grounded AI explanation |
| `guest_cleanup` | Removes expired guest analyses/storage, expires abandoned authenticated reservations, and deletes eligible authenticated media |

Analysis and explanation jobs live in PostgreSQL. A worker claims one job in a short transaction using row locking with `SKIP LOCKED`, increments its attempt count, and records a claim token and time-limited lease. Processing happens outside that transaction. Completion or failure is accepted only for the current claim; an expired claim can be reclaimed. The analysis processor renews its lease during longer work. Both processing types cap automatic attempts at **three**; exhausted jobs become failed. Admin retry actions are available only when their safety checks pass, and a failed guest analysis can be retried only while its temporary access and media are still valid.

The worker monitor records each process instance's type, state, current job, and heartbeat about every 10 seconds. Admin operations classifies a heartbeat older than 30 seconds as stale and older than 90 seconds as failed; it also flags queued jobs older than 10 minutes and expired running leases. A stale signal calls for inspection: it does not by itself prove that data was lost. The operations page shows queue and worker health, job events, and eligible recovery actions.

Cleanup runs periodically in bounded batches. A failed storage deletion leaves the corresponding row eligible for another pass. A one-off guest cleanup pass is available from `backend` with `uv run python -m scripts.cleanup_guest_analyses`.

For local diagnosis, check `/health/db`, worker process output, and the admin operations dashboard. See [Demo setup](demo-setup.md) before recording analysis results.
