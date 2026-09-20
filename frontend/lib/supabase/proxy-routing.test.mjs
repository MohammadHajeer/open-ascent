import assert from "node:assert/strict";
import test from "node:test";

import {
  isSessionRoutedPath,
  routeDestination,
} from "./proxy-routing.ts";

test("session and admin navigation redirect matrix", () => {
  const cases = [
    // Unauthenticated requests.
    ["/dashboard", null, "/login"],
    ["/dashboard/analyses/123", null, "/login"],
    ["/admin", null, "/login"],
    ["/admin/movements", null, "/login"],
    ["/onboarding", null, "/login"],
    ["/login", null, null],
    ["/signup", null, null],

    // The persisted normal-user role is "athlete".
    ["/dashboard", { onboarding_complete: false, user_role: "athlete" }, "/onboarding"],
    ["/dashboard/analyses", { onboarding_complete: false, user_role: "athlete" }, "/onboarding"],
    ["/admin", { onboarding_complete: false, user_role: "athlete" }, "/onboarding"],
    ["/onboarding", { onboarding_complete: false, user_role: "athlete" }, null],
    ["/login", { onboarding_complete: false, user_role: "athlete" }, "/onboarding"],
    ["/dashboard", { onboarding_complete: true, user_role: "athlete" }, null],
    ["/dashboard/settings", { onboarding_complete: true, user_role: "athlete" }, null],
    ["/admin", { onboarding_complete: true, user_role: "athlete" }, "/dashboard"],
    ["/admin/movements/example", { onboarding_complete: true, user_role: "athlete" }, "/dashboard"],
    ["/onboarding", { onboarding_complete: true, user_role: "athlete" }, "/dashboard"],
    ["/login", { onboarding_complete: true, user_role: "athlete" }, "/dashboard"],
    ["/signup", { onboarding_complete: true, user_role: "athlete" }, "/dashboard"],

    // Admin access is independent of athlete onboarding.
    ["/admin", { onboarding_complete: false, user_role: "admin" }, null],
    ["/admin/documentation", { user_role: "admin" }, null],
    ["/dashboard", { onboarding_complete: false, user_role: "admin" }, "/admin"],
    ["/dashboard/analyses/123", { user_role: "admin" }, "/admin"],
    ["/onboarding", { onboarding_complete: false, user_role: "admin" }, null],
    ["/login", { onboarding_complete: false, user_role: "admin" }, "/admin"],
    ["/signup", { onboarding_complete: false, user_role: "admin" }, "/admin"],
    ["/admin", { onboarding_complete: true, user_role: "admin" }, null],
    ["/admin/documentation/example", { onboarding_complete: true, user_role: "admin" }, null],
    ["/dashboard", { onboarding_complete: true, user_role: "admin" }, null],
    ["/dashboard/settings", { onboarding_complete: true, user_role: "admin" }, null],
    ["/onboarding", { onboarding_complete: true, user_role: "admin" }, "/admin"],
    ["/login", { onboarding_complete: true, user_role: "admin" }, "/admin"],

    // Absent or malformed role claims never grant admin access.
    ["/dashboard", {}, "/onboarding"],
    ["/dashboard", { onboarding_complete: false }, "/onboarding"],
    ["/dashboard", { onboarding_complete: "true" }, "/onboarding"],
    ["/onboarding", { onboarding_complete: false }, null],
    ["/login", { onboarding_complete: false }, "/onboarding"],
    ["/dashboard", { onboarding_complete: true }, null],
    ["/onboarding", { onboarding_complete: true }, "/dashboard"],
    ["/admin", {}, "/onboarding"],
    ["/admin", { onboarding_complete: true }, "/dashboard"],
    ["/admin", { onboarding_complete: true, user_role: null }, "/dashboard"],
    ["/admin", { onboarding_complete: true, user_role: "user" }, "/dashboard"],
    ["/admin", { onboarding_complete: true, user_role: ["admin"] }, "/dashboard"],
    ["/admin/", { onboarding_complete: true, user_role: "admin" }, null],

    // Public paths and route boundaries stay unchanged.
    ["/", null, null],
    ["/movements/pull-up", null, null],
    ["/analyze", null, null],
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
  assert.equal(isSessionRoutedPath("/admin"), true);
  assert.equal(isSessionRoutedPath("/admin/users"), true);
  assert.equal(isSessionRoutedPath("/administrator"), false);
});
