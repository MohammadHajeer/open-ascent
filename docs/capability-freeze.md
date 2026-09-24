# Capability freeze

Final repository snapshot for the capstone presentation.

## Implemented / Supported

- Supabase-backed signup, login, email verification/recovery screens, onboarding, athlete profile, and role-gated admin workspace.
- Public movement guides and safety documentation, with admin management of movement content.
- Workout logging, recent history, dashboard summaries, progress views, and guided dashboard tour.
- Guest and authenticated uploaded-video analysis for the Vertical Pull family, with queued processing, deterministic rep/form results, private authenticated history, and optional AI explanation.
- Evidence-aware readiness; target-matched, self-performed max-test analysis can recalibrate measured **rep** capability.
- Persistent AI Coach conversations with streamed OpenAI responses and bounded, owner-scoped read tools.
- Structured weekly plan generation, validated preview, explicit save, and current saved plan on the athlete dashboard.
- Browser-local Live Coach for Vertical Pull: complete-rep counting, automatic five-variant or unknown classification, deterministic cues, local voice clips, and backend-checked Pro access.
- Free/Pro entitlements, usage accounting, Stripe test checkout and verified webhook reconciliation.
- Durable analysis/explanation jobs, cleanup, worker heartbeats, admin queue/worker monitoring, and guarded retry actions.
- DOC-02 seeded admin and Pro athlete demo identities with reproducible workout history, subject to a verified Stripe test subscription.

## Scope Boundaries

- Uploaded analysis and Live Coach cover Vertical Pull, not every movement in the public library. Live Coach does not include Muscle-Up or other movement families.
- Live Coach sessions are local feedback sessions; they do not create workout logs or uploaded analysis history.
- AI proposes coaching and plans; the backend validates plan content and readiness, and the athlete chooses to save. Neither AI output nor a self-report is a measured performance claim.
- The Library route is currently a placeholder. Revisit saved plans on the dashboard or in the originating Coach conversation; revisit uploads through Analyses.
- The demo seed never invents analysis results or a Pro subscription. Measurement depends on a real qualifying upload and workout link.

See [Known limitations](known-limitations.md) for practical constraints and [Demo flow](demo-flow.md) for the presentation story.
