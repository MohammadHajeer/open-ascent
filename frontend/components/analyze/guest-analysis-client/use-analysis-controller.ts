"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchAuthenticatedAnalysisResult,
  fetchAuthenticatedAnalysisStatus,
  reserveAuthenticatedAnalysis,
  streamAuthenticatedAnalysis,
  uploadAuthenticatedVideo,
} from "@/features/analysis/api";
import { analysisKeys } from "@/features/analysis/keys";
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
  type ExecutionIntent,
} from "@/lib/analysis";
import {
  analysisProgressCopy,
  blocksNewAnalysis,
  isAnalysisServiceUnavailable,
  type AnalysisQueue,
} from "@/lib/analysis-progress";
import {
  analysisAvailabilityQuery,
  analysisPublicKeys,
} from "@/lib/analysis-public";
import {
  streamGuestAnalysis,
  type AnalysisProgressEvent,
} from "@/lib/analysis-stream";
import {
  analysisUrlWithId,
  getGuestAnalysisSession,
  getGuestIdentityCredential,
  recoveryActionForStatus,
  removeGuestAnalysisSession,
  saveGuestAnalysisSession,
} from "@/lib/guest-analysis-session";
import { invalidatePrivateQueries } from "@/lib/private-state";

import type {
  AnalysisAccess,
  RecoveryIssue,
  SelectedMovement,
  Step,
  UploadConfig,
  VideoChoice,
} from "./types";

const INVALID_ACCESS_MESSAGE =
  "Analysis access has expired or is invalid. Start a new analysis.";

function messageFor(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    return INVALID_ACCESS_MESSAGE;
  }

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

