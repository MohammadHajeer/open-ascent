# Capability freeze

Final repository snapshot for the capstone presentation.

## Implemented / Supported

- Supabase-backed signup, login, email verification/recovery screens, onboarding, athlete profile, and role-gated admin workspace.
- Public movement guides and safety documentation, with admin management of movement content.
- Workout logging, recent history, dashboard summaries, progress views, and guided dashboard tour.
- Guest and authenticated uploaded-video analysis for the Vertical Pull family, with queued processing, deterministic rep/form results, private authenticated history, and optional AI explanation.
- Evidence-aware readiness; target-matched, self-performed max-test analysis can recalibrate measured **rep** capability. A structured, provisional Quick readiness check supports eligible foundation rules for new athletes without claiming measurement.
- Persistent AI Coach conversations with streamed OpenAI responses and bounded, owner-scoped read tools.
- Library-led structured weekly plan generation in profile, goal, and progress modes, with an unmetered Profile/Goal readiness preflight, validated preview, explicit save, saved-plan list/detail views, and a current-plan summary on the athlete dashboard. AI Coach retains conversational plan proposals through the same engine.
- Browser-local Live Coach for Vertical Pull: complete-rep counting, evidence-based canonical or partial variant labels, deterministic cues, local voice clips, and backend-checked Pro access.
- Free/Pro entitlements, usage accounting, Stripe test checkout, provider-priced subscription status, period-end cancellation/resumption, and verified webhook reconciliation.
- Durable analysis/explanation jobs, cleanup, worker heartbeats, admin queue/worker monitoring, and guarded retry actions.
- DOC-02 seeded admin and Pro athlete demo identities with reproducible workout history and a readiness-validated foundation plan, subject to a verified Stripe test subscription.

## Scope Boundaries

- Uploaded analysis and Live Coach cover Vertical Pull, not every movement in the public library. Live Coach does not include Muscle-Up or other movement families.
- Live Coach sessions are local feedback sessions; they do not create workout logs or uploaded analysis history.
- AI proposes coaching and plans; the backend validates plan content and readiness, and the athlete chooses to save. Neither AI output nor a self-report is a measured performance claim.
- Library creates and holds training plans. Uploaded analysis history remains under Analyses.
- The demo seed never invents analysis results or a Pro subscription. Measurement depends on a real qualifying upload and workout link.

See [Known limitations](known-limitations.md) for practical constraints and [Demo flow](demo-flow.md) for the presentation story.
