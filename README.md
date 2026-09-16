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

This starts both:

- Next.js frontend
- FastAPI backend

You can also run them separately:

```bash
pnpm dev:frontend
pnpm dev:backend
```

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
