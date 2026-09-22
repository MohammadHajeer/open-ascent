import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, ScanLine, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ExecutionIntent } from "@/lib/analysis";

import { GuestVideoRecorder as AnalysisVideoRecorder } from "../guest-video-recorder";
import type {
  AnalysisAccess,
  SelectedMovement,
  Step,
  UploadConfig,
  VideoChoice,
} from "./types";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export function VideoStep({
  step,
  movement,
  config,
  authenticated,
  access,
  file,
  videoUrl,
  duration,
  acknowledged,
  executionIntent,
  videoChoice,
  safetyGuidance,
  onAcknowledgedChange,
  onExecutionIntentChange,
  onVideoChoiceChange,
  onSelectFile,
  onAnalyze,
  onError,
}: {
  step: Extract<Step, "video" | "ready">;
  movement: SelectedMovement;
  config: UploadConfig;
  authenticated: boolean;
  access: AnalysisAccess | null;
  file: File | null;
  videoUrl: string | null;
  duration: number | null;
  acknowledged: boolean;
  executionIntent: ExecutionIntent;
  videoChoice: VideoChoice;
  safetyGuidance: ReactNode;
  onAcknowledgedChange: (value: boolean) => void;
  onExecutionIntentChange: (value: ExecutionIntent) => void;
  onVideoChoiceChange: (value: VideoChoice) => void;
  onSelectFile: (file: File, knownDuration?: number) => void;
  onAnalyze: (file?: File, duration?: number | null) => void;
  onError: (message: string) => void;
}) {
  const canRecord = !access;

  return (
    <>
      <Link
        href="/analyze"
        className="mb-6 -ml-2 inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-foreground hover:bg-muted"
      >
        <ArrowLeft className="size-4" />
        Change exercise
      </Link>

      <section aria-labelledby="video-step-title">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <span className="font-mono text-[0.59rem] font-semibold tracking-widest text-primary uppercase">
              Step 02 / Video
            </span>
            <h2
              id="video-step-title"
              className="mt-3 text-[clamp(2rem,4vw,3.6rem)] leading-none font-medium tracking-[-0.055em] text-foreground"
            >
              {step === "ready"
                ? "Review before analysis."
                : "Add one clear repetition set."}
            </h2>
          </div>

          <span className="rounded-full border border-border bg-card px-4 py-2 text-xs text-foreground-soft">
            Selected:{" "}
            <strong className="text-foreground">{movement.name}</strong>
          </span>
        </div>

        <div className="mt-6 max-w-sm">
          <Label htmlFor="execution-intent">Execution intent</Label>

          <Select
            value={executionIntent}
            disabled={Boolean(access)}
            onValueChange={(value) => {
              if (value) {
                onExecutionIntentChange(value as ExecutionIntent);
              }
            }}
          >
            <SelectTrigger id="execution-intent" className="mt-2 w-full">
              <SelectValue placeholder="Select execution intent" />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="normal_training">Normal training</SelectItem>

              <SelectItem value="explosive_power">Explosive power</SelectItem>

              <SelectItem value="controlled_tempo">Controlled tempo</SelectItem>

              <SelectItem value="max_test">Max test</SelectItem>

              <SelectItem value="technique_check">Technique check</SelectItem>
            </SelectContent>
          </Select>

          <p className="mt-2 text-sm leading-5 text-foreground-soft">
            Optional context for tempo feedback; it does not change rep
            counting.
          </p>
        </div>

        {step === "video" && !videoChoice ? (
          <VideoSourceChoice
            authenticated={authenticated}
            access={access}
            config={config}
            canRecord={canRecord}
            onVideoChoiceChange={onVideoChoiceChange}
            onSelectFile={onSelectFile}
          />
        ) : step === "video" && videoChoice === "record" ? (
          <AnalysisVideoRecorder
            maxDurationSeconds={config.maxDurationSeconds}
            maxSizeBytes={config.maxSizeBytes}
            acknowledged={acknowledged}
            onAcknowledgedChange={onAcknowledgedChange}
            onCancel={() => onVideoChoiceChange(null)}
            onUse={({ file: recordedFile, durationSeconds }) => {
              onSelectFile(recordedFile, durationSeconds);
              onAnalyze(recordedFile, durationSeconds);
            }}
          />
        ) : file && videoUrl ? (
          <VideoReview
            movement={movement}
            config={config}
            access={access}
            file={file}
            videoUrl={videoUrl}
            duration={duration}
            acknowledged={acknowledged}
            onAcknowledgedChange={onAcknowledgedChange}
            onSelectFile={onSelectFile}
            onAnalyze={onAnalyze}
            onError={onError}
          />
        ) : null}
      </section>

      {safetyGuidance}
    </>
  );
}

