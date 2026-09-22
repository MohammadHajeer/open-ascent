"use client";

import { AnalysisResults } from "../analysis-results";
import { AnalyzeSteps } from "../analyze-steps";

import { ProcessingStep } from "./processing-step";
import { RestoringState, UnavailableState } from "./recovery-state";
import type { GuestAnalysisClientProps } from "./types";
import { useAnalysisController } from "./use-analysis-controller";
import { VideoStep } from "./video-step";

export function GuestAnalysisClient({
  analysisId,
  movement,
  config,
  safetyGuidance,
  authenticated = false,
}: GuestAnalysisClientProps) {
  const controller = useAnalysisController({
    analysisId,
    movement,
    config,
    authenticated,
  });

  const {
    step,
    file,
    videoUrl,
    duration,
    acknowledged,
    setAcknowledged,
    access,
    status,
    observing,
    stage,
    reps,
    result,
    error,
    setError,
    storageWarning,
    recoveryIssue,
    videoChoice,
    setVideoChoice,
    selectFile,
    analyze,
    restart,
    progressTitle,
    progressDescription,
  } = controller;

  return (
    <>
      <AnalyzeSteps
        activeIndex={step === "video" || step === "ready" ? 1 : 2}
      />

      <div className="pt-12 sm:pt-16">
        {error && (
          <div
            className="mb-7 rounded-2xl border border-destructive/35 bg-destructive/10 p-4 text-sm text-foreground"
            role="alert"
          >
            {error}
          </div>
        )}

        {storageWarning && (
          <div
            className="mb-7 rounded-2xl border border-border bg-card p-4 text-sm text-foreground-soft"
            role="status"
          >
            This browser could not save guest access. The analysis can continue,
            but it cannot be restored after refresh.
          </div>
        )}

        {step === "restoring" && <RestoringState />}

        {step === "unavailable" && (
          <UnavailableState
            recoveryIssue={recoveryIssue}
            onRestart={restart}
          />
        )}

        {(step === "video" || step === "ready") && (
          <VideoStep
            step={step}
            movement={movement}
            config={config}
            authenticated={authenticated}
            access={access}
            file={file}
            videoUrl={videoUrl}
            duration={duration}
            acknowledged={acknowledged}
            videoChoice={videoChoice}
            safetyGuidance={safetyGuidance}
            onAcknowledgedChange={setAcknowledged}
            onVideoChoiceChange={setVideoChoice}
            onSelectFile={selectFile}
            onAnalyze={(selectedFile, selectedDuration) => {
              void analyze(selectedFile, selectedDuration);
            }}
            onError={setError}
          />
        )}

        {step === "processing" && (
          <ProcessingStep
            movement={movement}
            status={status}
            stage={stage}
            observing={observing}
            reps={reps}
            error={error}
            progressTitle={progressTitle}
            progressDescription={progressDescription}
            onRestart={restart}
          />
        )}

        {step === "results" && result?.result && (
          <AnalysisResults
            analysis={result}
            access={access}
            authenticated={authenticated}
            videoUrl={videoUrl}
            onRestart={restart}
          />
        )}
      </div>
    </>
  );
}

export type {
  GuestAnalysisClientProps,
  SelectedMovement,
  UploadConfig,
} from "./types";
