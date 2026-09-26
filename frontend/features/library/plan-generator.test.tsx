import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanGenerator } from "./plan-generator";
import * as libraryApi from "./api";
import * as coachApi from "@/features/coach/api";

vi.mock("./api", () => ({ getGenerationOptions: vi.fn(), preflightLibraryPlan: vi.fn(), submitReadinessCheck: vi.fn(), startLibraryPlan: vi.fn() }));
vi.mock("@/features/coach/api", () => ({ getConversation: vi.fn(), streamGeneration: vi.fn() }));
vi.mock("@/features/coach/plan-preview", () => ({ PlanPreviewCard: ({ previewId }: { previewId: string }) => <p>Preview {previewId}</p> }));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PlanGenerator /></QueryClientProvider>);
}

beforeEach(() => {
  vi.mocked(libraryApi.preflightLibraryPlan).mockResolvedValue({ status: "ready", questions: [] });
  vi.mocked(libraryApi.getGenerationOptions).mockResolvedValue({
    goals: [{ id: "c7713458-d793-4b0a-9de4-c5bde2ca5894", name: "Muscle-Up" }],
    progress_available: false, plan_allowance: 1, plan_remaining: 1,
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Library plan generator", () => {
  it("explains why progress mode is unavailable without history", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Adapt to my progress/ }));
    expect(await screen.findByText(/Log at least two workouts to use progress adaptation/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Generate plan" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("submits a canonical goal and opens the shared structured preview", async () => {
    vi.mocked(libraryApi.startLibraryPlan).mockResolvedValue({ conversation_id: "conversation", generation_id: "generation", created: true });
    vi.mocked(coachApi.getConversation).mockResolvedValue({ id: "conversation", title: "Goal", created_at: "", updated_at: "", messages: [
      { id: "reply", role: "assistant", content: "Ready", status: "completed", created_at: "", generation_id: "generation", plan_preview_id: "preview" },
    ] });
    vi.mocked(coachApi.streamGeneration).mockImplementation(async (_conversation, _generation, onSnapshot) => {
      onSnapshot({ id: "generation", status: "completed", content: "Ready", error_code: null });
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Build toward a goal/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "Your goal" }));
    const option = await screen.findByRole("option", { name: "Muscle-Up" });
    fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(option, { pointerType: "mouse", button: 0 });
    fireEvent.click(option);
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Your goal" }).parentElement?.querySelector("input") as HTMLInputElement).value).toBe("c7713458-d793-4b0a-9de4-c5bde2ca5894"));
    fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));
    await waitFor(() => expect(libraryApi.startLibraryPlan).toHaveBeenCalledWith(expect.objectContaining({
      mode: "goal", goal_movement_id: "c7713458-d793-4b0a-9de4-c5bde2ca5894",
    })));
    expect(await screen.findByText("Preview preview")).toBeTruthy();
  });

  it("collects a provisional foundation answer before spending a generation", async () => {
    const question = {
      movement_id: "663a1d09-6fae-4a4b-9329-741db58d4417",
      documentation_id: "2acbd3c0-5e45-4bd9-9940-d62dc71e319e",
      rule_code: "recent_logged_push_up", movement_name: "Push-Up",
      requirement: "At least five controlled Push-Ups",
      question: "Can you perform at least 5 controlled Push-Up repetitions without pain?",
    };
    vi.mocked(libraryApi.preflightLibraryPlan)
      .mockResolvedValueOnce({ status: "check_required", questions: [question] })
      .mockResolvedValueOnce({ status: "ready", questions: [] });
    vi.mocked(libraryApi.submitReadinessCheck).mockResolvedValue({ saved: 1 });
    vi.mocked(libraryApi.startLibraryPlan).mockResolvedValue({ conversation_id: "conversation", generation_id: "generation", created: true });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Start from my profile/ }));
    fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));
    expect(await screen.findByText("Quick readiness check")).toBeTruthy();
    expect(libraryApi.startLibraryPlan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("combobox", { name: question.question }));
    const option = await screen.findByRole("option", { name: "Yes, with control and no pain" });
    fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(option, { pointerType: "mouse", button: 0 });
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: "Continue to plan" }));
    await waitFor(() => expect(libraryApi.submitReadinessCheck).toHaveBeenCalledWith([{
      movement_id: question.movement_id, documentation_id: question.documentation_id,
      rule_code: question.rule_code, response: "able",
    }]));
    await waitFor(() => expect(libraryApi.startLibraryPlan).toHaveBeenCalledTimes(1));
  });

  it("keeps an unavailable plan unmetered and offers answer correction", async () => {
    vi.mocked(libraryApi.preflightLibraryPlan).mockResolvedValue({
      status: "unavailable", message: "No suitable foundation movement passes readiness yet.",
      questions: [{ movement_id: "movement", documentation_id: "guide", rule_code: "recent_logged_push_up",
        movement_name: "Push-Up", requirement: "Five controlled repetitions", question: "Can you do five Push-Ups?" }],
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Start from my profile/ }));
    fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));
    expect(await screen.findByText("No suitable foundation movement passes readiness yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update readiness answers" })).toBeTruthy();
    expect(libraryApi.startLibraryPlan).not.toHaveBeenCalled();
  });

  it("lets a newly onboarded Free athlete go straight from profile to a starter-plan preview", async () => {
    vi.mocked(libraryApi.getGenerationOptions)
      .mockResolvedValueOnce({ goals: [], progress_available: false, plan_allowance: 1, plan_remaining: 1 })
      .mockResolvedValue({ goals: [], progress_available: false, plan_allowance: 1, plan_remaining: 0 });
    vi.mocked(libraryApi.startLibraryPlan).mockResolvedValue({ conversation_id: "conversation", generation_id: "generation", created: true });
    vi.mocked(coachApi.getConversation).mockResolvedValue({ id: "conversation", title: "Starter", created_at: "", updated_at: "", messages: [
      { id: "reply", role: "assistant", content: "Ready", status: "completed", created_at: "", generation_id: "generation", plan_preview_id: "starter" },
    ] });
    vi.mocked(coachApi.streamGeneration).mockImplementation(async (_conversation, _generation, onSnapshot) => {
      onSnapshot({ id: "generation", status: "completed", content: "Ready", error_code: null });
    });
    mount();
    expect(await screen.findByText("1 of 1 plan generations remaining this month.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Start from my profile/ }));
    fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));
    expect(await screen.findByText("Preview starter")).toBeTruthy();
    expect(screen.queryByText("Quick readiness check")).toBeNull();
    expect(libraryApi.submitReadinessCheck).not.toHaveBeenCalled();
    expect(libraryApi.startLibraryPlan).toHaveBeenCalledTimes(1);
    expect(libraryApi.startLibraryPlan).toHaveBeenCalledWith(expect.objectContaining({ mode: "profile" }));
    await waitFor(() => expect(libraryApi.getGenerationOptions).toHaveBeenCalledTimes(2));
  });
});
