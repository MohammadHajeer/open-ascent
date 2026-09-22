"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  useAddWorkoutSet,
  useCreateWorkoutSession,
  useFinishWorkoutSession,
  useWorkoutMovements,
  useWorkoutSession,
  useWorkoutSessions,
} from "./hooks";
import { resolveSessionRecovery } from "./recovery";
import type { WorkoutIntent, WorkoutPerformer, WorkoutSource } from "./types";

function message(error: unknown) {
  return error instanceof Error ? error.message : "The workout could not be saved.";
}

export function useWorkoutLogger() {
  const sessions = useWorkoutSessions();
  const movements = useWorkoutMovements();
  const start = useCreateWorkoutSession();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const { unfinishedSessions, recoveryNeeded, activeSessionId } =
    resolveSessionRecovery(sessions.data ?? [], selectedSessionId);
  const session = useWorkoutSession(activeSessionId);
  const addSet = useAddWorkoutSet(activeSessionId);
  const finish = useFinishWorkoutSession(activeSessionId);

  const [measurement, setMeasurement] = useState<"reps" | "hold">("reps");
  const [movementId, setMovementId] = useState("");
  const [value, setValue] = useState("");
  const [source, setSource] = useState<WorkoutSource>("manual");
  const [performer, setPerformer] = useState<WorkoutPerformer>("self");
  const [intent, setIntent] = useState<WorkoutIntent>("training_set");
  const [analysisId, setAnalysisId] = useState("");
  const [liveCoachRef, setLiveCoachRef] = useState("");
  const [notes, setNotes] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [setError, setSetError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const operationRef = useRef(false);

  const active = session.data;
  const nextPosition = active?.sets.length ?? 0;
  const pendingSet = value.trim().length > 0;
  const recentSessions = sessions.data
    ?.filter((item) => item.id !== activeSessionId)
    .slice(0, 5) ?? [];
  const movementItems = movements.data?.map((item) => ({
    value: item.id,
    label: item.name,
  })) ?? [];

  function resetSetDraft() {
    setMeasurement("reps");
    setMovementId("");
    setValue("");
    setSource("manual");
    setPerformer("self");
    setIntent("training_set");
    setAnalysisId("");
    setLiveCoachRef("");
    setShowDetails(false);
    setSetError(null);
  }

  function selectSession(sessionId: string) {
    resetSetDraft();
    setNotes("");
    setSelectedSessionId(sessionId);
  }

  async function begin() {
    if (operationRef.current) return;
    operationRef.current = true;
    try {
      const created = await start.mutateAsync();
      setSelectedSessionId(created.id);
      setNotes("");
      resetSetDraft();
      toast.success("Workout started");
    } catch (error) {
      toast.error(message(error));
    } finally {
      operationRef.current = false;
    }
  }

  async function saveSetCore(): Promise<boolean> {
    setSetError(null);
    const amount = Number(value);
    if (!activeSessionId || !movementId || !pendingSet || !Number.isFinite(amount) || amount <= 0) {
      setSetError("Choose a movement and enter a positive value.");
      return false;
    }
    if (measurement === "reps" && !Number.isInteger(amount)) {
      setSetError("Repetitions must be a whole number.");
      return false;
    }
    if (source === "uploaded_analysis" && !analysisId) {
      setSetError("Choose a completed analysis for this movement.");
      return false;
    }

    try {
      await addSet.mutateAsync({
        movement_id: movementId,
        position: nextPosition,
        source,
        performer,
        intent,
        ...(measurement === "reps" ? { reps: amount } : { hold_seconds: amount }),
        ...(source === "uploaded_analysis" ? { analysis_id: analysisId } : {}),
        ...(source === "live_coach" && liveCoachRef.trim()
          ? { live_coach_session_ref: liveCoachRef.trim() }
          : {}),
      });
      setValue("");
      setSetError(null);
      toast.success("Set logged");
      return true;
    } catch (error) {
      setSetError(message(error));
      return false;
    }
  }

  async function saveSet() {
    if (operationRef.current || session.isPending) return;
    operationRef.current = true;
    setIsWorking(true);
    try {
      await saveSetCore();
    } finally {
      operationRef.current = false;
      setIsWorking(false);
    }
  }

  async function complete() {
    if (operationRef.current || session.isPending) return;
    operationRef.current = true;
    setIsWorking(true);
    try {
      if (pendingSet && !(await saveSetCore())) return;
      if (nextPosition === 0 && !pendingSet) {
        setSetError("Add at least one set before finishing this workout.");
        return;
      }
      await finish.mutateAsync(notes.trim() || undefined);
      setSelectedSessionId(null);
      setNotes("");
      resetSetDraft();
      toast.success("Workout finished");
    } catch (error) {
      toast.error(message(error));
    } finally {
      operationRef.current = false;
      setIsWorking(false);
    }
  }

  return {
    sessions,
    movements,
    start,
    session,
    addSet,
    finish,
    active,
    activeSessionId,
    unfinishedSessions,
    recoveryNeeded,
    selectSession,
    recentSessions,
    movementItems,
    nextPosition,
    measurement,
    setMeasurement,
    movementId,
    setMovementId,
    value,
    setValue,
    source,
    setSource,
    performer,
    setPerformer,
    intent,
    setIntent,
    analysisId,
    setAnalysisId,
    liveCoachRef,
    setLiveCoachRef,
    notes,
    setNotes,
    showDetails,
    setShowDetails,
    setError,
    isWorking,
    pendingSet,
    begin,
    saveSet,
    complete,
  };
}

export type WorkoutLoggerController = ReturnType<typeof useWorkoutLogger>;
