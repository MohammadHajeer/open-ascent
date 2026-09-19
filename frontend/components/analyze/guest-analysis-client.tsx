"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, LoaderCircle, ScanLine, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  getGuestResult,
  getGuestStatus,
  reserveGuestAnalysis,
  uploadGuestVideo,
  type AnalysisStatus,
  type GuestAccess,
  type GuestResult,
} from "@/lib/analysis";
import { AnalysisResults } from "./analysis-results";
import { AnalyzeSteps } from "./analyze-steps";

type SelectedMovement = {
  id: string;
  name: string;
  illustrationUrl: string | null;
  safetyDocumentationId: string;
};

type UploadConfig = {
  maxSizeBytes: number;
  maxDurationSeconds: number;
  safetyAckVersion: string;
};

type Step = "video" | "ready" | "processing" | "results";

function messageFor(error: unknown) {
  if (error instanceof ApiError && error.status === 401)
    return "Analysis access has expired or is invalid. Start a new analysis.";
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

export function GuestAnalysisClient({
  movement,
  config,
  safetyGuidance,
}: {
  movement: SelectedMovement;
  config: UploadConfig;
  safetyGuidance: ReactNode;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("video");
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [access, setAccess] = useState<GuestAccess | null>(null);
  const [status, setStatus] = useState<AnalysisStatus>("reserved");
  const [polling, setPolling] = useState(false);
  const [result, setResult] = useState<GuestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  useEffect(() => {
    if (step !== "processing" || !access || !polling) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const current = await getGuestStatus(access!);
        if (!active) return;
        setStatus(current.status);
        if (current.status === "completed") {
          const completed = await getGuestResult(access!);
          if (!active) return;
          if (!completed.result)
            throw new Error("The analysis completed without a result.");
          setResult(completed);
          setStep("results");
        } else if (current.status !== "failed" && current.status !== "expired") {
          timer = setTimeout(check, 3000);
        }
      } catch (cause) {
        if (active) setError(messageFor(cause));
      }
    }
    timer = setTimeout(check, 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [step, access, polling]);

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
    setPolling(false);
    setStep("processing");
    try {
      const reserved = await reserveGuestAnalysis(
        movement.id,
        movement.safetyDocumentationId,
        config.safetyAckVersion,
      );
      setAccess(reserved);
      await uploadGuestVideo(reserved, file);
      setStatus("queued");
      setPolling(true);
    } catch (cause) {
      setError(messageFor(cause));
    }
  }

  const accessInvalid = error === "Analysis access has expired or is invalid. Start a new analysis.";

  return (
    <>
      <AnalyzeSteps activeIndex={step === "video" || step === "ready" ? 1 : 2} />
      <div className="pt-12 sm:pt-16">
        {error && <div className="mb-7 rounded-2xl border border-destructive/35 bg-destructive/10 p-4 text-sm text-foreground" role="alert">{error}</div>}
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
                  <div className="grid max-w-md justify-items-center"><span className="grid size-14 place-items-center rounded-full border border-border bg-background text-primary"><Upload className="size-5" /></span><h3 className="mt-6 text-2xl font-medium tracking-tight">Choose a short video</h3><p className="mt-3 text-sm leading-6 text-foreground-soft">Keep your full movement and equipment visible throughout the set.</p>
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
                    <Button variant="brand" size="lg" className="mt-6 w-full" disabled={!acknowledged || duration === null || duration > config.maxDurationSeconds} onClick={analyze}>Analyze movement <ScanLine className="size-4" /></Button>
                    <label className="mt-3 cursor-pointer text-center text-sm text-primary underline">Replace video<input className="sr-only" type="file" accept="video/mp4,.mp4" onChange={(event) => { if (event.target.files?.[0]) selectFile(event.target.files[0]); event.currentTarget.value = ""; }} /></label>
                  </aside>
                </div>
              ) : null}
            </section>
            {safetyGuidance}
          </>
        )}

        {step === "processing" && (
          <section className="overflow-hidden rounded-[3px_3px_34px_3px] border border-border bg-card lg:grid lg:grid-cols-2" role="status" aria-live="polite">
            <div className="relative grid min-h-85 place-items-center bg-background-alt p-8 lg:min-h-140">{movement.illustrationUrl && <div className="relative aspect-square w-full max-w-95"><Image src={movement.illustrationUrl} alt="" fill sizes="40vw" className="object-contain" /></div>}</div>
            <div className="flex flex-col justify-center p-7 sm:p-12"><span className="font-mono text-[0.59rem] font-semibold tracking-widest text-primary uppercase">Step 03 / Analysis</span><h2 className="mt-4 text-[clamp(2.6rem,5vw,4.5rem)] leading-[0.94] font-medium tracking-[-0.06em]">{accessInvalid ? "Guest access expired." : status === "failed" ? "Analysis failed." : status === "expired" ? "Analysis expired." : error ? "Analysis could not continue." : status === "reserved" ? "Uploading video…" : status === "queued" ? "Waiting for analysis…" : "Analyzing movement…"}</h2>
              <p className="mt-5 text-sm leading-6 text-foreground-soft">{status === "failed" ? "The video could not be processed. This is a processing failure, not a judgment of your movement." : accessInvalid ? "This guest credential no longer grants access to the analysis." : error ? "Start a new analysis to try again." : "The uploaded video is processed privately. Results appear when the worker completes."}</p>
              <div className="mt-8 grid gap-3 text-sm"><span className="flex items-center gap-3"><Check className="size-4 text-primary" /> Video selected</span><span className="flex items-center gap-3">{status === "reserved" ? <LoaderCircle className="size-4 animate-spin text-primary" /> : <Check className="size-4 text-primary" />} Upload and verification</span><span className="flex items-center gap-3">{status === "running" ? <LoaderCircle className="size-4 animate-spin text-primary" /> : <span className="size-4 rounded-full border border-border" />} Deterministic analysis</span></div>
              {(error || status === "failed" || status === "expired") && <Button variant="outline" className="mt-8 w-fit" onClick={() => router.push("/analyze")}>Start a new analysis</Button>}
            </div>
          </section>
        )}

        {step === "results" && result?.result && <AnalysisResults analysis={result} videoUrl={videoUrl} onRestart={() => router.push("/analyze")} />}
      </div>
    </>
  );
}
