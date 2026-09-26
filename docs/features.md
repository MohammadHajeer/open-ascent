# Features

## Athlete experience

- **Accounts and onboarding:** Supabase registration/login, email verification and recovery screens, then an athlete profile with goals, self-reported baseline, equipment, and safety acknowledgement.
- **Movement library:** Public movement pages and published technique/safety documentation, with admin-managed content.
- **Training record:** Workout logging for repetitions and timed holds, recent sessions, a dashboard overview, and progress summaries/charts based on self-performed sets. The dashboard also shows the current saved weekly plan.
- **Uploaded analysis:** Guest reservation/upload/result flow with limited access; signed-in uploads, private analysis history, progress events, deterministic rep/form findings, and optional grounded AI explanation. Supported uploads are in the Vertical Pull family; the selected target is checked separately from family classification.
- **Readiness and recalibration:** Published safety rules use structured evidence and can return `PASS`, `FAIL`, or `UNKNOWN`. A bounded Quick readiness check can supply provisional evidence for the published Pull-Up, Push-Up, and Dips foundation rules; advanced rules retain their stronger evidence requirements. Only qualifying, target-matched max-test analyses update measured rep capability.
- **AI Coach:** Persistent conversations, streamed responses, owner-scoped read tools for profile, workouts, progress, analyses, and published guides. Coach can still propose a structured weekly plan using the same generation and validation path as Library. Free athletes can send 5 Coach messages per UTC day (enforced server-side; pain and injury safety replies are never metered); Pro has full Coach access. A Coach plan proposal always uses the separate monthly plan-generation allowance (Free 1, Pro 10).
- **Library:** Athletes can generate a new plan from provisional onboarding/profile context, toward a canonical movement or general pulling goal, or from COACH-03 progress when at least two self-attributed workouts exist. Profile/Goal preflight offers an unmetered Quick readiness check when relevant foundation evidence is missing. Structured answers can unlock only rule-permitted foundation work, with conservative provisional prescriptions. The preview labels any self-report contribution; athletes click **Save Plan** explicitly, and readiness is checked again at Save. Plans become more evidence-grounded as workouts and analyses accumulate. Library lists owned saved plans and their rep/hold prescriptions. The dashboard retains a current-plan summary.
- **Subscriptions and usage:** Free/Pro entitlement and usage checks, Stripe test checkout and webhook reconciliation. Settings and the landing comparison read the configured Stripe test monthly Price (currently USD $9.99), show renewal or scheduled cancellation dates, and support cancellation at period end while paid Pro access continues. An active athlete can keep the plan before cancellation takes effect.
- **Profile:** The private athlete profile shows saved goal, equipment, availability, starting self reports, and current provisional or measured capability labels.
- **Guided tour:** Dashboard tour state and guided entry points for key athlete tools.

## Live Coach

Live Coach is a Pro-gated browser camera experience for the **Vertical Pull** family. MediaPipe pose inference runs locally. It counts complete bottom-to-top-to-bottom reps, selects a prioritized deterministic cue, and keeps grip, hand width, and upper-torso height evidence independently for each completed rep. It uses canonical Pull-Up and Chin-Up names only when grip direction is reliable; otherwise supported width or height evidence yields a partial label such as Wide Vertical Pull or High Vertical Pull. Fully unknown means no useful classification evidence. A variant breakdown and current phase appear in the session panel. Local prerecorded voice clips provide counts and cues. The session requires safety acknowledgement and releases the camera on stop. It does not save a workout or upload camera frames.

## Admin experience

The admin workspace provides management screens for users, movements, published documentation, analyses, plans, and usage. Its operations dashboard displays worker heartbeats, queued/running/failed jobs, stale signals, and eligible retry actions. Admin authorization is checked against the current backend profile.

## Navigation note

Library is the plan-generation and saved-plan destination. Uploaded results remain in the separate **Analyses** page.
