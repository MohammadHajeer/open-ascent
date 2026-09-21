# Open Ascent

Open Ascent is an AI-powered calisthenics coaching platform built as a full-stack monorepo.

## Project Structure

```text
open-ascent/
├── frontend/   # Next.js application
├── backend/    # FastAPI application
├── .husky/     # Git hooks
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

## Tech Stack

### Frontend

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- Supabase Auth

### Backend

- FastAPI
- SQLAlchemy
- Alembic
- PostgreSQL / Supabase
- MediaPipe
- OpenCV
- OpenAI

## Package Management

- Frontend / workspace: `pnpm`
- Backend: `uv`

## Development

From the repository root:

```bash
pnpm install
pnpm dev
```

This starts:

- Next.js frontend
- FastAPI backend
- deterministic analysis worker
- Stripe CLI webhook forwarding to `http://localhost:8000/webhooks/stripe`

You can also run them separately:

```bash
pnpm dev:frontend
pnpm dev:backend
pnpm dev:worker
pnpm dev:stripe
```

### Local Stripe webhooks

Install the Stripe CLI and authenticate once with `stripe login`. Before the
first local run, ask the CLI for its local webhook signing secret:

```bash
stripe listen --print-secret
```

Copy the printed `whsec_...` value into the ignored `backend/.env` file:

```dotenv
STRIPE_WEBHOOK_SECRET=whsec_...
```

Then use the normal entry point:

```bash
pnpm dev
```

The `stripe-webhooks` process starts `stripe listen` alongside the existing
frontend, backend, and worker processes and forwards test-mode events to the
backend webhook endpoint. The backend reads `backend/.env` only at startup, so
if the CLI signing secret changes, stop development, update that local value,
and restart `pnpm dev`. The secret remains local and is never stored in source
control. Missing CLI installation or authentication errors are emitted directly
by the labeled Stripe process and stop the concurrent development group.

The guest Analyze flow needs the current database migration and published
pull-up/chin-up movement guides. From `backend`, run `uv run alembic upgrade head`
and then run `uv run python -m scripts.seed_movements` and
`uv run python -m scripts.seed_subscriptions` when setting up an environment.
The worker reads private videos and uses the MediaPipe task files in
`backend/models`.

## Auth Hook Setup

From `backend`, run `uv run alembic upgrade head`. Then, in the Supabase
Dashboard, open **Authentication → Hooks (Auth Hooks) → Custom Access Token**.
Choose **Postgres Function**, select `public.open_ascent_access_token_hook`, and
enable the hook. New access tokens include `onboarding_complete: boolean`,
sourced from `profiles.onboarding_completed_at`, and `user_role`, sourced from
`profiles.app_role`. Valid application roles are `athlete` and `admin`; an
unavailable or invalid role produces a `null` claim and never grants admin
access. This claim does not replace Supabase's built-in `role` claim.

When onboarding later sets `onboarding_completed_at`, the frontend must call
`await supabase.auth.refreshSession()` before navigating to `/dashboard`. The
refresh issues a token with the updated claim. FastAPI continues to enforce
authorization for protected API actions.

After changing `profiles.app_role`, the current JWT keeps its old `user_role`
until the session refreshes. Call `await supabase.auth.refreshSession()` or
sign out and sign in again to obtain a token with the new role. FastAPI checks
the current database profile for admin actions, so its authorization does not
depend on the potentially stale JWT role.

## Quality Checks

```bash
pnpm lint
pnpm test
```

Git hooks are managed with Husky:

- `pre-commit` → lint staged files
- `pre-push` → run backend tests

## Environment

Copy the example environment files before running the project:

```text
frontend/.env.example
backend/.env.example
```

Then provide the required local environment variables.

## Branches

- `main` — stable code
- `dev` — active development
