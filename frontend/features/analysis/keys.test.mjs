import assert from "node:assert/strict";
import test from "node:test";

import { analysisKeys } from "./keys.ts";

test("analysis query keys are centralized and stable", () => {
  assert.deepEqual(analysisKeys.all, ["analysis"]);
  assert.deepEqual(analysisKeys.history(25), ["analysis", "history", { limit: 25 }]);
  assert.deepEqual(analysisKeys.detail("analysis-1"), ["analysis", "detail", "analysis-1"]);
  assert.deepEqual(analysisKeys.result("analysis-1"), ["analysis", "result", "analysis-1"]);
});
