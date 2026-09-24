# Demo setup

The DOC-02 seed creates two **non-production** presentation identities and reproducible athlete history. Use a separate Supabase project and Stripe **test mode**. Its detailed operator notes are in [`backend/scripts/DEMO_SEED.md`](../backend/scripts/DEMO_SEED.md).

| Role | Name | Email |
| --- | --- | --- |
| Admin | Mohammad Zeidan | `demo.admin@openascent.example` |
| Pro athlete | Yazan Al Rifaee | `demo.pro@openascent.example` |

## Prepare the environment

Complete [Getting started](getting-started.md), apply migrations, seed movements/subscriptions, and configure the Supabase Auth hook. The seed needs normal backend configuration and two **private** environment values, `DEMO_ADMIN_PASSWORD` and `DEMO_ATHLETE_PASSWORD`. Do not put passwords or service credentials in this documentation or a committed script.

From `backend`:

```powershell
uv run python -m scripts.seed_demo accounts
```

This creates/confirms the demo accounts, admin role, and Yazan's completed onboarding baseline. His initial rep counts are self-reported and provisional.

## Pro and rich history

Sign in as Yazan and complete the application's normal Pro checkout in Stripe test mode. Use the resulting **real, active** test subscription ID from that account. The rich seed verifies it; a fabricated subscription row or ID is rejected.

```powershell
uv run python -m scripts.seed_demo rich --stripe-subscription-id <STRIPE_TEST_SUBSCRIPTION_ID>
```

This adds seven manual training sessions over four weeks. It does not synthesize an analysis result, AI conversation, feature usage, or measurement.

For measured recalibration, first upload a real supported movement video as a **max test** and wait for analysis to complete. Supply each qualifying authenticated analysis ID to the rich command; the seed links it to a self-performed workout set:

```powershell
uv run python -m scripts.seed_demo rich --stripe-subscription-id <STRIPE_TEST_SUBSCRIPTION_ID> --analysis-id <ANALYSIS_UUID>
```

The backend accepts only target-matched valid rep evidence. A curated saved plan appears only if a movement actually passes readiness and the existing validator accepts it. For the full demo, generate a separate new proposal in AI Coach and show preview plus explicit save.

## Reruns and preflight

The account seed reuses only users marked by this demo tool and refuses an unmarked account with the same email. Rich history uses deterministic IDs and skips entries already present. It rechecks the Stripe subscription and reuses linked uploads. A rerun does not reset passwords or erase real uploaded evidence.

Before recording, confirm both logins, Yazan's Pro status, history and progress, a completed analysis result, the saved dashboard plan if one passed readiness, and admin access. Preload the browser routes listed in [Demo flow](demo-flow.md); check camera and audio on the actual presentation device.
