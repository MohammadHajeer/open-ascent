# Architecture

Open Ascent separates interactive training screens from authoritative data and longer-running work.

| Layer | Responsibility |
| --- | --- |
| Next.js App Router + React | Public movement and analyze pages; signup, onboarding, athlete and admin workspaces; browser-local Live Coach |
| FastAPI | Authenticated and guest APIs, validation, entitlements, readiness, Coach orchestration, and admin operations |
| Supabase | Auth identity, PostgreSQL application data, and private uploaded-video Storage |
| SQLAlchemy + Alembic + psycopg | Database access and schema migration |
| Workers | Durable recorded-video analysis, AI explanations, and media/reservation cleanup |
| OpenAI + Stripe | Conversational/structured AI flows and subscription billing/webhooks |

## Main data flows

1. A signed-in browser obtains a Supabase access token. FastAPI verifies it and derives the user ID; the database profile supplies the current role. Guest analysis uses a separate expiring credential bound to the reservation, not the analysis ID alone.
2. Workout sets and self-reported onboarding details enter the athlete record. Progress uses logged self-performed work. A qualifying **max-test** uploaded analysis can update measured capability and feed readiness; unqualified analysis is not silently promoted into a measured baseline.
3. For an upload, FastAPI validates the supported movement, reserves usage, issues bounded access to private storage, and queues a database job. The analysis worker reads the video and runs MediaPipe/OpenCV-based Vertical Pull processing. An explanation worker may add grounded AI feedback after deterministic results exist. The browser can follow progress events and later retrieve an owned result.
4. Live Coach is a distinct browser path: the user explicitly starts a camera session, MediaPipe pose inference processes frames locally, and deterministic logic counts and classifies completed Vertical Pull reps and selects cues. The server checks Pro entitlement before a session begins. Camera frames are not continuously sent to the API.
5. AI Coach uses persistent conversations and OpenAI Conversations/Responses. Its bounded, read-only tools fetch owner-scoped athlete data and published guides. Structured weekly plan generation returns a validated preview. Saving is a separate explicit request and rechecks current readiness.
6. Stripe checkout and verified webhooks reconcile subscription state. The backend checks plan entitlements and feature usage on protected operations; the UI reflects those results.

See [Security](security.md), [Workers and jobs](workers-and-jobs.md), and [Features](features.md) for the corresponding boundaries and user experience.
