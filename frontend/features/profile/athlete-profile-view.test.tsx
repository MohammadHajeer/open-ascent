import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { authApiFetch } from "@/lib/auth-api";
import { AthleteProfileView } from "./athlete-profile-view";
import type { AthleteProfile } from "./types";

vi.mock("@/lib/auth-api", () => ({ authApiFetch: vi.fn() }));

const full: AthleteProfile = {
  display_name: "Maya Okafor",
  context: {
    athlete_reported_profile: {
      primary_goal: "skill",
      equipment: ["pull_up_bar", "rings"],
      availability: { days_per_week: 4, minutes_per_session: 45 },
      starting_training_experience: "intermediate",
      starting_self_reported_clean_rep_max: { pull_up: 8, push_up: 25 },
    },
    athlete_state: {
      overall_level: "intermediate",
      overall_source: "logged_training",
      current_capabilities: [{ movement_slug: "pull_up", value: 9, source: "logged_set", confidence: "high" }],
    },
  },
};

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><AthleteProfileView /></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("AthleteProfileView", () => {
  it("shows a labelled loading state first", () => {
    vi.mocked(authApiFetch).mockReturnValue(new Promise(() => {}));
    renderView();

    expect(screen.getByRole("status", { name: "Loading your profile" })).toBeTruthy();
  });

  it("presents identity, training context, capabilities and the self-reported baseline", async () => {
    vi.mocked(authApiFetch).mockResolvedValue(full);
    renderView();

    expect(await screen.findByRole("heading", { name: "Maya Okafor" })).toBeTruthy();
    expect(screen.getByText("Intermediate level")).toBeTruthy();

    const context = screen.getByText("Goals and setup").closest("section") as HTMLElement;
    expect(within(context).getByText("Pull Up Bar")).toBeTruthy();
    expect(within(context).getByText("4 days a week · 45 minutes per session")).toBeTruthy();

    const current = screen.getByText("Where you are now").closest("section") as HTMLElement;
    expect(within(current).getByText("Pull Up")).toBeTruthy();
    expect(within(current).getByText(/started at 8/)).toBeTruthy();
    expect(within(current).getAllByText("High confidence").length).toBeGreaterThan(0);

    const baseline = screen.getByText("Self-reported baseline").closest("section") as HTMLElement;
    expect(within(baseline).getByText("Push Up")).toBeTruthy();
    expect(within(baseline).getAllByText("Self reported")).toHaveLength(2);
  });

  it("says what is missing instead of inventing values", async () => {
    vi.mocked(authApiFetch).mockResolvedValue({ display_name: "Jon", context: {} });
    renderView();

    expect(await screen.findByRole("heading", { name: "Jon" })).toBeTruthy();
    expect(screen.getAllByText("Not provided").length).toBeGreaterThan(0);
    expect(screen.getByText(/No current capability estimate yet/)).toBeTruthy();
    expect(screen.getByText("No starting rep estimate recorded.")).toBeTruthy();
  });

  it("offers a retry when the profile cannot be loaded", async () => {
    vi.mocked(authApiFetch).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(full);
    renderView();

    const retry = await screen.findByRole("button", { name: "Try again" });
    retry.click();

    await waitFor(() => expect(screen.getByRole("heading", { name: "Maya Okafor" })).toBeTruthy());
  });
});
