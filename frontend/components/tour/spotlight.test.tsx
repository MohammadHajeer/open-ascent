import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Spotlight } from "./spotlight";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); document.querySelectorAll("[data-tour]").forEach((node) => node.remove()); });

it("releases a missing target instead of trapping the athlete", () => {
  vi.useFakeTimers();
  const onMissing = vi.fn();
  render(<Spotlight target="never-mounted" title="Missing" description="" progress="1 of 1" onNext={vi.fn()} onExit={vi.fn()} onMissing={onMissing} />);
  act(() => vi.advanceTimersByTime(5100));
  expect(onMissing).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("supports Escape to leave a mounted spotlight", async () => {
  const target = document.createElement("div");
  target.dataset.tour = "available";
  document.body.append(target);
  target.scrollIntoView = vi.fn();
  const onExit = vi.fn();
  render(<Spotlight target="available" title="Available" description="A target" progress="1 of 1" onNext={vi.fn()} onExit={onExit} />);
  await waitFor(() => expect(screen.getByRole("dialog", { name: "Available" })).toBeTruthy());
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onExit).toHaveBeenCalledOnce();
});
