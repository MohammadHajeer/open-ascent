import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanGenerator } from "./plan-generator";
import * as libraryApi from "./api";
import * as coachApi from "@/features/coach/api";

vi.mock("./api", () => ({ getGenerationOptions: vi.fn(), startLibraryPlan: vi.fn() }));
vi.mock("@/features/coach/api", () => ({ getConversation: vi.fn(), streamGeneration: vi.fn() }));
vi.mock("@/features/coach/plan-preview", () => ({ PlanPreviewCard: ({ previewId }: { previewId: string }) => <p>Preview {previewId}</p> }));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PlanGenerator /></QueryClientProvider>);
}

beforeEach(() => {
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
    await screen.findByRole("option", { name: "Muscle-Up" });
    fireEvent.change(screen.getByRole("combobox", { name: "Your goal" }), { target: { value: "c7713458-d793-4b0a-9de4-c5bde2ca5894" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));
    await waitFor(() => expect(libraryApi.startLibraryPlan).toHaveBeenCalledWith(expect.objectContaining({
      mode: "goal", goal_movement_id: "c7713458-d793-4b0a-9de4-c5bde2ca5894",
    })));
    expect(await screen.findByText("Preview preview")).toBeTruthy();
  });
});
