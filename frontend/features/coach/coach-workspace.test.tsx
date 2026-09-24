import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CoachWorkspace } from "./coach-workspace";
import { CoachMarkdown } from "./coach-markdown";
import { CoachComposer } from "./coach-composer";
import { PlanPreviewCard } from "./plan-preview";
import { ConversationSidebar, shortConversationTitle } from "./conversation-sidebar";
import { MessageList } from "./message-list";
import { useCoachReveal } from "./use-coach-reveal";
import * as api from "./api";

vi.mock("./api", () => ({
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  sendFirstMessage: vi.fn(),
  sendMessage: vi.fn(),
  renameConversation: vi.fn(),
  streamGeneration: vi.fn(),
  getPlanPreview: vi.fn(),
  savePlanPreview: vi.fn(),
}));

const first = { id: "first", title: "Improving Pull-Ups", created_at: "2026-09-23", updated_at: "2026-09-23" };
const second = { id: "second", title: "Front Lever", created_at: "2026-09-22", updated_at: "2026-09-22" };
const user = { id: "user-1", role: "user" as const, content: "Help my Pull-Ups", status: "completed" as const, created_at: "2026-09-23", generation_id: null };
const assistant = { id: "assistant-1", role: "assistant" as const, content: "", status: "streaming" as const, created_at: "2026-09-23", generation_id: "generation-1" };
const planPreview = { id: "preview-1", saved_plan_id: null, title: "Weekly strength", summary: "A modest week.", days: [{ day_index: 1, label: "Strength", exercises: [{ movement_id: "movement-1", movement_name: "Pull-Up", movement_slug: "pull-up", sets: 3, reps: 5, hold_seconds: null, rest_seconds: 90, notes: null }] }] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(api.listConversations).mockResolvedValue([]);
  vi.mocked(api.getConversation).mockResolvedValue({ ...first, messages: [] });
  vi.mocked(api.sendFirstMessage).mockResolvedValue({ conversation: first, generation_id: "generation-1", created: true });
  vi.mocked(api.sendMessage).mockResolvedValue({ generation_id: "generation-1", created: true });
  vi.mocked(api.renameConversation).mockResolvedValue(first);
  vi.mocked(api.streamGeneration).mockImplementation(async () => {});
  vi.mocked(api.getPlanPreview).mockResolvedValue(planPreview);
  vi.mocked(api.savePlanPreview).mockResolvedValue({ id: "saved-1", title: "Weekly strength", saved_at: "2026-09-23" });
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000001" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("Coach workspace", () => {
  it("opens an empty New chat without creating a database conversation", async () => {
    vi.mocked(api.listConversations).mockResolvedValue([first]);
    render(<CoachWorkspace />);
    await waitFor(() => expect(api.getConversation).toHaveBeenCalledWith("first"));
    fireEvent.click(screen.getByText("New chat"));
    expect(screen.getByText("Ask your Open Ascent Coach")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Loading conversation" })).toBeNull();
    expect(api.sendFirstMessage).not.toHaveBeenCalled();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("shows skeletons for existing history, then replaces them with persisted messages", async () => {
    const loaded = deferred<{ id: string; title: string; created_at: string; updated_at: string; messages: typeof user[] }>();
    vi.mocked(api.listConversations).mockResolvedValue([first]);
    vi.mocked(api.getConversation).mockReturnValue(loaded.promise);
    render(<CoachWorkspace />);
    await waitFor(() => expect(api.getConversation).toHaveBeenCalledWith("first"));
    expect(screen.getByRole("status", { name: "Loading conversation" })).toBeTruthy();
    expect(screen.getByLabelText("Loading conversation title")).toBeTruthy();
    expect(screen.queryByText("Ask your Open Ascent Coach")).toBeNull();
    await act(async () => loaded.resolve({ ...first, messages: [user] }));
    expect(screen.queryByRole("status", { name: "Loading conversation" })).toBeNull();
    expect(screen.getByText("Help my Pull-Ups")).toBeTruthy();
  });

  it("uses a skeleton while switching conversations and a real empty state for local New chat", async () => {
    const next = deferred<{ id: string; title: string; created_at: string; updated_at: string; messages: typeof user[] }>();
    vi.mocked(api.listConversations).mockResolvedValue([first, second]);
    vi.mocked(api.getConversation).mockImplementation(id => id === "second" ? next.promise : Promise.resolve({ ...first, messages: [user] }));
    render(<CoachWorkspace />);
    await screen.findByText("Help my Pull-Ups");
    fireEvent.click(screen.getByRole("button", { name: "Front Lever" }));
    expect(screen.getByRole("status", { name: "Loading conversation" })).toBeTruthy();
    expect(screen.queryByText("Ask your Open Ascent Coach")).toBeNull();
    await act(async () => next.resolve({ ...second, messages: [{ ...user, id: "user-2", content: "Front lever progressions" }] }));
    expect(screen.getByText("Front lever progressions")).toBeTruthy();
    fireEvent.click(screen.getByText("New chat"));
    expect(screen.queryByRole("status", { name: "Loading conversation" })).toBeNull();
    expect(screen.getByText("Ask your Open Ascent Coach")).toBeTruthy();
  });

  it("keeps a first send selected when the initial history list loads late", async () => {
    const history = deferred<(typeof first)[]>();
    const response = deferred<{ conversation: typeof first; generation_id: string; created: boolean }>();
    vi.mocked(api.listConversations).mockReturnValueOnce(history.promise);
    vi.mocked(api.sendFirstMessage).mockReturnValue(response.promise);
    render(<CoachWorkspace />);
    fireEvent.change(screen.getByLabelText("Message your coach"), { target: { value: "Improve my false grip" } });
    fireEvent.click(screen.getByLabelText("Send message"));
    expect(screen.getByText("Improve my false grip")).toBeTruthy();
    await act(async () => history.resolve([second]));
    expect(screen.getByText("Improve my false grip")).toBeTruthy();
    await act(async () => response.resolve({ conversation: first, generation_id: "generation-1", created: true }));
    expect(api.getConversation).toHaveBeenCalledWith("first");
  });

  it("shows the user and Coach immediately, then reconciles one first send and progressive SSE", async () => {
    const response = deferred<{ conversation: typeof first; generation_id: string; created: boolean }>();
    vi.mocked(api.sendFirstMessage).mockReturnValue(response.promise);
    vi.mocked(api.getConversation).mockResolvedValue({ ...first, messages: [user, assistant] });
    let snapshot: ((value: { id: string; status: "streaming" | "completed"; content: string; error_code: null }) => void) | undefined;
    vi.mocked(api.streamGeneration).mockImplementation(async (_conversation, _generation, onSnapshot) => { snapshot = onSnapshot; });
    render(<CoachWorkspace />);
    await screen.findByText("Ask your Open Ascent Coach");
    fireEvent.change(screen.getByLabelText("Message your coach"), { target: { value: "Help my Pull-Ups" } });
    fireEvent.click(screen.getByLabelText("Send message"));
    fireEvent.click(screen.getByLabelText("Send message"));
    expect(screen.getByText("Help my Pull-Ups")).toBeTruthy();
    expect(screen.getByText("Thinking…")).toBeTruthy();
    expect(screen.getByText("Sending…")).toBeTruthy();
    expect((screen.getByLabelText("Message your coach") as HTMLTextAreaElement).value).toBe("");
    expect(api.sendFirstMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).not.toHaveBeenCalled();
    await act(async () => response.resolve({ conversation: first, generation_id: "generation-1", created: true }));
    await waitFor(() => expect(snapshot).toBeTypeOf("function"));
    act(() => snapshot?.({ id: "generation-1", status: "streaming", content: "### First", error_code: null }));
    expect(await screen.findByText("First")).toBeTruthy();
    act(() => snapshot?.({ id: "generation-1", status: "streaming", content: "### First step\n- Pull-Ups", error_code: null }));
    expect(await screen.findByText("First step")).toBeTruthy();
    expect(await screen.findByText("Pull-Ups")).toBeTruthy();
    vi.mocked(api.getConversation).mockResolvedValue({ ...first, messages: [user, { ...assistant, content: "### First step\n- Pull-Ups", status: "completed" }] });
    act(() => snapshot?.({ id: "generation-1", status: "completed", content: "### First step\n- Pull-Ups", error_code: null }));
    await waitFor(() => expect(screen.queryByText("Thinking…")).toBeNull());
  });

  it("reveals only received SSE text, catches up, flushes on completion, and cancels on switch", () => {
    vi.useFakeTimers();
    const large = "### Stronger grip\n- Set the rings deeply in the palm.";
    const final = `${large}\n- Practice short holds.`;
    const { result, rerender, unmount } = renderHook(
      ({ key, text, status }) => useCoachReveal(key, text, status),
      { initialProps: { key: "first:g1", text: "", status: "streaming" } },
    );
    rerender({ key: "first:g1", text: large, status: "streaming" });
    expect(result.current).toBe("");
    act(() => vi.advanceTimersByTime(16));
    expect(result.current.length).toBeGreaterThan(0);
    expect(result.current.length).toBeLessThanOrEqual(4);
    expect(result.current.length).toBeLessThan(large.length);
    expect(large.startsWith(result.current)).toBe(true);
    rerender({ key: "first:g1", text: final, status: "streaming" });
    act(() => vi.advanceTimersByTime(48));
    expect(final.startsWith(result.current)).toBe(true);
    expect(result.current.length).toBeLessThan(final.length);
    rerender({ key: "first:g1", text: final, status: "completed" });
    expect(result.current).toBe(final);
    rerender({ key: "second:g2", text: "New answer", status: "streaming" });
    expect(result.current).toBe("");
    act(() => vi.advanceTimersByTime(16));
    expect("New answer".startsWith(result.current)).toBe(true);
    expect(result.current).not.toContain("Stronger grip");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("marks an uncertain send as failed and retries with the same request ID", async () => {
    vi.mocked(api.sendFirstMessage).mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue({ conversation: first, generation_id: "generation-1", created: false });
    render(<CoachWorkspace />);
    await screen.findByText("Ask your Open Ascent Coach");
    fireEvent.change(screen.getByLabelText("Message your coach"), { target: { value: "Help my Pull-Ups" } });
    fireEvent.click(screen.getByLabelText("Send message"));
    await screen.findByText("Delivery was not confirmed.");
    expect(screen.getByText("Help my Pull-Ups")).toBeTruthy();
    fireEvent.click(screen.getByText("Retry safely"));
    await waitFor(() => expect(api.sendFirstMessage).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.sendFirstMessage).mock.calls[0][1]).toBe(vi.mocked(api.sendFirstMessage).mock.calls[1][1]);
  });

  it("opens persisted history and switches conversations", async () => {
    vi.mocked(api.listConversations).mockResolvedValue([first, second]);
    vi.mocked(api.getConversation).mockImplementation(async id => ({ ...(id === first.id ? first : second), messages: id === first.id ? [user] : [] }));
    render(<CoachWorkspace />);
    await screen.findByText("Help my Pull-Ups");
    fireEvent.click(screen.getByText("Front Lever"));
    await waitFor(() => expect(api.getConversation).toHaveBeenCalledWith("second"));
    expect(screen.queryByText("Help my Pull-Ups")).toBeNull();
  });

  it("keeps interrupted partial text visible after reopen", async () => {
    vi.mocked(api.listConversations).mockResolvedValue([first]);
    vi.mocked(api.getConversation).mockResolvedValue({ ...first, messages: [user, { ...assistant, content: "Partial guidance", status: "interrupted" }] });
    render(<CoachWorkspace />);
    expect(await screen.findByText("Partial guidance")).toBeTruthy();
    expect(screen.getByText(/This response was interrupted/)).toBeTruthy();
    expect(api.streamGeneration).not.toHaveBeenCalled();
  });

  it("keeps sidebar titles concise and supports rename", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const longTitle = "For a beginner learning ring rows, give a heading, five concise steps";
    expect(shortConversationTitle(longTitle)).toMatch(/^For a beginner learning ring rows.*…$/);
    expect(shortConversationTitle(longTitle).length).toBeLessThanOrEqual(48);
    render(<ConversationSidebar conversations={[{ ...first, title: longTitle }]} selected="first" onSelect={vi.fn()} onNew={vi.fn()} onRename={onRename} />);
    expect(screen.getByText(/For a beginner learning ring rows/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(`Options for ${longTitle}`));
    fireEvent.click(await screen.findByText("Rename"));
    fireEvent.change(screen.getByLabelText("Conversation title"), { target: { value: "Ring Row Basics" } });
    fireEvent.click(screen.getByLabelText("Save title"));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("first", "Ring Row Basics"));
  });

  it("does not force scroll to bottom after manual scroll-up", () => {
    const { rerender } = render(<MessageList messages={[user, { ...assistant, content: "First" }]} />);
    const viewport = screen.getByLabelText("Message history");
    Object.defineProperties(viewport, { scrollHeight: { value: 1000, configurable: true }, clientHeight: { value: 200, configurable: true }, scrollTop: { value: 100, writable: true, configurable: true } });
    fireEvent.scroll(viewport);
    expect(screen.getByText("Jump to latest")).toBeTruthy();
    rerender(<MessageList messages={[user, { ...assistant, content: "First second" }]} />);
    expect(viewport.scrollTop).toBe(100);
    fireEvent.click(screen.getByText("Jump to latest"));
    expect(viewport.scrollTop).toBe(1000);
  });

  it("sends with Enter and keeps Shift+Enter for a newline", () => {
    const onSend = vi.fn();
    render(<CoachComposer draft="Question" onDraftChange={vi.fn()} onSend={onSend} sendBlocked={false} error={null} />);
    fireEvent.keyDown(screen.getByLabelText("Message your coach"), { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText("Message your coach"), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("requests a structured plan through the separate plan action", async () => {
    render(<CoachWorkspace />);
    await screen.findByText("Ask your Open Ascent Coach");
    fireEvent.change(screen.getByLabelText("Message your coach"), { target: { value: "Build my week" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate weekly plan" }));
    await waitFor(() => expect(api.sendFirstMessage).toHaveBeenCalledWith("Build my week", expect.any(String), "plan"));
  });

  it("shows a plan preview without saving, then saves only on explicit click", async () => {
    render(<PlanPreviewCard previewId="preview-1" />);
    expect(await screen.findByText("Weekly strength")).toBeTruthy();
    expect(screen.getByText("Preview · not saved")).toBeTruthy();
    expect(screen.getByText(/3 sets × 5 reps/)).toBeTruthy();
    expect(api.savePlanPreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save Plan" }));
    await waitFor(() => expect(api.savePlanPreview).toHaveBeenCalledWith("preview-1"));
    expect(await screen.findByText("Saved plan")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View saved plan in Library" }).getAttribute("href")).toBe("/dashboard/library/saved-1");
    expect(screen.getByRole("button", { name: "Saved" }).hasAttribute("disabled")).toBe(true);
    expect(api.savePlanPreview).toHaveBeenCalledTimes(1);
  });

  it("leaves the preview unsaved when save-time validation fails", async () => {
    vi.mocked(api.savePlanPreview).mockRejectedValue(new Error("Readiness evidence is no longer sufficient."));
    render(<PlanPreviewCard previewId="preview-1" />);
    await screen.findByText("Weekly strength");
    fireEvent.click(screen.getByRole("button", { name: "Save Plan" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Readiness evidence is no longer sufficient.");
    expect(screen.getByText("Preview · not saved")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Plan" }).hasAttribute("disabled")).toBe(false);
  });

  it("renders partial and complete Markdown without executing HTML", () => {
    const partial = renderToStaticMarkup(<CoachMarkdown content="### Next\n**Grip" />);
    expect(partial).toContain("<h3");
    const html = renderToStaticMarkup(<CoachMarkdown content={"### Next session\n- **Pull-Ups**\n\n| Cue | Correction |\n| --- | --- |\n| Grip | Reset |\n\n`wrist` <script>alert(1)</script>"} />);
    expect(html).toContain("<h3");
    expect(html).toContain("<ul");
    expect(html).toContain("<strong");
    expect(html).toContain("<table");
    expect(html).toContain("<code");
    expect(html).not.toContain("<script");
  });
});