function VideoSourceChoice({
  authenticated,
  access,
  config,
  canRecord,
  onVideoChoiceChange,
  onSelectFile,
}: {
  authenticated: boolean;
  access: AnalysisAccess | null;
  config: UploadConfig;
  canRecord: boolean;
  onVideoChoiceChange: (value: VideoChoice) => void;
  onSelectFile: (file: File) => void;
}) {
  return (
    <div
      className="relative z-10 mt-8 grid min-h-90 place-items-center rounded-[3px_3px_34px_3px] px-6 py-12 text-center sm:min-h-107.5"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (event.dataTransfer.files[0]) {
          onSelectFile(event.dataTransfer.files[0]);
        }
      }}
    >
      <div className="cv-grid absolute inset-0 -z-10 bg-card border border-border"></div>
      <div className="grid w-full max-w-2xl justify-items-center">
        <h3 className="text-2xl font-medium tracking-tight text-foreground">
          {access ? "Re-select your video" : "Choose how to add your video"}
        </h3>

        <p className="mt-3 max-w-xl text-sm leading-6 text-foreground-soft">
          {access
            ? "Your reservation is ready. The local file was cleared by refresh, so choose the MP4 again to continue."
            : "Upload an existing clip or record one locally in your browser."}
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-foreground-soft">
          <span>{config.maxDurationSeconds} sec maximum</span>
          <span className="text-foreground-faint">•</span>
          <span>{Math.round(config.maxSizeBytes / 1048576)} MB maximum</span>
          {!authenticated && (
            <>
              <span className="text-foreground-faint">•</span>
              <span>1 guest analysis / day</span>
            </>
          )}
        </div>

        <div
          className={`mt-8 grid w-full gap-4 ${
            canRecord ? "sm:grid-cols-2" : "sm:grid-cols-1"
          }`}
        >
          <label className="group flex min-h-40 cursor-pointer flex-col justify-between rounded-2xl border-2 border-primary bg-primary p-5 text-left text-primary-foreground shadow-md transition duration-200 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-lg focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary-foreground/12">
              <Upload className="size-5" aria-hidden="true" />
            </span>

            <span className="mt-8">
              <span className="block text-base font-semibold">
                Upload video
              </span>
              <span className="mt-1 block text-sm leading-5 text-primary-foreground/80">
                Choose an existing movement clip from your device.
              </span>
            </span>

            <input
              className="sr-only"
              type="file"
              accept="video/mp4,.mp4"
              onChange={(event) => {
                if (event.target.files?.[0]) {
                  onSelectFile(event.target.files[0]);
                }
                event.currentTarget.value = "";
              }}
            />
          </label>

          {canRecord && (
            <button
              type="button"
              onClick={() => onVideoChoiceChange("record")}
              className="group flex min-h-40 flex-col justify-between rounded-2xl border-2 border-primary/70 bg-card p-5 text-left text-foreground shadow-md transition duration-200 hover:-translate-y-0.5 hover:border-primary hover:bg-primary/15 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span className="flex size-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/20 text-primary">
                <Camera className="size-5" aria-hidden="true" />
              </span>

              <span className="mt-8">
                <span className="block text-base font-semibold">
                  Record video
                </span>
                <span className="mt-1 block text-sm leading-5 text-foreground-soft">
                  Record a new clip directly with your camera.
                </span>
              </span>
            </button>
          )}
        </div>

        <p className="mt-6 font-mono text-[0.56rem] tracking-[0.08em] text-foreground-faint uppercase">
          MP4 · Maximum {Math.round(config.maxSizeBytes / 1048576)} MB ·{" "}
          {config.maxDurationSeconds} seconds
        </p>
      </div>
    </div>
  );
}

function VideoReview({
  movement,
  config,
  access,
  file,
  videoUrl,
  duration,
  acknowledged,
  onAcknowledgedChange,
  onSelectFile,
  onAnalyze,
  onError,
}: {
  movement: SelectedMovement;
  config: UploadConfig;
  access: AnalysisAccess | null;
  file: File;
  videoUrl: string;
  duration: number | null;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
  onSelectFile: (file: File) => void;
  onAnalyze: () => void;
  onError: (message: string) => void;
}) {
  return (
    <div className="mt-8 overflow-hidden rounded-[3px_3px_34px_3px] border border-border bg-card lg:grid lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="relative min-h-90 bg-visual-surface lg:min-h-140">
        <video
          className="absolute inset-0 size-full object-contain"
          src={videoUrl}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            if (!Number.isFinite(value) || value <= 0) {
              onError(
                "The video duration could not be read. Choose another MP4 clip.",
              );
            }
          }}
          onError={() =>
            onError(
              "This video could not be previewed. Choose another MP4 clip.",
            )
          }
        />
        <span className="absolute top-4 left-4 rounded-full bg-visual-surface/80 px-3 py-2 font-mono text-[0.55rem] text-visual-foreground uppercase">
          Local preview
        </span>
      </div>

      <aside className="flex flex-col border-t border-border p-6 lg:border-t-0 lg:border-l">
        <span className="font-mono text-[0.58rem] tracking-widest text-foreground-faint uppercase">
          Upload details
        </span>
        <h3 className="mt-3 text-2xl font-medium">{movement.name}</h3>

        <p className="mt-5 break-all text-sm text-foreground-soft">
          {file.name}
        </p>

        <p className="mt-2 text-sm text-foreground-soft">
          {duration === null
            ? "Reading duration…"
            : `${duration.toFixed(1)} seconds`}{" "}
          · {config.maxDurationSeconds} seconds maximum
        </p>

        {duration !== null && duration > config.maxDurationSeconds && (
          <p className="mt-5 text-sm text-destructive" role="alert">
            This clip is too long. Choose a shorter video.
          </p>
        )}

        <label className="mt-7 flex items-start gap-3 text-sm leading-6 text-foreground">
          <input
            className="mt-1 accent-primary"
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => onAcknowledgedChange(event.target.checked)}
          />
          I have read the safety guidance below and understand this analysis is
          informational.
        </label>

        <Button
          variant="brand"
          size="lg"
          className="mt-6 w-full"
          disabled={
            !acknowledged ||
            duration === null ||
            duration > config.maxDurationSeconds
          }
          onClick={() => onAnalyze()}
        >
          {access ? "Continue analysis" : "Analyze movement"}
          <ScanLine className="size-4" />
        </Button>

        <label className="mt-3 cursor-pointer text-center text-sm text-primary underline">
          Replace video
          <input
            className="sr-only"
            type="file"
            accept="video/mp4,.mp4"
            onChange={(event) => {
              if (event.target.files?.[0]) {
                onSelectFile(event.target.files[0]);
              }
              event.currentTarget.value = "";
            }}
          />
        </label>
      </aside>
    </div>
  );
}
