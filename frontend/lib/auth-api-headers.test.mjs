import assert from "node:assert/strict";
import test from "node:test";

import { withBearerToken } from "./auth-api-headers.ts";

test("authenticated request headers preserve caller headers and add the session bearer token", () => {
  const options = withBearerToken({
    method: "POST",
    headers: new Headers({ "Content-Type": "application/json", "X-Request-Id": "abc" }),
    body: "{}",
  }, "session-token");

  const headers = new Headers(options.headers);
  assert.equal(options.method, "POST");
  assert.equal(options.body, "{}");
  assert.equal(headers.get("Authorization"), "Bearer session-token");
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.equal(headers.get("X-Request-Id"), "abc");
});

test("the session token replaces a caller supplied Authorization header", () => {
  const options = withBearerToken({ headers: { Authorization: "Bearer old" } }, "current");
  assert.equal(new Headers(options.headers).get("Authorization"), "Bearer current");
});
