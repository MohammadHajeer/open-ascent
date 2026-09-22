"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addWorkoutSet,
  createWorkoutSession,
  fetchWorkoutMovements,
  fetchWorkoutSession,
  fetchWorkoutSessions,
  finishWorkoutSession,
} from "./api";
import { workoutKeys } from "./keys";
import type { WorkoutSetInput } from "./types";

export const useWorkoutSessions = () =>
  useQuery({ queryKey: workoutKeys.all, queryFn: fetchWorkoutSessions });

export const useWorkoutSession = (sessionId: string | null) =>
  useQuery({
    queryKey: workoutKeys.detail(sessionId ?? ""),
    queryFn: () => fetchWorkoutSession(sessionId!),
    enabled: Boolean(sessionId),
  });

export const useWorkoutMovements = () =>
  useQuery({ queryKey: workoutKeys.movements, queryFn: fetchWorkoutMovements });

export function useCreateWorkoutSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWorkoutSession,
    onSuccess: (session) => {
      queryClient.setQueryData(workoutKeys.detail(session.id), session);
      void queryClient.invalidateQueries({ queryKey: workoutKeys.all });
    },
  });
}

export function useAddWorkoutSet(sessionId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: WorkoutSetInput) => addWorkoutSet(sessionId!, payload),
    onSuccess: () => {
      if (sessionId) {
        void queryClient.invalidateQueries({
          queryKey: workoutKeys.detail(sessionId),
        });
      }
    },
  });
}

export function useFinishWorkoutSession(sessionId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notes?: string) => finishWorkoutSession(sessionId!, notes),
    onSuccess: (session) => {
      queryClient.setQueryData(workoutKeys.detail(session.id), session);
      void queryClient.invalidateQueries({ queryKey: workoutKeys.all });
    },
  });
}
