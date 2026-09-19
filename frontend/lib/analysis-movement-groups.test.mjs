import assert from "node:assert/strict";
import test from "node:test";

import { groupSupportedMovements, movementFamilyLabel } from "./analysis-movement-groups.ts";

test("supported exercises group by backend family while keeping their own records", () => {
  const movements = [
    { id: "one", slug: "pull-up", family_key: "vertical_pull", upload_analysis_supported: true },
    { id: "two", slug: "close-grip-pull-up", family_key: "vertical_pull", upload_analysis_supported: true },
    { id: "three", slug: "row", family_key: "horizontal_pull", upload_analysis_supported: true },
    { id: "four", slug: "squat", family_key: "squat", upload_analysis_supported: false },
  ];

  const groups = groupSupportedMovements(movements);
  assert.deepEqual(groups.map(({ familyKey, movements: family }) => [familyKey, family.map((item) => item.id)]), [
    ["vertical_pull", ["one", "two"]],
    ["horizontal_pull", ["three"]],
  ]);
  assert.equal(groups[0].movements[1], movements[1]);
  assert.equal(movementFamilyLabel(groups[0].familyKey), "Vertical Pull");
});
