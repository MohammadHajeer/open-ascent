import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const resultsSource = readFileSync(
  new URL("../components/analyze/analysis-results.tsx", import.meta.url),
  "utf8",
);
const explanationSource = readFileSync(
  new URL("../components/analyze/analysis-explanation.tsx", import.meta.url),
  "utf8",
);

test("AI explanation is placed before rep-by-rep analysis", () => {
  assert.ok(
    resultsSource.indexOf("<AnalysisExplanationPanel") <
      resultsSource.indexOf("<RepAnalysis"),
  );
});

test("pending and completed explanations share one reserved card position", () => {
  assert.equal(
    explanationSource.match(/aria-labelledby="ai-explanation-title"/g)?.length,
    1,
  );
  assert.match(explanationSource, /min-h-80/);
  assert.match(
    explanationSource,
    /Preparing a grounded explanation from your analysis…/,
  );
  assert.match(explanationSource, /assets\.analysis\.processing/);
  assert.match(explanationSource, /activeStatus === "completed" && content/);
});

test("explanation completion does not auto-scroll the result page", () => {
  assert.doesNotMatch(explanationSource, /scrollIntoView|window\.scroll|scrollTo/);
});

test("grounded coaching output is grouped into the requested sections", () => {
  for (const heading of [
    "What went well",
    "Technique findings",
    "Target / variation consistency",
    "Tempo / control",
    "Next set focus",
  ]) {
    assert.match(explanationSource, new RegExp(heading.replace("/", "\\/")));
  }
});
