# Capstone demo flow

**Target: about 9 minutes.** Use a local/test environment and the [DOC-02 demo accounts](demo-setup.md). Keep the product story centered on one athlete gaining a useful training record, then making a decision from that record.

| Time | Page / screen | Action | Speaking point | Mode |
| --- | --- | --- | --- | --- |
| 0:00–0:35 | Landing `/` | Show product entry and Analyze/Movements links. | “Open Ascent connects training records, movement evidence, and coaching decisions.” | Live |
| 0:35–1:20 | Signup `/signup` → onboarding `/onboarding` | Show signup fields, then a prepared new athlete at onboarding; enter a goal and baseline. If time permits, open Library Profile mode and show the short Quick readiness check before a starter plan. | “The starting numbers and readiness answers are provisional. They are separate from measured evidence, and logged workouts will ground later plans.” | Preloaded signup; live onboarding if the account is ready |
| 1:20–1:30 | Cut / account switch | Use the time-jump slide or edit: **“After a few weeks of training with Open Ascent…”** Sign in as Yazan. | “Now there is enough history to see how the product responds to actual training.” | Preloaded cut |
| 1:30–2:25 | Athlete dashboard `/dashboard` | Show recent workouts, progress summary, and current saved foundation plan. Open Profile to show the training context if time permits. | “The dashboard brings the athlete’s own record and next steps together.” | Live, data preloaded |
| 2:25–3:05 | Train `/dashboard/train` and Progress `/dashboard/progress` | Open a completed workout and progress view; point out rep/hold trends. | “Logged sets build the trend. A video result alone does not become a training claim.” | Live, history preloaded |
| 3:05–4:10 | Analyses `/dashboard/analyses` → completed detail | Open a prepared Vertical Pull result; show valid/partial/uncertain counts, form findings, and explanation if ready. | “A worker processes the private upload, then the athlete can inspect what was observed and what remains uncertain.” | Preloaded result |
| 4:10–5:15 | Live Coach `/dashboard/train/live-coach` | Acknowledge safety, start camera, perform one or two controlled reps, show count, variant breakdown, cue, and stop. | “Pose inference stays in this browser. Completed Vertical Pull reps are counted automatically. Width and upper-torso height can yield partial labels when grip is uncertain; local voice clips deliver cues. Pro access is checked by the server.” | Live after device rehearsal; use a short prepared capture if camera is unreliable |
| 5:15–6:10 | AI Coach `/dashboard/coach` | Ask about Yazan’s recent training or a specific movement. | “Coach can read this athlete’s records and published guides through limited read-only tools.” | Live with a prepared completed conversation fallback |
| 6:10–7:25 | Library `/dashboard/library` → Generate a new plan | Choose **Build toward a goal** → **Muscle-Up**. Explain that Yazan's current plan should build eligible pulling and support prerequisites instead of prescribing an unready full Muscle-Up. Generate and inspect the structured preview; click **Save Plan** only after reviewing it. | “The goal sets direction. Each prescribed exercise still passes readiness, and saving is a separate choice.” | Live if provider is responsive; preloaded preview fallback |
| 7:25–7:55 | Library → saved plan | Open the newly saved plan from Library and show its days and rep/hold prescriptions. | “The saved plan is now in the athlete’s Library, ready to review by day.” | Live |
| 7:55–8:45 | Admin `/admin` | Switch to Mohammad’s prepared admin session; show worker and queue health, then one management view. | “The admin workspace makes processing and recovery visible without exposing athlete controls to ordinary users.” | Preloaded admin tab |
| 8:45–9:00 | Closing | Return to landing or summary slide. | “Open Ascent turns training, evidence, and guidance into a reviewable next step.” | Preloaded |

## Stage the browser

Preload separate browser profiles or windows for the new athlete, Yazan, and Mohammad so switching accounts does not invalidate another tab’s session. The DOC-02 refresh provides a validated saved foundation plan; it does not create an analysis or AI preview. Prepare a real completed authenticated Vertical Pull analysis separately if that segment is shown. Have a completed Coach conversation and a valid plan preview ready in case provider latency interrupts the live request. Open Library after saving and show the plan detail.

Keep signup **visual** unless email confirmation is known to work during the presentation. Avoid live video upload, analysis wait, Pro checkout, webhook timing, and fresh demo seeding on stage. Rehearse the camera on the actual machine, in a current browser on `localhost` or HTTPS, with a stable bar, full upper body and wrists visible, permission granted, and audio unmuted. If the live camera fails, use a previously recorded local capture of the UI and state that it is a rehearsal capture. Prepare analysis results beforehand; any AI explanation should already be loaded. For live Coach/plan calls, keep a completed response and preview in another conversation so the story can continue if OpenAI is slow.

## Short fallback (about 4 minutes)

1. **Landing + time jump (0:30):** introduce the product and switch directly to Yazan.
2. **Dashboard + progress (0:55):** show logged history and measured versus self-reported context.
3. **Completed analysis (0:55):** show deterministic findings and uncertainty.
4. **Live Coach (0:40):** show one rehearsed rep or a prepared capture with local inference and classification.
5. **Library plan (0:45):** select Muscle-Up as a goal, show a prerequisite-oriented preview, explicit Save, and the saved plan in Library.
6. **Admin + close (0:15):** show worker health and close.

## Rehearsal checklist

- [ ] Frontend running at the intended URL; backend `/health` and `/health/db` healthy.
- [ ] Analysis, explanation, and cleanup workers running; admin heartbeat panel healthy.
- [ ] Alembic migrations at head; movement and subscription seed data present.
- [ ] Demo admin and Yazan accounts verified in separate browser sessions.
- [ ] Yazan’s Pro subscription, $9.99 monthly test price, renewal/cancellation state, and Live Coach entitlement verified through the app.
- [ ] Rich workout/progress demo data present; saved plans visible in Library and their detail pages.
- [ ] Completed analysis results and optional explanation ready; detail route preloaded.
- [ ] Camera permission, framing, bar setup, and Live Coach voice/audio checked on the actual device.
- [ ] OpenAI connectivity checked; completed Coach response and plan preview fallback ready.
- [ ] Stripe test/demo state checked where checkout or Pro entitlement is shown.
- [ ] Landing, onboarding, dashboard, progress, analysis, Live Coach, Coach, Library, and admin routes preloaded.
- [ ] No passwords, API keys, service-role keys, webhook secrets, or private browser panels visible.
- [ ] Admin account ready; fallback capture and shorter script available if AI or analysis is slow.
