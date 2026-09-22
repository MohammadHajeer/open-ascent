"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchProgressSummary } from "./api";
import { progressKeys } from "./keys";

export const useProgressSummary = () =>
  useQuery({ queryKey: progressKeys.summary, queryFn: fetchProgressSummary });
