"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { progressKeys } from "@/features/progress/keys";

import {
  addWorkoutSet,
  createWorkoutSession,
  discardWorkoutSession,
  fetchWorkoutSession,
  finishWorkoutSession,
} from "./api";
import { clearActiveWorkout, incrementActiveSetCount } from "./active-cache";
import { workoutKeys } from "./keys";
import { activeWorkoutQuery, workoutMovementsQuery, workoutSessionsQuery } from "./queries";
import type {
  WorkoutSession,
  WorkoutSessionDetail,
  WorkoutSetInput,
} from "./types";

export const useWorkoutSessions = () => useQuery(workoutSessionsQuery());

export const useActiveWorkoutSession = (enabled = true) =>
  useQuery({ ...activeWorkoutQuery(), enabled });

export const useWorkoutSession = (sessionId: string | null) =>
  useQuery({
    queryKey: workoutKeys.detail(sessionId ?? ""),
    queryFn: () => fetchWorkoutSession(sessionId!),
    enabled: Boolean(sessionId),
  });

export const useWorkoutMovements = () => useQuery(workoutMovementsQuery());

// Logged sets feed the progress summary, which is otherwise reused from cache.
const invalidateProgress = (queryClient: ReturnType<typeof useQueryClient>) =>
  queryClient.invalidateQueries({ queryKey: progressKeys.summary });

export function useCreateWorkoutSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWorkoutSession,
    onSuccess: (session) => {
      queryClient.setQueryData(workoutKeys.active, session);
      queryClient.setQueryData(workoutKeys.detail(session.id), session);
      queryClient.setQueryData<WorkoutSession[]>(workoutKeys.all, (current) =>
        current ? [session, ...current.filter((item) => item.id !== session.id)] : [session],
      );
      void queryClient.invalidateQueries({ queryKey: workoutKeys.all });
    },
  });
}

export function useAddWorkoutSet(sessionId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: WorkoutSetInput) => addWorkoutSet(sessionId!, payload),
    onSuccess: (workoutSet) => {
      if (sessionId) {
        queryClient.setQueryData<WorkoutSessionDetail>(
          workoutKeys.detail(sessionId),
          (current) =>
            current
              ? { ...current, set_count: current.set_count + 1, sets: [...current.sets, workoutSet] }
              : current,
        );
        queryClient.setQueryData<WorkoutSession | null>(workoutKeys.active, (current) =>
          incrementActiveSetCount(current, sessionId),
        );
        void queryClient.invalidateQueries({
          queryKey: workoutKeys.detail(sessionId),
        });
        void invalidateProgress(queryClient);
      }
    },
  });
}

export function useFinishWorkoutSession(sessionId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (options?: { notes?: string; completedAt?: string }) =>
      finishWorkoutSession(sessionId!, options),
    onSuccess: (session) => {
      queryClient.setQueryData<WorkoutSession | null>(workoutKeys.active, (current) =>
        clearActiveWorkout(current, session.id),
      );
      queryClient.setQueryData(workoutKeys.detail(session.id), session);
      queryClient.setQueryData<WorkoutSession[]>(workoutKeys.all, (current) =>
        current?.map((item) => (item.id === session.id ? session : item)),
      );
      void queryClient.invalidateQueries({ queryKey: workoutKeys.all });
      void invalidateProgress(queryClient);
    },
  });
}

export function useDiscardWorkoutSession(sessionId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => discardWorkoutSession(sessionId!),
    onSuccess: () => {
      queryClient.setQueryData<WorkoutSession | null>(workoutKeys.active, (current) =>
        clearActiveWorkout(current, sessionId!),
      );
      queryClient.removeQueries({ queryKey: workoutKeys.detail(sessionId!) });
      queryClient.setQueryData<WorkoutSession[]>(workoutKeys.all, (current) =>
        current?.filter((item) => item.id !== sessionId),
      );
      void queryClient.invalidateQueries({ queryKey: workoutKeys.all });
      void invalidateProgress(queryClient);
    },
  });
}
