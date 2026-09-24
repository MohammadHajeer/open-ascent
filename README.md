<p align="center"><img src="frontend/public/assets/brand/symbol-light.svg" alt="Open Ascent symbol" width="112" height="112"></p>

# Open Ascent

**AI Calisthenics Coach**

Open Ascent helps athletes record training, review movement evidence, and make informed decisions about their next session. It combines a workout and progress record with asynchronous video analysis, a conversational coach, and browser-local live feedback for vertical pulls.

## At a glance

- Log workouts and view progress from self-performed sets.
- Upload supported Vertical Pull videos for deterministic rep and form analysis; signed-in athletes can revisit their results.
- Use Live Coach for local pose-based rep counting, variant classification, form cues, and voice clips with Pro access.
- Ask AI Coach about your own training record and published movement guides; generate a structured weekly plan, preview it, explicitly save it, then browse it in Library.
- Review movement safety and readiness guidance, with measured capability updates only from qualifying analysis evidence.
- Manage movement content, users, subscriptions, and job health through the admin workspace.

## How it is built

The [Next.js App Router frontend](frontend/) talks to a [FastAPI backend](backend/). Supabase provides authentication, PostgreSQL, and private video storage. SQLAlchemy and Alembic manage data and migrations. Background workers process uploads, generate explanations, and clean up expired media. MediaPipe and OpenCV power recorded-video analysis; Live Coach runs MediaPipe pose inference in the browser. OpenAI powers the conversational coach, structured plan proposals, and optional bounded analysis assistance. Stripe checkout and verified webhooks support Pro entitlements.

## Quick start

Install Node.js, pnpm, Python 3.12, uv, and the Stripe CLI. Configure a non-production Supabase project and the placeholder variables in [`frontend/.env.example`](frontend/.env.example) and [`backend/.env.example`](backend/.env.example). Then:

```powershell
pnpm install
cd backend
uv sync
uv run alembic upgrade head
uv run python -m scripts.seed_movements
uv run python -m scripts.seed_subscriptions
cd ..
pnpm dev
```

`pnpm dev` starts the frontend, API, worker group, and Stripe webhook forwarding. See [Getting started](docs/getting-started.md) for setup details and [Demo setup](docs/demo-setup.md) for the seeded presentation accounts.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Getting started](docs/getting-started.md) | Prerequisites, environment, migrations, local commands, and tests |
| [Architecture](docs/architecture.md) | Components and data flow |
| [Features](docs/features.md) | Implemented athlete, coach, and admin experiences |
| [Security](docs/security.md) | Authorization and privacy boundaries |
| [Workers and jobs](docs/workers-and-jobs.md) | Queues, leases, retries, and cleanup |
| [Demo setup](docs/demo-setup.md) | DOC-02 accounts and rich data seed |
| [Capability freeze](docs/capability-freeze.md) | Final supported scope |
| [Known limitations](docs/known-limitations.md) | Current limits and future work |
| [Demo flow](docs/demo-flow.md) | Capstone script and rehearsal checklist |

## Quality checks

From the repository root, run `pnpm lint` and `pnpm test` for frontend/backend linting and backend tests. `pnpm test:live-coach` runs the focused Live Coach suite; other frontend suites are listed in [`frontend/package.json`](frontend/package.json). The [testing commands](docs/getting-started.md#testing) guide has the full list.
