import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { SavedPlanLibrary } from "./saved-plan-library";
import { SavedPlanDetail } from "./saved-plan-detail";
import * as api from "./api";

vi.mock("./api", () => ({ listSavedPlans: vi.fn(), getSavedPlan: vi.fn() }));

const summary = {
  id: "6a1380c8-69ec-49d2-8d5d-f10685fd7c78",
  title: "Weekly strength",
  summary: "A measured week.",
  saved_at: "2026-09-24T10:00:00Z",
  training_day_count: 2,
  movement_count: 2,
};

function renderQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.mocked(api.listSavedPlans).mockResolvedValue([]);
  vi.mocked(api.getSavedPlan).mockResolvedValue({
    ...summary,
    days: [
      { day_index: 1, label: "Strength", exercises: [{ movement_id: "a", movement_name: "Pull-Up", movement_slug: "pull-up", sets: 3, reps: 5, hold_seconds: null, rest_seconds: 90, notes: null }] },
      { day_index: 2, label: "Skill", exercises: [{ movement_id: "b", movement_name: "Front Lever", movement_slug: "front-lever", sets: 2, reps: null, hold_seconds: 20, rest_seconds: 120, notes: "Keep control." }] },
    ],
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("saved plan Library", () => {
  it("shows a loading state, then a useful empty state", async () => {
    let resolve!: (plans: api.SavedPlanSummary[]) => void;
    vi.mocked(api.listSavedPlans).mockReturnValue(new Promise((done) => { resolve = done; }));
    renderQuery(<SavedPlanLibrary />);
    expect(screen.getByRole("status").textContent).toContain("Loading your plans");
    resolve([]);
    expect(await screen.findByText("No saved plans yet.")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Open AI Coach" }).length).toBeGreaterThan(0);
  });

  it("lists the current athlete's plans and links to detail", async () => {
    vi.mocked(api.listSavedPlans).mockResolvedValue([summary]);
    renderQuery(<SavedPlanLibrary />);
    expect(await screen.findByText("Weekly strength")).toBeTruthy();
    expect(screen.getByText(/2 training days · 2 movements/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Weekly strength" }).getAttribute("href")).toBe(`/dashboard/library/${summary.id}`);
    expect(screen.getByRole("link", { name: "Open Weekly strength" }).className).toContain("sm:w-auto");
  });

  it("shows a recoverable list error", async () => {
    vi.mocked(api.listSavedPlans).mockRejectedValue(new Error("offline"));
    renderQuery(<SavedPlanLibrary />);
    expect(await screen.findByText("Your plans could not be loaded.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("renders plan days with reps and hold duration", async () => {
    renderQuery(<SavedPlanDetail planId={summary.id} />);
    expect(await screen.findByText("Weekly strength")).toBeTruthy();
    expect(screen.getByText("3 sets × 5 reps · 90 sec rest")).toBeTruthy();
    expect(screen.getByText("2 sets × 20 sec hold · 120 sec rest")).toBeTruthy();
    expect(screen.getByText("Keep control.")).toBeTruthy();
  });

  it("handles missing plans safely", async () => {
    vi.mocked(api.getSavedPlan).mockRejectedValue(new ApiError(404, "http_error", "Training plan not found."));
    renderQuery(<SavedPlanDetail planId="missing" />);
    await waitFor(() => expect(screen.getByText("Plan not found.")).toBeTruthy());
    expect(screen.getByRole("link", { name: "All saved plans" })).toBeTruthy();
  });
});
