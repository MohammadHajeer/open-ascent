# DOC-02 demo setup

Run only against a non-production Supabase project and Stripe **test** mode. The
command uses backend credentials. It does not change ordinary signup or email
confirmation. Keep the two passwords and all service credentials out of Git.

## 1. Create the accounts and baseline

Install the backend dependencies and migrations, then seed movements. From
`backend`, set the normal backend environment variables plus
`DEMO_ADMIN_PASSWORD` and `DEMO_ATHLETE_PASSWORD` in your shell or private
environment. Both passwords are required. Run:

```powershell
uv run python -m scripts.seed_demo accounts
```

The command creates and confirms these accounts through Supabase Admin:

| Email | Role | Display name |
| --- | --- | --- |
| `demo.admin@openascent.example` | admin | Mohammad Zeidan |
| `demo.pro@openascent.example` | athlete | Yazan Al Rifaee |

Yazan begins with a self-reported baseline of 3 pull-ups, 12 push-ups, and 4
dips; a three-day strength goal; bar and dip-bar equipment; a safety
acknowledgement; and a completed onboarding profile. The baseline stays
provisional. The admin role is the existing `profiles.app_role` gate.

## 2. Obtain real provider and analysis evidence

Sign in as the athlete. Complete the normal Pro Checkout using Stripe test
mode. The test customer must be created by Open Ascent so its
`open_ascent_user_id` metadata matches the athlete. Record the resulting active
Stripe subscription ID (`sub_...`). No fabricated subscription row or Stripe
identifier will pass the rich phase.

For measured recalibration, upload one or more real, self-performed, supported
movement videos as **max tests**. Wait for the analyzer to complete. Use the
authenticated analysis IDs from the history/API, or inspect the database:

```sql
SELECT id, movement_id, completed_at, valid_rep_count, execution_intent
FROM analyses
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'demo.pro@openascent.example')
  AND owner_kind = 'authenticated' AND status = 'completed'
ORDER BY completed_at;
```

For measured recalibration, the analyzer result must contain target-matched
valid reps and the upload must be a max test. The seed links the completed
analysis to a self-performed workout set and calls the existing COACH-07
recalibration service. SAF-04 then evaluates published movement rules. A saved
weekly plan is inserted only if a movement actually passes readiness, after
the existing plan validator runs. The plan is a curated demo plan; generate a
new AI plan live during the presentation if that sequence is important.

## 3. Enrich the athlete

```powershell
uv run python -m scripts.seed_demo rich --stripe-subscription-id sub_TEST_ID
```

Optionally add `--analysis-id UUID` once per qualifying upload. The command
adds seven historical manual sessions across four weeks, producing progress
trends. Without analysis IDs it skips measured recalibration and leaves
analysis history alone. The AI Coach reads the normal profile, workouts,
analyses, and measured state; no AI response or usage is invented. Current
usage is governed by the existing Pro plan and any actual feature calls. An
analysis result is never synthesized. If no movement reaches SAF-04 `PASS`,
the seed reports that no weekly plan was saved.

## Reruns and cleanup

The command reuses only Supabase users with the `open-ascent-doc-02` app
metadata marker. Existing unmarked email accounts are refused. Workout and
plan IDs are deterministic and are skipped on rerun. Existing linked uploads
are reused. The rich phase refreshes Stripe test verification. It never changes
an existing account password on rerun. To reset passwords, use Supabase Admin
outside this seed command. There is no bulk reset command: deletion would
also remove genuine uploaded evidence and has to be an explicit operator
action in the non-production project.

The account phase can complete before Pro Checkout and uploads. The rich phase
requires a verified Stripe test subscription but does not require an analysis.
It rolls back database changes on failure, although Supabase Auth account
creation in the account phase is an independent external operation; rerunning
recovers using the metadata marker.
