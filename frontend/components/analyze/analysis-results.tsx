import { Check, CircleAlert, RotateCcw, ScanLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AuthenticatedAnalysisAccess } from "@/features/analysis/types";
import {
  countMetrics,
  describeReason,
  mechanicalUncertaintySummary,
  resultHeadline,
  strongestFindings,
} from "@/lib/analysis-findings";
import type { GuestResult, Rep } from "@/lib/analysis";
import type { GuestAccess } from "@/lib/analysis";
import { classificationLabels, targetRelation, variationDistribution } from "@/lib/rep-classification";
import { AnalysisExplanationPanel } from "./analysis-explanation";
import { SafetyGuidance } from "./safety-guidance";

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`;
}

function RepAnalysis({ reps, familyMode, targetSlug }: { reps: Rep[]; familyMode: boolean; targetSlug: string }) {
  return (
    <section className="mt-16 sm:mt-20" aria-labelledby="rep-analysis-title">
      <span className="font-mono text-[0.58rem] font-semibold tracking-widest text-primary uppercase">
        Rep by rep
      </span>
      <h3
        id="rep-analysis-title"
        className="mt-3 text-3xl font-medium tracking-tighter text-foreground sm:text-4xl"
      >
        What happened in each attempt.
      </h3>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-foreground-soft">
        Uncertain means the evidence was not reliable enough to judge that
        attempt.
      </p>
      {reps.length ? (
        <div className="mt-8 grid overflow-hidden rounded-[3px_3px_28px_3px] border border-border bg-card lg:grid-cols-2">
          {reps.map((rep) => (
            <article
              key={rep.rep_index}
              className="grid min-h-44 gap-6 border-b border-border p-5 sm:grid-cols-[72px_1fr] sm:p-7"
            >
              <div>
                <span className="font-mono text-[0.56rem] tracking-widest text-foreground-faint uppercase">
                  Rep
                </span>
                <strong className="mt-1 block text-4xl font-medium tracking-tighter">
                  {String(rep.rep_index).padStart(2, "0")}
                </strong>
              </div>
              <div>
                <Badge
                  variant="outline"
                  className={
                    rep.outcome === "valid"
                      ? "text-primary"
                      : "text-foreground-mid"
                  }
                >
                  {rep.outcome === "valid" ? <Check /> : <CircleAlert />}
                  {rep.outcome}
                </Badge>
                <h4 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
                  {rep.outcome === "valid"
                    ? "Valid repetition"
                    : rep.outcome === "partial"
                      ? "Partial attempt"
                      : "Uncertain attempt"}
                </h4>
                <p className="mt-2 text-sm leading-6 text-foreground-soft">
                  {rep.reason_codes
                    .map(describeReason)
                    .filter(Boolean)
                    .join(" ") ||
                    (rep.outcome === "valid"
                      ? "The analyzer confirmed this repetition."
                      : "No more specific reason was recorded.")}
                </p>
                <p className="mt-4 font-mono text-[0.58rem] text-foreground-faint uppercase">
                  {seconds(rep.start_ms)}–{seconds(rep.end_ms)} ·{" "}
                  {seconds(rep.end_ms - rep.start_ms)}
                  {rep.top_ms !== null
                    ? ` · top at ${seconds(rep.top_ms)}`
                    : ""}
                </p>
                <p className="mt-3 text-sm font-medium">Detected: {classificationLabels(rep).base}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-foreground-soft">
                  <span className="rounded-full bg-muted px-2 py-1">{classificationLabels(rep).width}</span>
                  <span className="rounded-full bg-muted px-2 py-1">{classificationLabels(rep).height}</span>
                </div>
                {targetRelation(rep, familyMode, targetSlug) && <p className="mt-3 text-xs text-foreground-soft">{targetRelation(rep, familyMode, targetSlug)}</p>}
                {!!rep.target_deviations?.length && <p className="mt-1 text-xs text-foreground-soft">{rep.target_deviations.map((item) => `${item.dimension.replaceAll("_", " ")}: ${item.expected.replaceAll("_", " ")} → ${item.detected.replaceAll("_", " ")}`).join(" · ")}</p>}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-8 rounded-2xl border border-border bg-card p-6 text-sm text-foreground-soft">
          No complete attempts were detected in this clip.
        </p>
      )}
    </section>
  );
}

export function AnalysisResults({
  analysis,
  access,
  videoUrl,
  onRestart,
  authenticated = false,
}: {
  analysis: GuestResult;
  access: GuestAccess | AuthenticatedAnalysisAccess | null;
  videoUrl: string | null;
  onRestart: () => void;
  authenticated?: boolean;
}) {
  const result = analysis.result;
  if (!result) return null;
  const findings = strongestFindings(result);
  const validDurations = result.reps
    .filter((rep) => rep.outcome === "valid")
    .map((rep) => rep.end_ms - rep.start_ms);
  const average = validDurations.length
    ? validDurations.reduce((sum, duration) => sum + duration, 0) /
      validDurations.length
    : null;
  const { title, subtitle } = resultHeadline(result);
  const uncertaintySummary = mechanicalUncertaintySummary(result);
  const metrics = [
    ...countMetrics(result),
    ["Video duration", seconds(result.duration_ms)],
    [
      "Usable pose frames",
      `${Math.round(result.evidence.usable_pose_ratio * 100)}%`,
    ],
    ...(average === null ? [] : [["Average confirmed rep", seconds(average)]]),
  ];

  return (
    <section aria-labelledby="analysis-results-title">
      <div className="flex flex-wrap items-start justify-between gap-7">
        <div>
          <Badge variant="outline">
            <ScanLine /> Deterministic result
          </Badge>
          <h2
            id="analysis-results-title"
            className="mt-5 text-[clamp(3rem,7vw,6.8rem)] leading-[0.87] font-medium tracking-[-0.07em] text-foreground"
          >
            {title}
            <span className="mt-2 block text-primary">{subtitle}</span>
          </h2>
        </div>
        <div className="rounded-[3px_3px_20px_3px] border border-border bg-card px-5 py-4 text-xs leading-5 text-foreground-soft">
          <strong className="block text-foreground">{authenticated ? "Saved result" : "Guest result"}</strong>
          {authenticated ? "Raw video is removed after processing" : "Access expires after a limited time"}
        </div>
      </div>
      <div className="mt-10 overflow-hidden rounded-[3px_3px_34px_3px] border border-border bg-card sm:mt-12 lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(330px,0.8fr)]">
        <div className="relative min-h-87.5 bg-visual-surface lg:min-h-162.5">
          {videoUrl ? (
            <video
              className="absolute inset-0 size-full object-contain"
              src={videoUrl}
              controls
              playsInline
              preload="metadata"
            />
          ) : (
            <div className="grid size-full place-items-center px-8 text-center text-sm text-visual-foreground">
              {authenticated
                ? "Raw video is not retained after processing."
                : "Original video preview is unavailable after refreshing this guest session."}
            </div>
          )}
          <span className="absolute top-4 left-4 rounded-full bg-visual-surface/80 px-3 py-2 font-mono text-[0.54rem] text-visual-foreground uppercase">
            Original video
          </span>
        </div>
        <aside className="flex flex-col border-t border-border p-5 sm:p-8 lg:border-t-0 lg:border-l lg:p-10">
          <span className="font-mono text-[0.58rem] tracking-widest text-foreground-faint uppercase">{analysis.movement.id ? "Selected target" : "Mode"}</span>
          <h3 className="mt-3 text-3xl font-medium tracking-tight">
            {analysis.movement.name}
          </h3>
          <p className="mt-2 text-sm text-foreground-soft">
            {!analysis.movement.id ? "Each supported rep was classified independently. " : ""}{result.outcome === "insufficient_evidence"
              ? "Movement findings are limited by the recording."
              : "Counts reflect confirmed analyzer outcomes."}
          </p>
          <div className="mt-5 border-t border-border pt-4 text-xs text-foreground-soft"><strong className="text-foreground">Variation distribution</strong><ul className="mt-2 space-y-1">{variationDistribution(result.reps).map((line) => <li key={line}>{line}</li>)}</ul></div>
          <dl className="mt-8 grid border-t border-border">
            {metrics.map(([label, value], index) => (
              <div
                key={label}
                className="grid grid-cols-[1fr_auto] items-end gap-5 border-b border-border py-4"
              >
                <dt className="text-xs text-foreground-faint">{label}</dt>
                <dd
                  className={`text-right text-sm font-semibold text-foreground ${index === 0 ? "text-3xl tracking-tighter text-primary" : ""}`}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-auto pt-8">
            <div className="rounded-2xl bg-primary-light p-5">
              <span className="font-mono text-[0.55rem] font-semibold tracking-widest text-primary uppercase">
                Main observation
              </span>
              <p className="mt-3 text-sm leading-6 text-foreground-mid">
                {uncertaintySummary ?? findings[0]?.detail ??
                  "No major issues were detected in the analyzed repetitions."}
              </p>
            </div>
          </div>
        </aside>
      </div>

      <AnalysisExplanationPanel initial={analysis} access={access} authenticated={authenticated} />

      <RepAnalysis reps={result.reps} familyMode={!analysis.movement.id} targetSlug={analysis.movement.slug} />

      <section
        className="mt-8 rounded-[3px_3px_34px_3px] border border-border bg-card p-6 sm:p-9"
        aria-labelledby="findings-title"
      >
        <span className="font-mono text-[0.58rem] font-semibold tracking-widest text-primary uppercase">
          Analysis findings
        </span>
        <h3
          id="findings-title"
          className="mt-3 text-3xl font-medium tracking-tighter"
        >
          Strongest issues and evidence.
        </h3>
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {findings.length ? (
            findings.map((finding) => (
              <div
                key={finding.headline}
                className="rounded-2xl border border-border p-5"
              >
                <h4 className="font-semibold text-foreground">
                  {finding.headline}
                </h4>
                <p className="mt-2 text-sm leading-6 text-foreground-soft">
                  {finding.detail}
                </p>
                <span className="mt-4 block font-mono text-[0.55rem] text-foreground-faint uppercase">
                  {finding.count}{" "}
                  {finding.count === 1 ? "occurrence" : "occurrences"}
                </span>
              </div>
            ))
          ) : (
            <p className="text-sm leading-6 text-foreground-soft">
              No major issues were detected in the analyzed repetitions.
            </p>
          )}
        </div>
      </section>

      <section
        className="cv-grid mt-8 overflow-hidden rounded-[3px_3px_34px_3px] bg-primary px-6 py-10 text-primary-foreground sm:px-9 sm:py-12"
        aria-labelledby="key-finding-title"
      >
        <span className="font-mono text-[0.58rem] font-semibold tracking-widest text-primary-foreground/70 uppercase">
          Key finding
        </span>
        <h3
          id="key-finding-title"
          className="mt-7 text-[clamp(2.2rem,5vw,4.6rem)] leading-[0.94] font-medium tracking-[-0.06em]"
        >
          {findings[0]?.headline ?? "No major issues detected."}
        </h3>
        <p className="mt-5 max-w-2xl text-sm leading-6 text-primary-foreground/80">
          {findings[0]?.detail ??
            "The analyzer recorded no specific issues in the evaluated attempts."}
        </p>
      </section>

      <SafetyGuidance
        safety={analysis.movement.safety}
        movementName={analysis.movement.name}
      />
      <div className="mt-8 flex justify-end">
        <Button variant="outline" size="lg" onClick={onRestart}>
          <RotateCcw className="size-4" /> Analyze another video
        </Button>
      </div>
    </section>
  );
}
