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
5. Library starts deliberate plan generation with a server-validated mode: profile, canonical goal, or progress. An unmetered Profile/Goal preflight derives short questions from the current published SAF-04 foundation rules when evidence is missing. Authenticated answers are stored separately with owner, rule, guide version, source, response, and timestamp; they are provisional and never update measured capability or workout history. Only explicitly opted-in Pull-Up, Push-Up, and Dips rules accept them. Library, Coach plan requests, preflight, and Save all use one deterministic planning engine (`plan_engine`): a small goal training path (`goal_paths`) names relevant canonical movements and curated supporting exercises (`supporting_exercises`, a versioned code catalog); canonical movements enter the allowed pool only with SAF-04 PASS, and supporting exercises only when their deterministic applicability gates on canonical readiness, capability, equipment, and avoidance pass. The goal movement is never ready because it is the goal. Each pool entry carries dosage ranges derived from one explicit capability basis (recent measured max test, logged max test, recent working sets, provisional onboarding self-report, or Quick-readiness threshold) and weekly limits. Luna receives that pool once, chooses and arranges entries by ID, and the server resolves identities, keeps numbers inside the ranges, and validates identity, readiness, dosage, and week-level sanity before preview and again at Save. Version 2 plan documents reference either a `movement_id` or a `supporting_exercise_id` and carry server-written explanations; version 1 documents remain readable unchanged. Coach conversations and read-only tools remain available; Coach explains supporting exercises only from the curated catalog.
6. Stripe checkout and verified webhooks reconcile subscription state. The backend checks plan entitlements and feature usage on protected operations; the UI reflects those results.

See [Security](security.md), [Workers and jobs](workers-and-jobs.md), and [Features](features.md) for the corresponding boundaries and user experience.
