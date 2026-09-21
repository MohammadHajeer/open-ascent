"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, LoaderCircle, ScanLine, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  fetchAuthenticatedAnalysisResult,
  fetchAuthenticatedAnalysisStatus,
  reserveAuthenticatedAnalysis,
  streamAuthenticatedAnalysis,
  uploadAuthenticatedVideo,
} from "@/features/analysis/api";
import type { AuthenticatedAnalysisAccess } from "@/features/analysis/types";
import { ApiError } from "@/lib/api";
import {
  getGuestResult,
  getGuestStatus,
  reserveGuestAnalysis,
  uploadGuestVideo,
  type AnalysisStatus,
  type GuestAccess,
  type GuestResult,
  type RepClassification,
} from "@/lib/analysis";
import { classificationLabels, targetRelation } from "@/lib/rep-classification";
import { streamGuestAnalysis, type AnalysisProgressEvent } from "@/lib/analysis-stream";
import {
  analysisUrlWithId,
  getGuestAnalysisSession,
  recoveryActionForStatus,
  removeGuestAnalysisSession,
  saveGuestAnalysisSession,
} from "@/lib/guest-analysis-session";
import { AnalysisResults } from "./analysis-results";
import { AnalyzeSteps } from "./analyze-steps";

type SelectedMovement = {
  id: string | null;
  name: string;
  slug: string;
  illustrationUrl: string | null;
  safetyDocumentationId: string;
};

type UploadConfig = {
  maxSizeBytes: number;
  maxDurationSeconds: number;
  safetyAckVersion: string;
};

type Step = "video" | "ready" | "restoring" | "unavailable" | "processing" | "results";
type RecoveryIssue = "missing" | "invalid" | null;
type AnalysisAccess = GuestAccess | AuthenticatedAnalysisAccess;

const INVALID_ACCESS_MESSAGE = "Analysis access has expired or is invalid. Start a new analysis.";

