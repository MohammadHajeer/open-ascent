import { act, cleanup, render, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "./sonner";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light" }) }));

beforeEach(() => {
  navigation.pathname = "/";
});
afterEach(() => {
  act(() => { toast.dismiss(); });
  cleanup();
});

async function showToast(show: () => void) {
  render(<Toaster />);
  act(show);
  return waitFor(() => {
    const element = document.querySelector<HTMLElement>("[data-sonner-toast]");
    expect(element).not.toBeNull();
    return element as HTMLElement;
  });
}

describe("Open Ascent Toaster", () => {
  it.each([
    ["success", () => toast.success("Set logged")],
    ["error", () => toast.error("Could not sign out", { description: "Try again." })],
    ["warning", () => toast.warning("Session unavailable")],
    ["info", () => toast.info("Email sent")],
  ] as const)("renders %s toasts through the shared branded treatment", async (type, show) => {
    const element = await showToast(show);

    expect(element.dataset.type).toBe(type);
    // Sonner's default palette is off: the toast is styled by our class map.
    expect(element.dataset.styled).toBe("false");
    expect(element.className).toContain("bg-popover");
    expect(document.querySelector("[data-sonner-toaster]")?.getAttribute("data-rich-colors")).not.toBe("true");
    expect(element.querySelector("[data-icon] svg")).not.toBeNull();
  });

  it("keeps toasts announced through the notifications region", async () => {
    await showToast(() => toast.success("Saved"));

    expect(document.querySelector('section[aria-label^="Notifications"]')).not.toBeNull();
  });

  it("lifts toasts above the floating navigation only inside the signed-in app", async () => {
    navigation.pathname = "/dashboard/train";
    await showToast(() => toast.success("Set logged"));
    expect(document.querySelector("[data-sonner-toaster]")?.className).toContain("oa-toaster-above-nav");

    cleanup();
    navigation.pathname = "/movements";
    await showToast(() => toast.success("Elsewhere"));
    expect(document.querySelector("[data-sonner-toaster]")?.className).not.toContain("oa-toaster-above-nav");
  });
});
