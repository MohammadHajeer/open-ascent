"use client";

import { useQuery } from "@tanstack/react-query";

import { progressSummaryQuery } from "./queries";

export const useProgressSummary = () => useQuery(progressSummaryQuery());