function messageFor(error: unknown) {
  if (error instanceof ApiError && error.status === 401)
    return INVALID_ACCESS_MESSAGE;
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

const statusFor = (current: AnalysisAccess, authenticated: boolean) =>
  authenticated
    ? fetchAuthenticatedAnalysisStatus(current.analysis_id)
    : getGuestStatus(current as GuestAccess);

const resultFor = (current: AnalysisAccess, authenticated: boolean) =>
  authenticated
    ? fetchAuthenticatedAnalysisResult(current.analysis_id)
    : getGuestResult(current as GuestAccess);

function progressCopy(status: AnalysisStatus, stage: string) {
  if (status === "failed") return {
    title: "Analysis could not be completed",
    description: "We couldn’t process this video successfully. This is a processing issue, not a judgment of your movement.",
  };
  if (status === "expired") return {
    title: "Analysis expired",
    description: "This guest analysis has expired. Start a new analysis to try again.",
  };
  if (status === "reserved") return {
    title: "Getting your video ready",
    description: "Your upload is being prepared and checked before analysis.",
  };
  if (status === "queued") return {
    title: "Your analysis is queued",
    description: "We’ve received your video and it’s waiting to be processed.",
  };
  if (status === "completed") return {
    title: "Your results are ready",
    description: "Opening your movement analysis results.",
  };
  if (stage === "video_loaded") return {
    title: "Video ready",
    description: "Your video is ready for movement analysis.",
  };
  if (stage === "movement_analysis_started" || stage === "rep_completed") return {
    title: "Analyzing your movement",
    description: "We’re reviewing the movement and identifying completed repetitions.",
  };
  if (stage === "finalizing") return {
    title: "Finalizing your results",
    description: "We’re organizing the detected repetitions and analysis findings.",
  };
  return {
    title: "Preparing your analysis",
    description: "Your video is being prepared for movement analysis.",
  };
}

type ProgressStepState = "completed" | "active" | "upcoming";

function progressSteps(status: AnalysisStatus, stage: string): {
  label: string;
  state: ProgressStepState;
}[] {
  const uploaded = status !== "reserved";
  const finalizing = stage === "finalizing" || status === "completed";
  const analyzing = stage === "movement_analysis_started" || stage === "rep_completed" || finalizing;
  const preparing = status === "running" && !analyzing;

  return [
    { label: uploaded ? "Video uploaded" : "Video upload", state: uploaded ? "completed" : "active" },
    {
      label: preparing ? "Preparing analysis" : "Movement analysis",
      state: finalizing ? "completed" : analyzing || preparing ? "active" : "upcoming",
    },
    {
      label: "Results preparation",
      state: status === "completed" ? "completed" : finalizing ? "active" : "upcoming",
    },
  ];
}

function ProgressStep({ label, state }: { label: string; state: ProgressStepState }) {
  return (
    <li className={`flex items-center gap-3 ${state === "upcoming" ? "text-foreground-faint" : "text-foreground"}`}>
      {state === "completed" ? <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
        : state === "active" ? <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
        : <span className="size-4 shrink-0 rounded-full border border-border" aria-hidden="true" />}
      <span>{label}</span>
    </li>
  );
}

export function GuestAnalysisClient({
  analysisId,
  movement,
  config,
  safetyGuidance,
  authenticated = false,
}: {
  analysisId: string | null;
  movement: SelectedMovement;
  config: UploadConfig;
  safetyGuidance: ReactNode;
  authenticated?: boolean;
}) {
  const router = useRouter();
  const restorationRef = useRef<{
    id: string;
    request: Promise<{ status: AnalysisStatus; stage: string; result: GuestResult | null }>;
  } | null>(null);
  const lastEventId = useRef(0);
  const currentAttempt = useRef(0);
  const [step, setStep] = useState<Step>(analysisId ? "restoring" : "video");
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [access, setAccess] = useState<AnalysisAccess | null>(null);
  const [status, setStatus] = useState<AnalysisStatus>("reserved");
  const [observing, setObserving] = useState(false);
  const [stage, setStage] = useState("reserved");
  const [reps, setReps] = useState<RepClassification[]>([]);
  const [result, setResult] = useState<GuestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [recoveryIssue, setRecoveryIssue] = useState<RecoveryIssue>(null);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  useEffect(() => {
    if (!analysisId) return;
    let active = true;
    const saved: AnalysisAccess | null = authenticated
      ? { analysis_id: analysisId, kind: "authenticated" }
      : getGuestAnalysisSession(analysisId);
    if (!saved) {
      queueMicrotask(() => {
        if (!active) return;
        setRecoveryIssue("missing");
        setStep("unavailable");
      });
      return () => { active = false; };
    }

    if (restorationRef.current?.id !== analysisId) {
      restorationRef.current = {
        id: analysisId,
        request: statusFor(saved, authenticated).then(async (current) => ({
          status: current.status,
          stage: current.stage,
          result: current.status === "completed" ? await resultFor(saved, authenticated) : null,
        })),
      };
    }

    restorationRef.current.request.then(
      ({ status: restoredStatus, stage: restoredStage, result: restoredResult }) => {
        if (!active) return;
        setAccess(saved);
        setStatus(restoredStatus);
        setStage(restoredStage);
        const action = recoveryActionForStatus(restoredStatus);
        if (action === "reselect-video") {
          setStep("video");
        } else if (action === "poll") {
          setStep("processing");
          setObserving(true);
        } else if (action === "fetch-result") {
          if (!restoredResult?.result) {
            setError("The analysis completed without a result.");
            setStep("processing");
          } else {
            setResult(restoredResult);
            setStep("results");
          }
        } else {
          if (action === "expired" && !authenticated) removeGuestAnalysisSession(analysisId);
          setStep("processing");
        }
      },
      (cause: unknown) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) {
          if (!authenticated) removeGuestAnalysisSession(analysisId);
          setRecoveryIssue("invalid");
          setStep("unavailable");
        } else {
          setError(messageFor(cause));
          setStep("processing");
        }
      },
    );
    return () => { active = false; };
  }, [analysisId, authenticated]);

  useEffect(() => {
    if (step !== "processing" || !access || !observing) return;
    let active = true;
    let settled = false;
    const controller = new AbortController();

    async function finish(nextStatus: AnalysisStatus) {
      if (!active || settled) return;
      setStatus(nextStatus);
      if (nextStatus === "completed") {
        const completed = await resultFor(access!, authenticated);
        if (!active || settled) return;
        if (!completed.result) throw new Error("The analysis completed without a result.");
        settled = true;
        setResult(completed);
        setObserving(false);
        setStep("results");
      } else if (nextStatus === "failed" || nextStatus === "expired") {
        settled = true;
        setObserving(false);
        if (nextStatus === "expired" && !authenticated)
          removeGuestAnalysisSession(access!.analysis_id);
      }
    }

    async function receive(event: AnalysisProgressEvent) {
      if (!active || settled) return;
      if (event.id !== null) {
        if (event.id <= lastEventId.current) return;
        lastEventId.current = event.id;
      }
      if (event.type === "state") {
        setStatus(event.status);
        setStage(event.stage);
        if (["completed", "failed", "expired"].includes(event.status)) await finish(event.status);
        return;
      }
      if (event.type.startsWith("explanation_")) return;
      if (event.attempt < currentAttempt.current) return;
      if (event.attempt > currentAttempt.current) {
        currentAttempt.current = event.attempt;
        setReps([]);
      }
      if (event.type === "analysis_queued") {
        setStatus("queued");
        setStage("queued");
      } else if (event.type === "processing_started") {
        setStatus("running");
        setStage("processing_started");
      } else if (event.type === "rep_completed") {
        setReps((previous) => [
          ...previous.filter((rep) => rep.rep_index !== event.rep_index),
          { rep_index: event.rep_index, outcome: event.outcome,
            variations: event.classification, target_match: event.target_match,
            target_deviations: event.target_deviations },
        ].sort((left, right) => left.rep_index - right.rep_index));
      } else if (event.type === "completed" || event.type === "failed") {
        setStage(event.type);
        await finish(event.type);
      } else {
        setStatus("running");
        setStage(event.type);
      }
    }

    async function observe() {
      let failures = 0;
      while (active && !settled) {
        try {
          if (authenticated) {
            await streamAuthenticatedAnalysis(
              access!.analysis_id,
              lastEventId.current,
              controller.signal,
              receive,
            );
          } else {
            await streamGuestAnalysis(
              access! as GuestAccess,
              lastEventId.current,
              controller.signal,
              receive,
            );
          }
          if (active && !settled) throw new Error("Progress stream disconnected.");
        } catch (cause) {
          if (!active || controller.signal.aborted) return;
          if (cause instanceof ApiError && cause.status === 401) {
            if (!authenticated) removeGuestAnalysisSession(access!.analysis_id);
            setObserving(false);
            setError(INVALID_ACCESS_MESSAGE);
            return;
          }
          failures += 1;
          if (failures >= 3) {
            try {
              const current = await statusFor(access!, authenticated);
              if (!active) return;
              setStatus(current.status);
              setStage(current.stage);
              await finish(current.status);
              if (settled) return;
            } catch (statusError) {
              if (statusError instanceof ApiError && statusError.status === 401) {
                if (!authenticated) removeGuestAnalysisSession(access!.analysis_id);
                setObserving(false);
                setError(INVALID_ACCESS_MESSAGE);
                return;
              }
            }
          }
          await new Promise((resolve) => setTimeout(resolve,
            Math.min(1000 * 2 ** Math.min(failures - 1, 3), 8000)));
        }
      }
    }

    void observe();
    return () => {
      active = false;
      controller.abort();
    };
  }, [step, access, observing, authenticated]);

  function selectFile(next: File) {
    if (next.size === 0) {
      setError("Choose a nonempty MP4 video.");
      return;
    }
    if (!/\.mp4$/i.test(next.name) || (next.type && next.type !== "video/mp4")) {
      setError("Choose an MP4 video.");
      return;
    }
    if (next.size > config.maxSizeBytes) {
      setError(`Choose a video no larger than ${Math.round(config.maxSizeBytes / 1048576)} MB.`);
      return;
    }
    setError(null);
    setFile(next);
    setVideoUrl(URL.createObjectURL(next));
    setDuration(null);
    setStep("ready");
  }

  async function analyze() {
    if (!file || !acknowledged || duration === null || duration > config.maxDurationSeconds) return;
    setError(null);
    setStatus("reserved");
    setStage("reserved");
    setObserving(false);
    setReps([]);
    lastEventId.current = 0;
    currentAttempt.current = 0;
    setStep("processing");
    let currentAccess = access;
    try {
      if (!currentAccess) {
        currentAccess = authenticated
          ? await reserveAuthenticatedAnalysis(
              movement.id,
              movement.safetyDocumentationId,
              config.safetyAckVersion,
            )
          : await reserveGuestAnalysis(
              movement.id,
              movement.safetyDocumentationId,
              config.safetyAckVersion,
            );
        setAccess(currentAccess);
        if (!authenticated && !saveGuestAnalysisSession(currentAccess as GuestAccess))
          setStorageWarning(true);
        window.history.replaceState(
          null,
          "",
          analysisUrlWithId(window.location.href, currentAccess.analysis_id),
        );
      }
      if (authenticated) {
        await uploadAuthenticatedVideo(currentAccess as AuthenticatedAnalysisAccess, file);
      } else {
        await uploadGuestVideo(currentAccess as GuestAccess, file);
      }
      setStatus("queued");
      setStage("queued");
      setObserving(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401 && currentAccess) {
        if (!authenticated) removeGuestAnalysisSession(currentAccess.analysis_id);
      }
      setError(messageFor(cause));
    }
  }

  function restart() {
    const currentId = access?.analysis_id ?? analysisId;
    if (currentId && !authenticated) removeGuestAnalysisSession(currentId);
    setAccess(null);
    setFile(null);
    setVideoUrl(null);
    setResult(null);
    setObserving(false);
    setReps([]);
    lastEventId.current = 0;
    currentAttempt.current = 0;
    setError(null);
    setRecoveryIssue(null);
    setStep("video");
    router.replace("/analyze");
  }

  const accessInvalid = error === INVALID_ACCESS_MESSAGE;
  const copy = progressCopy(status, stage);
  const progressTitle = accessInvalid ? "Analysis access expired."
    : error && status !== "failed" && status !== "expired" ? "Analysis could not continue."
    : copy.title;
  const progressDescription = accessInvalid
    ? "Your current session no longer grants access to the analysis."
    : error && status !== "failed" && status !== "expired"
      ? "Start a new analysis to try again."
      : copy.description;

  return (
    <>
      <AnalyzeSteps activeIndex={step === "video" || step === "ready" ? 1 : 2} />
      <div className="pt-12 sm:pt-16">
        {error && <div className="mb-7 rounded-2xl border border-destructive/35 bg-destructive/10 p-4 text-sm text-foreground" role="alert">{error}</div>}
        {storageWarning && <div className="mb-7 rounded-2xl border border-border bg-card p-4 text-sm text-foreground-soft" role="status">This browser could not save guest access. The analysis can continue, but it cannot be restored after refresh.</div>}
        {step === "restoring" && (
          <section className="rounded-[3px_3px_34px_3px] border border-border bg-card p-8 sm:p-12" role="status" aria-live="polite">
            <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden="true" />
            <h2 className="mt-6 text-3xl font-medium tracking-tight">Restoring analysis…</h2>
            <p className="mt-3 text-sm text-foreground-soft">Checking its current status and access.</p>
          </section>
        )}
        {step === "unavailable" && (
          <section className="rounded-[3px_3px_34px_3px] border border-border bg-card p-8 sm:p-12" aria-labelledby="recovery-title">
            <span className="font-mono text-[0.59rem] font-semibold tracking-widest text-primary uppercase">Analysis</span>
            <h2 id="recovery-title" className="mt-4 text-3xl font-medium tracking-tight">{recoveryIssue === "invalid" ? "Analysis access expired." : "This analysis cannot be restored here."}</h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-foreground-soft">{recoveryIssue === "invalid" ? "The saved access is expired or invalid." : "This session has no matching access to that analysis."}</p>
            <Button variant="outline" className="mt-8" onClick={restart}>Start a new analysis</Button>
          </section>
        )}
        {(step === "video" || step === "ready") && (
          <>
            <Link href="/analyze" className="mb-6 -ml-2 inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-foreground hover:bg-muted"><ArrowLeft className="size-4" /> Change exercise</Link>
            <section aria-labelledby="video-step-title">
              <div className="flex flex-wrap items-end justify-between gap-5">
                <div><span className="font-mono text-[0.59rem] font-semibold tracking-widest text-primary uppercase">Step 02 / Video</span><h2 id="video-step-title" className="mt-3 text-[clamp(2rem,4vw,3.6rem)] leading-none font-medium tracking-[-0.055em] text-foreground">{step === "ready" ? "Review before analysis." : "Add one clear repetition set."}</h2></div>
                <span className="rounded-full border border-border bg-card px-4 py-2 text-xs text-foreground-soft">Selected: <strong className="text-foreground">{movement.name}</strong></span>
              </div>
              {step === "video" ? (
                <div className="cv-grid mt-8 grid min-h-90 place-items-center rounded-[3px_3px_34px_3px] border border-border bg-card px-6 py-12 text-center sm:min-h-107.5" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files[0]) selectFile(event.dataTransfer.files[0]); }}>
                  <div className="grid max-w-md justify-items-center"><span className="grid size-14 place-items-center rounded-full border border-border bg-background text-primary"><Upload className="size-5" /></span><h3 className="mt-6 text-2xl font-medium tracking-tight">{access ? "Re-select your video" : "Choose a short video"}</h3><p className="mt-3 text-sm leading-6 text-foreground-soft">{access ? "Your reservation is ready. The local file was cleared by refresh, so choose the MP4 again to continue." : "Keep your full movement and equipment visible throughout the set."}</p>
                    <label className="mt-7 cursor-pointer rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">Choose MP4 video<input className="sr-only" type="file" accept="video/mp4,.mp4" onChange={(event) => { if (event.target.files?.[0]) selectFile(event.target.files[0]); event.currentTarget.value = ""; }} /></label>
                    <p className="mt-6 font-mono text-[0.56rem] tracking-[0.08em] text-foreground-faint uppercase">MP4 · Maximum {Math.round(config.maxSizeBytes / 1048576)} MB · {config.maxDurationSeconds} seconds</p>
                  </div>
                </div>
              ) : file && videoUrl ? (
                <div className="mt-8 overflow-hidden rounded-[3px_3px_34px_3px] border border-border bg-card lg:grid lg:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="relative min-h-90 bg-visual-surface lg:min-h-140"><video className="absolute inset-0 size-full object-contain" src={videoUrl} controls playsInline preload="metadata" onLoadedMetadata={(event) => { const value = event.currentTarget.duration; if (Number.isFinite(value) && value > 0) setDuration(value); else setError("The video duration could not be read. Choose another MP4 clip."); }} onError={() => setError("This video could not be previewed. Choose another MP4 clip.")} /><span className="absolute top-4 left-4 rounded-full bg-visual-surface/80 px-3 py-2 font-mono text-[0.55rem] text-visual-foreground uppercase">Local preview</span></div>
                  <aside className="flex flex-col border-t border-border p-6 lg:border-t-0 lg:border-l"><span className="font-mono text-[0.58rem] tracking-widest text-foreground-faint uppercase">Upload details</span><h3 className="mt-3 text-2xl font-medium">{movement.name}</h3><p className="mt-5 break-all text-sm text-foreground-soft">{file.name}</p><p className="mt-2 text-sm text-foreground-soft">{duration === null ? "Reading duration…" : `${duration.toFixed(1)} seconds`} · {config.maxDurationSeconds} seconds maximum</p>
                    {duration !== null && duration > config.maxDurationSeconds && <p className="mt-5 text-sm text-destructive" role="alert">This clip is too long. Choose a shorter video.</p>}
                    <label className="mt-7 flex items-start gap-3 text-sm leading-6 text-foreground"><input className="mt-1 accent-primary" type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />I have read the safety guidance below and understand this analysis is informational.</label>
                    <Button variant="brand" size="lg" className="mt-6 w-full" disabled={!acknowledged || duration === null || duration > config.maxDurationSeconds} onClick={analyze}>{access ? "Continue analysis" : "Analyze movement"} <ScanLine className="size-4" /></Button>
                    <label className="mt-3 cursor-pointer text-center text-sm text-primary underline">Replace video<input className="sr-only" type="file" accept="video/mp4,.mp4" onChange={(event) => { if (event.target.files?.[0]) selectFile(event.target.files[0]); event.currentTarget.value = ""; }} /></label>
                  </aside>
                </div>
              ) : null}
            </section>
            {safetyGuidance}
          </>
        )}

        {step === "processing" && (
          <section className="overflow-hidden rounded-[3px_3px_34px_3px] border border-border bg-card" role="status" aria-live="polite">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-6 sm:p-8">
              <div><span className="font-mono text-[0.59rem] font-semibold tracking-widest text-primary uppercase">Step 03 / Analysis</span>
                <h2 className="mt-3 text-[clamp(2rem,4vw,3.5rem)] leading-none font-medium tracking-[-0.06em]">{progressTitle}</h2>
                <p className="mt-3 text-sm text-foreground-soft">{progressDescription}</p></div>
              <span className="rounded-full border border-primary/40 px-3 py-1.5 font-mono text-[0.65rem] text-primary uppercase">{observing ? "● Live" : "Analysis"}</span>
            </header>
            <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="flex min-w-0 flex-col border-b border-border bg-background-alt p-6 lg:border-r lg:border-b-0 sm:p-8">
                <span className="font-mono text-[0.59rem] tracking-widest text-foreground-faint uppercase">{movement.id ? "Selected target" : "Mode"}</span>
                <h3 className="mt-2 text-2xl font-medium tracking-tight">{movement.name}</h3>
                {!movement.id && <p className="mt-2 text-sm text-foreground-soft">Each supported rep will be classified independently.</p>}
                <div className="relative mx-auto mt-4 h-32 w-full max-w-80 sm:h-56 lg:mt-auto lg:h-72">
                  {movement.illustrationUrl ? <Image src={movement.illustrationUrl} alt="" fill sizes="(max-width: 1024px) 80vw, 35vw" className="object-contain" /> : <span className="grid size-full place-items-center text-primary"><ScanLine className="size-20" aria-hidden="true" /></span>}
                </div>
              </div>
              <div className="flex min-w-0 flex-col p-6 sm:p-8">
                <div className="flex items-baseline justify-between gap-3"><h3 className="font-mono text-[0.64rem] font-semibold tracking-widest text-primary uppercase">Live rep analysis</h3><span className="text-xs text-foreground-soft">{reps.length} detected</span></div>
                <ol className="mt-4 h-72 min-h-0 space-y-3 overflow-y-auto overscroll-contain pr-1 sm:h-88" aria-label="Detected repetitions">
                  {reps.length === 0 && <li className="rounded-xl border border-dashed border-border p-5 text-sm text-foreground-soft">Reps will appear here as they are analyzed.</li>}
                  {reps.map((rep) => {
                    const labels = classificationLabels(rep);
                    const relation = targetRelation(rep, !movement.id, movement.slug);
                    return <li key={rep.rep_index} className="rounded-xl border border-border bg-background p-4">
                      <div className="flex items-center justify-between gap-4"><span className="font-mono text-xs text-primary">REP {String(rep.rep_index).padStart(2, "0")}</span><span className="rounded-full border border-border px-2 py-0.5 text-xs capitalize">{rep.outcome}</span></div>
                      <strong className="mt-2 block text-lg">{labels.base}</strong>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-foreground-soft"><span className="rounded-full bg-muted px-2 py-1">{labels.width}</span><span className="rounded-full bg-muted px-2 py-1">{labels.height}</span></div>
                      {relation && <p className="mt-3 border-t border-border pt-2 text-xs text-foreground-soft">{relation}</p>}
                    </li>;
                  })}
                </ol>
              </div>
            </div>
            <footer className="border-t border-border p-6 sm:px-8"><ol className="flex flex-wrap gap-x-8 gap-y-3 text-xs">{progressSteps(status, stage).map((item) => <ProgressStep key={item.label} {...item} />)}</ol>
              {(error || status === "failed" || status === "expired") && <Button variant="outline" className="mt-6" onClick={restart}>Start a new analysis</Button>}</footer>
          </section>
        )}

        {step === "results" && result?.result && <AnalysisResults analysis={result} access={access} authenticated={authenticated} videoUrl={videoUrl} onRestart={restart} />}
      </div>
    </>
  );
}
