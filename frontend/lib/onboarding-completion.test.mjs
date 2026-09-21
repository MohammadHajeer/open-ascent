import assert from "node:assert/strict";
import test from "node:test";

import {
  completeOnboardingFlow,
  getEffectivePlanFromAccessToken,
  hasCompletedOnboardingClaim,
} from "./onboarding-completion.ts";
import { getEffectivePlan, parseAccessTokenClaims } from "./supabase/claims.ts";
import { onboardingPayload, onboardingSchema } from "./validations/onboarding.ts";

function token(claim, effectivePlan = "free") {
  return `header.${btoa(JSON.stringify({ onboarding_complete: claim, effective_plan: effectivePlan }))}.signature`;
}

test("completion refreshes the session and verifies its claim before navigation", async () => {
  const calls = [];
  await completeOnboardingFlow({
    submit: async () => { calls.push("submit"); },
    refreshSession: async () => { calls.push("refreshSession"); return token(true); },
    replace: (path) => { calls.push(`replace:${path}`); },
    refreshRouter: () => { calls.push("refreshRouter"); },
  });
  assert.deepEqual(calls, ["submit", "refreshSession", "replace:/dashboard", "refreshRouter"]);
});

test("backend failure never refreshes or navigates", async () => {
  const calls = [];
  await assert.rejects(completeOnboardingFlow({
    submit: async () => { throw new Error("backend failed"); },
    refreshSession: async () => { calls.push("refresh"); return token(true); },
    replace: () => { calls.push("replace"); },
    refreshRouter: () => { calls.push("refreshRouter"); },
  }), /backend failed/);
  assert.deepEqual(calls, []);
});

test("missing or false refreshed claim never navigates", async () => {
  for (const accessToken of [null, token(false), token("true"), "malformed"]) {
    const calls = [];
    await assert.rejects(completeOnboardingFlow({
      submit: async () => { calls.push("submit"); },
      refreshSession: async () => { calls.push("refresh"); return accessToken; },
      replace: () => { calls.push("replace"); },
      refreshRouter: () => { calls.push("refreshRouter"); },
    }), /session has not updated/);
    assert.deepEqual(calls, ["submit", "refresh"]);
  }
  assert.equal(hasCompletedOnboardingClaim(token(true)), true);
});

test("effective plan is read from the centralized presentation claim helper", () => {
  assert.equal(getEffectivePlanFromAccessToken(token(true, "pro")), "pro");
  assert.equal(getEffectivePlan(parseAccessTokenClaims(token(true, "free"))), "free");
  assert.equal(getEffectivePlan(parseAccessTokenClaims(token(true, "forged"))), "free");
});

test("session refresh failure leaves the athlete on onboarding", async () => {
  const calls = [];
  await assert.rejects(completeOnboardingFlow({
    submit: async () => { calls.push("submit"); },
    refreshSession: async () => { calls.push("refresh"); throw new Error("refresh failed"); },
    replace: () => { calls.push("replace"); },
    refreshRouter: () => { calls.push("refreshRouter"); },
  }), /refresh failed/);
  assert.deepEqual(calls, ["submit", "refresh"]);
});

test("unknown self-reports remain explicit and zero reps remain zero", () => {
  const values = onboardingSchema.parse({
    acknowledged: true,
    display_name: "Ada Athlete",
    primary_goal: "strength",
    equipment: ["unknown"],
    days_per_week: "",
    minutes_per_session: "",
    avoid_movement_ids: [],
    training_experience: "unknown",
    pull_up: "0",
    push_up: "",
    dips: "",
    pulling: "unknown",
    pushing: "unknown",
    core: "unknown",
    balance: "unknown",
    statics: "unknown",
    skill_movement_id: "",
    skill_stage: "unknown",
  });
  const result = onboardingPayload(values, "v1");
  assert.equal(result.assessment.max_clean_reps.pull_up, 0);
  assert.equal(result.assessment.max_clean_reps.push_up, null);
  assert.equal(result.assessment.dimension_stage.balance, "unknown");
  assert.equal(result.coaching_context.availability.days_per_week, null);
  assert.equal(result.assessment.skill_progression, null);
});
