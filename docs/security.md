# Security and privacy boundaries

Open Ascent implements application controls; this document is not a certification or audit claim.

- **Identity and roles:** FastAPI verifies Supabase bearer tokens and derives the user ID server-side. Admin endpoints require the current database profile's `app_role=admin`; a client-provided user ID or stale role claim does not grant access.
- **Guest analysis:** An analysis ID identifies a record but does not authorize access. Guest operations require a separate signed/hashed temporary credential with expiry and rate/usage limits.
- **Video storage:** Uploaded analysis videos use a private Supabase bucket. Upload and read access are issued with bounded credentials or signed URLs rather than public object paths. Expired guest records and eligible authenticated media are cleaned up by background work.
- **Entitlements:** The backend checks feature access and usage, including Pro access for Live Coach. Stripe webhook events require signature verification before subscription reconciliation.
- **Coach isolation:** Coach tools are registered, read-only functions with validated arguments and bounded output. Personal reads are scoped to the authenticated athlete. No arbitrary SQL tool is exposed. Provider tool rounds/calls are limited.
- **Plan control:** AI generation creates a preview. A separate user action saves it, with backend validation and a fresh readiness check. Library list and detail reads use the authenticated athlete ID; another athlete's plan returns no detail.
- **Live camera privacy:** A session starts explicitly after safety acknowledgement. Camera frames go to browser-local MediaPipe inference and are not recorded or continuously uploaded by this flow; stopping releases camera resources. Static pose assets may be downloaded to initialize the browser runtime.
- **Background integrity:** Analysis and explanation workers claim jobs with leases and claim tokens, cap attempts, and reject completions from a lost claim.

See [Architecture](architecture.md) for data flow and [Known limitations](known-limitations.md) for operational limits.
