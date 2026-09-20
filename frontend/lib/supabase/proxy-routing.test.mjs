import assert from "node:assert/strict";
import test from "node:test";

import {
  isSessionRoutedPath,
  routeDestination,
} from "./proxy-routing.ts";

test("AUTH-01 navigation redirect matrix", () => {
  const cases = [
    ["/dashboard", null, "/login"],
    ["/dashboard/analyses/123", null, "/login"],
    ["/onboarding", null, "/login"],
    ["/login", null, null],
    ["/signup", null, null],
    ["/dashboard", {}, "/onboarding"],
    ["/dashboard", { onboarding_complete: false }, "/onboarding"],
    ["/dashboard", { onboarding_complete: "true" }, "/onboarding"],
    ["/dashboard/analyses", { onboarding_complete: false }, "/onboarding"],
    ["/onboarding", { onboarding_complete: false }, null],
    ["/login", { onboarding_complete: false }, "/onboarding"],
    ["/signup", { onboarding_complete: false }, "/onboarding"],
    ["/dashboard", { onboarding_complete: true }, null],
    ["/dashboard/settings", { onboarding_complete: true }, null],
    ["/onboarding", { onboarding_complete: true }, "/dashboard"],
    ["/login", { onboarding_complete: true }, "/dashboard"],
    ["/signup", { onboarding_complete: true }, "/dashboard"],
    ["/", null, null],
    ["/movements/pull-up", null, null],
    ["/analyze", null, null],
    ["/admin", null, null],
    ["/movements/pull-up", { onboarding_complete: true }, null],
    ["/dashboardish", null, null],
    ["/dashboard/", { onboarding_complete: false }, "/onboarding"],
  ];

  for (const [path, claims, expected] of cases) {
    assert.equal(
      routeDestination(path, claims),
      expected,
      `${path} claims=${JSON.stringify(claims)}`,
    );
  }
});

test("public routes do not require a profile claim", () => {
  for (const path of ["/", "/movements", "/movements/pull-up", "/analyze"]) {
    assert.equal(isSessionRoutedPath(path), false);
  }
  assert.equal(isSessionRoutedPath("/dashboard/analyses"), true);
});
