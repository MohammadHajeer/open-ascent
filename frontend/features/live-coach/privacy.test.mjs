import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const featureRoot = dirname(fileURLToPath(import.meta.url));

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

test("Live Coach has no raw-frame upload, recording, or encoding path", () => {
  const source = sourceFiles(featureRoot)
    .filter((path) => !path.endsWith("privacy.test.mjs"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  for (const forbidden of [
    /\bMediaRecorder\b/,
    /\.toBlob\s*\(/,
    /\.toDataURL\s*\(/,
    /\bFormData\b/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bapiFetch\b/,
    /\bauthApiFetch\b/,
    /\bsupabase\b/i,
    /\bfetch\s*\(/,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test("Live Coach stays inside authenticated Train and does not replace AI Coach", () => {
  const route = readFileSync(
    join(
      featureRoot,
      "..",
      "..",
      "app",
      "(authenticated)",
      "dashboard",
      "train",
      "live-coach",
      "page.tsx",
    ),
    "utf8",
  );
  const navigation = readFileSync(
    join(featureRoot, "..", "..", "components", "dashboard", "dashboard-navigation.ts"),
    "utf8",
  );

  assert.match(route, /LiveCoachWorkspace/);
  const workspace = readFileSync(join(featureRoot, "live-coach-workspace.tsx"), "utf8");
  assert.match(workspace, /useSubscriptionStatus/);
  assert.match(workspace, /Safety guidance remains/);
  assert.match(navigation, /label: "Train"/);
  assert.match(navigation, /label: "AI Coach"/);
  assert.match(navigation, /href: "\/dashboard\/coach"/);
});
