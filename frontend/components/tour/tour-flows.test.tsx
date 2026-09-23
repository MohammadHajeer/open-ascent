import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DashboardTour } from "./dashboard-tour";
import { GuestAnalysisTour } from "./guest-analysis-tour";

const nav = vi.hoisted(() => ({ pathname: "/dashboard", push: vi.fn() }));
const fetchTour = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: nav.push }) }));
vi.mock("@/lib/auth-api", () => ({ authApiFetch: fetchTour }));
vi.mock("./spotlight", () => ({
  Spotlight: ({ title, onBack, onNext, onExit }: { title: string; onBack?: () => void; onNext: () => void; onExit: () => void }) => <div role="dialog" aria-label={title}>
    {onBack && <button onClick={onBack}>Back</button>}
    <button onClick={onNext}>Next</button>
    <button onClick={onExit}>Exit tour</button>
  </div>,
}));

beforeEach(() => {
  nav.pathname = "/dashboard";
  nav.push.mockReset();
  fetchTour.mockReset();
  sessionStorage.clear();
});
afterEach(() => { cleanup(); document.querySelectorAll("[data-tour]").forEach((node) => node.remove()); });

it("offers the first dashboard visit and persists skip", async () => {
  fetchTour.mockResolvedValueOnce({ status: "not_started" }).mockResolvedValueOnce({ status: "dismissed" });
  render(<DashboardTour />);
  fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
  await waitFor(() => expect(fetchTour).toHaveBeenCalledWith("/profiles/me/dashboard-tour", expect.objectContaining({ method: "PUT", body: JSON.stringify({ status: "dismissed" }) })));
  expect(screen.queryByText("Want a quick tour of Open Ascent?")).toBeNull();
});

it("replays a completed dashboard tour without changing profile status", async () => {
  fetchTour.mockResolvedValue({ status: "completed" });
  render(<DashboardTour />);
  await waitFor(() => expect(fetchTour).toHaveBeenCalledTimes(1));
  window.dispatchEvent(new Event("dashboard-tour:replay"));
  expect(await screen.findByRole("dialog", { name: "Your overview" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(nav.push).toHaveBeenCalledWith("/dashboard/train");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(nav.push).toHaveBeenCalledWith("/dashboard");
  fireEvent.click(screen.getByRole("button", { name: "Exit tour" }));
  expect(fetchTour).toHaveBeenCalledTimes(1);
});

it("marks a first completed dashboard tour once", async () => {
  fetchTour.mockResolvedValueOnce({ status: "not_started" }).mockResolvedValueOnce({ status: "completed" });
  render(<DashboardTour />);
  fireEvent.click(await screen.findByRole("button", { name: "Start tour" }));
  for (let index = 0; index < 6; index++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(fetchTour).toHaveBeenCalledWith("/profiles/me/dashboard-tour", expect.objectContaining({ method: "PUT", body: JSON.stringify({ status: "completed" }) })));
  expect(screen.queryByRole("dialog", { name: "AI Coach" })).toBeNull();
  expect(nav.push).toHaveBeenCalledWith("/dashboard/coach");
});

it("does not automatically invite a dismissed athlete", async () => {
  fetchTour.mockResolvedValue({ status: "dismissed" });
  render(<DashboardTour />);
  await waitFor(() => expect(fetchTour).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("Want a quick tour of Open Ascent?")).toBeNull();
});

it("waits for the real guest processing and result targets", async () => {
  const movement = document.createElement("div");
  movement.dataset.tour = "guest-movement";
  document.body.append(movement);
  render(<GuestAnalysisTour />);
  fireEvent.click(await screen.findByRole("button", { name: "Start guide" }));
  expect(screen.getByRole("dialog", { name: "Choose your movement" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  const upload = document.createElement("div");
  upload.dataset.tour = "guest-upload";
  document.body.append(upload);
  await screen.findByRole("dialog", { name: "Add a short video" });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  const processing = document.createElement("div");
  processing.dataset.tour = "guest-processing";
  document.body.append(processing);
  await screen.findByRole("dialog", { name: "Analysis in progress" });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  const result = document.createElement("div");
  result.dataset.tour = "guest-result-summary";
  document.body.append(result);
  await screen.findByRole("dialog", { name: "Your result at a glance" });
  fireEvent.click(screen.getByRole("button", { name: "Exit tour" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(JSON.parse(sessionStorage.getItem("open-ascent:guest-analysis-tour:v1") ?? "{}").mode).toBe("dismissed");
});

it("waits through guest page loading before choosing the first visible step", async () => {
  render(<GuestAnalysisTour />);
  fireEvent.click(await screen.findByRole("button", { name: "Start guide" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  const upload = document.createElement("div");
  upload.dataset.tour = "guest-upload";
  document.body.append(upload);
  await screen.findByRole("dialog", { name: "Add a short video" });
});
