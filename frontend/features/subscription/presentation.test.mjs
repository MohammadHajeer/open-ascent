import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canUpgrade,
  getCheckoutReturnMessage,
} from "./presentation.ts";

test("only a resolved Free plan can render the upgrade action", () => {
  assert.equal(canUpgrade("free"), true);
  assert.equal(canUpgrade("pro"), false);
  assert.equal(canUpgrade(undefined), false);
});

test("checkout return copy never claims that Pro was granted", () => {
  assert.equal(
    getCheckoutReturnMessage("success"),
    "Checkout completed. Your subscription status will update after payment verification.",
  );
  assert.equal(
    getCheckoutReturnMessage("cancelled"),
    "Checkout was cancelled. Your current plan has not changed.",
  );
});

test("landing keeps guest/account and Free/Pro as separate concepts", () => {
  const coachingModes = readFileSync(
    new URL("../../app/(public)/(landing)/_components/coaching-modes.tsx", import.meta.url),
    "utf8",
  );
  const plans = readFileSync(
    new URL("../../app/(public)/(landing)/_components/plans.tsx", import.meta.url),
    "utf8",
  );

  assert.match(coachingModes, /No account required/);
  assert.match(coachingModes, /Account required/);
  assert.match(plans, /Free vs Pro/);
  assert.match(plans, /included with both Free and Pro/);
  assert.doesNotMatch(plans, /\$\d|\d+\s+analyses/);
});

