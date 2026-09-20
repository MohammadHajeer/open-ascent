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

You can also run them separately:

```bash
pnpm dev:frontend
pnpm dev:backend
pnpm dev:worker
```

The guest Analyze flow needs the current database migration and published
pull-up/chin-up movement guides. From `backend`, run `uv run alembic upgrade head`
and `uv run python -m scripts.seed_movements` when setting up an environment.
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
