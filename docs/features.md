# Features

## Athlete experience

- **Accounts and onboarding:** Supabase registration/login, email verification and recovery screens, then an athlete profile with goals, self-reported baseline, equipment, and safety acknowledgement.
- **Movement library:** Public movement pages and published technique/safety documentation, with admin-managed content.
- **Training record:** Workout logging for repetitions and timed holds, recent sessions, a dashboard overview, and progress summaries/charts based on self-performed sets. The dashboard also shows the current saved weekly plan.
- **Uploaded analysis:** Guest reservation/upload/result flow with limited access; signed-in uploads, private analysis history, progress events, deterministic rep/form findings, and optional grounded AI explanation. Supported uploads are in the Vertical Pull family; the selected target is checked separately from family classification.
- **Readiness and recalibration:** Published safety rules use structured evidence and can return `PASS`, `FAIL`, or `UNKNOWN`. Only qualifying, target-matched max-test analyses update measured rep capability. Self-reports remain marked as provisional.
- **AI Coach:** Persistent conversations, streamed responses, owner-scoped read tools for profile, workouts, progress, analyses, and published guides. A separate action generates a structured weekly plan proposal; the athlete reviews a preview and clicks **Save Plan**. Readiness is checked again at save time.
- **Subscriptions and usage:** Free/Pro entitlement and usage checks, Stripe test checkout and webhook reconciliation, plus account plan information.
- **Guided tour:** Dashboard tour state and guided entry points for key athlete tools.

## Live Coach

Live Coach is a Pro-gated browser camera experience for the **Vertical Pull** family. MediaPipe pose inference runs locally. It counts complete bottom-to-top-to-bottom reps, selects a prioritized deterministic cue, and classifies each completed valid rep as Pull-Up, Chin-Up, Close-Grip Pull-Up, Wide-Grip Pull-Up, High Pull-Up, or **unknown** when evidence is insufficient. A variant breakdown and current phase appear in the session panel. Local prerecorded voice clips provide counts and cues. The session requires safety acknowledgement and releases the camera on stop. It does not save a workout or upload camera frames.

## Admin experience

The admin workspace provides management screens for users, movements, published documentation, analyses, plans, and usage. Its operations dashboard displays worker heartbeats, queued/running/failed jobs, stale signals, and eligible retry actions. Admin authorization is checked against the current backend profile.

## Navigation note

`/dashboard/library` currently shows a placeholder empty state. Saved plans are visible in the Coach conversation where they were generated and in the dashboard's **Your saved plan** section; analysis history has its own **Analyses** page. See [Known limitations](known-limitations.md).