export function useAnalysisController({
  analysisId,
  movement,
  config,
  authenticated,
}: {
  analysisId: string | null;
  movement: SelectedMovement;
  config: UploadConfig;
  authenticated: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const restorationRef = useRef<{
    id: string;
    request: Promise<{
      status: AnalysisStatus;
      stage: string;
      queue: AnalysisQueue | null;
      result: GuestResult | null;
    }>;
  } | null>(null);

  const lastEventId = useRef(0);
  const currentAttempt = useRef(0);

  const [step, setStep] = useState<Step>(analysisId ? "restoring" : "video");
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [executionIntent, setExecutionIntent] =
    useState<ExecutionIntent>("normal_training");
  const [access, setAccess] = useState<AnalysisAccess | null>(null);
  const [status, setStatus] = useState<AnalysisStatus>("reserved");
  const [observing, setObserving] = useState(false);
  const [stage, setStage] = useState("reserved");
  const [queue, setQueue] = useState<AnalysisQueue | null>(null);
  const [reps, setReps] = useState<RepClassification[]>([]);
  const [result, setResult] = useState<GuestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [recoveryIssue, setRecoveryIssue] = useState<RecoveryIssue>(null);
  const [videoChoice, setVideoChoice] = useState<VideoChoice>(null);

  // Checked only while choosing a video; once an analysis exists its own
  // status and stream carry the service state.
  const availability = useQuery({
    ...analysisAvailabilityQuery(),
    enabled: step === "video" || step === "ready",
  });
  const serviceState = availability.data ?? null;
  const newAnalysisBlocked = blocksNewAnalysis(serviceState, Boolean(access));

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

      return () => {
        active = false;
      };
    }

    if (restorationRef.current?.id !== analysisId) {
      restorationRef.current = {
        id: analysisId,
        request: statusFor(saved, authenticated).then(async (current) => ({
          status: current.status,
          stage: current.stage,
          queue: current.queue ?? null,
          result:
            current.status === "completed"
              ? await resultFor(saved, authenticated)
              : null,
        })),
      };
    }

    restorationRef.current.request.then(
      ({
        status: restoredStatus,
        stage: restoredStage,
        queue: restoredQueue,
        result: restoredResult,
      }) => {
        if (!active) return;

        setAccess(saved);
        setStatus(restoredStatus);
        setStage(restoredStage);
        setQueue(restoredQueue);

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
          if (action === "expired" && !authenticated) {
            removeGuestAnalysisSession(analysisId);
          }
          setStep("processing");
        }
      },
      (cause: unknown) => {
        if (!active) return;

        if (cause instanceof ApiError && cause.status === 401) {
          if (!authenticated) {
            removeGuestAnalysisSession(analysisId);
          }
          setRecoveryIssue("invalid");
          setStep("unavailable");
        } else {
          setError(messageFor(cause));
          setStep("processing");
        }
      },
    );

    return () => {
      active = false;
    };
  }, [analysisId, authenticated]);

  useEffect(() => {
    if (step !== "processing" || !access || !observing) return;

    let active = true;
    let settled = false;
    const controller = new AbortController();

    async function finish(nextStatus: AnalysisStatus) {
      if (!active || settled) return;

      setStatus(nextStatus);

      // The saved history is cached across navigation; a finished analysis
      // changes it.
      if (authenticated && ["completed", "failed", "expired"].includes(nextStatus)) {
        invalidatePrivateQueries(analysisKeys.all);
      }

      if (nextStatus === "completed") {
        const completed = await resultFor(access!, authenticated);

        if (!active || settled) return;
        if (!completed.result) {
          throw new Error("The analysis completed without a result.");
        }

        settled = true;
        setResult(completed);
        setObserving(false);
        setStep("results");
      } else if (nextStatus === "failed" || nextStatus === "expired") {
        settled = true;
        setObserving(false);

        if (nextStatus === "expired" && !authenticated) {
          removeGuestAnalysisSession(access!.analysis_id);
        }
      }
    }

    async function receive(event: AnalysisProgressEvent) {
      if (!active || settled) return;

      if (event.id !== null) {
        if (event.id <= lastEventId.current) return;
        lastEventId.current = event.id;
      }

      if (event.type === "queue") {
        setQueue({
          service_state: event.service_state,
          analyses_ahead: event.analyses_ahead,
        });
        return;
      }

      if (event.type === "state") {
        setStatus(event.status);
        setStage(event.stage);

        if (["completed", "failed", "expired"].includes(event.status)) {
          await finish(event.status);
        }
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
        // A worker claimed it; the queued snapshot no longer applies.
        setQueue(null);
        setStatus("running");
        setStage("processing_started");
      } else if (event.type === "rep_completed") {
        setReps((previous) =>
          [
            ...previous.filter((rep) => rep.rep_index !== event.rep_index),
            {
              rep_index: event.rep_index,
              outcome: event.outcome,
              variations: event.classification,
              target_match: event.target_match,
              target_deviations: event.target_deviations,
            },
          ].sort((left, right) => left.rep_index - right.rep_index),
        );
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

          if (active && !settled) {
            throw new Error("Progress stream disconnected.");
          }
        } catch (cause) {
          if (!active || controller.signal.aborted) return;

          if (cause instanceof ApiError && cause.status === 401) {
            if (!authenticated) {
              removeGuestAnalysisSession(access!.analysis_id);
            }
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
              setQueue(current.queue ?? null);
              await finish(current.status);

              if (settled) return;
            } catch (statusError) {
              if (
                statusError instanceof ApiError &&
                statusError.status === 401
              ) {
                if (!authenticated) {
                  removeGuestAnalysisSession(access!.analysis_id);
                }
                setObserving(false);
                setError(INVALID_ACCESS_MESSAGE);
                return;
              }
            }
          }

          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Math.min(1000 * 2 ** Math.min(failures - 1, 3), 8000),
            ),
          );
        }
      }
    }

    void observe();

    return () => {
      active = false;
      controller.abort();
    };
  }, [step, access, observing, authenticated]);

  function replaceVideoUrl(nextUrl: string | null) {
    setVideoUrl((current) => {
      if (current && current !== nextUrl) {
        URL.revokeObjectURL(current);
      }
      return nextUrl;
    });
  }

  function selectFile(next: File, knownDuration?: number) {
    const recorded = knownDuration !== undefined;

    if (next.size === 0) {
      setError(
        recorded
          ? "The recording is empty. Please record again."
          : "Choose a nonempty MP4 video.",
      );
      return;
    }

    const baseType = next.type.split(";", 1)[0].toLowerCase();
    const compatibleRecording =
      recorded && ["video/mp4", "video/webm"].includes(baseType);

    if (
      !compatibleRecording &&
      (!/\.mp4$/i.test(next.name) || (next.type && baseType !== "video/mp4"))
    ) {
      setError("Choose an MP4 video.");
      return;
    }

    if (next.size > config.maxSizeBytes) {
      setError(
        `Choose a video no larger than ${Math.round(
          config.maxSizeBytes / 1048576,
        )} MB.`,
      );
      return;
    }

    setError(null);
    setFile(next);
    replaceVideoUrl(URL.createObjectURL(next));
    setDuration(knownDuration ?? null);
    setStep("ready");
  }

  async function analyze(
    selectedFile = file,
    selectedDuration = duration,
  ) {
    if (
      !selectedFile ||
      !acknowledged ||
      selectedDuration === null ||
      selectedDuration > config.maxDurationSeconds
    ) {
      return;
    }

    // The service is known to be down: keep the chosen video on the review
    // screen, where the start action is disabled with an explanation.
    if (blocksNewAnalysis(serviceState, Boolean(access))) {
      setStep("ready");
      return;
    }

    setError(null);
    setStatus("reserved");
    setStage("reserved");
    setQueue(null);
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
              executionIntent,
            )
          : await reserveGuestAnalysis(
              movement.id,
              movement.safetyDocumentationId,
              config.safetyAckVersion,
              executionIntent,
              getGuestIdentityCredential(),
            );

        setAccess(currentAccess);
        if (authenticated) invalidatePrivateQueries(analysisKeys.all);

        if (
          !authenticated &&
          !saveGuestAnalysisSession(currentAccess as GuestAccess)
        ) {
          setStorageWarning(true);
        }

        window.history.replaceState(
          null,
          "",
          analysisUrlWithId(window.location.href, currentAccess.analysis_id),
        );
      }

      if (authenticated) {
        await uploadAuthenticatedVideo(
          currentAccess as AuthenticatedAnalysisAccess,
          selectedFile,
        );
      } else {
        await uploadGuestVideo(currentAccess as GuestAccess, selectedFile);
      }

      setStatus("queued");
      setStage("queued");
      setObserving(true);
    } catch (cause) {
      // The backend re-checks worker health when reserving. If it refused,
      // nothing was created: return to review and show the outage there.
      if (!currentAccess && isAnalysisServiceUnavailable(cause)) {
        queryClient.setQueryData(analysisPublicKeys.availability, "unavailable");
        setStep("ready");
        return;
      }

      if (cause instanceof ApiError && cause.status === 401 && currentAccess) {
        if (!authenticated) {
          removeGuestAnalysisSession(currentAccess.analysis_id);
        }
      }

      setError(messageFor(cause));
    }
  }

  function restart() {
    const currentId = access?.analysis_id ?? analysisId;

    if (currentId && !authenticated) {
      removeGuestAnalysisSession(currentId);
    }

    setAccess(null);
    setFile(null);
    replaceVideoUrl(null);
    setDuration(null);
    setResult(null);
    setQueue(null);
    setObserving(false);
    setReps([]);
    lastEventId.current = 0;
    currentAttempt.current = 0;
    setError(null);
    setStorageWarning(false);
    setRecoveryIssue(null);
    setVideoChoice(null);
    setAcknowledged(false);
    setExecutionIntent("normal_training");
    setStep("video");

    router.replace("/analyze");
  }

  const accessInvalid = error === INVALID_ACCESS_MESSAGE;
  const copy = analysisProgressCopy(status, stage, queue);

  const progressTitle = accessInvalid
    ? "Analysis access expired."
    : error && status !== "failed" && status !== "expired"
      ? "Analysis could not continue."
      : copy.title;

  const progressDescription = accessInvalid
    ? "Your current session no longer grants access to the analysis."
    : error && status !== "failed" && status !== "expired"
      ? "Start a new analysis to try again."
      : copy.description;

  return {
    step,
    file,
    videoUrl,
    duration,
    setVideoDuration: setDuration,
    acknowledged,
    setAcknowledged,
    executionIntent,
    setExecutionIntent,
    access,
    status,
    observing,
    stage,
    queue,
    serviceState,
    newAnalysisBlocked,
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
  };
}
