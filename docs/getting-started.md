# Getting started

## Prerequisites

- Node.js and pnpm (the frontend declares pnpm 11.20.0), Python 3.12, and uv.
- A non-production Supabase project with Auth, PostgreSQL, and Storage; create a **private** `analysis-videos` bucket or set `SUPABASE_VIDEO_BUCKET` to another private bucket.
- OpenAI API access for AI Coach and explanations. Stripe test-mode credentials and the Stripe CLI are needed for checkout and local webhook flows.
- MediaPipe task model files under `backend/models` for recorded-video processing; check those local assets before starting the worker.

## Install and configure

```powershell
git clone https://github.com/MohammadHajeer/open-ascent.git
cd open-ascent
pnpm install
cd backend
uv sync
Copy-Item .env.example .env
cd ../frontend
Copy-Item .env.example .env.local
cd ..
```

Fill the local files with values from **your own** project. Keep them out of Git. The frontend needs `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The backend needs `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_VIDEO_BUCKET`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_COACH_MODEL`, `STRIPE_SECRET_KEY`, `STRIPE_PRO_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `GUEST_TOKEN_SECRET`, and `FRONTEND_URL`. The example files document optional values and defaults. Never put the service-role key in the frontend file.

## Database and initial data

Use the Supabase PostgreSQL connection string for `DATABASE_URL`. From `backend`:

```powershell
uv run alembic upgrade head
uv run python -m scripts.seed_movements
uv run python -m scripts.seed_subscriptions
uv run alembic current
```

In Supabase **Authentication → Hooks → Custom Access Token**, enable the Postgres function `public.open_ascent_access_token_hook` created by migrations. It adds onboarding and app-role claims to access tokens. Refresh the session after onboarding or a role change; the backend still checks the current profile for admin access.

## Run locally

From the repository root, `pnpm dev` starts Next.js (`localhost:3000`), FastAPI (`localhost:8000`), the analysis/explanation/cleanup worker group, and Stripe CLI forwarding. Stripe forwarding is optional for general development: if the listener fails, the other processes keep running and the terminal prints a diagnostic. A backend or worker failure still stops the dev process group. For local subscription testing, install and authenticate the Stripe CLI (`stripe login`), obtain a local webhook signing secret with `stripe listen --print-secret`, put it in the ignored `backend/.env`, and restart the backend after changing it. Run `pnpm dev:stripe` separately to see the CLI error and exit status when forwarding fails.

Run components separately when useful:

```powershell
pnpm dev:frontend
pnpm dev:backend
pnpm dev:worker
pnpm dev:stripe
```

The API exposes `/health` and `/health/db`. The worker entry point is `uv run python -m scripts.run_analysis_worker` from `backend`. See [Workers and jobs](workers-and-jobs.md) for what it starts.

## Development commands

| Command (repository root) | Purpose |
| --- | --- |
| `pnpm dev:clean` | Clear development artifacts and start the local process group |
| `pnpm lint` | Frontend ESLint and backend Ruff |
| `pnpm --dir frontend build` | Build the frontend |
| `pnpm test` | Backend pytest suite |
| `pnpm test:live-coach` | Focused Live Coach tests |

## Testing

Use `pnpm lint` and `pnpm test` as the standard checks. Frontend scripts also include `pnpm --dir frontend test:analysis`, `test:subscription`, `test:progress`, `test:workouts`, and `test:coach`. These are separate from the root `pnpm test` command.

Run the full backend suite against a dedicated, clean non-production test database. Guest-capacity tests assume there are no pre-existing guest analyses for the current UTC day; the DOC-02 demo database can contain such records and produce quota failures unrelated to a code change.

For presentation data, continue with [Demo setup](demo-setup.md).
