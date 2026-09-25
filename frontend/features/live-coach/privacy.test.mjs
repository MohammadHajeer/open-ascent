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
  const files = sourceFiles(featureRoot).filter((path) => !path.endsWith("privacy.test.mjs"));
  const source = files.map((path) => readFileSync(path, "utf8")).join("\n");
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
    /\bsendBeacon\b/,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }

  // The only network read is a same-origin GET of the bundled voice clips.
  const fetching = files.filter((path) => /\bfetch\s*\(/.test(readFileSync(path, "utf8")));
  assert.deepEqual(fetching.map((path) => path.slice(featureRoot.length + 1)), ["voice-output.ts"]);
  const loader = readFileSync(join(featureRoot, "voice-output.ts"), "utf8");
  assert.equal(loader.match(/\bfetch\s*\(/g).length, 1);
  assert.match(loader, /fetch\(`\$\{VOICE_ROOT\}\/\$\{path\}`\)/);
  assert.match(loader, /export const VOICE_ROOT = "\/live-coach\/voice";/);
  assert.doesNotMatch(loader, /\b(method|body)\s*:/);
});

test("Live Coach source outside the voice loader makes no network calls", () => {
  const source = sourceFiles(featureRoot)
    .filter((path) => !path.endsWith("privacy.test.mjs") && !path.endsWith("voice-output.ts"))
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
  const session = readFileSync(join(featureRoot, "hooks", "use-live-coach-session.ts"), "utf8");
  const preview = readFileSync(join(featureRoot, "components", "camera-preview.tsx"), "utf8");
  const panel = readFileSync(join(featureRoot, "components", "session-panel.tsx"), "utf8");
  assert.match(workspace, /useLiveCoachSession/);
  assert.match(session, /useLiveCoachAccess/);
  assert.match(session, /fetchLiveCoachAccess/);
  assert.match(session, /measurePullUpPose\(frame\.landmarks/);
  assert.match(preview, /mirrorPreview && "-scale-x-100"/);
  assert.match(panel, /Safety guidance remains/);
  assert.match(navigation, /label: "Train"/);
  assert.match(navigation, /label: "AI Coach"/);
  assert.match(navigation, /href: "\/dashboard\/coach"/);
});
